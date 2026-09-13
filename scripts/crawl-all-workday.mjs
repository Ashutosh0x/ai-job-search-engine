/**
 * Crawl every Workday tenant this repo knows about, and write every job link.
 *
 *   npx tsx scripts/crawl-all-workday.mjs
 *   npx tsx scripts/crawl-all-workday.mjs --concurrency 10 --out data/workday
 *   npx tsx scripts/crawl-all-workday.mjs --resume        # continue a killed run
 *   npx tsx scripts/crawl-all-workday.mjs --include-unverified
 *
 * WHAT "ALL WORKDAY JOBS" CAN AND CANNOT MEAN
 * ------------------------------------------
 * There is no global Workday index. Every customer is a separate tenant on its
 * own host with its own search endpoint, and the only way to know a tenant
 * exists is to have seen a link to it. Workday has tens of thousands of
 * customers; this crawls the ones we have discovered.
 *
 * So the honest claim is "every job at every Workday tenant we can name", and
 * the output states the tenant count so a reader can judge the coverage rather
 * than trust the word "all". Where a tenant is reachable, the crawl of THAT
 * tenant is complete -- which is the part that is actually under our control,
 * and the part the 2,000-cap handling below exists to guarantee.
 *
 * WHY THIS USES THE ADAPTER INSTEAD OF ITS OWN FETCH LOOP
 * ------------------------------------------------------
 * Workday will not page past 2,000 results. It does not error and it does not
 * return a short page -- it clamps the offset and serves the same page forever,
 * so a board with more openings comes back as exactly 2,000 and looks complete.
 * The `workday` branch in crawl-board.mjs stops at 2,000 for that reason and
 * quietly truncates the large tenants, which are precisely the ones worth
 * having: 18 of the tenants in the board list report 2,000+ open roles.
 *
 * WorkdayAdapter already solves this by partitioning on `jobFamilyGroup` and
 * deduping by `externalPath`, and scripts/test-workday-cap.mjs pins the
 * behaviour against a fake tenant. Reimplementing the loop here would mean a
 * second, untested copy of the hard part, so this script is a driver: it
 * supplies targets and owns output, and the adapter owns the protocol.
 *
 * STREAMED, NOT ACCUMULATED
 * -------------------------
 * The known tenants report ~140,000 open roles before this run widens the
 * tenant set, and the ceiling is unknown. Building one array and serialising it
 * at the end is how a nine-hour crawl dies on heap exhaustion at hour eight, so
 * each tenant is appended to NDJSON as it completes and nothing but counters is
 * retained. That also means a killed run keeps everything it had already read.
 *
 * BLOCKED IS NOT EMPTY
 * --------------------
 * A tenant behind a WAF answers 403, and a tenant with no openings answers 200
 * with zero postings. Both yield no jobs. Collapsing them lets a report say
 * "412 tenants have nothing open" when a quarter of them refused us, so the two
 * are counted separately and the refusals are named in the summary.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, createReadStream } from 'fs'
import { createInterface } from 'readline'
import { WorkdayAdapter } from '../lib/sources/adapters/ats.ts'
import { httpStats } from '../lib/sources/http.ts'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const flag = (n) => args.includes(`--${n}`)

const OUT_DIR = val('out', 'data/workday')
const CONCURRENCY = Number(val('concurrency', 8))
const MAX_PAGES = Number(val('max-pages', 400))
const LIMIT = Number(val('limit', 0))
const RESUME = flag('resume')
const INCLUDE_UNVERIFIED = flag('include-unverified')

const JOBS_NDJSON = `${OUT_DIR}/workday-jobs.ndjson`
const TENANTS_JSON = `${OUT_DIR}/workday-tenants.json`
const LINKS_TXT = `${OUT_DIR}/workday-links.txt`
const SUMMARY_TXT = `${OUT_DIR}/workday-summary.txt`
const STATE_JSON = `${OUT_DIR}/.crawl-state.json`

mkdirSync(OUT_DIR, { recursive: true })

/* ---------------------------- gather the tenants --------------------------- */

