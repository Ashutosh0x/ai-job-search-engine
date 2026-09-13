/**
 * Find out whether an HR platform has a public job API, by asking it.
 *
 *   node scripts/probe-hrms-platforms.mjs
 *   node scripts/probe-hrms-platforms.mjs --platforms keka,darwinbox
 *
 * WHY
 * ---
 * "No public API — headless browser needed" is a claim that decides whether a
 * platform costs an afternoon or a browser farm, and it is wrong often enough
 * to be worth five minutes of checking. The same document that said this of
 * Oracle Recruiting and Eightfold was describing two adapters this repo
 * already ships, both reading plain JSON.
 *
 * So this does not take the claim at its word. For each platform it finds real
 * tenants in the Common Crawl index -- guessed tenant names prove nothing,
 * because a 404 from a tenant that never existed looks exactly like a 404 from
 * a platform with no API -- then loads a real career page and reads what the
 * page itself fetches. A career page that renders jobs in the browser must get
 * them from somewhere, and that somewhere is usually a JSON endpoint that
 * needs no key.
 *
 * OUTPUT
 * ------
 * scripts/hrms-probe-results.json, with the evidence per platform: tenants
 * found, endpoints tried, and the shape of anything that answered. Nothing is
 * written to the registry from here -- this decides whether an adapter is
 * worth writing, and against what.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const CACHE = '.cc'
if (!existsSync(CACHE)) mkdirSync(CACHE)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/**
 * Each platform: the host shape to look for in the crawl index, how to read a
 * tenant out of a URL, and the career-page path to load once we have one.
 */
const PLATFORMS = [
  {
    id: 'zohorecruit',
    indexUrl: '*.zohorecruit.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9][a-z0-9-]*)\.zohorecruit\.(?:com|in|eu)\//i)
      return m && !/^(www|recruit|help|blog)$/i.test(m[1]) ? m[1].toLowerCase() : null
    },
    careerPage: (t) => `https://${t}.zohorecruit.com/jobs/Careers`,
  },
  {
    id: 'darwinbox',
    indexUrl: '*.darwinbox.in',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9][a-z0-9-]*)\.darwinbox\.in\//i)
      return m && !/^(www|app|help|blog|india)$/i.test(m[1]) ? m[1].toLowerCase() : null
    },
    careerPage: (t) => `https://${t}.darwinbox.in/ms/candidate/careers`,
  },
  {
    id: 'keka',
    indexUrl: '*.keka.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9][a-z0-9-]*)\.keka\.com\//i)
      return m && !/^(www|help|blog|docs|support|status|assets)$/i.test(m[1]) ? m[1].toLowerCase() : null
    },
    careerPage: (t) => `https://${t}.keka.com/careers/`,
  },
  {
    id: 'peoplestrong',
    indexUrl: '*.peoplestrong.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9][a-z0-9-]*)\.peoplestrong\.com\//i)
      return m && !/^(www|help|blog|docs|support)$/i.test(m[1]) ? m[1].toLowerCase() : null
    },
    careerPage: (t) => `https://${t}.peoplestrong.com/`,
  },
]

const WANTED = val('platforms', '').trim()
const RUN = WANTED ? PLATFORMS.filter((p) => WANTED.split(',').includes(p.id)) : PLATFORMS

async function get(url, opts = {}, timeoutMs = 60_000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, ...opts, signal: ctl.signal })
    return { status: r.status, ct: r.headers.get('content-type') || '', body: await r.text() }
  } catch (e) {
    return { status: 0, ct: '', body: '', error: e.name }
  } finally { clearTimeout(t) }
}

/* ------------------------- 1. real tenants from CC ------------------------ */

