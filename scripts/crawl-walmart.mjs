/**
 * Crawl Walmart careers via the sitemap Walmart publishes for crawlers.
 *
 *   npx tsx scripts/crawl-walmart.mjs --limit 50 --out walmart-roles.json
 *   npx tsx scripts/crawl-walmart.mjs --all --out walmart-roles.json
 *   npx tsx scripts/crawl-walmart.mjs --all --resume --out walmart-roles.json
 *
 * WHY THE SITEMAP AND NOT THE SEARCH API
 * --------------------------------------
 * careers.walmart.com/robots.txt:
 *
 *     Disallow: /api
 *     Disallow: /results
 *     Disallow: /us/en/results
 *     Sitemap:  https://careers.walmart.com/sitemap.xml
 *
 * The search API and the results pages are refused. The sitemap is published
 * FOR crawlers and is not disallowed, and neither is `/us/en/jobs/`, where the
 * 15,907 requisition pages it lists actually live. So the permitted route is
 * the one Walmart advertises, which is also the route this repo already uses
 * for Microsoft and eBay.
 *
 * WHERE THE DATA COMES FROM ON THE PAGE
 * -------------------------------------
 * There is no schema.org JobPosting block -- the page is client-rendered, so
 * the usual ld+json route this repo uses finds nothing. What IS in the served
 * HTML is Next.js's `__NEXT_DATA__`, carrying
 * `props.pageProps.jobDetails` in full: title, description, both qualification
 * blocks, employment type, primary location, requisition status and pay range.
 * That is the same payload the page itself renders from.
 *
 * NOT EVERY SITEMAP ENTRY IS AN OPEN ROLE
 * ---------------------------------------
 * Entries persist after a requisition closes -- `active: false` with
 * `positionAvailable: 0`. Ingesting those unfiltered is precisely the ghost
 * listing this repo's audit pipeline exists to catch, so closed requisitions
 * are recorded with `isOpen: false` and counted separately rather than being
 * silently mixed into the open roles.
 *
 * ONE REQUEST PER ROLE
 * --------------------
 * 15,907 pages at one request per second is about four and a half hours. The
 * crawl is resumable (`--resume` skips ids already in the output) so it can be
 * stopped and restarted without losing work.
 */
import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const SITEMAP = 'https://careers.walmart.com/sitemap.xml'
const OUT = val('out', 'walmart-roles.json')
const NDJSON = OUT.replace(/\.json$/, '.ndjson')
const LIMIT = has('all') ? Infinity : Number(val('limit', 25))
/** Politeness. Walmart permits this route; that is not a licence to hammer it. */
const DELAY_MS = Number(val('delay-ms', 1000))
const UA = 'jobsearch-engine/1.0 (+https://github.com/Ashutosh0x/ai-job-search-engine)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 429 || res.status >= 500) {
        // Back off rather than retry immediately; a 429 is a request to slow down.
        await sleep(DELAY_MS * attempt * 4)
        continue
      }
      if (!res.ok) return { status: res.status, text: '' }
      return { status: res.status, text: await res.text() }
    } catch (e) {
      if (attempt === tries) return { status: 0, text: '', error: e.message }
      await sleep(DELAY_MS * attempt * 2)
    }
  }
  return { status: 0, text: '' }
}

/** Pull `__NEXT_DATA__` out of served HTML. */
export function extractNextData(html) {
  const marker = html.indexOf('__NEXT_DATA__')
  if (marker === -1) return null
  const start = html.indexOf('>', marker) + 1
  const end = html.indexOf('</script>', start)
  if (start <= 0 || end <= start) return null
  try {
    return JSON.parse(html.slice(start, end))
  } catch {
    return null
  }
}