/**
 * Three sources, in descending order of how much we trust them:
 *
 *   registry.ts            curated, hand-checked, carries the company identity
 *   discovered-boards.json harvested AND verified against the live API
 *   cc-boards.json         harvested only -- a URL that existed when Common
 *                          Crawl ran, which is not a board that exists now.
 *                          Roughly one candidate in six is already dead, so
 *                          this is opt-in via --include-unverified.
 *
 * Keyed on host|token|site because a tenant legitimately runs several career
 * sites (an external site, a campus site, a country site) and they hold
 * different postings. Keying on token alone would drop all but one.
 */
const targets = []
const seen = new Set()
/**
 * WORKDAY SITE PATHS ARE CASE-INSENSITIVE.
 *
 * `AccentureCareers`, `accenturecareers` and `ACCENTURECAREERS` are one board:
 * verified against the live API, all three return the same `total` and the
 * same first posting. Common Crawl records whatever casing a page happened to
 * link, so the harvest yields several spellings of one board -- and because
 * this key folded the token but NOT the site, each spelling was crawled as a
 * separate employer.
 *
 * The postings then carry different URLs (the site segment is in the path), so
 * URL dedupe cannot collapse them either. Measured on the corpus: 316 of 1,670
 * endpoints had more than one casing, and 220,782 postings -- 27.1% -- were
 * the same job counted twice. Accenture appeared as two boards of 21,268 and
 * 21,267.
 */
const key = (t) => `${String(t.host).toLowerCase()}|${String(t.token).toLowerCase()}|${String(t.site).toLowerCase()}`

function add(t, origin) {
  if (!t.host || !t.token || !t.site) return
  const k = key(t)
  if (seen.has(k)) return
  seen.add(k)
  targets.push({ ...t, origin })
}

// The registry lines are uniform enough to read with a regex, and doing so
// avoids importing a 93KB TS module for three fields.
const reg = readFileSync('lib/companies/registry.ts', 'utf8')
for (const m of reg.matchAll(
  /provider: 'workday', token: '([^']*)', site: '([^']*)', host: '([^']*)'/g
)) add({ token: m[1], site: m[2], host: m[3] }, 'registry')
const fromRegistry = targets.length

if (existsSync('scripts/discovered-boards.json')) {
  const disc = JSON.parse(readFileSync('scripts/discovered-boards.json', 'utf8'))
  for (const b of disc.boards ?? []) {
    if (b.provider === 'workday') {
      add({ token: b.token, site: b.site, host: b.host, openRoles: b.openRoles }, 'verified')
    }
  }
}
const fromVerified = targets.length - fromRegistry

if (INCLUDE_UNVERIFIED && existsSync('scripts/cc-boards.json')) {
  const cc = JSON.parse(readFileSync('scripts/cc-boards.json', 'utf8'))
  const wd = (cc.boards ?? []).filter((b) => b.provider === 'workday')
  // Most-linked first: if the run is bounded, spend the budget on the tenants
  // the web actually points at.
  wd.sort((a, b) => (b.hits || 0) - (a.hits || 0))
  for (const b of wd) add({ token: b.token, site: b.site, host: b.host }, 'unverified')
}
const fromUnverified = targets.length - fromRegistry - fromVerified

/* ------------------------------- resume state ----------------------------- */

/**
 * Resume is keyed on the same host|token|site as the target list, and only
 * tenants that FINISHED are recorded. A tenant killed mid-drain is re-crawled
 * from scratch on resume: its partial jobs are already in the NDJSON, so the
 * file can hold duplicates across a resume boundary. That is why the reporting
 * pass below dedupes by URL rather than trusting the line count.
 */
let doneKeys = new Set()
if (RESUME && existsSync(STATE_JSON)) {
  try {
    const s = JSON.parse(readFileSync(STATE_JSON, 'utf8'))
    doneKeys = new Set(s.done ?? [])
    console.log(`resuming: ${doneKeys.size} tenants already crawled`)
  } catch (e) {
    console.error(`could not read ${STATE_JSON}, starting fresh: ${e.message}`)
  }
}

