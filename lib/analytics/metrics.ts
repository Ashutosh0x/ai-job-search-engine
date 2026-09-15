import type { StoredEvent } from './events'
import { filterSignature } from './events'

/**
 * Aggregation. Every metric on the dashboard is computed here, from events.
 *
 * THE DEFINITIONS ARE THE PRODUCT
 * -------------------------------
 * A dashboard whose numbers are not defined is worse than no dashboard: people
 * act on it and cannot tell when it is lying. So each metric below states its
 * formula, and the same formula is what the UI documents.
 *
 *   impression       a result the user actually SAW, reported by the browser's
 *                    IntersectionObserver -- not every row the API returned.
 *                    A search returning 50 rows where 8 scroll into view is 8.
 *   detail view      a job page opened.
 *   apply click      the /go/job redirect being served. Server-authored, so it
 *                    cannot be forged and cannot be lost to a page unload.
 *   unique           distinct sessions, not raw events. A session is a rotating
 *                    daily hash (see identity.ts), so "unique" means unique
 *                    WITHIN A DAY and the UI says so.
 *
 *   detail CTR       unique detail views / unique impressions
 *   apply CTR        unique apply clicks / unique detail views
 *   search->apply    sessions that applied / sessions that searched
 *
 * Ratios are reported as null, never zero, when the denominator is below
 * MIN_SAMPLE. A 100% click-through built on one impression is noise presented
 * as insight, and it is exactly the number that makes someone promote the wrong
 * job.
 */

/** Below this, a rate is not reported at all. */
export const MIN_SAMPLE = 20

/**
 * Bots are excluded from every metric.
 *
 * They are still STORED -- dropping them would make "nobody visited" and "only
 * crawlers visited" look identical, and those call for very different responses.
 * The raw/unique split and this filter are what keep the reported numbers about
 * people.
 */
export const isHuman = (e: StoredEvent): boolean => !e.isBot

/** `metadata.repeat` is set by the de-duplication pass in record.ts. */
const isRepeat = (e: StoredEvent): boolean => e.metadata?.repeat === true

/* ------------------------------- primitives ------------------------------- */

function rate(numerator: number, denominator: number): number | null {
  if (denominator < MIN_SAMPLE) return null
  return numerator / denominator
}

/** Distinct sessions in a set of events. */
function uniqueSessions(events: StoredEvent[]): number {
  const s = new Set<string>()
  for (const e of events) s.add(e.sessionId)
  return s.size
}

interface Counter {
  raw: number
  unique: number
  sessions: Set<string>
}
const newCounter = (): Counter => ({ raw: 0, unique: 0, sessions: new Set() })
function bump(c: Counter, e: StoredEvent): void {
  c.raw++
  if (!c.sessions.has(e.sessionId)) {
    c.sessions.add(e.sessionId)
    c.unique++
  }
}

/* --------------------------------- shapes --------------------------------- */

export interface Totals {
  searches: { raw: number; unique: number }
  impressions: { raw: number; unique: number }
  detailViews: { raw: number; unique: number }
  applyClicks: { raw: number; unique: number }
  uniqueVisitors: number
  /** unique detail views / unique impressions */
  detailCtr: number | null
  /** unique apply clicks / unique detail views */
  applyCtr: number | null
  /** sessions that applied / sessions that searched */
  searchToApply: number | null
  zeroResultSearches: number
  botEvents: number
  totalEvents: number
}

export interface JobRow {
  jobId: string
  companySlug: string | null
  source: string | null
  impressions: number
  uniqueImpressions: number
  detailViews: number
  uniqueDetailViews: number
  applyClicks: number
  uniqueApplyClicks: number
  saves: number
  shares: number
  detailCtr: number | null
  applyCtr: number | null
  /** Mean rank in the result lists where it was seen. Null if never ranked. */
  averagePosition: number | null
  trend: number
}

export interface CompanyRow {
  companySlug: string
  jobs: number
  impressions: number
  detailViews: number
  applyClicks: number
  uniqueApplyClicks: number
  detailCtr: number | null
  applyCtr: number | null
}

export interface QueryRow {
  query: string
  searches: number
  uniqueSearchers: number
  /** Mean result count across those searches -- 0 identifies the gaps. */
  averageResults: number
  zeroResultSearches: number
  jobClicks: number
  applyClicks: number
  firstSeen: string
  lastSeen: string
  /** Only for zero-result queries. See opportunityScore(). */
  opportunity?: number
}

export interface DimensionRow {
  value: string
  events: number
  sessions: number
}

