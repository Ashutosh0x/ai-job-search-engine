/**
 * End-to-end funnel: ingest -> store -> aggregate.
 *
 * The unit tests cover each piece. This one drives the whole path the way the
 * product does -- a session searches, sees results, opens a job, clicks apply --
 * and checks the numbers that come out the far end are the ones a person would
 * count by hand.
 *
 * It exercises the real store through its real interface, so a driver that
 * accepts writes and loses them fails here rather than in production.
 */
// Read the store accessor through record.ts so this end-to-end test observes
// the exact singleton used by record(), including under Node 20's tsx loader.
import {
  __resetAnalyticsStore, buildEvent, getAnalyticsStore, record, __resetDedupe,
} from '../lib/analytics/record.ts'
import { computeTotals, computeJobs, computeQueries, computeFunnel, opportunityScore } from '../lib/analytics/metrics.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/** Force the in-process driver so the test does not depend on a database. */
process.env.ANALYTICS_DRIVER = 'memory'
delete process.env.ANALYTICS_DISABLED
__resetAnalyticsStore()
__resetDedupe()

const store = getAnalyticsStore()

function req(sessionIp, ua = 'Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120 Safari') {
  const h = new Map([
    ['x-forwarded-for', sessionIp],
    ['user-agent', ua],
    ['cf-ipcountry', 'GB'],
  ])
  return {
    url: 'https://jobspark.test/jobs',
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    cookies: { get: () => undefined },
  }
}

const JOB = 'greenhouse:acme:1'
const OTHER = 'greenhouse:globex:2'

/* ---------------------------- drive the funnel ---------------------------- */
/**
 * Three visitors:
 *   visitor A  searches, sees two jobs, opens one, applies
 *   visitor B  searches, sees two jobs, opens one, does NOT apply
 *   visitor C  searches something we have nothing for
 * plus a crawler that does everything A did.
 */
{
  const A = req('198.51.100.10')
  const B = req('198.51.100.11')
  const C = req('198.51.100.12')
  const BOT = req('198.51.100.13', 'Googlebot/2.1 (+http://www.google.com/bot.html)')

  const ctx = { source: 'greenhouse', companySlug: 'acme' }

  await record([
    buildEvent(A, { type: 'search', query: 'Software Engineer', resultCount: 42 }),
    buildEvent(A, { type: 'search_result_impression', jobId: JOB, position: 1 }, ctx),
    buildEvent(A, { type: 'search_result_impression', jobId: OTHER, position: 2 }, { source: 'greenhouse', companySlug: 'globex' }),
    buildEvent(A, { type: 'job_detail_view', jobId: JOB }, ctx),
    // Server-authored, exactly as /go/job writes it.
    buildEvent(A, { type: 'apply_click', jobId: JOB }, ctx),
    buildEvent(A, { type: 'external_redirect', jobId: JOB }, ctx),

    buildEvent(B, { type: 'search', query: 'software engineer', resultCount: 42 }),
    buildEvent(B, { type: 'search_result_impression', jobId: JOB, position: 1 }, ctx),
    buildEvent(B, { type: 'search_result_impression', jobId: OTHER, position: 2 }, { source: 'greenhouse', companySlug: 'globex' }),
    buildEvent(B, { type: 'job_detail_view', jobId: JOB }, ctx),

    buildEvent(C, { type: 'search', query: 'AI Agent Engineer', resultCount: 0 }),

    buildEvent(BOT, { type: 'search', query: 'Software Engineer', resultCount: 42 }),
    buildEvent(BOT, { type: 'job_detail_view', jobId: JOB }, ctx),
    buildEvent(BOT, { type: 'apply_click', jobId: JOB }, ctx),
  ])
}

/* ------------------------------ read it back ------------------------------ */

const now = new Date()
const window = { from: new Date(now.getTime() - 3600_000), to: new Date(now.getTime() + 3600_000) }
const events = await store.read(window)

t('every event was persisted and read back', events.length === 14, events.length)

const totals = computeTotals(events)

/* --- the two searches for "Software Engineer" normalise together --- */
t('searches are counted', totals.searches.raw === 3, totals.searches)
t('the crawler search is excluded', totals.searches.raw === 3 && totals.botEvents === 3, {
  searches: totals.searches, bots: totals.botEvents,
})

t('impressions counted', totals.impressions.raw === 4, totals.impressions)
t('detail views counted, bot excluded', totals.detailViews.raw === 2, totals.detailViews)
t('apply clicks counted, bot excluded', totals.applyClicks.raw === 1, totals.applyClicks)
t('unique visitors excludes the bot', totals.uniqueVisitors === 3, totals.uniqueVisitors)
t('the zero-result search is identified', totals.zeroResultSearches === 1, totals.zeroResultSearches)

/**
 * Rates are withheld here BY DESIGN: three sessions is far below the sample
 * floor. A dashboard reporting "50% apply rate" off two views is the number
 * that makes someone promote the wrong job.
 */
t('rates are withheld at this sample size', totals.detailCtr === null && totals.applyCtr === null, {
  detailCtr: totals.detailCtr, applyCtr: totals.applyCtr,
})

