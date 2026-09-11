/**
 * IBM careers discovery via the Common Crawl URL index.
 *
 *   node scripts/crawl-ibm.mjs
 *   node scripts/crawl-ibm.mjs --indexes 4 --out public/data/ibm-jobs.json
 *
 * WHY THIS ROUTE, AND WHAT IT CAN AND CANNOT PROVE
 * ================================================
 * IBM does not expose a public jobs API. Measured 11 Sep 2026:
 *
 *   careers.ibm.com/en_US/careers/*        HTTP 202, 1,999-byte body
 *   careers.ibm.com/en_US/careers/sitemap  HTTP 202, empty body
 *   careers.ibm.com/api/jobs               HTTP 404
 *   www.ibm.com/careers/search             SPA shell, no data
 *   greenhouse / workday tokens            no board
 *
 * A 202 with a tiny body is an Akamai bot-manager challenge. IBM's robots.txt
 * ALLOWS /careers and even advertises a sitemap, but the content routes answer
 * the challenge instead of the document. We do not defeat anti-bot systems, so
 * that is the end of the direct route.
 *
 * Common Crawl is the legitimate alternative and the one this repo already uses
 * for board discovery: an open, web-scale crawl published specifically for
 * programmatic analysis, queryable by host pattern, returning structured URLs.
 *
 * WHAT THIS PRODUCES IS A URL CENSUS, NOT A LIVE JOB FEED
 * ------------------------------------------------------
 * Every URL here is an official IBM link that existed when the crawl ran. It is
 * NOT proof the requisition is open today, and because the live page is behind
 * the challenge we cannot check. Records are therefore emitted with
 * `status: 'SEEN_IN_CRAWL'` and the crawl id that saw them -- never 'OPEN'.
 *
 * Title and location come from the URL SLUG, which IBM builds from them:
 *   /job/15037791/designer-ux-design-casablanca-ma/
 *    -> title "Designer UX Design", city Casablanca, country MA
 * That is derived data and is labelled as such. A slug is a lossy rendering of
 * a title, so it is good enough for regional analysis and not good enough to
 * display as the posting's official title.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const OUT = val('out', 'public/data/ibm-jobs.json')
const MAX_INDEXES = Number(val('indexes', 4))
const UA = 'JobSparkAI/1.0 (+https://jobspark.ai; job discovery)'

/* ------------------------- ISO-3166 alpha-2 from slug --------------------- */
//
// IBM ends a slug with a lowercase country code, or the literal "remote".
// Only codes actually observed in the corpus are mapped; an unmapped code is
// reported as the raw code rather than guessed at.
const COUNTRY = {
  us: 'United States', in: 'India', gb: 'United Kingdom', uk: 'United Kingdom',
  ca: 'Canada', ma: 'Morocco', br: 'Brazil', mx: 'Mexico', de: 'Germany',
  fr: 'France', es: 'Spain', it: 'Italy', nl: 'Netherlands', be: 'Belgium',
  ch: 'Switzerland', at: 'Austria', pl: 'Poland', cz: 'Czechia', ro: 'Romania',
  hu: 'Hungary', ie: 'Ireland', pt: 'Portugal', se: 'Sweden', dk: 'Denmark',
  no: 'Norway', fi: 'Finland', jp: 'Japan', cn: 'China', kr: 'South Korea',
  sg: 'Singapore', au: 'Australia', nz: 'New Zealand', za: 'South Africa',
  eg: 'Egypt', ae: 'United Arab Emirates', sa: 'Saudi Arabia', il: 'Israel',
  tr: 'Turkey', ar: 'Argentina', cl: 'Chile', co: 'Colombia', pe: 'Peru',
  ph: 'Philippines', my: 'Malaysia', th: 'Thailand', id: 'Indonesia',
  vn: 'Vietnam', tw: 'Taiwan', hk: 'Hong Kong', gr: 'Greece', bg: 'Bulgaria',
  sk: 'Slovakia', si: 'Slovenia', hr: 'Croatia', rs: 'Serbia', ua: 'Ukraine',
}

