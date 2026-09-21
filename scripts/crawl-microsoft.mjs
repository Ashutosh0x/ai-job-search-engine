/**
 * Microsoft careers crawler -- sitemap + schema.org JobPosting.
 *
 *   node scripts/crawl-microsoft.mjs                      # full crawl
 *   node scripts/crawl-microsoft.mjs --resume             # continue a checkpoint
 *   node scripts/crawl-microsoft.mjs --limit 50           # smoke test
 *
 * WHY THIS ROUTE AND NOT AN API
 * =============================
 * Microsoft retired its own careers API and moved to Eightfold. As of
 * 2026-09-21, measured:
 *
 *   jobs.careers.microsoft.com/*            301 -> apply.careers.microsoft.com/
 *   gcsservices.careers.microsoft.com/...   host no longer resolves
 *   /api/apply/v2/jobs   (Eightfold std)    403 {"message":"Not authorized for PCSX"}
 *   /api/career_hub/search                  405 on GET; POST needs a session
 *   /careerhub/explore/jobs                 302 -> candidate login
 *   /careers/sitemap.xml                    200, ~2,375 job URLs
 *
 * The JSON API is authorization-gated on Microsoft's tenant -- it answers for
 * HSBC, Netflix and Bayer but not here. That gate is deliberate and is left
 * alone. What Microsoft publishes for machines is the sitemap it gives search
 * engines plus the schema.org JobPosting block on each job page, and
 * robots.txt explicitly allows /careers. That is the route this uses.
 *
 * WHAT THIS FIXES vs crawl-sitemap-board.mjs
 * ==========================================
 * The generic sitemap crawler is fine for a one-shot report but it keeps only
 * five fields, holds everything in memory, and a killed run loses the lot. It
 * also cannot tell you afterwards WHY a URL is missing. This one:
 *
 *   - classifies every URL OPEN / CLOSED / UNKNOWN / FETCH_FAILED and records
 *     the evidence for the verdict, so a throttled request is never reported
 *     as a closed job;
 *   - checkpoints, so a killed or rate-limited run resumes instead of
 *     re-asking Microsoft for 2,000 pages it already has;
 *   - retries the failure queue in a second, slower pass before giving up;
 *   - keeps the raw JSON-LD, so a parser change can be re-run offline.
 *
 * POLITENESS
 * ==========
 * Concurrency defaults to 4 with a 350ms per-request delay -- about 1 req/s.
 * Do not raise it. A 403 here means "you are asking too fast", and the
 * previous generation of this crawler mistook that for "this job closed" and
 * reported 887 then 1,125 roles closed in two runs five minutes apart.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/* ------------------------------ configuration ----------------------------- */

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const COMPANY = val('company', 'Microsoft')

/**
 * Every default output path is derived from the company, never hardcoded.
 *
 * The first version of this file defaulted to `microsoft-roles.json` no matter
 * what `--company` or `--sitemap` said, so
 *
 *   node scripts/crawl-microsoft.mjs --company Google --sitemap <google sitemap>
 *
 * would have silently overwritten Microsoft's dataset with Google's. Deriving
 * the names makes that impossible by construction; `--out` and friends still
 * override for a deliberate one-off.
 */
const SLUG = COMPANY.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'

const CONFIG = {
  sitemap: val('sitemap', 'https://apply.careers.microsoft.com/careers/sitemap.xml'),
  company: COMPANY,
  companySlug: SLUG,
  companyDomain: val('domain', 'microsoft.com'),
  out: resolve(ROOT, val('out', `${SLUG}-roles.json`)),
  outText: resolve(ROOT, val('out-text', `${SLUG}-roles.txt`)),
  report: resolve(ROOT, val('report', `${SLUG}-crawl-report.json`)),
  reportText: resolve(ROOT, val('report-text', `${SLUG}-crawl-report.txt`)),
  checkpoint: resolve(ROOT, val('checkpoint', `data/${SLUG}-crawl-checkpoint.json`)),
  log: resolve(ROOT, val('log', `scripts/${SLUG}-crawl.jsonl`)),
  concurrency: Math.max(1, Number(val('concurrency', 4))),
  delayMs: Math.max(0, Number(val('delay', 350))),
  limit: Number(val('limit', 0)),
  timeoutMs: Number(val('timeout', 40_000)),
  maxRetries: Number(val('max-retries', 4)),
  /**
   * Records between checkpoint writes.
   *
   * The checkpoint holds the full records, raw JSON-LD included, so a resumed
   * run is not missing fields for the postings it already settled -- which
   * makes it ~18MB for this board. Every 250 keeps the rewrite cost to a few
   * hundred MB across a full crawl while losing at most ~90 seconds of work.
   */
  checkpointEvery: Number(val('checkpoint-every', 250)),
  /** Second, slower pass over everything that ended FETCH_FAILED. */
  failurePass: !has('no-failure-pass'),
  failurePassDelayMs: Number(val('failure-delay', 2_000)),
  resume: has('resume'),
  keepRaw: !has('no-raw'),
}

// The other half of the same footgun: renaming the company without repointing
// the sitemap would write Microsoft's board into another company's files.
if (SLUG !== 'microsoft' && /careers\.microsoft\.com/i.test(CONFIG.sitemap)) {
  console.error(
    `--company ${COMPANY} was given but --sitemap is still Microsoft's ` +
    `(${CONFIG.sitemap}). That would write Microsoft's board into ` +
    `${SLUG}-roles.json. Pass --sitemap for ${COMPANY}, or drop --company.`
  )
  process.exit(1)
}

