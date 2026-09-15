import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/analytics/admin'
import { getAnalyticsStore } from '@/lib/analytics/store'
import {
  computeCompanies,
  computeDimension,
  computeFilterCombos,
  computeFunnel,
  computeJobs,
  computeQueries,
  computeTimeseries,
  computeTotals,
  opportunityScore,
  MIN_SAMPLE,
} from '@/lib/analytics/metrics'
import { loadIndex } from '@/lib/job-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The analytics read API.
 *
 *   GET /api/admin/analytics?range=7d
 *
 * ONE ENDPOINT, NOT SEVEN
 * -----------------------
 * Overview, jobs, companies, queries, sources, locations and the funnel are all
 * derived from the SAME window of events. Splitting them across routes would
 * make one dashboard load re-read and re-scan that window seven times, and
 * risks the panels disagreeing when a read lands either side of a new event.
 * One read, one pass, one consistent snapshot.
 *
 * WHY THE AGGREGATION IS IN THE APP AND NOT IN SQL
 * ------------------------------------------------
 * Because the store is an interface with more than one driver -- see
 * lib/analytics/store.ts for why that is forced rather than speculative. SQL
 * aggregation would have to be written per driver and would drift between them.
 * At this volume a single in-process pass is fast, and the read is bounded.
 * When volume demands it, the place to change is the driver: add a materialised
 * view behind `read()` without touching the dashboard.
 */

const RANGES: Record<string, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/** Rows returned per table. The dashboard paginates client-side from these. */
const TOP_N = 50

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const sp = new URL(req.url).searchParams
  const rangeKey = sp.get('range') ?? '7d'
  const days = RANGES[rangeKey] ?? RANGES['7d']

  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)

  const store = getAnalyticsStore()
  const health = await store.health()

  let events
  try {
    events = await store.read({ from, to })
  } catch (err) {
    // A read failure is reported as a read failure. Returning empty arrays would
    // render as "no activity", which is the single most misleading thing this
    // dashboard could say.
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not read analytics events',
        detail: (err as Error).message,
        storage: health,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const window = { from, to }
  const totals = computeTotals(events)
  const jobs = computeJobs(events, window)
  const queries = computeQueries(events)

  /**
   * Resolve job and company ids to names.
   *
   * The event store holds ids only -- denormalising titles into every event row
   * would multiply storage and go stale the moment a posting is re-crawled. The
   * index is already in memory, so the join is free and always current.
   */
  const index = await loadIndex()
  const jobById = new Map((index?.jobs ?? []).map((j) => [j.externalId, j]))
  const companyBySlug = new Map((index?.companies ?? []).map((c) => [c.slug, c]))

  const decorate = (rows: ReturnType<typeof computeJobs>) =>
    rows.map((r) => {
      const job = jobById.get(r.jobId)
      return {
        ...r,
        // Null rather than a placeholder: a job that has left the index is a
        // real state, and inventing a title would hide it.
        title: job?.title ?? null,
        company: job?.companyName ?? companyBySlug.get(r.companySlug ?? '')?.name ?? null,
        location: job?.locationDisplay ?? job?.location ?? null,
        stillIndexed: Boolean(job),
      }
    })

  const byApply = [...jobs].sort((a, b) => b.uniqueApplyClicks - a.uniqueApplyClicks || b.detailViews - a.detailViews)
  const byViews = [...jobs].sort((a, b) => b.detailViews - a.detailViews)
  const byTrend = [...jobs].filter((j) => j.detailViews > 0).sort((a, b) => b.trend - a.trend)
  /**
   * Seen a lot, clicked rarely. The actionable list: these are ranking or
   * presentation problems, not demand problems. Gated on MIN_SAMPLE so a job
   * with three impressions and no clicks does not head the table.
   */
  const underperforming = [...jobs]
    .filter((j) => j.uniqueImpressions >= MIN_SAMPLE && j.detailCtr !== null)
    .sort((a, b) => (a.detailCtr ?? 1) - (b.detailCtr ?? 1))

  const zeroResult = queries
    .filter((q) => q.zeroResultSearches > 0)
    .map((q) => ({ ...q, opportunity: opportunityScore(q, to.getTime()) }))
    .sort((a, b) => b.opportunity - a.opportunity)

  const companies = computeCompanies(events)
    .map((c) => ({ ...c, name: companyBySlug.get(c.companySlug)?.name ?? c.companySlug }))
    .sort((a, b) => b.applyClicks - a.applyClicks || b.detailViews - a.detailViews)

  return NextResponse.json(
    {
      ok: true,
      range: { key: rangeKey, days, from: from.toISOString(), to: to.toISOString() },
      /**
       * Surfaced on every response so the UI can say what it is looking at.
       * A dashboard reading a store that cannot persist must announce that
       * rather than render zeros that look like "nobody visited".
       */
      storage: health,
      /** The sample gate, so the UI can explain why a rate reads "—". */
      minSample: MIN_SAMPLE,
      totals,
      timeseries: computeTimeseries(events, window),
      funnel: computeFunnel(events),
      jobs: {
        topByApply: decorate(byApply.slice(0, TOP_N)),
        topByViews: decorate(byViews.slice(0, TOP_N)),
        trending: decorate(byTrend.slice(0, TOP_N)),
        underperforming: decorate(underperforming.slice(0, TOP_N)),
      },
      companies: companies.slice(0, TOP_N),
      queries: {
        top: [...queries].sort((a, b) => b.searches - a.searches).slice(0, TOP_N),
        zeroResult: zeroResult.slice(0, TOP_N),
      },
      sources: computeDimension(events, (e) => e.source),
      countries: computeDimension(events, (e) => e.country),
      devices: computeDimension(events, (e) => e.device),
      filterCombos: computeFilterCombos(events).slice(0, TOP_N),
    },
    {
      // Never cached and never shared: this is per-admin, and it is a report on
      // other people's behaviour. A CDN copy of it would be a privacy incident.
      headers: { 'Cache-Control': 'no-store, private' },
    },
  )
}