/** Region grouping, for the coverage view. */
const REGION = {
  'United States': 'North America', Canada: 'North America', Mexico: 'North America',
  Brazil: 'Latin America', Argentina: 'Latin America', Chile: 'Latin America',
  Colombia: 'Latin America', Peru: 'Latin America',
  India: 'Asia Pacific', China: 'Asia Pacific', Japan: 'Asia Pacific',
  'South Korea': 'Asia Pacific', Singapore: 'Asia Pacific', Australia: 'Asia Pacific',
  'New Zealand': 'Asia Pacific', Philippines: 'Asia Pacific', Malaysia: 'Asia Pacific',
  Thailand: 'Asia Pacific', Indonesia: 'Asia Pacific', Vietnam: 'Asia Pacific',
  Taiwan: 'Asia Pacific', 'Hong Kong': 'Asia Pacific',
  Morocco: 'Middle East & Africa', Egypt: 'Middle East & Africa',
  'South Africa': 'Middle East & Africa', 'United Arab Emirates': 'Middle East & Africa',
  'Saudi Arabia': 'Middle East & Africa', Israel: 'Middle East & Africa', Turkey: 'Middle East & Africa',
}
const regionOf = (c) => REGION[c] ?? (c ? 'Europe' : 'Unknown')

/* ------------------------------ slug parsing ------------------------------ */

/**
 * Read title / city / country out of an IBM job URL.
 *
 * Returns nulls rather than guesses when the slug does not carry a signal --
 * a slug with no trailing country code genuinely does not say where the role is.
 */
function parseJobUrl(raw) {
  let u
  try { u = new URL(raw) } catch { return null }
  const m = u.pathname.match(/^\/job\/(\d+)\/([^/]+)\/?$/)
  if (!m) return null

  const [, id, slug] = m
  const parts = slug.split('-').filter(Boolean)
  if (!parts.length) return null

  let country = null, city = null, remote = false

  // Trailing "remote" is a workplace statement, not a place.
  if (parts[parts.length - 1] === 'remote') {
    remote = true
    parts.pop()
  } else {
    const last = parts[parts.length - 1]
    if (last.length === 2 && COUNTRY[last]) {
      country = COUNTRY[last]
      parts.pop()
      // The token(s) before a country code are the city. Take one, since IBM
      // hyphenates multi-word cities and we cannot tell where the city ends
      // without a gazetteer -- so prefer under-claiming.
      if (parts.length > 1) {
        city = parts[parts.length - 1]
        parts.pop()
      }
    }
  }

  const title = parts
    .map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')

  return {
    id,
    url: raw.split('?')[0],
    titleFromSlug: title || null,
    cityFromSlug: city ? city[0].toUpperCase() + city.slice(1) : null,
    country,
    region: regionOf(country),
    remoteFromSlug: remote,
  }
}

/* ------------------------------ CC querying ------------------------------- */

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 45_000)
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal })
      clearTimeout(t)
      if (r.status === 404) return null          // no records for this pattern
      if (r.ok) return await r.text()
      // The index rate-limits; back off rather than hammering a free service.
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)))
    } catch {
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)))
    }
  }
  return null
}

const collinfo = await get('https://index.commoncrawl.org/collinfo.json')
if (!collinfo) { console.error('Common Crawl index list unreachable.'); process.exit(1) }
const indexes = JSON.parse(collinfo).slice(0, MAX_INDEXES).map((c) => c.id)
console.log(`querying ${indexes.length} crawl indexes: ${indexes.join(', ')}\n`)

const byId = new Map()
const seenIn = new Map()

// IBM uses two public job URL shapes; query both or the census misses whichever
// the crawler happened to see less of.
const PATTERNS = ['careers.ibm.com/job/*', 'careers.ibm.com/*/job/*']

for (const idx of indexes) {
 for (const pattern of PATTERNS) {
  let pages = 0
  // The index paginates; walk until a page returns nothing.
  for (let page = 0; page < 20; page++) {
    const u =
      `https://index.commoncrawl.org/${idx}-index` +
      `?url=${encodeURIComponent(pattern)}&output=json&limit=1000&page=${page}`
    const body = await get(u)
    if (!body) break
    const lines = body.trim().split('\n').filter(Boolean)
    if (!lines.length) break

    for (const line of lines) {
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const parsed = parseJobUrl(rec.url)
      if (!parsed) continue
      if (!byId.has(parsed.id)) byId.set(parsed.id, parsed)
      const s = seenIn.get(parsed.id) ?? new Set()
      s.add(idx)
      seenIn.set(parsed.id, s)
    }
    pages++
    if (lines.length < 1000) break
  }
 }
 console.log(`  ${idx}  cumulative distinct jobs: ${byId.size}`)
}