export interface FunnelStage {
  stage: string
  sessions: number
  /** Share of the sessions that reached the PREVIOUS stage. */
  conversionFromPrevious: number | null
}

/* -------------------------------- totals ---------------------------------- */

export function computeTotals(events: StoredEvent[]): Totals {
  const human = events.filter(isHuman)

  const searches = newCounter()
  const impressions = newCounter()
  const detail = newCounter()
  const apply = newCounter()
  const visitors = new Set<string>()
  let zeroResult = 0

  for (const e of human) {
    visitors.add(e.sessionId)
    switch (e.type) {
      case 'search':
        bump(searches, e)
        if (e.resultCount === 0) zeroResult++
        break
      case 'search_result_impression':
        bump(impressions, e)
        break
      case 'job_detail_view':
        bump(detail, e)
        break
      case 'apply_click':
        bump(apply, e)
        break
    }
  }

  const searchSessions = new Set(human.filter((e) => e.type === 'search').map((e) => e.sessionId))
  const applySessions = new Set(human.filter((e) => e.type === 'apply_click').map((e) => e.sessionId))
  /**
   * Only sessions that BOTH searched and applied count in the numerator.
   * Someone who arrived on a job page from Google and applied never searched,
   * so counting them would make the search funnel look better than it is.
   */
  let converted = 0
  for (const s of applySessions) if (searchSessions.has(s)) converted++

  return {
    searches: { raw: searches.raw, unique: searches.unique },
    impressions: { raw: impressions.raw, unique: impressions.unique },
    detailViews: { raw: detail.raw, unique: detail.unique },
    applyClicks: { raw: apply.raw, unique: apply.unique },
    uniqueVisitors: visitors.size,
    detailCtr: rate(detail.unique, impressions.unique),
    applyCtr: rate(apply.unique, detail.unique),
    searchToApply: rate(converted, searchSessions.size),
    zeroResultSearches: zeroResult,
    botEvents: events.length - human.length,
    totalEvents: events.length,
  }
}

/* --------------------------------- trend ---------------------------------- */

/**
 * Trend velocity: engagement in the recent half of the window against the older
 * half.
 *
 *   trend = (recent - older) / max(older, 1)
 *
 * Weighted so an apply click counts for more than an impression, because that
 * is the behaviour actually worth surfacing:
 *
 *   apply click 5   detail view 2   impression 1
 *
 * A job with no history scores as new rather than infinitely trending: the
 * denominator floor of 1 caps a from-nothing rise instead of letting a single
 * first click dominate the board.
 */
const TREND_WEIGHT: Partial<Record<StoredEvent['type'], number>> = {
  apply_click: 5,
  job_detail_view: 2,
  search_result_impression: 1,
  save_job: 3,
  share_job: 3,
}

function trendFor(events: StoredEvent[], midpoint: number): number {
  let recent = 0
  let older = 0
  for (const e of events) {
    const w = TREND_WEIGHT[e.type] ?? 0
    if (!w) continue
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) continue
    if (t >= midpoint) recent += w
    else older += w
  }
  if (recent === 0 && older === 0) return 0
  return (recent - older) / Math.max(older, 1)
}

/* --------------------------------- jobs ----------------------------------- */

export function computeJobs(events: StoredEvent[], window: { from: Date; to: Date }): JobRow[] {
  const midpoint = (window.from.getTime() + window.to.getTime()) / 2
  const byJob = new Map<string, StoredEvent[]>()

  for (const e of events) {
    if (!isHuman(e) || !e.jobId) continue
    const list = byJob.get(e.jobId)
    if (list) list.push(e)
    else byJob.set(e.jobId, [e])
  }

  const rows: JobRow[] = []
  for (const [jobId, list] of byJob) {
    const imp = newCounter()
    const det = newCounter()
    const app = newCounter()
    let saves = 0
    let shares = 0
    let positionSum = 0
    let positionCount = 0
    let companySlug: string | null = null
    let source: string | null = null

    for (const e of list) {
      companySlug ??= e.companySlug ?? null
      source ??= e.source ?? null
      switch (e.type) {
        case 'search_result_impression':
          bump(imp, e)
          if (typeof e.position === 'number') {
            positionSum += e.position
            positionCount++
          }
          break
        case 'job_detail_view':
          bump(det, e)
          break
        case 'apply_click':
          bump(app, e)
          break
        case 'save_job':
          saves++
          break
        case 'share_job':
          shares++
          break
      }
    }

    rows.push({
      jobId,
      companySlug,
      source,
      impressions: imp.raw,
      uniqueImpressions: imp.unique,
      detailViews: det.raw,
      uniqueDetailViews: det.unique,
      applyClicks: app.raw,
      uniqueApplyClicks: app.unique,
      saves,
      shares,
      detailCtr: rate(det.unique, imp.unique),
      applyCtr: rate(app.unique, det.unique),
      averagePosition: positionCount ? positionSum / positionCount : null,
      trend: trendFor(list, midpoint),
    })
  }

  return rows
}

