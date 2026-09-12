/**
 * Hunt one role in one place across every source this repo can reach.
 *
 *   node scripts/hunt-role.mjs --place Argentina --out jobs.txt
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT
 * --------------------------------------
 * Three kinds of source, and they are not equally complete:
 *
 *   GLOBAL SEARCHES   Workable runs a real cross-tenant index at
 *                     jobs.workable.com covering all its customers, and Get on
 *                     Board indexes LATAM tech roles directly. One query each
 *                     and the answer is complete for that platform.
 *
 *   PER-BOARD APIS    Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee and
 *                     Workday publish no global index -- each customer is a
 *                     separate board and the only way to search them all is to
 *                     know they exist and ask each one. Coverage here is
 *                     exactly the board list in scripts/cc-boards.json, which
 *                     comes from the Common Crawl URL index.
 *
 *   REMOTE BOARDS     Remotive / Arbeitnow / Himalayas / Jobicy, filtered to
 *                     postings that name the place.
 *
 * So "found N roles" means N across the boards reachable from here, not N in
 * existence. The report prints how many boards answered so the denominator is
 * visible rather than implied.
 *
 * Google dorking is deliberately not used: Google's ToS forbids automated
 * querying, SERP scraping gets blocked, and Search returns a ranked sample
 * rather than an enumeration. Common Crawl is the open, complete-by-design
 * index built for this, and it is what the board list comes from.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const PLACE = val('place', 'Argentina')
const OUT = val('out', 'jobs.txt')
const JSON_OUT = val('json', 'hunt-results.json')
const CONCURRENCY = Number(val('concurrency', 12))
const ONLY = val('only', null)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/* ------------------------------- matching --------------------------------- */

/** Titles that make something a recruiting role. */
const TITLE_RE = /recruit|talent acquisition|talent partner|talent scout|sourcer|sourcing specialist|headhunt|selecci[oó]n de personal|reclutad|reclutamiento/i

/** The narrower ask: TECHNICAL recruiting. */
const TECHNICAL_RE = /\b(technical|technology|tech|engineering|engineer|it|software|developer|dev|r&d|digital|product)\b/i

/**
 * Place matching is deliberately conservative.
 *
 * "Argentina" and "Buenos Aires" are unambiguous. "Cordoba", "Rosario",
 * "Mendoza" and "Santa Fe" are NOT -- they name places in Spain, Mexico and
 * the USA too. Matching those would file non-Argentine roles under an
 * Argentina heading, which is worse than missing them.
 */
const PLACES = {
  argentina: {
    re: /argentina|buenos aires|\bcaba\b|\bar\b|\barg\b/i,
    strict: /argentina|buenos aires/i,
    country: 'AR',
    terms: ['Argentina', 'Buenos Aires'],
  },
}
const P = PLACES[PLACE.toLowerCase()] ?? {
  re: new RegExp(PLACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  strict: new RegExp(PLACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  country: null,
  terms: [PLACE],
}

/**
 * A posting counts as being in the place only if a location field says so.
 * The loose regex (which allows the "AR"/"ARG" country codes) is applied to
 * location fields ONLY -- never to a description, where "ar" matches half the
 * Spanish language.
 */
const inPlace = (loc) => {
  const s = String(loc || '')
  if (!s.trim()) return false
  if (P.strict.test(s)) return true
  // Country-code forms, only as a standalone token in a location string.
  return /(^|[\s,|/(])(ar|arg)([\s,|/)]|$)/i.test(s)
}

/* -------------------------------- plumbing -------------------------------- */

const results = []
const sourceStats = []
const seenUrl = new Set()
/**
 * Second dedupe key, because URL alone is not enough: Workable publishes the
 * same posting at both jobs.workable.com/view/... and apply.workable.com/j/...,
 * so a URL-only key reported one Huzzle role twice.
 */
const seenRole = new Set()
const roleKey = (r) => `${String(r.company || '').toLowerCase().trim()}|${String(r.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}`

function record(r) {
  if (!r.url || seenUrl.has(r.url)) return
  const rk = roleKey(r)
  if (seenRole.has(rk)) return
  seenUrl.add(r.url)
  seenRole.add(rk)
  results.push({ ...r, technical: TECHNICAL_RE.test(r.title) })
}

/**
 * --merge keeps what earlier runs found. Coverage is built up over several
 * passes (different providers, different concurrencies), so a fresh run that
 * only searched two providers must not be allowed to delete the rest.
 */
if (has('merge') && existsSync(JSON_OUT)) {
  try {
    const prev = JSON.parse(readFileSync(JSON_OUT, 'utf8'))
    for (const r of prev.results || []) record(r)
    for (const s of prev.sourceStats || []) sourceStats.push({ ...s, carried: true })
    console.log(`merged ${results.length} roles from the previous run\n`)
  } catch (e) { console.log(`could not merge previous run: ${e.message}`) }
}

async function req(url, opts = {}, tries = 3, timeoutMs = 25000) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, {
        ...opts,
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
      })
      if (r.status === 404 || r.status === 403 || r.status === 401) return null // board gone / closed
      if (r.status === 429 || r.status >= 500) throw new Error(`http ${r.status}`)
      if (!r.ok) return null
      return await r.json()
    } catch (e) {
      if (i === tries - 1) return undefined // undefined = never answered, distinct from null = answered "no"
      await new Promise((res) => setTimeout(res, 1200 * (i + 1) + Math.random() * 800))
    } finally { clearTimeout(t) }
  }
}