const jobs = [...byId.values()].map((j) => ({
  ...j,
  // Provenance, always. These are crawl observations, not live postings.
  status: 'SEEN_IN_CRAWL',
  seenInCrawls: [...(seenIn.get(j.id) ?? [])],
  source: 'common-crawl',
  employer: 'IBM',
  applyUrl: j.url,
}))

/* -------------------------------- analysis -------------------------------- */

const tally = (fn) => {
  const m = {}
  for (const j of jobs) { const k = fn(j) ?? 'Unknown'; m[k] = (m[k] || 0) + 1 }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]))
}

// Remote is a WORKPLACE, not a missing country. Counting the two together
// reported 44% "Unknown" when in fact 41% of the corpus was explicitly remote
// and only ~3% genuinely had no location signal -- which understated the data
// and overstated the gap.
const byCountry = tally((j) => (j.remoteFromSlug && !j.country ? 'Remote (no country stated)' : j.country))
const byRegion = tally((j) => (j.remoteFromSlug && !j.country ? 'Remote' : j.region))
const remote = jobs.filter((j) => j.remoteFromSlug).length
const noLocationSignal = jobs.filter((j) => !j.country && !j.remoteFromSlug).length

// Role families, from slug tokens. Descriptive only -- a slug is lossy.
const FAMILY = [
  ['Software Engineering', /engineer|developer|swe|programmer/i],
  ['Data & AI', /data|\bai\b|machine.?learning|scientist|analytics|quantum/i],
  ['Cloud & Infrastructure', /cloud|infrastructur|devops|sre|site.?reliability|platform|kubernetes/i],
  ['Consulting & Services', /consultant|consulting|advisory|delivery/i],
  ['Sales & Marketing', /sales|marketing|seller|account|brand/i],
  ['Design & UX', /design|\bux\b|\bui\b|research/i],
  ['Security', /security|cyber|risk|compliance/i],
  ['Product & Program', /product|program|project|manager|scrum/i],
  ['Intern & Early Career', /intern|trainee|graduate|apprentice|entry/i],
  ['Finance & Legal', /finance|financial|account|legal|counsel|tax/i],
]
const familyOf = (t) => FAMILY.find(([, re]) => re.test(t ?? ''))?.[0] ?? 'Other / Unclassified'
const byFamily = tally((j) => familyOf(j.titleFromSlug))

const pct = (n) => `${((n / (jobs.length || 1)) * 100).toFixed(1)}%`
const show = (title, obj, n = 15) => {
  console.log(`\n${title}`)
  for (const [k, v] of Object.entries(obj).slice(0, n)) {
    console.log(`  ${String(k).padEnd(28)} ${String(v).padStart(5)}  ${pct(v)}`)
  }
}

console.log(`\n${'='.repeat(58)}`)
console.log(`IBM job URLs discovered: ${jobs.length}`)
console.log(`Remote (from slug):      ${remote}  ${pct(remote)}`)
console.log(`No location signal:      ${noLocationSignal}  ${pct(noLocationSignal)}`)
console.log(`Countries represented:   ${Object.keys(byCountry).filter((k) => k !== 'Unknown').length}`)
show('BY REGION', byRegion)
show('BY COUNTRY', byCountry)
show('BY ROLE FAMILY (derived from URL slug)', byFamily)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  employer: 'IBM',
  method: 'common-crawl-url-index',
  indexesQueried: indexes,
  caveat:
    'These are official IBM job URLs observed in Common Crawl. They are NOT verified as currently ' +
    'open: careers.ibm.com answers HTTP 202 (bot challenge) to non-browser clients, so live status ' +
    'cannot be checked. Title and location are derived from the URL slug, not from the posting.',
  jobCount: jobs.length,
  analysis: { byRegion, byCountry, byFamily, remote },
  jobs,
}, null, 2))
console.log(`\nwrote ${OUT}`)
