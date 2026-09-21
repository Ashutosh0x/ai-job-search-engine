/**
 * Independent validation of a Microsoft crawl dataset.
 *
 *   node scripts/validate-microsoft-dataset.mjs
 *   node scripts/validate-microsoft-dataset.mjs --no-network   # skip the sitemap re-fetch
 *
 * INDEPENDENT OF THE CRAWLER'S OWN REPORT
 * =======================================
 * Every count here is re-derived from the records in `microsoft-roles.json`,
 * not read out of `microsoft-crawl-report.json`. A crawler that miscounts will
 * write a report that agrees with itself, so a report checked against itself
 * proves nothing. Where the two disagree, that disagreement is itself a
 * finding. The sitemap URL count is re-fetched from Microsoft for the same
 * reason.
 *
 * FINDINGS, NOT REPAIRS
 * =====================
 * Nothing here edits a record. A questionable posting is recorded with its id,
 * its URL and the evidence, and stays in the dataset. Silently "fixing" a
 * record destroys the evidence that something upstream is wrong -- and a
 * repaired record looks identical to a correct one.
 *
 * SEVERITY
 * ========
 *   error  - the dataset contradicts itself or the crawler's own report
 *   warn   - a record is unusual and a human should look
 *   info   - a measured property worth recording, not a problem
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const DATASET = resolve(ROOT, val('dataset', 'microsoft-roles.json'))
const REPORT = resolve(ROOT, val('report', 'microsoft-crawl-report.json'))
const OUT = resolve(ROOT, val('out', 'microsoft-validation.json'))
const OUT_TEXT = resolve(ROOT, val('out-text', 'microsoft-validation.txt'))
const NO_NETWORK = has('no-network')

/** Descriptions below this are recorded as suspiciously short, not removed. */
const SHORT_DESCRIPTION_CHARS = Number(val('short-description', 200))

const data = JSON.parse(readFileSync(DATASET, 'utf8'))
const crawlReport = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : null
const records = data.roles ?? []

const findings = []
const add = (severity, check, message, samples = []) =>
  findings.push({ severity, check, message, count: samples.length || undefined, samples: samples.slice(0, 10) })

const brief = (r) => ({ jobId: r.jobId, title: r.title?.slice(0, 70), url: r.sourceUrl, status: r.status })

/* ------------------------- 1. sitemap, independently ---------------------- */

let sitemapUrlCount = null
let sitemapJobUrlCount = null
if (!NO_NETWORK) {
  const UA = process.env.CRAWLER_USER_AGENT ||
    'JobSparkAI/1.0 (+https://jobspark.ai; job discovery; contact: support@jobspark.ai)'
  try {
    const res = await fetch(data.sitemap, { headers: { 'User-Agent': UA } })
    const xml = await res.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
    sitemapUrlCount = locs.length
    sitemapJobUrlCount = locs.filter((u) => /\/careers\/job\/\d+/.test(u)).length
  } catch (err) {
    add('warn', 'sitemap-refetch', `could not re-fetch the sitemap: ${err instanceof Error ? err.message : err}`)
  }
}

/* --------------------------- 2. identity and counts ----------------------- */

const bySourceUrl = new Map()
const byJobId = new Map()
const byCanonicalUrl = new Map()

for (const r of records) {
  const su = r.sourceUrl ?? ''
  bySourceUrl.set(su, [...(bySourceUrl.get(su) ?? []), r])
  if (r.jobId) byJobId.set(r.jobId, [...(byJobId.get(r.jobId) ?? []), r])
  const cu = r.url ?? ''
  if (cu) byCanonicalUrl.set(cu, [...(byCanonicalUrl.get(cu) ?? []), r])
}

const dupSourceUrls = [...bySourceUrl].filter(([, v]) => v.length > 1)
const dupJobIds = [...byJobId].filter(([, v]) => v.length > 1)
const dupCanonicalUrls = [...byCanonicalUrl].filter(([, v]) => v.length > 1)
const noJobId = records.filter((r) => !r.jobId)