let queue = targets.filter((t) => !doneKeys.has(key(t)))
if (LIMIT) queue = queue.slice(0, LIMIT)

// A fresh run starts the NDJSON over; a resume appends to it.
if (!RESUME) writeFileSync(JOBS_NDJSON, '')

console.log(
  `workday tenants: ${targets.length} known ` +
  `(${fromRegistry} registry, ${fromVerified} verified, ${fromUnverified} unverified)`
)
console.log(`crawling ${queue.length} at concurrency ${CONCURRENCY} -> ${OUT_DIR}\n`)

/* --------------------------------- crawl ---------------------------------- */

const adapter = new WorkdayAdapter()
const out = createWriteStream(JOBS_NDJSON, { flags: 'a' })
const tenantRows = []
const warnings = []
const truncated = []

let done = 0, withJobs = 0, empty = 0, errored = 0, totalJobs = 0
let refused = 0, gone = 0, unreachable = 0
const started = Date.now()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/**
 * Ask a tenant that returned nothing WHY it returned nothing.
 *
 * The adapter cannot tell us: an HTML maintenance page, a 403 and a genuinely
 * empty board all arrive as "no postings". Workday serves the first of those
 * under HTTP 200 -- it answered wd1, wd3 and wd5 with a 31KB "currently
 * unavailable" page for every request in one run here, which would have been
 * reported as ~2,700 employers that simply have no openings.
 *
 * One extra request, paid only by tenants that came back empty, converts that
 * guess into an observation. Raw `fetch` on purpose: the shared client may have
 * an open circuit for this host by now, and the question is what the SERVER
 * says, not what our breaker remembers.
 */
async function diagnoseEmpty(t) {
  const url = `https://${t.host}/wday/cxs/${encodeURIComponent(t.token)}/${encodeURIComponent(t.site)}/jobs`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
      signal: AbortSignal.timeout(25_000),
    })
    if (r.status === 404 || r.status === 410) return 'gone'
    if ([401, 403, 429, 202].includes(r.status)) return 'refused'
    const body = await r.text()
    const head = body.slice(0, 200).trimStart().toLowerCase()
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'refused'
    try {
      const j = JSON.parse(body)
      // A board that answers with postings here but gave the adapter none is
      // not empty and not refused -- it is a disagreement worth seeing.
      return (j.jobPostings?.length || j.total) ? 'inconsistent' : 'empty'
    } catch {
      return 'refused'
    }
  } catch {
    return 'unreachable'
  }
}

/** Backpressure: a 5,000-role tenant must not outrun the disk. */
function write(line) {
  if (!out.write(line)) return new Promise((res) => out.once('drain', res))
  return null
}

/**
 * Shard-level circuit breaker.
 *
 * Workday throttles by SHARD, not by tenant: when wd1 says no it says no to
 * all 1,279 tenants on it. The per-host breaker in http.ts cannot see that,
 * because every tenant is its own host -- so a throttled shard costs a full
 * retry schedule plus a diagnosis probe per tenant, and the run spends hours
 * asking 1,279 different hostnames the same question it already knows the
 * answer to.
 *
 * After SHARD_STRIKES consecutive refusals with nothing read in between, the
 * shard is skipped. Skipped tenants are recorded as refused and are NOT marked
 * done, so `--resume` picks up exactly them once the platform recovers. One
 * success anywhere on the shard clears the count: this must yield to evidence,
 * or a shard that had a bad minute stays excluded for the rest of the run.
 */
const SHARD_STRIKES = Number(val('shard-strikes', 12))
const shardStrikes = new Map()
const shardOf = (host) => (/\.(wd\d+)\./.exec(host)?.[1]) ?? host
const skippedByShard = new Map()