/** Strip the HTML Walmart embeds in its description fields. */
function toText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Map Walmart's jobDetails onto the shape the rest of the pipeline reads. */
export function normalizeWalmartJob(details, url) {
  if (!details || !details.jobId) return null

  const loc = details.primaryLocation || {}
  const city = loc.city || loc.locationName || null
  const state = loc.state || loc.stateCode || null
  const country = loc.country || loc.countryCode || details.countryCode || null

  const pay = Array.isArray(details.payRange) && details.payRange.length ? details.payRange[0] : null

  const description = toText(
    details.jobPostingDescription || details.description || details.descriptionSummary || ''
  )

  return {
    id: `walmart:${details.jobId}`,
    source: 'walmart',
    sourceId: details.jobId,
    company: details.brand === "Sam's Club" ? "Sam's Club" : 'Walmart',
    companySlug: details.brand === "Sam's Club" ? 'sams-club' : 'walmart',
    companyDomain: 'walmart.com',
    title: details.jobPostingTitle || details.title || null,
    description,
    descriptionText: description,
    minimumQualification: toText(details.minimumQualification),
    preferredQualification: toText(details.preferredQualification),
    locationRaw: [city, state, country].filter(Boolean).join(', ') || null,
    city,
    state,
    country,
    employmentType: (details.employmentTypes || []).map((e) => e.value).join(', ') || null,
    workerType: details.positionWorkerType?.value || null,
    businessSegment: details.businessSegment?.value || null,
    jobProfile: details.jobProfile?.value || null,
    payMin: pay?.min ?? null,
    payMax: pay?.max ?? null,
    payFrequency: details.payFrequency || null,
    payCurrency: pay?.currency || (pay ? 'USD' : null),
    postedAt: details.jobPostingStartDate || details.createdAt || null,
    // Kept rather than dropped: a closed requisition still in the sitemap is
    // exactly the ghost listing the audit pipeline looks for.
    isOpen: details.active === true && Number(details.positionAvailable ?? 0) > 0,
    requisitionStatus: details.requisitionStatus?.value || null,
    applicationUrl: url,
    isDirectApplication: true,
    retrievedAt: new Date().toISOString(),
  }
}

// ─── Crawl ────────────────────────────────────────────────────────────────────

console.log(`fetching sitemap ${SITEMAP} ...`)
const sm = await fetchText(SITEMAP)
if (sm.status !== 200) {
  console.error(`sitemap unavailable (status ${sm.status}) — nothing to crawl`)
  process.exit(1)
}

const jobUrls = [...sm.text.matchAll(/<loc>(https:\/\/careers\.walmart\.com\/[a-z]{2}\/[a-z]{2}\/jobs\/[^<]+)<\/loc>/g)]
  .map((m) => m[1])
console.log(`sitemap lists ${jobUrls.length.toLocaleString()} job pages`)

let done = new Set()
if (has('resume') && existsSync(NDJSON)) {
  for (const line of readFileSync(NDJSON, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { done.add(JSON.parse(line).sourceId) } catch { /* partial final line */ }
  }
  console.log(`resuming: ${done.size.toLocaleString()} already crawled`)
}

const targets = jobUrls.filter((u) => !done.has(u.split('/').pop())).slice(0, LIMIT === Infinity ? undefined : LIMIT)
console.log(`crawling ${targets.length.toLocaleString()} page(s) at ${DELAY_MS}ms intervals\n`)

let ok = 0, skipped = 0, failed = 0, open = 0, closed = 0
const started = Date.now()

for (let i = 0; i < targets.length; i++) {
  const url = targets[i]
  const res = await fetchText(url)

  if (res.status !== 200) { failed++; }
  else {
    const next = extractNextData(res.text)
    const details = next?.props?.pageProps?.jobDetails
    const job = normalizeWalmartJob(details, url)
    if (!job) skipped++
    else {
      appendFileSync(NDJSON, JSON.stringify(job) + '\n')
      ok++
      job.isOpen ? open++ : closed++
    }
  }

  if ((i + 1) % 25 === 0 || i === targets.length - 1) {
    const rate = (i + 1) / ((Date.now() - started) / 1000)
    const left = targets.length - (i + 1)
    console.log(
      `  ${i + 1}/${targets.length}  ok=${ok} open=${open} closed=${closed} failed=${failed} skipped=${skipped}` +
      `  ${rate.toFixed(1)}/s  eta ${left > 0 ? Math.round(left / rate / 60) + 'm' : '0m'}`
    )
  }
  if (i < targets.length - 1) await sleep(DELAY_MS)
}

// Assemble the JSON view from the NDJSON that was written as we went, so a
// killed run still leaves everything it fetched.
const all = existsSync(NDJSON)
  ? readFileSync(NDJSON, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  : []

const byCountry = {}
for (const j of all) byCountry[j.country || 'unknown'] = (byCountry[j.country || 'unknown'] || 0) + 1

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'careers.walmart.com sitemap + __NEXT_DATA__',
  method: 'Sitemap published in robots.txt; /us/en/jobs/ is not disallowed. One identified ' +
          'User-Agent, one request per role, no bypass of any control.',
  sitemapJobCount: jobUrls.length,
  crawled: all.length,
  open: all.filter((j) => j.isOpen).length,
  closed: all.filter((j) => !j.isOpen).length,
  byCountry,
  jobs: all,
}, null, 2))

console.log(`\nwrote ${OUT}  (${all.length.toLocaleString()} roles, ${all.filter((j) => j.isOpen).length.toLocaleString()} open)`)
console.log('by country:', JSON.stringify(byCountry).slice(0, 300))