if (dupSourceUrls.length) {
  add('error', 'duplicate-source-urls', `${dupSourceUrls.length} source urls appear more than once`,
    dupSourceUrls.map(([u, v]) => ({ url: u, occurrences: v.length })))
}
if (dupJobIds.length) {
  add('error', 'duplicate-job-ids', `${dupJobIds.length} job ids appear more than once`,
    dupJobIds.map(([id, v]) => ({ jobId: id, occurrences: v.length, urls: v.map((r) => r.sourceUrl) })))
}
if (dupCanonicalUrls.length) {
  // Two postings advertising the same canonical URL is a real ambiguity: the
  // index would link both to one page.
  add('error', 'duplicate-canonical-urls', `${dupCanonicalUrls.length} canonical urls are claimed by more than one posting`,
    dupCanonicalUrls.map(([u, v]) => ({ url: u, jobIds: v.map((r) => r.jobId) })))
}
if (noJobId.length) {
  add('error', 'missing-job-id', `${noJobId.length} records carry no job id`, noJobId.map(brief))
}

/* ------------------- 3. status counts, re-derived from records ------------ */

const statusCounts = {}
for (const r of records) statusCounts[r.status ?? 'unrecorded'] = (statusCounts[r.status ?? 'unrecorded'] || 0) + 1

const httpCounts = {}
for (const r of records) {
  const k = r.httpStatus === null || r.httpStatus === undefined ? 'none' : String(r.httpStatus)
  httpCounts[k] = (httpCounts[k] || 0) + 1
}

/* ---------------- 4. cross-check against the crawler's own report --------- */

if (crawlReport) {
  for (const [k, v] of Object.entries(crawlReport.statusCounts ?? {})) {
    if ((statusCounts[k] || 0) !== v) {
      add('error', 'report-disagrees-with-records',
        `crawl report says ${v} ${k}, the records say ${statusCounts[k] || 0}`)
    }
  }
  if (crawlReport.uniqueJobUrls !== records.length) {
    add('error', 'report-record-count-mismatch',
      `crawl report says ${crawlReport.uniqueJobUrls} unique postings, the file holds ${records.length}`)
  }
}
if (sitemapJobUrlCount !== null && sitemapJobUrlCount !== records.length) {
  // Not automatically an error: Microsoft publishes continuously, so a
  // re-fetch minutes later legitimately differs. Recorded with the delta.
  add('info', 'sitemap-drift',
    `the sitemap now holds ${sitemapJobUrlCount} job urls; the dataset holds ${records.length} ` +
    `(delta ${sitemapJobUrlCount - records.length}) -- the board changes between reads`)
}

/* -------------------- 5. JSON-LD extraction and required fields ---------- */

// `jsonLdFound` is the explicit flag the extractor sets. Datasets written
// before that flag existed are read by the presence of rawJsonLd instead, so
// this validator works on an older snapshot too.
const hasPosting = (r) => (typeof r.jsonLdFound === 'boolean' ? r.jsonLdFound : Boolean(r.rawJsonLd))
const parsed = records.filter(hasPosting)
const unparsed = records.filter((r) => !hasPosting(r))
const malformed = records.filter((r) => (r.extractionErrors ?? []).some((e) => /not valid JSON/i.test(e)))
const noBlock = records.filter((r) => (r.extractionErrors ?? []).some((e) => /no ld\+json block/i.test(e)))
const blockNoPosting = records.filter((r) => (r.extractionErrors ?? []).some((e) => /no JobPosting among/i.test(e)))

add('info', 'jsonld-extraction',
  `${parsed.length}/${records.length} pages yielded a JobPosting ` +
  `(${((parsed.length / records.length) * 100).toFixed(1)}%)`)
if (malformed.length) add('warn', 'malformed-jsonld', `${malformed.length} pages carried an unparseable ld+json block`, malformed.map(brief))
if (noBlock.length) add('info', 'no-jsonld-block', `${noBlock.length} pages carried no ld+json block at all`, noBlock.map(brief))
if (blockNoPosting.length) add('warn', 'jsonld-without-jobposting', `${blockNoPosting.length} pages had ld+json but no JobPosting`, blockNoPosting.map(brief))

// schema.org / Google's JobPosting requirements. Checked on parsed postings
// only: a page with no posting is a separate finding, above.
const REQUIRED = ['title', 'description', 'datePosted', 'hiringOrganization']
for (const field of REQUIRED) {
  const missing = parsed.filter((r) => {
    const v = r[field]
    return v === null || v === undefined || v === ''
  })
  if (missing.length) {
    add('warn', `missing-required-${field}`,
      `${missing.length} parsed postings have no ${field}`, missing.map(brief))
  }
}
const noLocation = parsed.filter((r) => (r.locations ?? []).length === 0 && r.remoteIndicator !== 'remote')
if (noLocation.length) {
  add('warn', 'missing-location',
    `${noLocation.length} parsed postings name no location and declare no remote type`, noLocation.map(brief))
}