/**
 * Three outcomes per board, and collapsing them would overstate coverage:
 *
 *   LIVE         the board answered with data -- this is real coverage
 *   DEAD         the board answered 404/403: the token existed when the crawl
 *                ran and the board is now gone or private
 *   UNREACHABLE  never answered at all (timeout, throttle, network)
 *
 * Only `live` belongs in a coverage claim. A crawl-derived board list is mostly
 * churn, so counting a 404 as "answered" would turn a thin search into a
 * confident-looking one.
 */
/** Same contract as req(), for feeds that are XML rather than JSON. */
async function reqText(url, tries = 3, timeoutMs = 30000) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } })
      if (r.status === 404 || r.status === 403 || r.status === 401) return null
      if (r.status === 429 || r.status >= 500) throw new Error(`http ${r.status}`)
      if (!r.ok) return null
      return await r.text()
    } catch {
      if (i === tries - 1) return undefined
      await new Promise((res) => setTimeout(res, 1200 * (i + 1) + Math.random() * 800))
    } finally { clearTimeout(t) }
  }
}

const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : ''
}
const decodeXml = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#3[19];/g, "'").replace(/&amp;/g, '&')
  .trim()

async function pool(items, worker, label) {
  let done = 0, live = 0, dead = 0, unreachable = 0
  const queue = [...items]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const item = queue.shift()
      const outcome = await worker(item)
      if (outcome === undefined) unreachable++
      else if (outcome === null) dead++
      else live++
      done++
      if (done % 50 === 0 || done === items.length) {
        process.stdout.write(`  ${label}: ${done}/${items.length} boards, ${live} live, ${dead} gone, ${results.length} hits\r`)
      }
    }
  }))
  process.stdout.write('\n')
  return { total: items.length, answered: live, dead, unreachable }
}

/* -------------------------------- sources --------------------------------- */

const boards = existsSync('scripts/cc-boards.json')
  ? JSON.parse(readFileSync('scripts/cc-boards.json', 'utf8')).boards
  : []
const byProvider = (p) => boards.filter((b) => b.provider === p)

/** Merge in whatever the repo already verified, so nothing is lost. */
function mergeKnown() {
  const add = (b) => {
    const id = b.provider === 'workday' ? `${b.host}|${b.site}` : b.token
    if (!boards.some((x) => x.provider === b.provider && (x.provider === 'workday' ? `${x.host}|${x.site}` === id : x.token === id))) {
      boards.push(b)
    }
  }
  try {
    for (const b of JSON.parse(readFileSync('scripts/discovered-boards.json', 'utf8')).boards || []) add(b)
  } catch {}
  try {
    const reg = readFileSync('lib/companies/registry.ts', 'utf8')
    for (const m of reg.matchAll(/provider: '([a-z]+)', token: '([^']*)'(?:, site: '([^']*)')?(?:, host: '([^']*)')?/g)) {
      add({ provider: m[1], token: m[2], site: m[3], host: m[4] })
    }
  } catch {}
}
mergeKnown()

