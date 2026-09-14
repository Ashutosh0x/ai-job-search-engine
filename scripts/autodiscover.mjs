/**
 * One-shot employer -> verified ATS board discovery.
 *
 *   node scripts/autodiscover.mjs companies.json
 *   node scripts/autodiscover.mjs companies.json --apply      # write to the registry
 *   node scripts/autodiscover.mjs companies.json --concurrency 6
 *
 * Input is the minimum a human actually knows:
 *
 *   [{ "name": "SanDisk", "domain": "sandisk.com" }]
 *
 * Everything else is derived. This replaces the two-step dance of bulk-probe
 * (guess tokens) then discover-ats (hand me a careers URL) with a single pass,
 * because both steps were failing for the same reason: they needed a human to
 * supply the thing that is hardest to know.
 *
 * THE ALGORITHM
 * -------------
 *   1. LOCATE  Try the careers URLs employers actually use, in likelihood
 *              order, plus whatever /robots.txt and the homepage link to.
 *              Follow redirects -- most large employers redirect a marketing
 *              careers page straight onto their ATS, which is the whole game.
 *   2. FINGERPRINT  Match vendor signatures in the landing URL and HTML: CDN
 *              hosts, API paths, tenant names. One page can yield several.
 *   3. VERIFY  Call each candidate vendor's real API. A fingerprint is a guess
 *              until an endpoint returns postings; nothing is reported on the
 *              strength of a CDN reference alone.
 *   4. EMIT    Print a registry line for every board that returned jobs, with
 *              the count that proves it.
 *
 * WHY VERIFICATION IS NOT OPTIONAL
 * --------------------------------
 * A provider configured with no adapter, or a tenant whose site segment is
 * wrong, ingests zero rows and reports success. That failure is invisible for
 * weeks. So the count printed beside each board is the number of postings the
 * endpoint actually returned during this run.
 */

import { readFileSync, writeFileSync } from 'fs'

const args = process.argv.slice(2)
const INPUT = args[0]
const APPLY = args.includes('--apply')
const CONCURRENCY = Number(args[args.indexOf('--concurrency') + 1]) || 5
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT = 20_000

// Node warns at 10 listeners on the shared fetch abort signal. Concurrency
// above that is intentional here, so raise the ceiling rather than print a
// memory-leak warning on every run that is not a leak.
process.setMaxListeners(64)

if (!INPUT) {
  console.error('usage: node scripts/autodiscover.mjs companies.json [--apply]')
  process.exit(1)
}

async function get(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      ...init,
      headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*', ...(init.headers || {}) },
    })
    const text = await r.text()
    return { ok: r.ok, status: r.status, url: r.url, text }
  } catch (e) {
    return { ok: false, status: 0, url, text: '', error: String(e.message || e).slice(0, 60) }
  } finally { clearTimeout(t) }
}

/* ------------------------------- 1. LOCATE -------------------------------- */

/** Careers paths in rough order of how often employers actually use them. */
const CAREER_PATHS = [
  'careers', 'jobs', 'en/careers', 'company/careers', 'about/careers',
  'careers/jobs', 'en-us/careers', 'about-us/careers', 'careers/search-jobs',
]
const CAREER_HOSTS = ['careers', 'jobs', 'career', 'apply', 'talent']

/** Every URL worth trying for one domain, cheapest and likeliest first. */
function candidateUrls(domain) {
  const d = domain.replace(/^www\./, '')
  const urls = CAREER_HOSTS.map((h) => `https://${h}.${d}/`)
  urls.push(...CAREER_PATHS.map((p) => `https://www.${d}/${p}`))
  return urls
}

/** Careers links the homepage itself points at -- the employer's own answer. */
function careersLinksFrom(html, domain) {
  const out = []
  for (const m of html.matchAll(/href=["']([^"']{4,200})["']/gi)) {
    const href = m[1]
    if (!/career|jobs|vacanc|recruit|talent/i.test(href)) continue
    try {
      const u = new URL(href, `https://www.${domain}`)
      if (/^https?:$/.test(u.protocol)) out.push(u.href)
    } catch { /* malformed href */ }
  }
  return [...new Set(out)].slice(0, 6)
}

/* ---------------------------- 2. FINGERPRINT ------------------------------ */