/**
 * Identify the crawler rather than impersonating a browser.
 *
 * robots.txt allows /careers for `User-agent: *`, and Microsoft serves this
 * UA a full page (verified 2026-09-21: HTTP 200, same byte count as Chrome).
 * There is no reason to pretend to be someone else when the publisher is
 * happy to serve us as ourselves, and a contactable UA is what lets an
 * operator complain to us instead of silently blocking us.
 */
const UA = process.env.CRAWLER_USER_AGENT ||
  'JobSparkAI/1.0 (+https://jobspark.ai; job discovery; contact: support@jobspark.ai)'

/* ------------------------------ structured log ---------------------------- */

mkdirSync(dirname(CONFIG.log), { recursive: true })
mkdirSync(dirname(CONFIG.checkpoint), { recursive: true })

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-')

/** One JSON object per line. Machine-readable; the console gets prose. */
function log(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), runId: RUN_ID, level, event, ...fields })
  try { appendFileSync(CONFIG.log, line + '\n') } catch { /* logging must never kill a crawl */ }
}

/* --------------------------------- metrics -------------------------------- */

const metrics = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: 0,
  sitemapUrls: 0,
  sitemapJobUrls: 0,
  duplicateUrls: 0,
  requests: 0,
  retries: 0,
  redirects: 0,
  byHttpStatus: {},          // "200": n, "403": n, ...
  byOutcome: {},             // OPEN / CLOSED / UNKNOWN / FETCH_FAILED
  networkErrors: {},         // "timeout": n, "ECONNRESET": n, ...
  failurePassAttempted: 0,
  failurePassRecovered: 0,
  resumedFromCheckpoint: 0,
  checkpointWrites: 0,
  checkpointFailures: 0,
  /** HTTP 200s for job pages only -- the sitemap fetch is not a posting. */
  sitemapRequests: 0,
}

const bump = (obj, key, by = 1) => { obj[key] = (obj[key] || 0) + by }

/* ------------------------------ http with policy -------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Exponential backoff with jitter, in ms. */
const backoff = (attempt, base = 1_500) =>
  Math.min(60_000, base * 2 ** attempt) + Math.floor(Math.random() * 1_000)

/**
 * Fetch one URL under the retry policy.
 *
 * Returns a verdict object rather than throwing, because the caller has to
 * distinguish four different reasons a page did not yield a posting and a
 * thrown error collapses them all into one.
 *
 *   kind: 'ok'       body present
 *         'gone'     404/410 -- the posting is genuinely not there
 *         'blocked'  403/429 persisted through every retry
 *         'error'    5xx or network failure persisted through every retry
 */
async function fetchPage(url, { maxRetries = CONFIG.maxRetries, minDelayMs = 0 } = {}) {
  let attempts = 0
  let lastStatus = null
  let lastError = null
  let redirected = false
  let finalUrl = url

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++
    metrics.requests++
    if (attempt > 0) metrics.retries++

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
        redirect: 'follow',
      })
      lastStatus = res.status
      bump(metrics.byHttpStatus, String(res.status))

      if (res.redirected || res.url !== url) {
        redirected = true
        finalUrl = res.url
        metrics.redirects++
      }

      if (res.status === 404 || res.status === 410) {
        return { kind: 'gone', status: res.status, attempts, redirected, finalUrl }
      }

      // 403 here is rate limiting, not authorization: these pages are public
      // and answered a moment ago. Back off hard and long.
      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 120_000)
          : backoff(attempt, 15_000)
        log('warn', 'throttled', { url, status: res.status, attempt, waitMs, retryAfter: retryAfter || null })
        if (attempt === maxRetries) {
          return { kind: 'blocked', status: res.status, attempts, redirected, finalUrl }
        }
        await sleep(waitMs)
        continue
      }

      if (res.status >= 500) {
        log('warn', 'server-error', { url, status: res.status, attempt })
        if (attempt === maxRetries) {
          return { kind: 'error', status: res.status, attempts, redirected, finalUrl, error: `HTTP ${res.status}` }
        }
        await sleep(backoff(attempt))
        continue
      }

      if (!res.ok) {
        return { kind: 'error', status: res.status, attempts, redirected, finalUrl, error: `HTTP ${res.status}` }
      }

      const body = await res.text()
      if (minDelayMs) await sleep(minDelayMs)
      return { kind: 'ok', status: res.status, body, attempts, redirected, finalUrl }
    } catch (err) {
      const name = err?.name === 'AbortError' ? 'timeout' : (err?.cause?.code || err?.code || err?.name || 'fetch-failed')
      lastError = String(name)
      bump(metrics.networkErrors, lastError)
      log('warn', 'network-error', { url, attempt, error: lastError })
      if (attempt === maxRetries) {
        return { kind: 'error', status: lastStatus, attempts, redirected, finalUrl, error: lastError }
      }
      await sleep(backoff(attempt))
    } finally {
      clearTimeout(timer)
    }
  }

  return { kind: 'error', status: lastStatus, attempts, redirected, finalUrl, error: lastError || 'exhausted' }
}