async function crawlTenant(t) {
  const shard = shardOf(t.host)
  if ((shardStrikes.get(shard) ?? 0) >= SHARD_STRIKES) {
    skippedByShard.set(shard, (skippedByShard.get(shard) ?? 0) + 1)
    tenantRows.push({
      token: t.token, site: t.site, host: t.host, origin: t.origin,
      jobs: 0, outcome: 'refused', skippedShard: shard,
      priorOpenRoles: t.openRoles ?? null, truncated: false, error: null,
    })
    refused++
    done++
    return
  }

  const target = {
    source: 'workday',
    token: t.token,
    site: t.site,
    host: t.host,
    companyName: null,
    companyDomain: null,
  }

  let jobs = [], warns = [], error = null
  try {
    const r = await adapter.fetchJobs(target, { maxPages: MAX_PAGES })
    jobs = r.jobs ?? []
    warns = r.warnings ?? []
  } catch (e) {
    // One tenant's WAF, expired cert or open circuit must not end the crawl.
    error = e instanceof Error ? e.message : String(e)
  }

  for (const w of warns) {
    warnings.push(w)
    if (/truncated/i.test(w)) truncated.push(w)
  }

  if (jobs.length) {
    // One line per job. Newline-delimited so the file can be read back with a
    // stream and never needs to be parsed whole.
    const chunk = jobs.map((j) => JSON.stringify({
      tenant: t.token,
      site: t.site,
      host: t.host,
      title: j.title,
      location: j.locationRaw ?? '',
      requisitionId: j.requisitionId ?? '',
      employmentType: j.employmentType ?? '',
      remote: j.remoteFlag ?? false,
      postedAt: j.postedAt ?? '',
      url: j.applicationUrl,
    })).join('\n') + '\n'
    const wait = write(chunk)
    if (wait) await wait
  }

  // Only a tenant that produced nothing needs explaining.
  const outcome = error ? 'error' : jobs.length ? 'jobs' : await diagnoseEmpty(t)

  // Evidence the shard is alive outranks a run of failures on it.
  if (outcome === 'jobs' || outcome === 'empty' || outcome === 'gone') shardStrikes.set(shard, 0)
  else shardStrikes.set(shard, (shardStrikes.get(shard) ?? 0) + 1)

  tenantRows.push({
    token: t.token, site: t.site, host: t.host, origin: t.origin,
    jobs: jobs.length,
    outcome,
    // The previously recorded count, so a tenant that has dropped from 4,658 to
    // 20 is visible as a suspicious delta rather than accepted as the truth.
    priorOpenRoles: t.openRoles ?? null,
    truncated: warns.some((w) => /truncated/i.test(w)),
    error,
  })

  if (error) errored++
  else if (jobs.length) { withJobs++; totalJobs += jobs.length }
  else if (outcome === 'refused' || outcome === 'inconsistent') refused++
  else if (outcome === 'gone') gone++
  else if (outcome === 'unreachable') unreachable++
  else empty++

  done++
  /**
   * Only a tenant we actually READ counts as done.
   *
   * A refused or unreachable tenant is an unanswered question, and marking it
   * done would make `--resume` skip exactly the tenants the resume exists to
   * retry -- quietly freezing a throttled shard out of the corpus for good. An
   * empty board and a 404 are real answers and do not need asking again.
   */
  if (outcome === 'jobs' || outcome === 'empty' || outcome === 'gone') doneKeys.add(key(t))

  if (done % 10 === 0 || done === queue.length) {
    const mins = (Date.now() - started) / 60000
    const rate = done / Math.max(mins, 0.01)
    const eta = (queue.length - done) / Math.max(rate, 0.01)
    process.stdout.write(
      `  ${done}/${queue.length} tenants | ${totalJobs.toLocaleString()} jobs | ` +
      `${withJobs} live, ${empty} empty, ${refused} refused, ${gone} gone, ${errored + unreachable} failed | ` +
      `${rate.toFixed(1)}/min, eta ${eta.toFixed(0)}m    \r`
    )
  }
  // Checkpoint often enough that a kill costs minutes, not hours.
  if (done % 25 === 0) {
    writeFileSync(STATE_JSON, JSON.stringify({ updatedAt: new Date().toISOString(), done: [...doneKeys] }))
  }
}

const work = [...queue]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (work.length) await crawlTenant(work.shift())
}))