const SOURCES = {

  /* ---- global cross-tenant search: covers ALL Workable customers ---- */
  async workableGlobal() {
    const terms = ['recruiter', 'talent acquisition', 'sourcer', 'recruiting', 'reclutamiento']
    let pages = 0
    for (const term of terms) {
      let token = null
      do {
        const u = new URL('https://jobs.workable.com/api/v1/jobs')
        u.searchParams.set('query', term)
        u.searchParams.set('location', PLACE)
        if (token) u.searchParams.set('pageToken', token)
        const d = await req(u.toString())
        if (!d) break
        pages++
        for (const j of d.jobs || []) {
          const loc = [j.location?.city, j.location?.subregion, j.location?.countryName].filter(Boolean).join(', ')
          if (!TITLE_RE.test(j.title || '')) continue
          if (!inPlace(loc)) continue
          record({
            title: j.title, company: j.company?.title || '', location: loc,
            source: 'workable (global search)', url: j.url,
            posted: j.created || j.updated || '', workplace: j.workplace || '',
          })
        }
        token = d.nextPageToken
      } while (token && pages < 60)
    }
    return { total: terms.length, answered: pages, unreachable: 0 }
  },

  /* ---- LATAM tech board with its own index ---- */
  async getonbrd() {
    let n = 0
    for (const term of ['recruiter', 'reclutamiento', 'talent']) {
      for (let page = 1; page <= 5; page++) {
        const d = await req(`https://www.getonbrd.com/api/v0/search/jobs?query=${encodeURIComponent(term)}&per_page=100&page=${page}`)
        if (!d) break
        n++
        const rows = d.data || []
        for (const j of rows) {
          const a = j.attributes || {}
          const loc = [a.city, a.country].filter(Boolean).join(', ')
          if (!TITLE_RE.test(a.title || '')) continue
          if (!inPlace(loc)) continue
          record({
            title: a.title, company: a.company?.data?.attributes?.name || a.company_name || '',
            location: loc, source: 'getonbrd', url: `https://www.getonbrd.com/jobs/${j.id}`,
            posted: a.published_at ? new Date(a.published_at * 1000).toISOString().slice(0, 10) : '',
          })
        }
        if (rows.length < 100) break
      }
    }
    return { total: 3, answered: n, unreachable: 0 }
  },

  /* ---- remote-first boards ---- */
  async remoteBoards() {
    let answered = 0, total = 0
    const feeds = [
      { name: 'remotive', url: 'https://remotive.com/api/remote-jobs?limit=1000', rows: (d) => d.jobs || [],
        map: (j) => ({ title: j.title, company: j.company_name, location: j.candidate_required_location, url: j.url, posted: j.publication_date }) },
      { name: 'arbeitnow', url: 'https://www.arbeitnow.com/api/job-board-api', rows: (d) => d.data || [],
        map: (j) => ({ title: j.title, company: j.company_name, location: j.location, url: j.url, posted: j.created_at }) },
      { name: 'himalayas', url: 'https://himalayas.app/jobs/api?limit=500', rows: (d) => d.jobs || [],
        map: (j) => ({ title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(', '), url: j.applicationLink || j.guid, posted: j.pubDate }) },
      { name: 'jobicy', url: 'https://jobicy.com/api/v2/remote-jobs?count=100', rows: (d) => d.jobs || [],
        map: (j) => ({ title: j.jobTitle, company: j.companyName, location: j.jobGeo, url: j.url, posted: j.pubDate }) },
    ]
    for (const f of feeds) {
      total++
      const d = await req(f.url, {}, 3, 60000)
      if (!d) continue
      answered++
      for (const j of f.rows(d)) {
        const m = f.map(j)
        if (!TITLE_RE.test(m.title || '')) continue
        if (!inPlace(m.location)) continue
        record({ ...m, source: f.name })
      }
    }
    return { total, answered, unreachable: total - answered }
  },

  /* ---- per-board: Greenhouse ---- */
  async greenhouse() {
    const list = byProvider('greenhouse')
    return pool(list, async (b) => {
      const d = await req(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.token)}/jobs`)
      if (!d) return d
      for (const j of d.jobs || []) {
        const loc = j.location?.name || ''
        if (!TITLE_RE.test(j.title || '') || !inPlace(loc)) continue
        record({ title: j.title, company: b.token, location: loc, source: 'greenhouse', url: j.absolute_url, posted: j.updated_at })
      }
      return d
    }, 'greenhouse')
  },

  /* ---- per-board: Lever ---- */
  async lever() {
    const list = byProvider('lever')
    return pool(list, async (b) => {
      const d = await req(`https://api.lever.co/v0/postings/${encodeURIComponent(b.token)}?mode=json`)
      if (!d || !Array.isArray(d)) return d
      for (const j of d) {
        const loc = j.categories?.location || (j.categories?.allLocations || []).join(', ') || ''
        if (!TITLE_RE.test(j.text || '') || !inPlace(loc)) continue
        record({ title: j.text, company: b.token, location: loc, source: 'lever', url: j.hostedUrl, posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '' })
      }
      return d
    }, 'lever')
  },

  /* ---- per-board: Ashby ---- */
  async ashby() {
    const list = byProvider('ashby')
    return pool(list, async (b) => {
      const d = await req(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.token)}`, {}, 3, 40000)
      if (!d) return d
      for (const j of d.jobs || []) {
        const loc = j.location || (j.secondaryLocations || []).map((x) => x.location).join(', ') || ''
        if (!TITLE_RE.test(j.title || '') || !inPlace(loc)) continue
        record({ title: j.title, company: d.organizationName || b.token, location: loc, source: 'ashby', url: j.jobUrl || j.applyUrl, posted: j.publishedAt })
      }
      return d
    }, 'ashby')
  },

  /* ---- per-board: SmartRecruiters (supports a server-side country filter) ---- */
  async smartrecruiters() {
    const list = byProvider('smartrecruiters')
    return pool(list, async (b) => {
      const u = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.token)}/postings?limit=100${P.country ? `&country=${P.country.toLowerCase()}` : ''}`
      const d = await req(u)
      if (!d) return d
      for (const j of d.content || []) {
        const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ')
        if (!TITLE_RE.test(j.name || '') || !inPlace(loc)) continue
        record({ title: j.name, company: b.token, location: loc, source: 'smartrecruiters', url: `https://jobs.smartrecruiters.com/${b.token}/${j.id}`, posted: j.releasedDate })
      }
      return d
    }, 'smartrecruiters')
  },

  /* ---- per-board: Recruitee ---- */
  async recruitee() {
    const list = byProvider('recruitee')
    return pool(list, async (b) => {
      const d = await req(`https://${encodeURIComponent(b.token)}.recruitee.com/api/offers/`)
      if (!d) return d
      for (const j of d.offers || []) {
        const loc = [j.city, j.country].filter(Boolean).join(', ') || j.location || ''
        if (!TITLE_RE.test(j.title || '') || !inPlace(loc)) continue
        record({ title: j.title, company: j.company_name || b.token, location: loc, source: 'recruitee', url: j.careers_url || j.url, posted: j.published_at })
      }
      return d
    }, 'recruitee')
  },

  /* ---- per-board: Workable tenants (the global search above may miss private boards) ---- */
  async workableBoards() {
    const list = byProvider('workable')
    return pool(list, async (b) => {
      const d = await req(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.token)}?details=true`)
      if (!d) return d
      for (const j of d.jobs || []) {
        const loc = [j.city, j.state, j.country].filter(Boolean).join(', ')
        if (!TITLE_RE.test(j.title || '') || !inPlace(loc)) continue
        record({ title: j.title, company: d.name || b.token, location: loc, source: 'workable (board)', url: j.url || j.application_url, posted: j.published_on })
      }
      return d
    }, 'workable-boards')
  },

  /* ---- per-board: Teamtailor ----
   * jobs.json carries no location at all -- only content_html -- so the RSS
   * feed is the one to read: it namespaces a <tt:locations> block with city
   * and country per posting. Parsing HTML descriptions for a place instead
   * would match any job whose text merely mentions Argentina.
   */
  async teamtailor() {
    const list = byProvider('teamtailor')
    return pool(list, async (b) => {
      const xml = await reqText(`https://${encodeURIComponent(b.token)}.teamtailor.com/jobs.rss`)
      if (!xml) return xml
      for (const item of xml.split('<item>').slice(1)) {
        const title = decodeXml(pick(item, 'title'))
        if (!TITLE_RE.test(title)) continue
        const cities = [...item.matchAll(/<tt:city>([^<]*)<\/tt:city>/g)].map((m) => decodeXml(m[1]))
        const countries = [...item.matchAll(/<tt:country>([^<]*)<\/tt:country>/g)].map((m) => decodeXml(m[1]))
        const loc = [...new Set([...cities, ...countries])].filter(Boolean).join(', ')
        if (!inPlace(loc)) continue
        record({
          title, company: b.token, location: loc, source: 'teamtailor',
          url: decodeXml(pick(item, 'link')), posted: pick(item, 'pubDate'),
        })
      }
      return xml
    }, 'teamtailor')
  },

  /* ---- per-board: Breezy ---- */
  async breezy() {
    const list = byProvider('breezy')
    return pool(list, async (b) => {
      const d = await req(`https://${encodeURIComponent(b.token)}.breezy.hr/json`)
      if (!d || !Array.isArray(d)) return d
      for (const j of d) {
        if (!TITLE_RE.test(j.name || '')) continue
        const locs = (j.locations && j.locations.length ? j.locations : [j.location]).filter(Boolean)
        const loc = locs.map((l) => l.name || [l.city, l.state?.name, l.country?.name].filter(Boolean).join(', ')).join(' | ')
        if (!inPlace(loc)) continue
        record({
          title: j.name, company: j.company?.name || b.token, location: loc,
          source: 'breezy', url: j.url, posted: j.published_date,
        })
      }
      return d
    }, 'breezy')
  },

  /* ---- per-tenant: Workday ---- */
  async workday() {
    const list = byProvider('workday').filter((b) => b.host && b.token && b.site)
    return pool(list, async (b) => {
      const endpoint = `https://${b.host}/wday/cxs/${b.token}/${b.site}/jobs`
      let answered
      // Search by PLACE, not by role. The place query is narrow (a handful of
      // results per tenant) so it can be paged to exhaustion, where a role
      // query on a big tenant hits Workday's 2,000 cap with the Argentine
      // roles possibly past it.
      for (const term of P.terms) {
        for (let offset = 0; offset < 400; offset += 20) {
          const d = await req(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: term }),
          })
          if (d === undefined) break
          if (!d) { answered = answered ?? null; break }
          answered = d
          const posts = d.jobPostings || []
          for (const j of posts) {
            // locationsText is optional and its absence is silent -- some
            // tenants encode the place only in externalPath.
            const loc = String(j.locationsText || '') ||
              String(j.externalPath || '').split('/').filter(Boolean)[1]?.replace(/-+/g, ' ') || ''
            if (!TITLE_RE.test(j.title || '') || !inPlace(loc)) continue
            record({
              title: String(j.title).trim(), company: b.token, location: loc.trim(),
              source: 'workday', url: `https://${b.host}/${b.site}${j.externalPath}`, posted: j.postedOn || '',
            })
          }
          if (posts.length < 20) break
        }
      }
      return answered
    }, 'workday')
  },
}