/* ------------------------------- per job ---------------------------------- */
{
  const rows = computeJobs(events, window)
  const job = rows.find((r) => r.jobId === JOB)
  const other = rows.find((r) => r.jobId === OTHER)

  t('the applied-to job is tracked', Boolean(job), rows.map((r) => r.jobId))
  t('its impressions are counted', job.impressions === 2, job.impressions)
  t('its detail views exclude the bot', job.detailViews === 2, job.detailViews)
  t('its apply clicks exclude the bot', job.uniqueApplyClicks === 1, job.uniqueApplyClicks)
  t('its average position is 1', job.averagePosition === 1, job.averagePosition)
  t('the source is carried', job.source === 'greenhouse', job.source)
  t('the company is carried', job.companySlug === 'acme', job.companySlug)

  t('the un-opened job has impressions but no views', other.impressions === 2 && other.detailViews === 0, other)
  t('and its average position is 2', other.averagePosition === 2, other.averagePosition)
}

/* ------------------------------- queries ---------------------------------- */
{
  const rows = computeQueries(events)
  const se = rows.find((r) => r.query === 'software engineer')
  const ai = rows.find((r) => r.query === 'ai agent engineer')

  // Case and spacing fold together, or the report fragments into near-duplicates.
  t('"Software Engineer" and "software engineer" aggregate together',
    se && se.searches === 2, rows.map((r) => [r.query, r.searches]))
  t('distinct searchers are counted', se.uniqueSearchers === 2, se.uniqueSearchers)
  t('average result count is carried', se.averageResults === 42, se.averageResults)

  t('the zero-result query is separate', ai && ai.zeroResultSearches === 1, ai)
  t('it scores an opportunity', opportunityScore(ai, Date.now()) > 0, opportunityScore(ai, Date.now()))
  t('and the query that found results scores none', opportunityScore(se, Date.now()) === 0)
}

/* -------------------------------- funnel ---------------------------------- */
{
  const funnel = computeFunnel(events)
  const stage = (name) => funnel.find((f) => f.stage === name)

  /**
   * THREE sessions searched: A, B, and C -- who searched for something the
   * corpus has nothing for. Only two saw results.
   *
   * That gap between stage 1 and stage 2 IS the zero-result loss, and it is the
   * single most actionable number on the funnel: it is demand arriving and
   * leaving with nothing, which no amount of ranking work will fix.
   */
  t('3 sessions searched', stage('Searched').sessions === 3, funnel)
  t('only 2 saw results — the third searched for something we do not have',
    stage('Saw results').sessions === 2)
  t('and the drop-off is visible as a conversion below 1',
    Math.abs(stage('Saw results').conversionFromPrevious - 2 / 3) < 1e-9,
    stage('Saw results').conversionFromPrevious)
  t('2 sessions viewed a job', stage('Viewed a job').sessions === 2)
  t('1 session clicked apply', stage('Clicked apply').sessions === 1)
  t('1 session reached the employer', stage('Reached employer').sessions === 1)

  const applyStage = stage('Clicked apply')
  t('conversion from view to apply is 50%',
    Math.abs(applyStage.conversionFromPrevious - 0.5) < 1e-9, applyStage.conversionFromPrevious)
}

/* ------------------------------- retention -------------------------------- */
{
  const before = (await store.read(window)).length
  // Nothing is older than the window, so nothing should go.
  const removedNone = await store.prune(new Date(now.getTime() - 86_400_000))
  t('pruning an empty range removes nothing', removedNone === 0, removedNone)
  t('and the data is intact', (await store.read(window)).length === before)

  // Now prune everything.
  const removed = await store.prune(new Date(now.getTime() + 3600_000))
  t('pruning removes the expired rows', removed === before, { removed, before })
  t('and they are gone', (await store.read(window)).length === 0)
}

/* ---------------------------- health reporting ---------------------------- */
{
  const health = await store.health()
  t('the store reports its driver', health.driver === 'memory', health)
  t('it reports that it is writable', health.writable === true)
  // The honesty requirement: an in-process buffer must not claim durability.
  t('it does NOT claim to be durable', health.durable === false, health)
  t('and it explains why', typeof health.detail === 'string' && health.detail.length > 20)
}

/* ------------------------- disabled / null driver ------------------------- */
{
  process.env.ANALYTICS_DISABLED = '1'
  __resetAnalyticsStore()
  const off = getAnalyticsStore()
  const health = await off.health()

  t('disabling analytics yields a non-writable store', health.writable === false, health)
  t('and it says so plainly', /disabled/i.test(health.detail), health.detail)

  // The critical property: writing to a disabled store must not throw. A caller
  // on the Apply path has no way to recover, so failure here would break Apply.
  let threw = false
  try {
    await off.write([{ id: 'x', type: 'page_view', ts: new Date().toISOString(), sessionId: 's',
      device: 'desktop', browser: 'chrome', os: 'macos', referrer: 'direct', country: null, isBot: false }])
  } catch { threw = true }
  t('writing to a disabled store never throws', !threw)
  t('and reading returns empty rather than failing', (await off.read(window)).length === 0)

  delete process.env.ANALYTICS_DISABLED
  __resetAnalyticsStore()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