await new Promise((res) => out.end(res))
writeFileSync(STATE_JSON, JSON.stringify({ updatedAt: new Date().toISOString(), done: [...doneKeys] }))
process.stdout.write('\n')

/* -------------------------------- reporting ------------------------------- */

/**
 * The link list is built by streaming the NDJSON back, not from an in-memory
 * array, for the same reason the crawl streamed out.
 *
 * Dedupe is by URL, and THE LAST WRITE WINS. A resume appends, so a tenant
 * re-read after an adapter fix has both its old and its new records in the
 * file. Keeping the first occurrence -- the obvious way to dedupe a stream --
 * would serve the stale copy and silently discard the re-crawl, which is how a
 * backfill reports success while changing nothing.
 *
 * Two passes over the file rather than one: the first records where each URL
 * last appears, the second emits only those lines. That costs a second read of
 * a large file and a map of URLs, and buys the guarantee that what we publish
 * is the freshest thing we read.
 */
const lastAt = new Map()
{
  let i = 0
  for await (const line of createInterface({ input: createReadStream(JOBS_NDJSON), crlfDelay: Infinity })) {
    if (line.trim()) {
      const m = /"url":"([^"]+)"/.exec(line)
      if (m) lastAt.set(m[1], i)
    }
    i++
  }
}

const linkStream = createWriteStream(LINKS_TXT)
const seenUrls = new Set()
let lines = 0, duplicates = 0, lineNo = -1
const byTenant = new Map()
const byLocation = new Map()

linkStream.write('# Every job link from every Workday tenant this repo knows about.\n')
linkStream.write(`# generated ${new Date().toISOString()}\n`)
linkStream.write('# NOT all of Workday -- see the header of scripts/crawl-all-workday.mjs.\n#\n')

for await (const line of createInterface({ input: createReadStream(JOBS_NDJSON), crlfDelay: Infinity })) {
  lineNo++
  if (!line.trim()) continue
  let j
  try { j = JSON.parse(line) } catch { continue }
  lines++
  // Superseded by a later read of the same posting.
  if (lastAt.get(j.url) !== lineNo) { duplicates++; continue }
  if (seenUrls.has(j.url)) { duplicates++; continue }
  seenUrls.add(j.url)
  byTenant.set(j.tenant, (byTenant.get(j.tenant) || 0) + 1)
  const loc = j.location || '(no location)'
  byLocation.set(loc, (byLocation.get(loc) || 0) + 1)
  const row = `${j.url}\n    ${j.title}  |  ${j.tenant}  |  ${loc}${j.postedAt ? `  |  ${j.postedAt}` : ''}\n`
  if (!linkStream.write(row)) await new Promise((res) => linkStream.once('drain', res))
}
await new Promise((res) => linkStream.end(res))

const unique = seenUrls.size
const stats = httpStats()

writeFileSync(TENANTS_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: 'every Workday tenant known to this repo; not a global Workday index',
  tenantsKnown: targets.length,
  tenantsCrawled: done,
  tenantsWithJobs: withJobs,
  tenantsEmpty: empty,
  tenantsRefused: refused,
  tenantsGone: gone,
  tenantsUnreachable: unreachable,
  tenantsFailed: errored,
  shardsAbandoned: Object.fromEntries(skippedByShard),
  jobsWritten: lines,
  jobsUnique: unique,
  truncatedTenants: truncated.length,
  http: stats,
  tenants: tenantRows.sort((a, b) => b.jobs - a.jobs),
}, null, 2))