/* --------------------------------- sitemap -------------------------------- */

const locsIn = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())

async function readSitemap(url) {
  metrics.sitemapRequests++
  const res = await fetchPage(url, { maxRetries: 3 })
  if (res.kind !== 'ok') {
    console.error(`sitemap unreadable: ${res.kind} ${res.status ?? ''} ${res.error ?? ''}`)
    log('error', 'sitemap-unreadable', { url, ...res, body: undefined })
    process.exit(1)
  }

  let urls = locsIn(res.body)

  // A sitemap index points at child sitemaps; follow exactly one level.
  if (/<sitemapindex/i.test(res.body)) {
    const children = urls
    urls = []
    for (const child of children) {
      metrics.sitemapRequests++
      const sub = await fetchPage(child, { maxRetries: 3 })
      if (sub.kind === 'ok') urls.push(...locsIn(sub.body))
      else log('warn', 'child-sitemap-unreadable', { url: child, kind: sub.kind, status: sub.status })
    }
  }
  return urls
}

/**
 * Dedupe key for a job URL.
 *
 * Every sitemap entry carries `?domain=microsoft.com`, and the slug repeats
 * data already in the id. The numeric id is the posting's identity, so that is
 * the key when present; the origin+path is the fallback for anything whose
 * shape we do not recognise. Keying on the raw URL instead would count one
 * posting twice the moment Microsoft changes a slug.
 */