/* ------------------------------- companies -------------------------------- */

export function computeCompanies(events: StoredEvent[]): CompanyRow[] {
  const byCompany = new Map<string, { jobs: Set<string>; imp: Counter; det: Counter; app: Counter }>()

  for (const e of events) {
    if (!isHuman(e) || !e.companySlug) continue
    let c = byCompany.get(e.companySlug)
    if (!c) {
      c = { jobs: new Set(), imp: newCounter(), det: newCounter(), app: newCounter() }
      byCompany.set(e.companySlug, c)
    }
    if (e.jobId) c.jobs.add(e.jobId)
    if (e.type === 'search_result_impression') bump(c.imp, e)
    else if (e.type === 'job_detail_view') bump(c.det, e)
    else if (e.type === 'apply_click') bump(c.app, e)
  }

  return [...byCompany.entries()].map(([companySlug, c]) => ({
    companySlug,
    jobs: c.jobs.size,
    impressions: c.imp.raw,
    detailViews: c.det.raw,
    applyClicks: c.app.raw,
    uniqueApplyClicks: c.app.unique,
    detailCtr: rate(c.det.unique, c.imp.unique),
    applyCtr: rate(c.app.unique, c.det.unique),
  }))
}

/* -------------------------------- queries --------------------------------- */

export function computeQueries(events: StoredEvent[]): QueryRow[] {
  const byQuery = new Map<
    string,
    {
      searches: number
      sessions: Set<string>
      resultSum: number
      resultCount: number
      zero: number
      first: string
      last: string
    }
  >()

  // Sessions that ran a given query, so downstream clicks can be attributed.
  const sessionQueries = new Map<string, Set<string>>()

  for (const e of events) {
    if (!isHuman(e) || e.type !== 'search' || !e.query) continue
    let q = byQuery.get(e.query)
    if (!q) {
      q = { searches: 0, sessions: new Set(), resultSum: 0, resultCount: 0, zero: 0, first: e.ts, last: e.ts }
      byQuery.set(e.query, q)
    }
    q.searches++
    q.sessions.add(e.sessionId)
    if (typeof e.resultCount === 'number') {
      q.resultSum += e.resultCount
      q.resultCount++
      if (e.resultCount === 0) q.zero++
    }
    if (e.ts < q.first) q.first = e.ts
    if (e.ts > q.last) q.last = e.ts

    const set = sessionQueries.get(e.sessionId) ?? new Set()
    set.add(e.query)
    sessionQueries.set(e.sessionId, set)
  }

  /**
   * Attribute clicks to every query the session ran in the window.
   *
   * Deliberately generous and deliberately stated: without per-event referrer
   * chaining there is no way to know WHICH of a session's searches produced a
   * given click, so a session that searched two things and applied once adds
   * one apply to both. That over-counts when people search several things, and
   * the alternative -- attributing to none -- would make the column useless.
   */
  const jobClicks = new Map<string, number>()
  const applyClicks = new Map<string, number>()
  for (const e of events) {
    if (!isHuman(e)) continue
    if (e.type !== 'job_detail_view' && e.type !== 'apply_click') continue
    const queries = sessionQueries.get(e.sessionId)
    if (!queries) continue
    const target = e.type === 'apply_click' ? applyClicks : jobClicks
    for (const q of queries) target.set(q, (target.get(q) ?? 0) + 1)
  }

  return [...byQuery.entries()].map(([query, q]) => ({
    query,
    searches: q.searches,
    uniqueSearchers: q.sessions.size,
    averageResults: q.resultCount ? q.resultSum / q.resultCount : 0,
    zeroResultSearches: q.zero,
    jobClicks: jobClicks.get(query) ?? 0,
    applyClicks: applyClicks.get(query) ?? 0,
    firstSeen: q.first,
    lastSeen: q.last,
  }))
}