/* --------------------------------- run ------------------------------------ */

const order = ['workableGlobal', 'getonbrd', 'remoteBoards', 'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'teamtailor', 'breezy', 'workableBoards', 'workday']
const chosen = ONLY ? ONLY.split(',').map((s) => s.trim()) : order

console.log(`hunting recruiting roles in ${PLACE}`)
console.log(`board list: ${boards.length} boards across ${new Set(boards.map((b) => b.provider)).size} providers\n`)

for (const name of chosen) {
  if (!SOURCES[name]) { console.log(`! unknown source ${name}`); continue }
  const started = Date.now()
  const before = results.length
  console.log(`[${name}]`)
  let st
  try { st = await SOURCES[name]() } catch (e) { console.log(`  failed: ${e.message}`); st = { total: 0, answered: 0, unreachable: 0, error: e.message } }
  sourceStats.push({ source: name, ...st, hits: results.length - before, seconds: Math.round((Date.now() - started) / 1000) })
  console.log(`  -> ${results.length - before} hits in ${Math.round((Date.now() - started) / 1000)}s (${st.answered}/${st.total} answered)\n`)
}

/* -------------------------------- report ---------------------------------- */

const uniq = results.sort((a, b) => Number(b.technical) - Number(a.technical) || (a.company || '').localeCompare(b.company || ''))
const technical = uniq.filter((r) => r.technical)

const lines = []
lines.push(`# recruiting roles -- ${PLACE}`)
lines.push(`# generated ${new Date().toISOString()}`)
lines.push('#')
lines.push('# COVERAGE')
// A merged run carries the previous run's stats forward; where this run
// searched the same source again, the fresh numbers win.
const statsBySource = new Map()
for (const s of sourceStats) {
  const prev = statsBySource.get(s.source)
  if (!prev || (prev.carried && !s.carried)) statsBySource.set(s.source, s)
}
for (const s of [...statsBySource.values()].sort((a, b) => b.hits - a.hits)) {
  const detail = `${s.answered}/${s.total} live` +
    (s.dead ? `, ${s.dead} gone` : '') +
    (s.unreachable ? `, ${s.unreachable} unreachable` : '')
  lines.push(`#   ${String(s.source).padEnd(18)} ${String(s.hits).padStart(4)} hits   ${detail.padEnd(44)} ${s.seconds}s${s.carried ? '  (earlier run)' : ''}${s.error ? '  ERROR ' + s.error : ''}`)
}
writeFileSync('scripts/.last-stats.json', JSON.stringify([...statsBySource.values()], null, 2))
lines.push('#')
lines.push('# "live" means the board answered with data. "gone" means the token existed')
lines.push('# when the crawl ran but the board now 404s -- normal churn, not an error.')
lines.push('#')
lines.push('# Global searches (workableGlobal, getonbrd) are complete for their platform.')
lines.push('# Per-board providers cover only the boards in scripts/cc-boards.json, which')
lines.push('# come from the Common Crawl URL index -- not every board that exists.')
lines.push('# Lever is the known hole: jobs.lever.co/robots.txt blocks Common Crawl, so')
lines.push('# only the boards already in this repo registry are searched there.')
lines.push(`#`)
lines.push(`# ${uniq.length} recruiting roles matched, ${technical.length} of them technical`)
lines.push('')

const fmt = (r) => [
  `  ${r.title}`,
  `    company  : ${r.company || '(unknown)'}`,
  `    location : ${r.location}`,
  `    source   : ${r.source}${r.posted ? `   posted: ${String(r.posted).slice(0, 10)}` : ''}`,
  `    url      : ${r.url}`,
  '',
].join('\n')

lines.push('## TECHNICAL RECRUITING ROLES')
lines.push('')
for (const r of technical) lines.push(fmt(r))
lines.push('## OTHER RECRUITING ROLES')
lines.push('')
for (const r of uniq.filter((r) => !r.technical)) lines.push(fmt(r))

writeFileSync(OUT, lines.join('\n'))
writeFileSync(JSON_OUT, JSON.stringify({ place: PLACE, generatedAt: new Date().toISOString(), sourceStats, results: uniq }, null, 2))

console.log(`${uniq.length} recruiting roles in ${PLACE}, ${technical.length} technical`)
console.log(`-> ${OUT}  /  ${JSON_OUT}`)