function jobKey(url) {
  const id = jobIdFrom(url)
  if (id) return `id:${id}`
  try {
    const u = new URL(url)
    return `url:${u.origin.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return `url:${url}`
  }
}

const jobIdFrom = (url) => {
  const m = String(url).match(/\/job\/(\d+)/)
  return m ? m[1] : null
}

/** Title and location live in the slug; only a fallback when JSON-LD is absent. */
function slugOf(url) {
  const m = String(url).match(/\/job\/\d+-([^?#]+)/)
  return m ? m[1].replace(/-/g, ' ').trim() : ''
}

/* ------------------------------ JSON-LD parsing --------------------------- */

/**
 * Pull the JobPosting out of a page, across every ld+json block.
 *
 * Returns { posting, errors, blocks } -- a malformed block is recorded and
 * skipped, never fatal. Pages carry one block today, but a vendor template
 * change that adds a BreadcrumbList must not break extraction.
 */
export function extractJobPosting(html) {
  const errors = []
  let blocks = 0
  let posting = null

  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    blocks++
    let parsed
    try {
      parsed = JSON.parse(m[1].trim())
    } catch (err) {
      errors.push(`ld+json block ${blocks} is not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`)
      continue
    }
    const nodes = []
    const push = (n) => {
      if (!n || typeof n !== 'object') return
      nodes.push(n)
      if (Array.isArray(n['@graph'])) n['@graph'].forEach(push)
    }
    if (Array.isArray(parsed)) parsed.forEach(push)
    else push(parsed)

    const found = nodes.find((n) => {
      const t = n['@type']
      return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
    })
    // First JobPosting wins, but keep scanning so malformed later blocks are
    // still reported.
    if (found && !posting) posting = found
  }

  if (blocks === 0) errors.push('no ld+json block on the page')
  else if (!posting) errors.push(`${blocks} ld+json block(s) but no JobPosting among them`)

  return { posting, errors, blocks }
}

/**
 * schema.org text fields are "Text or Thing": any of them can arrive as a
 * string, as {name}, or as {@type, value}. String() on those produced 19
 * Microsoft locations reading "[object Object]" -- a value that looks like
 * data and is not. Read the known text-bearing keys and return '' otherwise.
 */
export function asText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') return asText(v.name ?? v.value ?? v['@value'] ?? v.alternateName ?? v.title ?? '')
  return ''
}

/** Strip markup if a posting ever ships HTML in `description`. */
export function toPlainText(s) {
  const text = String(s ?? '')
  if (!/<[a-z/][^>]*>/i.test(text) && !/&[a-z#0-9]+;/i.test(text)) return text.trim()
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One schema.org Place -> a flat address.
 *
 * Microsoft writes the country into addressRegion as well as addressCountry
 * ("Redmond" / "WA,US" / "US"), so a naive join yields "Redmond, WA,US, US".
 * Split every field on commas and dedupe rather than assuming a shape.
 */
export function placeToAddress(place) {
  const a = (place && place.address) || {}
  const city = asText(a.addressLocality) || null
  const countryRaw = asText(a.addressCountry) || null
  let region = asText(a.addressRegion) || null

  // "WA,US" -> region "WA" once the country is already known.
  if (region && countryRaw) {
    const parts = region.split(',').map((s) => s.trim()).filter(Boolean)
    const trimmed = parts.filter((p) => p.toUpperCase() !== countryRaw.toUpperCase())
    region = (trimmed.length ? trimmed : parts).join(', ') || null
  }

  const bits = [city, region, countryRaw]
    .filter(Boolean)
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean)

  return {
    display: [...new Set(bits)].join(', '),
    city,
    state: region,
    country: countryRaw,
    postalCode: asText(a.postalCode) || null,
    streetAddress: asText(a.streetAddress) || null,
  }
}

/**
 * Remote indicator, from declared fields only.
 *
 * schema.org states this in `jobLocationType: TELECOMMUTE`. When the posting
 * does not declare it, this returns 'unknown' rather than guessing from prose
 * -- workplace classification from description text is lib/pipeline/workplace
 * ts's job, and it records its evidence. Inventing a verdict here would
 * overwrite a classifier that can explain itself with one that cannot.
 */
export function remoteIndicator(posting) {
  const t = asText(posting.jobLocationType).toUpperCase()
  if (t.includes('TELECOMMUTE')) return 'remote'
  if (posting.applicantLocationRequirements && !posting.jobLocation) return 'remote'
  return 'unknown'
}

/** Absolute, normalised record for one posting. */
export function toRecord(url, posting, { html = '', crawledAt, httpStatus, attempts, redirectedTo }) {
  const errors = []
  const locsRaw = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : [posting.jobLocation].filter(Boolean)

  const locations = locsRaw.map(placeToAddress).filter((l) => l.display)
  if (locsRaw.length && !locations.length) errors.push('jobLocation present but yielded no readable address')

  const id = asText(posting.identifier) || jobIdFrom(url) || ''
  if (!id) errors.push('no identifier and no numeric id in the url')

  const title = asText(posting.title) || slugOf(url)
  if (!asText(posting.title)) errors.push('no title in JSON-LD; fell back to the url slug')

  const description = toPlainText(posting.description)
  if (!description) errors.push('no description in JSON-LD')

  const validThrough = asText(posting.validThrough) || null
  const datePosted = asText(posting.datePosted) || null

  return {
    jobId: id,
    title,
    description,
    descriptionLength: description.length,
    employmentType: Array.isArray(posting.employmentType)
      ? posting.employmentType.map(asText).filter(Boolean).join(', ')
      : (asText(posting.employmentType) || null),
    datePosted,
    validThrough,
    hiringOrganization: asText(posting.hiringOrganization) || null,
    hiringOrganizationDomain: asText(posting.hiringOrganization?.sameAs) || null,
    company: asText(posting.hiringOrganization) || CONFIG.company,
    department: asText(posting.department) || asText(posting.occupationalCategory) || null,
    industry: asText(posting.industry) || null,
    locations,
    locationDisplay: [...new Set(locations.map((l) => l.display))].join(' | ') || null,
    city: locations[0]?.city ?? null,
    state: locations[0]?.state ?? null,
    country: locations[0]?.country ?? null,
    postalCode: locations[0]?.postalCode ?? null,
    remoteIndicator: remoteIndicator(posting),
    baseSalary: posting.baseSalary ?? null,
    url: asText(posting.url) || url,
    sourceUrl: url,
    redirectedTo: redirectedTo || null,
    crawledAt,
    httpStatus,
    attempts,
    extractionErrors: errors,
    /**
     * Explicit, so downstream validation never has to infer extraction
     * success from whether some field happens to be populated -- and so the
     * signal survives `--no-raw`, which drops rawJsonLd.
     */
    jsonLdFound: true,
    rawJsonLd: CONFIG.keepRaw ? posting : undefined,
  }
}

/**
 * Status verdict for one crawled URL.
 *
 * The distinction this whole file exists to protect: a request that failed is
 * FETCH_FAILED, never CLOSED. CLOSED requires positive evidence -- Microsoft
 * answering 404/410, or the posting's own validThrough having passed.
 */
export function classify({ fetchKind, httpStatus, posting, validThrough, now = new Date() }) {
  if (fetchKind === 'gone') {
    return { status: 'CLOSED', reason: `http-${httpStatus}` }
  }
  if (fetchKind === 'blocked') {
    return { status: 'FETCH_FAILED', reason: `throttled-http-${httpStatus}` }
  }
  if (fetchKind === 'error') {
    return { status: 'FETCH_FAILED', reason: httpStatus ? `http-${httpStatus}` : 'network-error' }
  }
  if (!posting) {
    return { status: 'UNKNOWN', reason: 'page-answered-without-jobposting' }
  }
  if (validThrough) {
    const vt = new Date(validThrough)
    if (!Number.isNaN(vt.getTime()) && vt.getTime() < now.getTime()) {
      return { status: 'CLOSED', reason: 'validThrough-in-the-past' }
    }
  }
  return { status: 'OPEN', reason: validThrough ? 'jobposting-valid-through-future' : 'jobposting-present' }
}

/* ------------------------------- checkpointing ---------------------------- */

/**
 * Atomic write: temp file then rename, so a kill mid-write cannot corrupt.
 *
 * The rename is retried. This checkout lives under OneDrive, and a sync agent
 * (or an antivirus scanner) holding a handle on the destination makes
 * `renameSync` throw EPERM/EBUSY on Windows -- transiently, for a file that is
 * perfectly writable a second later. One retry turns that from a lost crawl
 * into a pause.
 */
function writeAtomic(path, text, { retries = 3 } = {}) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text)
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path)
      return
    } catch (err) {
      if (attempt >= retries) throw err
      const wait = 250 * (attempt + 1)
      log('warn', 'rename-retry', { path, attempt, error: String(err?.code ?? err), waitMs: wait })
      // Synchronous, deliberately: this runs between crawl steps and the
      // point is to let the other process release the handle.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    }
  }
}

/**
 * Persist progress. NEVER throws.
 *
 * A checkpoint is an optimisation, not the product. Letting a failed
 * checkpoint write kill the process would trade "we lost 250 records of
 * resume data" for "we lost the entire crawl", which is exactly backwards --
 * and on this checkout the likely cause is a transient OneDrive file lock.
 */
function saveCheckpoint(state) {
  try {
    writeAtomic(CONFIG.checkpoint, JSON.stringify({
      version: 1,
      sitemap: CONFIG.sitemap,
      runId: RUN_ID,
      savedAt: new Date().toISOString(),
      metrics,
      results: Object.fromEntries(state.results),
    }))
    metrics.checkpointWrites++
  } catch (err) {
    metrics.checkpointFailures++
    log('error', 'checkpoint-write-failed', { path: CONFIG.checkpoint, error: String(err?.code ?? err) })
    console.error(`\n  checkpoint write failed (${err?.code ?? err}) -- continuing; resume data is stale`)
  }
}

function loadCheckpoint() {
  if (!existsSync(CONFIG.checkpoint)) return null
  try {
    const data = JSON.parse(readFileSync(CONFIG.checkpoint, 'utf8'))
    if (data.sitemap !== CONFIG.sitemap) {
      console.log(`checkpoint is for a different sitemap (${data.sitemap}) -- ignoring it`)
      return null
    }
    return data
  } catch (err) {
    console.log(`checkpoint unreadable (${err instanceof Error ? err.message : 'error'}) -- starting fresh`)
    return null
  }
}

/* ---------------------------------- crawl --------------------------------- */

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) process.exit(130)
    stopping = true
    console.log(`\n${sig} -- finishing in-flight requests, then checkpointing. Ctrl-C again to abort.`)
    log('warn', 'shutdown-requested', { signal: sig })
  })
}

async function crawlUrls(urls, state, { delayMs, label }) {
  const queue = [...urls]
  let done = 0
  const total = queue.length
  if (!total) return

  const worker = async () => {
    while (queue.length && !stopping) {
      const url = queue.shift()
      const crawledAt = new Date().toISOString()
      const res = await fetchPage(url, { minDelayMs: delayMs })

      let record = null
      let posting = null
      let extractionErrors = []

      if (res.kind === 'ok') {
        const extracted = extractJobPosting(res.body)
        posting = extracted.posting
        extractionErrors = extracted.errors
      }

      const verdict = classify({
        fetchKind: res.kind,
        httpStatus: res.status,
        posting,
        validThrough: posting ? asText(posting.validThrough) : null,
      })

      if (posting) {
        record = toRecord(url, posting, {
          crawledAt,
          httpStatus: res.status,
          attempts: res.attempts,
          redirectedTo: res.redirected ? res.finalUrl : null,
        })
        record.status = verdict.status
        record.statusReason = verdict.reason
      } else {
        // No posting: keep an honest stub so the URL is accounted for rather
        // than silently vanishing from the report.
        record = {
          jobId: jobIdFrom(url) || '',
          title: slugOf(url),
          description: '',
          descriptionLength: 0,
          employmentType: null,
          datePosted: null,
          validThrough: null,
          hiringOrganization: null,
          hiringOrganizationDomain: null,
          company: CONFIG.company,
          department: null,
          industry: null,
          locations: [],
          locationDisplay: null,
          city: null, state: null, country: null, postalCode: null,
          remoteIndicator: 'unknown',
          baseSalary: null,
          url,
          sourceUrl: url,
          redirectedTo: res.redirected ? res.finalUrl : null,
          crawledAt,
          httpStatus: res.status ?? null,
          attempts: res.attempts,
          extractionErrors,
          jsonLdFound: false,
          status: verdict.status,
          statusReason: verdict.reason,
          fetchError: res.error ?? null,
        }
      }
      if (extractionErrors.length && record.extractionErrors !== extractionErrors) {
        record.extractionErrors = [...new Set([...(record.extractionErrors || []), ...extractionErrors])]
      }

      state.results.set(jobKey(url), record)
      done++

      log('info', 'crawled', {
        url, status: verdict.status, reason: verdict.reason,
        httpStatus: res.status ?? null, attempts: res.attempts,
      })

      if (done % CONFIG.checkpointEvery === 0) saveCheckpoint(state)
      if (done % 25 === 0 || done === total) {
        const counts = tally(state.results)
        process.stdout.write(
          `  ${label} ${done}/${total}  open ${counts.OPEN || 0}  closed ${counts.CLOSED || 0}  ` +
          `unknown ${counts.UNKNOWN || 0}  failed ${counts.FETCH_FAILED || 0}\r`
        )
      }
    }
  }

  await Promise.all(Array.from({ length: CONFIG.concurrency }, worker))
  process.stdout.write('\n')
  saveCheckpoint(state)
}

const tally = (results) => {
  const out = {}
  for (const r of results.values()) bump(out, r.status)
  return out
}

/* --------------------------------- report --------------------------------- */

function buildReport(state, sitemapUrls, jobUrls, duplicates) {
  const records = [...state.results.values()]
  const counts = tally(state.results)

  const byId = new Map()
  for (const r of records) {
    const k = r.jobId || r.sourceUrl
    byId.set(k, (byId.get(k) || 0) + 1)
  }
  const duplicateIds = [...byId].filter(([, n]) => n > 1)

  // Exact, from the flag the extractor sets -- not inferred from whether some
  // field happens to be populated. A posting with an empty description and no
  // location is still a posting that parsed.
  const withPosting = records.filter((r) => r.jsonLdFound)
  const withErrors = records.filter((r) => (r.extractionErrors || []).length > 0)

  const fieldCoverage = {}
  const FIELDS = [
    'jobId', 'title', 'description', 'employmentType', 'datePosted', 'validThrough',
    'hiringOrganization', 'department', 'industry', 'locationDisplay', 'city',
    'state', 'country', 'postalCode', 'baseSalary',
  ]
  const parsed = records.filter((r) => r.status === 'OPEN' || r.statusReason === 'validThrough-in-the-past')
  for (const f of FIELDS) {
    const n = parsed.filter((r) => {
      const v = r[f]
      return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    }).length
    fieldCoverage[f] = { present: n, of: parsed.length, pct: parsed.length ? Math.round((n / parsed.length) * 1000) / 10 : 0 }
  }

  return {
    crawlTimestamp: metrics.startedAt,
    finishedAt: metrics.finishedAt,
    crawlDurationMs: metrics.durationMs,
    crawlDurationHuman: `${Math.round(metrics.durationMs / 1000)}s`,
    sitemapUrl: CONFIG.sitemap,
    sitemapUrlCount: sitemapUrls,
    sitemapJobUrlCount: jobUrls,
    uniqueJobUrls: state.results.size,
    duplicateSitemapUrls: duplicates,
    duplicateJobIds: duplicateIds.length,
    duplicateJobIdSamples: duplicateIds.slice(0, 10).map(([id, n]) => ({ jobId: id, occurrences: n })),
    // Postings that answered 200, counted once each. Distinct from
    // `http200Responses`, which counts every 200 the run received --
    // the sitemap included, and retries counted separately.
    successfulFetches: records.filter((r) => r.httpStatus === 200).length,
    http200Responses: metrics.byHttpStatus['200'] || 0,
    sitemapRequests: metrics.sitemapRequests,
    failedFetchCount: counts.FETCH_FAILED || 0,
    checkpointWrites: metrics.checkpointWrites,
    checkpointFailures: metrics.checkpointFailures,
    httpStatusDistribution: metrics.byHttpStatus,
    networkErrors: metrics.networkErrors,
    totalRequests: metrics.requests,
    retryCount: metrics.retries,
    redirectCount: metrics.redirects,
    validJobPostingCount: withPosting.length,
    invalidOrMissingJobPostingCount: records.length - withPosting.length,
    recordsWithExtractionErrors: withErrors.length,
    extractionErrorSamples: withErrors.slice(0, 10).map((r) => ({ url: r.sourceUrl, errors: r.extractionErrors })),
    statusCounts: {
      OPEN: counts.OPEN || 0,
      CLOSED: counts.CLOSED || 0,
      UNKNOWN: counts.UNKNOWN || 0,
      FETCH_FAILED: counts.FETCH_FAILED || 0,
    },
    closedBreakdown: records.filter((r) => r.status === 'CLOSED')
      .reduce((acc, r) => { bump(acc, r.statusReason); return acc }, {}),
    unknownBreakdown: records.filter((r) => r.status === 'UNKNOWN')
      .reduce((acc, r) => { bump(acc, r.statusReason); return acc }, {}),
    fetchFailedBreakdown: records.filter((r) => r.status === 'FETCH_FAILED')
      .reduce((acc, r) => { bump(acc, r.statusReason); return acc }, {}),
    failurePassAttempted: metrics.failurePassAttempted,
    failurePassRecovered: metrics.failurePassRecovered,
    resumedFromCheckpoint: metrics.resumedFromCheckpoint,
    fieldCoverage,
    /**
     * The number that may be quoted as "open roles" -- and only this one.
     * A sitemap URL count is a count of URLs, not of live jobs.
     */
    defensibleActiveCount: counts.OPEN || 0,
    defensibleActiveCountBasis:
      'URLs that returned HTTP 200 with a schema.org JobPosting whose validThrough ' +
      'has not passed. Excludes every URL whose status could not be established.',
    config: {
      concurrency: CONFIG.concurrency,
      delayMs: CONFIG.delayMs,
      timeoutMs: CONFIG.timeoutMs,
      maxRetries: CONFIG.maxRetries,
      failurePass: CONFIG.failurePass,
      userAgent: UA,
    },
  }
}

function reportToText(report) {
  const L = []
  const n = (v) => String(v).padStart(6)
  L.push('MICROSOFT CAREERS CRAWL REPORT')
  L.push('='.repeat(72))
  L.push(`crawl started      ${report.crawlTimestamp}`)
  L.push(`crawl finished     ${report.finishedAt}`)
  L.push(`duration           ${report.crawlDurationHuman}`)
  L.push(`sitemap            ${report.sitemapUrl}`)
  L.push('')
  L.push('URL INVENTORY')
  L.push(`${n(report.sitemapUrlCount)}  urls in the sitemap`)
  L.push(`${n(report.sitemapJobUrlCount)}  of those are job pages`)
  L.push(`${n(report.duplicateSitemapUrls)}  duplicate sitemap entries (same posting listed twice)`)
  L.push(`${n(report.uniqueJobUrls)}  unique postings crawled`)
  L.push('')
  L.push('WHAT CAME BACK  -- these are four different things, do not add them up loosely')
  L.push(`${n(report.statusCounts.OPEN)}  OPEN          200 + JobPosting, validThrough not passed`)
  L.push(`${n(report.statusCounts.CLOSED)}  CLOSED        positive evidence the posting is gone`)
  L.push(`${n(report.statusCounts.UNKNOWN)}  UNKNOWN       page answered, status not establishable`)
  L.push(`${n(report.statusCounts.FETCH_FAILED)}  FETCH_FAILED  we could not read it -- NOT a closed job`)
  L.push('')
  L.push(`DEFENSIBLE ACTIVE COUNT: ${report.defensibleActiveCount}`)
  L.push(`  ${report.defensibleActiveCountBasis}`)
  L.push('')
  L.push('HTTP STATUS DISTRIBUTION')
  for (const [k, v] of Object.entries(report.httpStatusDistribution).sort()) L.push(`${n(v)}  HTTP ${k}`)
  if (Object.keys(report.networkErrors).length) {
    L.push('')
    L.push('NETWORK ERRORS')
    for (const [k, v] of Object.entries(report.networkErrors)) L.push(`${n(v)}  ${k}`)
  }
  L.push('')
  L.push('REQUESTS')
  L.push(`${n(report.totalRequests)}  requests issued`)
  L.push(`${n(report.retryCount)}  of those were retries`)
  L.push(`${n(report.redirectCount)}  redirects followed`)
  L.push(`${n(report.failurePassAttempted)}  urls re-tried in the slow failure pass`)
  L.push(`${n(report.failurePassRecovered)}  of those recovered`)
  L.push('')
  L.push('EXTRACTION')
  L.push(`${n(report.validJobPostingCount)}  urls yielded a usable JobPosting`)
  L.push(`${n(report.invalidOrMissingJobPostingCount)}  yielded none`)
  L.push(`${n(report.recordsWithExtractionErrors)}  records carry at least one extraction warning`)
  L.push(`${n(report.duplicateJobIds)}  duplicate job ids across the crawl`)
  L.push('')
  L.push('FIELD COVERAGE  (of parsed postings)')
  for (const [f, c] of Object.entries(report.fieldCoverage)) {
    L.push(`  ${f.padEnd(20)} ${String(c.present).padStart(5)}/${c.of}  ${String(c.pct).padStart(5)}%`)
  }
  for (const [label, obj] of [
    ['CLOSED BREAKDOWN', report.closedBreakdown],
    ['UNKNOWN BREAKDOWN', report.unknownBreakdown],
    ['FETCH_FAILED BREAKDOWN', report.fetchFailedBreakdown],
  ]) {
    if (!Object.keys(obj).length) continue
    L.push('')
    L.push(label)
    for (const [k, v] of Object.entries(obj)) L.push(`${n(v)}  ${k}`)
  }
  L.push('')
  return L.join('\n')
}

function rolesToText(records, report) {
  const open = records.filter((r) => r.status === 'OPEN')
  const locCounts = new Map()
  for (const r of open) {
    const k = r.locationDisplay || '(no location in JSON-LD)'
    locCounts.set(k, (locCounts.get(k) || 0) + 1)
  }

  const L = []
  L.push(`# ${CONFIG.company} -- crawled roles`)
  L.push(`# source: ${CONFIG.sitemap}`)
  L.push(`# generated ${report.finishedAt}`)
  L.push(`#`)
  L.push(`# ${report.sitemapJobUrlCount} sitemap job urls -> ${report.uniqueJobUrls} unique postings`)
  L.push(`# ${report.statusCounts.OPEN} OPEN / ${report.statusCounts.CLOSED} CLOSED / ` +
         `${report.statusCounts.UNKNOWN} UNKNOWN / ${report.statusCounts.FETCH_FAILED} FETCH_FAILED`)
  L.push(`# Only the OPEN figure is a defensible count of live roles.`)
  L.push('')
  L.push('## BY LOCATION (open roles)')
  for (const [loc, cnt] of [...locCounts].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    L.push(`   ${String(cnt).padStart(4)}  ${loc}`)
  }
  if (locCounts.size > 40) L.push(`   ... and ${locCounts.size - 40} more locations`)
  L.push('')
  L.push('## OPEN ROLES')
  L.push('')
  for (const r of open.sort((a, b) => (b.datePosted || '').localeCompare(a.datePosted || '') || a.title.localeCompare(b.title))) {
    L.push(`  ${r.title}`)
    if (r.locationDisplay) L.push(`    location : ${r.locationDisplay}`)
    if (r.employmentType) L.push(`    type     : ${r.employmentType}`)
    if (r.datePosted) L.push(`    posted   : ${r.datePosted.slice(0, 10)}`)
    if (r.validThrough) L.push(`    valid to : ${r.validThrough.slice(0, 10)}`)
    L.push(`    url      : ${r.url}`)
    L.push('')
  }

  const notOpen = records.filter((r) => r.status !== 'OPEN')
  if (notOpen.length) {
    L.push('## NOT COUNTED AS OPEN')
    L.push('')
    for (const r of notOpen) {
      L.push(`  [${r.status}] ${r.title || r.sourceUrl}`)
      L.push(`    why : ${r.statusReason}`)
      L.push(`    url : ${r.sourceUrl}`)
      L.push('')
    }
  }
  return L.join('\n')
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const t0 = Date.now()
  console.log(`sitemap: ${CONFIG.sitemap}`)
  log('info', 'crawl-start', { config: CONFIG })

  const allUrls = await readSitemap(CONFIG.sitemap)
  metrics.sitemapUrls = allUrls.length

  const jobUrls = allUrls.filter((u) => /\/jobs?\//.test(u))
  metrics.sitemapJobUrls = jobUrls.length

  // Deduplicate before crawling: asking twice for the same posting is both
  // impolite and a way to double-count it in the report.
  const unique = new Map()
  for (const u of jobUrls) {
    const k = jobKey(u)
    if (!unique.has(k)) unique.set(k, u)
  }
  metrics.duplicateUrls = jobUrls.length - unique.size
  console.log(
    `${allUrls.length} urls in sitemap, ${jobUrls.length} job pages, ` +
    `${unique.size} unique (${metrics.duplicateUrls} duplicate)`
  )

  const state = { results: new Map() }

  if (CONFIG.resume) {
    const cp = loadCheckpoint()
    if (cp) {
      for (const [k, v] of Object.entries(cp.results || {})) {
        // Re-try anything that failed; keep every settled verdict.
        if (v.status !== 'FETCH_FAILED') state.results.set(k, v)
      }
      metrics.resumedFromCheckpoint = state.results.size
      console.log(`resumed ${state.results.size} settled records from checkpoint`)
      log('info', 'resumed', { records: state.results.size })
    }
  }

  let targets = [...unique.values()].filter((u) => !state.results.has(jobKey(u)))
  if (CONFIG.limit) targets = targets.slice(0, CONFIG.limit)

  console.log(`crawling ${targets.length} urls at concurrency ${CONFIG.concurrency}, ${CONFIG.delayMs}ms delay`)
  await crawlUrls(targets, state, { delayMs: CONFIG.delayMs, label: 'pass 1' })

  // Failure queue: everything that ended FETCH_FAILED gets one slower pass
  // before we accept that we could not read it.
  if (CONFIG.failurePass && !stopping) {
    const failed = [...state.results.values()].filter((r) => r.status === 'FETCH_FAILED')
    if (failed.length) {
      metrics.failurePassAttempted = failed.length
      console.log(`failure pass: ${failed.length} urls, ${CONFIG.failurePassDelayMs}ms delay`)
      log('info', 'failure-pass-start', { count: failed.length })
      const before = failed.length
      await crawlUrls(failed.map((r) => r.sourceUrl), state, {
        delayMs: CONFIG.failurePassDelayMs, label: 'failure pass',
      })
      const stillFailed = [...state.results.values()].filter((r) => r.status === 'FETCH_FAILED').length
      metrics.failurePassRecovered = before - stillFailed
      console.log(`failure pass recovered ${metrics.failurePassRecovered} of ${before}`)
    }
  }

  metrics.finishedAt = new Date().toISOString()
  metrics.durationMs = Date.now() - t0

  const records = [...state.results.values()]
  const report = buildReport(state, allUrls.length, jobUrls.length, metrics.duplicateUrls)

  // Each artifact is written independently. A failure on the 20MB roles file
  // must not cost us the report, and vice versa -- and the checkpoint written
  // last is the backstop that makes any of them regenerable with --resume.
  const artifacts = [
    [CONFIG.out, () => JSON.stringify({
      company: CONFIG.company,
      companyDomain: CONFIG.companyDomain,
      sitemap: CONFIG.sitemap,
      crawledAt: metrics.finishedAt,
      counts: report.statusCounts,
      defensibleActiveCount: report.defensibleActiveCount,
      roles: records,
    }, null, 2)],
    [CONFIG.outText, () => rolesToText(records, report)],
    [CONFIG.report, () => JSON.stringify(report, null, 2)],
    [CONFIG.reportText, () => reportToText(report)],
  ]
  const writeFailures = []
  for (const [path, build] of artifacts) {
    try {
      writeAtomic(path, build())
    } catch (err) {
      writeFailures.push({ path, error: String(err?.code ?? err) })
      log('error', 'artifact-write-failed', { path, error: String(err?.code ?? err) })
      console.error(`  FAILED to write ${path}: ${err?.code ?? err}`)
    }
  }
  saveCheckpoint(state)

  console.log('')
  console.log(reportToText(report))
  console.log(`wrote ${CONFIG.out}`)
  console.log(`wrote ${CONFIG.outText}`)
  console.log(`wrote ${CONFIG.report}`)
  console.log(`wrote ${CONFIG.reportText}`)
  log('info', 'crawl-finished', { report: report.statusCounts, durationMs: metrics.durationMs })

  if (writeFailures.length) {
    console.error(`\n${writeFailures.length} artifact(s) could not be written. The checkpoint at`)
    console.error(`${CONFIG.checkpoint} holds every record -- re-run with --resume to rewrite them.`)
    process.exit(2)
  }

  if (stopping) {
    console.log('\nstopped early -- re-run with --resume to finish')
    process.exit(130)
  }
}

// Only run when invoked directly, so the pure helpers above can be imported
// by the test suite without starting a crawl.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    log('error', 'crawl-crashed', { error: String(err) })
    process.exit(1)
  })
}