/**
 * Which missing job categories are worth crawling next.
 *
 *   opportunity = zeroResultSearches * log2(1 + uniqueSearchers) * recency
 *
 * Three factors, each earning its place:
 *
 *   volume      how often people ask for something that is not there.
 *   reach       LOG of distinct searchers, not the raw count -- one determined
 *               person refreshing forty times must not outrank forty people
 *               asking once, and the log flattens that without ignoring reach.
 *   recency     halves every 7 days, so a category people wanted last quarter
 *               does not outrank one they want this week.
 */
export function opportunityScore(row: QueryRow, now = Date.now()): number {
  if (!row.zeroResultSearches) return 0
  const ageDays = Math.max(0, (now - Date.parse(row.lastSeen)) / 86_400_000)
  const recency = Math.pow(0.5, ageDays / 7)
  return row.zeroResultSearches * Math.log2(1 + row.uniqueSearchers) * recency
}

/* ------------------------------- dimensions -------------------------------- */

/** Group events by a coarse attribute: country, device, source, browser. */
export function computeDimension(
  events: StoredEvent[],
  key: (e: StoredEvent) => string | null | undefined,
): DimensionRow[] {
  const m = new Map<string, { events: number; sessions: Set<string> }>()
  for (const e of events) {
    if (!isHuman(e)) continue
    const v = key(e)
    if (!v) continue
    const row = m.get(v) ?? { events: 0, sessions: new Set<string>() }
    row.events++
    row.sessions.add(e.sessionId)
    m.set(v, row)
  }
  return [...m.entries()]
    .map(([value, r]) => ({ value, events: r.events, sessions: r.sessions.size }))
    .sort((a, b) => b.events - a.events)
}

/** Which filter combinations people actually use. */
export function computeFilterCombos(events: StoredEvent[]): DimensionRow[] {
  return computeDimension(events, (e) =>
    e.type === 'search' || e.type === 'filter_change' ? filterSignature(e.filters) : null,
  )
}

/* --------------------------------- funnel ---------------------------------- */

/**
 * Session-based funnel.
 *
 * Counted in SESSIONS, not events: "how many people got this far" is the
 * question, and an event count answers "how many times did it happen", which
 * makes a stage look larger than the audience that reached it.
 *
 * Stages are not required to be nested -- someone can reach a job page from a
 * search engine without searching here -- so conversion is reported between
 * ADJACENT stages and the UI does not claim a strict funnel.
 */
export function computeFunnel(events: StoredEvent[]): FunnelStage[] {
  const human = events.filter(isHuman)
  const stageEvents: [string, StoredEvent['type']][] = [
    ['Searched', 'search'],
    ['Saw results', 'search_result_impression'],
    ['Viewed a job', 'job_detail_view'],
    ['Clicked apply', 'apply_click'],
    ['Reached employer', 'external_redirect'],
  ]

  const out: FunnelStage[] = []
  let previous: number | null = null
  for (const [stage, type] of stageEvents) {
    const sessions = uniqueSessions(human.filter((e) => e.type === type))
    out.push({
      stage,
      sessions,
      conversionFromPrevious: previous === null || previous === 0 ? null : sessions / previous,
    })
    previous = sessions
  }
  return out
}

/* -------------------------------- timeseries ------------------------------- */

export interface TimeBucket {
  bucket: string
  searches: number
  impressions: number
  detailViews: number
  applyClicks: number
}

/**
 * Engagement over time.
 *
 * Bucket size is chosen from the window so a chart always has a readable number
 * of points: hourly up to two days, daily beyond.
 */
export function computeTimeseries(events: StoredEvent[], window: { from: Date; to: Date }): TimeBucket[] {
  const spanMs = window.to.getTime() - window.from.getTime()
  const hourly = spanMs <= 2 * 86_400_000
  const size = hourly ? 3_600_000 : 86_400_000

  const buckets = new Map<number, TimeBucket>()
  // Pre-create every bucket so a quiet hour renders as zero rather than being
  // dropped, which would make a gap look like a shorter time axis.
  for (let t = Math.floor(window.from.getTime() / size) * size; t < window.to.getTime(); t += size) {
    buckets.set(t, {
      bucket: new Date(t).toISOString(),
      searches: 0,
      impressions: 0,
      detailViews: 0,
      applyClicks: 0,
    })
  }

  for (const e of events) {
    if (!isHuman(e)) continue
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) continue
    const b = buckets.get(Math.floor(t / size) * size)
    if (!b) continue
    if (e.type === 'search') b.searches++
    else if (e.type === 'search_result_impression') b.impressions++
    else if (e.type === 'job_detail_view') b.detailViews++
    else if (e.type === 'apply_click') b.applyClicks++
  }

  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}