/* ------------------------------- 6. dates -------------------------------- */

const now = new Date()
const invalidDate = (v) => v && Number.isNaN(new Date(v).getTime())

const badPosted = records.filter((r) => invalidDate(r.datePosted))
const badValid = records.filter((r) => invalidDate(r.validThrough))
if (badPosted.length) add('error', 'invalid-datePosted', `${badPosted.length} records have an unparseable datePosted`, badPosted.map((r) => ({ ...brief(r), datePosted: r.datePosted })))
if (badValid.length) add('error', 'invalid-validThrough', `${badValid.length} records have an unparseable validThrough`, badValid.map((r) => ({ ...brief(r), validThrough: r.validThrough })))

const expired = records.filter((r) => r.validThrough && !invalidDate(r.validThrough) && new Date(r.validThrough) < now)
add('info', 'expired-validThrough', `${expired.length} postings state a validThrough already in the past`,
  expired.map((r) => ({ ...brief(r), validThrough: r.validThrough })))

// An expired posting still classified OPEN would be a classifier bug.
const expiredButOpen = expired.filter((r) => r.status === 'OPEN')
if (expiredButOpen.length) {
  add('error', 'expired-but-open', `${expiredButOpen.length} postings are expired yet classified OPEN`, expiredButOpen.map(brief))
}

const futurePosted = records.filter((r) => r.datePosted && !invalidDate(r.datePosted) && new Date(r.datePosted) > now)
if (futurePosted.length) {
  add('warn', 'future-datePosted', `${futurePosted.length} postings claim a datePosted in the future`,
    futurePosted.map((r) => ({ ...brief(r), datePosted: r.datePosted })))
}

const postedAfterValid = records.filter((r) =>
  r.datePosted && r.validThrough && !invalidDate(r.datePosted) && !invalidDate(r.validThrough) &&
  new Date(r.datePosted) > new Date(r.validThrough))
if (postedAfterValid.length) {
  add('error', 'posted-after-validThrough', `${postedAfterValid.length} postings were posted after they expire`,
    postedAfterValid.map((r) => ({ ...brief(r), datePosted: r.datePosted, validThrough: r.validThrough })))
}

const ancient = records.filter((r) => {
  if (!r.datePosted || invalidDate(r.datePosted)) return false
  const days = (now - new Date(r.datePosted)) / 86_400_000
  return days > 365
})
add('info', 'posted-over-a-year-ago', `${ancient.length} OPEN-or-other postings are over a year old`,
  ancient.map((r) => ({ ...brief(r), datePosted: r.datePosted })))

/* ---------------------------- 7. descriptions ---------------------------- */

const emptyDesc = parsed.filter((r) => !r.description || r.description.trim().length === 0)
const shortDesc = parsed.filter((r) => r.description && r.description.trim().length > 0 && r.description.length < SHORT_DESCRIPTION_CHARS)
if (emptyDesc.length) add('warn', 'empty-description', `${emptyDesc.length} parsed postings have an empty description`, emptyDesc.map(brief))
if (shortDesc.length) {
  add('warn', 'short-description',
    `${shortDesc.length} parsed postings have a description under ${SHORT_DESCRIPTION_CHARS} characters`,
    shortDesc.map((r) => ({ ...brief(r), chars: r.description.length })))
}

const lengths = parsed.map((r) => r.descriptionLength ?? 0).sort((a, b) => a - b)
const pct = (p) => lengths.length ? lengths[Math.floor(lengths.length * p)] : 0
add('info', 'description-length',
  `min ${lengths[0] ?? 0} / p10 ${pct(0.1)} / median ${pct(0.5)} / p90 ${pct(0.9)} / max ${lengths[lengths.length - 1] ?? 0} chars`)

/* ------------------------ 8. canonical url consistency -------------------- */

/**
 * Compare urls by their normalised form, not byte-for-byte.
 *
 * The sitemap serves percent-encoded paths ("san-jos%C3%A9") while the JSON-LD
 * declares the decoded form ("san-josé"). Those are the same url, and a raw
 * string comparison reported 75 false mismatches. `new URL().href` normalises
 * both -- and it is also what surfaces the genuinely malformed ones, because a
 * declared url containing a literal space encodes to %20 and still matches,
 * while anything truly different does not.
 */