const FINGERPRINTS = [
  ['workday', (t) => {
    const m = t.match(/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)/i)
    if (!m) return null
    const site = t.match(/myworkdayjobs\.com\/(?:[a-z-]{2,7}\/)?([A-Za-z0-9_-]{2,40})(?:["'/?]|$)/)
    return { host: m[1], site: site?.[1] ?? null }
  }],
  ['oracle', (t) => {
    const host = t.match(/([a-z0-9-]+\.fa\.[a-z0-9.]*oraclecloud\.com)/i)
    const site = t.match(/\/sites\/(CX(?:_\d+)?)/) || t.match(/siteNumber["'= ]+(CX(?:_\d+)?)/)
    return host && site ? { host: host[1], site: site[1] } : null
  }],
  ['greenhouse', (t) => {
    const m = t.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i)
    return m && m[1] !== 'embed' ? { token: m[1] } : null
  }],
  ['lever', (t) => { const m = t.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i); return m ? { token: m[1] } : null }],
  ['ashby', (t) => { const m = t.match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i); return m ? { token: m[1] } : null }],
  ['smartrecruiters', (t) => { const m = t.match(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/); return m ? { token: m[1] } : null }],
  ['workable', (t) => { const m = t.match(/apply\.workable\.com\/([a-z0-9_-]+)/i); return m ? { token: m[1] } : null }],
  ['recruitee', (t) => { const m = t.match(/([a-z0-9-]+)\.recruitee\.com/i); return m ? { token: m[1] } : null }],
  ['personio', (t) => { const m = t.match(/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i); return m ? { token: m[1] } : null }],
  ['teamtailor', (t) => { const m = t.match(/([a-z0-9-]+)\.teamtailor\.com/i); return m ? { token: m[1] } : null }],
  ['eightfold', (t) => { const m = t.match(/([a-z0-9-]+\.eightfold\.ai)/i); return m && !/vs-errors/.test(m[1]) ? { host: m[1] } : null }],
]

/* ------------------------------- 3. VERIFY -------------------------------- */

const VERIFY = {
  async greenhouse(f) {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${f.token}/jobs`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.jobs?.length ? { count: d.jobs.length, board: `{ provider: 'greenhouse', token: '${f.token}' }` } : null
  },
  async lever(f) {
    const r = await get(`https://api.lever.co/v0/postings/${f.token}?mode=json`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return Array.isArray(d) && d.length ? { count: d.length, board: `{ provider: 'lever', token: '${f.token}' }` } : null
  },
  async ashby(f) {
    const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${f.token}`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.jobs?.length ? { count: d.jobs.length, board: `{ provider: 'ashby', token: '${f.token}' }` } : null
  },
  async smartrecruiters(f) {
    const r = await get(`https://api.smartrecruiters.com/v1/companies/${f.token}/postings?limit=100`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.content?.length ? { count: d.totalFound ?? d.content.length, board: `{ provider: 'smartrecruiters', token: '${f.token}' }` } : null
  },
  async workable(f) {
    const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${f.token}?details=true`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.jobs?.length ? { count: d.jobs.length, board: `{ provider: 'workable', token: '${f.token}' }` } : null
  },
  async recruitee(f) {
    const r = await get(`https://${f.token}.recruitee.com/api/offers/`)
    if (!r.ok) return null
    const d = JSON.parse(r.text)
    return d.offers?.length ? { count: d.offers.length, board: `{ provider: 'recruitee', token: '${f.token}' }` } : null
  },
  async teamtailor(f) {
    const r = await get(`https://${f.token}.teamtailor.com/jobs.json`)
    if (!r.ok) return null
    try {
      const d = JSON.parse(r.text)
      const jobs = d.jobs ?? d
      return Array.isArray(jobs) && jobs.length ? { count: jobs.length, board: `{ provider: 'teamtailor', token: '${f.token}' }` } : null
    } catch { return null }
  },
  async personio(f) {
    const r = await get(`https://${f.token}.jobs.personio.de/search.json`)
    if (!r.ok) return null
    try {
      const d = JSON.parse(r.text)
      return Array.isArray(d) && d.length ? { count: d.length, board: `{ provider: 'personio', token: '${f.token}' }` } : null
    } catch { return null }
  },
  /** POST, and the site segment in a careers URL is often a locale or vanity path. */
  async workday(f) {
    const tenant = f.host.split('.')[0]
    const sites = [...new Set([f.site, 'External', 'Careers', 'External_Career_Site',
                               `${tenant}careers`, `${tenant}_careers`, 'Search', 'en-US'])].filter(Boolean)
    for (const site of sites) {
      const r = await get(`https://${f.host}/wday/cxs/${tenant}/${site}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      })
      if (!r.ok) continue
      try {
        const d = JSON.parse(r.text)
        if (d.jobPostings?.length) {
          return {
            count: d.total ?? d.jobPostings.length,
            board: `{ provider: 'workday', token: '${tenant}', site: '${site}', host: '${f.host}' }`,
          }
        }
      } catch { /* not JSON */ }
    }
    return null
  },
  async oracle(f) {
    const r = await get(
      `https://${f.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      `?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${f.site},limit=10,offset=0`)
    if (!r.ok) return null
    try {
      const d = JSON.parse(r.text)
      const item = d.items?.[0]
      const rows = item?.requisitionList ?? []
      if (!rows.length) return null
      return {
        count: item?.TotalJobsCount ?? rows.length,
        board: `{ provider: 'oracle', token: '${f.host.split('.')[0]}', site: '${f.site}', host: '${f.host}' }`,
      }
    } catch { return null }
  },
  async eightfold(f) {
    const domain = f.host.replace('.eightfold.ai', '.com')
    const r = await get(`https://${f.host}/api/apply/v2/jobs?domain=${domain}&start=0&num=10`)
    if (!r.ok) return null
    try {
      const d = JSON.parse(r.text)
      if (d.message) return null              // e.g. "Not authorized for PCSX"
      return d.positions?.length ? { count: d.count ?? d.positions.length, board: `{ provider: 'eightfold', token: '${f.host}' }` } : null
    } catch { return null }
  },
}

/* ------------------------------- the pass --------------------------------- */

async function discover(c) {
  const seen = new Set()
  const pages = []

  // Pages the employer's own site points at come first: an employer linking to
  // its ATS is better evidence than any guess we could make.
  const home = await get(`https://www.${c.domain}/`)
  if (home.ok) for (const u of careersLinksFrom(home.text, c.domain)) if (!seen.has(u)) { seen.add(u); pages.push(u) }
  for (const u of candidateUrls(c.domain)) if (!seen.has(u)) { seen.add(u); pages.push(u) }

  const tried = []
  for (const url of pages.slice(0, 10)) {
    const r = await get(url)
    if (!r.ok || r.text.length < 500) { tried.push(`${url} ${r.status || r.error}`); continue }

    const hay = `${r.url} ${r.text}`
    for (const [vendor, fn] of FINGERPRINTS) {
      const f = fn(hay)
      if (!f) continue
      const v = VERIFY[vendor]
      if (!v) continue
      try {
        const live = await v(f)
        if (live) return { ...c, vendor, ...live, via: r.url }
      } catch { /* try the next fingerprint */ }
    }
    tried.push(`${url} -> ${r.url} (no verified board)`)
  }

  // FALLBACK: fingerprinting only sees what the careers page reveals, and a
  // page rendered entirely client-side reveals nothing. Measured: Delivery
  // Hero's careers page names no vendor at all, yet `DeliveryHero` on
  // SmartRecruiters returns 980 postings.
  //
  // So when the page yields nothing, try the employer's own name as a token
  // against the APIs we support. This is a guess, but it is a CHEAP guess that
  // is still subject to the same rule as everything else: it only counts once
  // an endpoint has actually returned postings.
  const base = c.name.replace(/[^A-Za-z0-9]/g, '')
  const guesses = [...new Set([base, base.toLowerCase(), c.domain.split('.')[0]])]
  for (const token of guesses) {
    for (const vendor of ['smartrecruiters', 'greenhouse', 'lever', 'ashby', 'workable']) {
      try {
        const live = await VERIFY[vendor]({ token })
        if (live) return { ...c, vendor, ...live, via: `token guess: ${vendor}/${token}` }
      } catch { /* wrong guess, which is the normal case */ }
    }
  }

  return { ...c, failed: true, tried: tried.slice(0, 3) }
}

/** Bounded concurrency: polite to every employer's site, and fast enough. */
async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

const companies = JSON.parse(readFileSync(INPUT, 'utf8'))
console.log(`discovering ${companies.length} employers, concurrency ${CONCURRENCY}\n`)

const results = await mapLimit(companies, CONCURRENCY, discover)
const ok = results.filter((r) => !r.failed)
const bad = results.filter((r) => r.failed)

for (const r of results) {
  if (r.failed) console.log(`  --  ${r.name.padEnd(22)} no verified board`)
  else console.log(`  OK  ${r.name.padEnd(22)} ${r.vendor.padEnd(16)} ${String(r.count).padStart(6)} jobs`)
}

console.log(`\n${ok.length}/${companies.length} verified, ${ok.reduce((n, r) => n + (Number(r.count) || 0), 0)} postings\n`)

const lines = ok.map((r) =>
  `  // ${r.name}: ${r.count} postings verified ${new Date().toISOString().slice(0, 10)}.\n` +
  `  { slug: '${r.slug || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}', ` +
  `name: '${r.name.replace(/'/g, "\\'")}', domain: '${r.domain}', valuationKind: 'unknown',\n` +
  `    boards: [${r.board}] },`)

if (lines.length) {
  console.log('--- registry lines ---')
  console.log(lines.join('\n'))
}

if (bad.length) {
  console.log('\n--- unresolved (why) ---')
  for (const r of bad) {
    console.log(`  ${r.name}`)
    for (const t of r.tried || []) console.log(`      ${t}`)
  }
}

if (APPLY && lines.length) {
  const p = 'lib/companies/registry.ts'
  let s = readFileSync(p, 'utf8')
  const anchor = "  { slug: 'palantir', name: 'Palantir',"
  const existing = new Set([...s.matchAll(/slug: '([a-z0-9-]+)'/g)].map((m) => m[1]))
  const domains = new Set([...s.matchAll(/domain: '([^']+)'/g)].map((m) => m[1]))
  const fresh = ok.filter((r) => {
    const slug = r.slug || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (existing.has(slug)) { console.log(`  skip, slug exists: ${slug}`); return false }
    if (domains.has(r.domain)) { console.log(`  skip, domain exists: ${r.domain}`); return false }
    return true
  })
  const freshLines = lines.filter((_, i) => fresh.includes(ok[i]))
  if (freshLines.length) {
    s = s.replace(anchor, freshLines.join('\n') + '\n' + anchor)
    writeFileSync(p, s)
    console.log(`\napplied ${freshLines.length} entries to ${p}`)
  } else {
    console.log('\nnothing new to apply')
  }
}