const mins = ((Date.now() - started) / 60000).toFixed(1)
const L = []
L.push('# ALL WORKDAY JOBS -- crawl summary')
L.push(`# generated ${new Date().toISOString()} in ${mins} min`)
L.push('')
L.push('SCOPE')
L.push('  Every Workday tenant this repo can name, crawled completely. There is no')
L.push('  global Workday index: each customer is a separate tenant on its own host,')
L.push('  and a tenant is only knowable from a link to it. Coverage below is stated')
L.push('  in tenants so it can be judged rather than taken on trust.')
L.push('')
L.push('COVERAGE')
L.push(`  tenants known         : ${targets.length}  (${fromRegistry} curated, ${fromVerified} verified, ${fromUnverified} unverified)`)
L.push(`  tenants crawled       : ${done}`)
L.push(`  with open roles       : ${withJobs}`)
L.push(`  answered, nothing open: ${empty}`)
L.push(`  refused us            : ${refused}   <- NOT empty: 403/429, or a 200 carrying a maintenance page`)
L.push(`  gone (404/410)        : ${gone}`)
L.push(`  unreachable           : ${unreachable + errored}`)
L.push('')
if (refused) {
  L.push('  A refused tenant is a gap in this crawl, not an employer without')
  L.push('  openings. Re-run with --resume once the platform stops throttling;')
  L.push('  finished tenants are skipped, so only the gaps are re-read.')
  L.push('')
}
if (skippedByShard.size) {
  L.push('SHARDS ABANDONED MID-RUN')
  L.push(`  These refused ${SHARD_STRIKES} tenants in a row, so the rest of the shard was`)
  L.push('  skipped rather than asked one hostname at a time. Workday throttles by')
  L.push('  shard, so this is one outage, not N dead employers:')
  for (const [s, n] of [...skippedByShard].sort((a, b) => b[1] - a[1])) {
    L.push(`    ${s.padEnd(8)} ${n} tenants skipped`)
  }
  L.push('')
}
L.push('JOBS')
L.push(`  unique postings       : ${unique.toLocaleString()}`)
L.push(`  lines written         : ${lines.toLocaleString()}${duplicates ? `  (${duplicates} duplicate URLs collapsed)` : ''}`)
L.push(`  distinct locations    : ${byLocation.size.toLocaleString()}`)
L.push('')
L.push('COMPLETENESS')
if (truncated.length) {
  L.push(`  ${truncated.length} tenant(s) could NOT be read in full. Workday clamps at 2,000 results`)
  L.push('  per search; these have a single jobFamilyGroup partition that is itself at')
  L.push('  the cap, so part of the board is unreachable by this method:')
  for (const w of [...new Set(truncated)].slice(0, 40)) L.push(`    ${w}`)
} else {
  L.push('  No tenant reported truncation: every reachable board was read past the')
  L.push('  2,000-result cap in full.')
}
L.push('')
if (stats.blockedHosts?.length) {
  L.push('REFUSED (not empty -- these answered 401/403/429/202)')
  for (const b of stats.blockedHosts) L.push(`  ${String(b.count).padStart(4)}x  ${b.status}  ${b.host}`)
  L.push('')
}
L.push('HTTP')
L.push(`  requests attempted    : ${stats.requests.attempted.toLocaleString()}`)
L.push(`  ok                    : ${stats.requests.ok.toLocaleString()}`)
L.push(`  blocked               : ${stats.requests.blocked.toLocaleString()}`)
L.push(`  not found             : ${stats.requests.notFound.toLocaleString()}`)
L.push(`  server error          : ${stats.requests.serverError.toLocaleString()}`)
L.push(`  network error         : ${stats.requests.networkError.toLocaleString()}`)
L.push(`  success rate          : ${stats.successRate}`)
L.push('')
L.push('TOP 40 TENANTS BY OPEN ROLES')
for (const [t, n] of [...byTenant].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  L.push(`  ${String(n).padStart(6)}  ${t}`)
}
L.push('')
L.push('TOP 40 LOCATIONS')
for (const [l, n] of [...byLocation].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  L.push(`  ${String(n).padStart(6)}  ${l}`)
}
L.push('')
L.push('FILES')
L.push(`  ${LINKS_TXT}   every link, deduped`)
L.push(`  ${JOBS_NDJSON}  one JSON job per line`)
L.push(`  ${TENANTS_JSON}  per-tenant counts and failures`)
writeFileSync(SUMMARY_TXT, L.join('\n'))

console.log('')
console.log(L.slice(6, 24).join('\n'))
console.log(`\nwrote ${LINKS_TXT}, ${JOBS_NDJSON}, ${TENANTS_JSON}, ${SUMMARY_TXT}`)