const sameUrl = (a, b) => {
  try { return new URL(a).href === new URL(b).href } catch { return a === b }
}
const urlMismatch = parsed.filter((r) => r.url && r.sourceUrl && !sameUrl(r.url, r.sourceUrl))

// Separately: a declared url that is not a valid url at all. Microsoft emits
// raw spaces and U+202F narrow no-break spaces into the JSON-LD `url` field.
const unencodedDeclaredUrl = parsed.filter((r) => r.url && /[\s  ]/.test(r.url))
if (unencodedDeclaredUrl.length) {
  add('info', 'declared-url-not-percent-encoded',
    `${unencodedDeclaredUrl.length} postings declare a canonical url containing unencoded whitespace; ` +
    `the crawled (encoded) url is the one used for linking`,
    unencodedDeclaredUrl.map((r) => ({ jobId: r.jobId, declared: r.url })))
}
const idMismatch = parsed.filter((r) => {
  const fromUrl = (r.sourceUrl ?? '').match(/\/careers\/job\/(\d+)/)?.[1]
  return fromUrl && r.jobId && fromUrl !== r.jobId
})
const offHost = records.filter((r) => r.sourceUrl && !/^https:\/\/apply\.careers\.microsoft\.com\//.test(r.sourceUrl))
const redirected = records.filter((r) => r.redirectedTo)

if (urlMismatch.length) {
  add('warn', 'canonical-url-mismatch',
    `${urlMismatch.length} postings declare a canonical url different from the one crawled`,
    urlMismatch.map((r) => ({ jobId: r.jobId, crawled: r.sourceUrl, declared: r.url })))
}
if (idMismatch.length) {
  // The JSON-LD identifier disagreeing with the URL id means the dedupe key
  // and the link could point at different postings.
  add('error', 'job-id-url-mismatch',
    `${idMismatch.length} postings carry an identifier that disagrees with the id in their url`,
    idMismatch.map((r) => ({ jobId: r.jobId, url: r.sourceUrl })))
}
if (offHost.length) add('error', 'off-host-url', `${offHost.length} records are not on apply.careers.microsoft.com`, offHost.map(brief))
add('info', 'redirects', `${redirected.length} urls redirected during the crawl`, redirected.map((r) => ({ ...brief(r), redirectedTo: r.redirectedTo })))

/* --------------------- 9. drift against a prior snapshot ------------------ */

const PRIOR = resolve(ROOT, val('prior', 'microsoft-roles.snapshot-2026-09-21T0103Z.json'))
let drift = null
if (existsSync(PRIOR)) {
  const prior = JSON.parse(readFileSync(PRIOR, 'utf8'))
  const priorById = new Map((prior.roles ?? []).map((r) => [r.jobId, r]))
  const titleChanges = []
  const locationChanges = []
  const statusChanges = []
  const descChanges = []

  for (const r of records) {
    const p = priorById.get(r.jobId)
    if (!p) continue
    if (p.title && r.title && p.title !== r.title) titleChanges.push({ jobId: r.jobId, before: p.title, after: r.title })
    if (p.locationDisplay && r.locationDisplay && p.locationDisplay !== r.locationDisplay) {
      locationChanges.push({ jobId: r.jobId, before: p.locationDisplay, after: r.locationDisplay })
    }
    if (p.status && r.status && p.status !== r.status) {
      statusChanges.push({ jobId: r.jobId, before: p.status, after: r.status, reason: r.statusReason, url: r.sourceUrl })
    }
    if (typeof p.descriptionLength === 'number' && typeof r.descriptionLength === 'number' &&
        p.descriptionLength !== r.descriptionLength) {
      descChanges.push({ jobId: r.jobId, beforeChars: p.descriptionLength, afterChars: r.descriptionLength })
    }
  }

  drift = {
    priorFile: PRIOR.split(/[\\/]/).pop(),
    comparedPostings: records.filter((r) => priorById.has(r.jobId)).length,
    titleChanges: titleChanges.length,
    locationChanges: locationChanges.length,
    statusChanges: statusChanges.length,
    descriptionChanges: descChanges.length,
    samples: {
      title: titleChanges.slice(0, 10),
      location: locationChanges.slice(0, 10),
      status: statusChanges.slice(0, 10),
      description: descChanges.slice(0, 10),
    },
  }

  // A title or location changing within hours is worth a human look: it can be
  // a genuine edit, or it can be the crawler reading two different pages.
  if (titleChanges.length) add('warn', 'title-drift-within-hours', `${titleChanges.length} titles changed since the prior snapshot`, titleChanges)
  if (locationChanges.length) add('warn', 'location-drift-within-hours', `${locationChanges.length} locations changed since the prior snapshot`, locationChanges)
  if (statusChanges.length) add('info', 'status-drift', `${statusChanges.length} postings changed status since the prior snapshot`, statusChanges)
}

/* ------------------------------- 10. output ------------------------------- */

const summary = {
  validatedAt: new Date().toISOString(),
  dataset: DATASET.split(/[\\/]/).pop(),
  datasetCrawledAt: data.crawledAt ?? null,
  sitemapUrlCountLive: sitemapUrlCount,
  sitemapJobUrlCountLive: sitemapJobUrlCount,
  recordCount: records.length,
  uniqueSourceUrls: bySourceUrl.size,
  uniqueJobIds: byJobId.size,
  uniqueCanonicalUrls: byCanonicalUrl.size,
  statusCounts,
  httpStatusDistributionPerRecord: httpCounts,
  jsonLdParsed: parsed.length,
  jsonLdUnparsed: unparsed.length,
  jsonLdMalformed: malformed.length,
  drift,
  findings,
  errorCount: findings.filter((f) => f.severity === 'error').length,
  warnCount: findings.filter((f) => f.severity === 'warn').length,
  infoCount: findings.filter((f) => f.severity === 'info').length,
}

writeFileSync(OUT, JSON.stringify(summary, null, 2))

const L = []
const n = (v) => String(v).padStart(6)
L.push('MICROSOFT DATASET VALIDATION')
L.push('='.repeat(72))
L.push(`validated      ${summary.validatedAt}`)
L.push(`dataset        ${summary.dataset} (crawled ${summary.datasetCrawledAt})`)
L.push('')
L.push('COUNTS (re-derived from the records, not read from the crawl report)')
L.push(`${n(summary.sitemapJobUrlCountLive ?? 'n/a')}  job urls in the sitemap, re-fetched just now`)
L.push(`${n(summary.recordCount)}  records in the dataset`)
L.push(`${n(summary.uniqueSourceUrls)}  unique source urls`)
L.push(`${n(summary.uniqueJobIds)}  unique job ids`)
L.push(`${n(summary.uniqueCanonicalUrls)}  unique canonical urls`)
L.push('')
L.push('STATUS')
for (const [k, v] of Object.entries(statusCounts)) L.push(`${n(v)}  ${k}`)
L.push('')
L.push('HTTP STATUS, PER RECORD')
for (const [k, v] of Object.entries(httpCounts)) L.push(`${n(v)}  ${k}`)
L.push('')
L.push('EXTRACTION')
L.push(`${n(summary.jsonLdParsed)}  postings parsed from JSON-LD`)
L.push(`${n(summary.jsonLdUnparsed)}  pages yielded no posting`)
L.push(`${n(summary.jsonLdMalformed)}  pages carried a malformed ld+json block`)
if (drift) {
  L.push('')
  L.push(`DRIFT vs ${drift.priorFile} (${drift.comparedPostings} postings in both)`)
  L.push(`${n(drift.titleChanges)}  titles changed`)
  L.push(`${n(drift.locationChanges)}  locations changed`)
  L.push(`${n(drift.statusChanges)}  statuses changed`)
  L.push(`${n(drift.descriptionChanges)}  descriptions changed length`)
}
L.push('')
L.push(`FINDINGS  ${summary.errorCount} error / ${summary.warnCount} warn / ${summary.infoCount} info`)
L.push('-'.repeat(72))
for (const f of findings) {
  L.push(`[${f.severity.toUpperCase().padEnd(5)}] ${f.check}`)
  L.push(`        ${f.message}`)
  for (const s of f.samples.slice(0, 3)) L.push(`        e.g. ${JSON.stringify(s)}`)
}
L.push('')
L.push('No record was modified. Questionable postings remain in the dataset with')
L.push('their evidence intact.')
L.push('')
writeFileSync(OUT_TEXT, L.join('\n'))

console.log(L.join('\n'))
console.log(`wrote ${OUT}`)
console.log(`wrote ${OUT_TEXT}`)
process.exit(summary.errorCount > 0 ? 1 : 0)