async function tenantsFor(p) {
  const cacheFile = `${CACHE}/hrms__${p.id}.jsonl`
  let text
  if (existsSync(cacheFile)) {
    text = readFileSync(cacheFile, 'utf8')
    console.log(`  ${p.id}: crawl index (cached)`)
  } else {
    const crawls = await get('https://index.commoncrawl.org/collinfo.json')
    let crawl = 'CC-MAIN-2026-25'
    try { crawl = JSON.parse(crawls.body)[0].id } catch { /* fall back */ }
    const base = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(p.indexUrl)}&output=json`
    const meta = await get(`${base}&showNumPages=true`, {}, 120_000)
    let pages = 1
    try { pages = JSON.parse(meta.body).pages ?? 1 } catch { pages = 1 }
    // A handful of pages is plenty to learn whether an API exists; this is not
    // a full harvest.
    pages = Math.min(pages, 3)
    console.log(`  ${p.id}: fetching ${pages} index page(s)`)
    const parts = []
    for (let i = 0; i < pages; i++) {
      const r = await get(`${base}&page=${i}`, {}, 180_000)
      if (r.status === 200) parts.push(r.body)
    }
    text = parts.join('\n')
    writeFileSync(cacheFile, text)
  }

  const counts = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let u
    try { u = JSON.parse(line).url } catch { continue }
    if (!u) continue
    const t = p.extract(u)
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tenant: t, hits: n }))
}

/* --------------------- 2. what does the page itself call? ----------------- */

/**
 * Pull candidate API URLs out of a career page.
 *
 * Two sources: absolute/relative URLs that look like endpoints, and the
 * Next.js/embedded JSON blobs that some of these platforms ship the first page
 * of results in. Either answers the question.
 */
function endpointsIn(html, origin) {
  const out = new Set()
  const re = /["'`](\/(?:[a-z0-9_\-./]*)?(?:api|jobs|careers|openings|search|embed)[a-z0-9_\-./]*)["'`]/gi
  for (const m of html.matchAll(re)) {
    const path = m[1]
    if (/\.(png|jpe?g|svg|gif|css|woff2?|ico|webp)$/i.test(path)) continue
    if (path.length > 120) continue
    out.add(origin + path)
  }
  for (const m of html.matchAll(/https?:\/\/[a-z0-9.-]+\/[a-z0-9_\-./]*(?:api|openings|jobs)[a-z0-9_\-./]*/gi)) {
    if (!/\.(png|jpe?g|svg|gif|css|woff2?|ico)$/i.test(m[0])) out.add(m[0])
  }
  return [...out]
}

const looksLikeJobs = (body) => {
  try {
    const j = JSON.parse(body)
    const s = JSON.stringify(j)
    // A jobs payload names jobs and carries more than one of them.
    return /"(jobTitle|job_title|title|jobOpeningName|designation)"/i.test(s) && s.length > 400
  } catch { return false }
}

/* --------------------------------- run ------------------------------------ */

const results = []

for (const p of RUN) {
  console.log(`\n=== ${p.id} ===`)
  let tenants = []
  try { tenants = await tenantsFor(p) } catch (e) { console.log(`  index failed: ${e.message}`) }
  console.log(`  tenants found in crawl index: ${tenants.length}`)
  if (tenants.length) console.log(`  top: ${tenants.slice(0, 8).map((t) => t.tenant).join(', ')}`)

  const tried = []
  let verdict = 'NO TENANTS FOUND'
  let workingEndpoint = null
  let sampleTenant = null

  for (const { tenant } of tenants.slice(0, 4)) {
    const origin = new URL(p.careerPage(tenant)).origin
    const page = await get(p.careerPage(tenant))
    tried.push({ tenant, url: p.careerPage(tenant), status: page.status, len: page.body.length })
    console.log(`  ${tenant}: career page http ${page.status}, ${page.body.length} bytes`)
    if (page.status !== 200 || !page.body) { verdict = 'CAREER PAGE UNREACHABLE'; continue }

    // The page itself may already carry the jobs.
    if (looksLikeJobs(page.body)) {
      verdict = 'JSON ON THE PAGE'
      workingEndpoint = p.careerPage(tenant)
      sampleTenant = tenant
      break
    }

    const candidates = endpointsIn(page.body, origin).slice(0, 14)
    console.log(`    ${candidates.length} candidate endpoint(s) referenced by the page`)
    for (const url of candidates) {
      const r = await get(url, { headers: { Accept: 'application/json' } }, 25_000)
      const ok = r.status === 200 && /json/i.test(r.ct) && looksLikeJobs(r.body)
      tried.push({ tenant, url, status: r.status, ct: r.ct.slice(0, 40), jobs: ok })
      if (ok) {
        console.log(`    >>> PUBLIC JSON: ${url}`)
        verdict = 'PUBLIC JSON API'
        workingEndpoint = url
        sampleTenant = tenant
        break
      }
    }
    if (workingEndpoint) break
    verdict = 'NO PUBLIC JSON FOUND'
  }

  console.log(`  verdict: ${verdict}${workingEndpoint ? ` -> ${workingEndpoint}` : ''}`)
  results.push({
    platform: p.id,
    tenantsFound: tenants.length,
    topTenants: tenants.slice(0, 12),
    verdict,
    workingEndpoint,
    sampleTenant,
    attempts: tried.slice(0, 40),
  })
}

writeFileSync('scripts/hrms-probe-results.json', JSON.stringify({
  probedAt: new Date().toISOString(),
  note: 'Verdicts are what these endpoints returned when called. A NO PUBLIC JSON FOUND verdict means none was found from the career page, not that none exists.',
  results,
}, null, 2))

console.log('\n--- summary ---')
for (const r of results) {
  console.log(`  ${r.platform.padEnd(14)} ${String(r.tenantsFound).padStart(5)} tenants  ${r.verdict}`)
}
console.log('\nwrote scripts/hrms-probe-results.json')
