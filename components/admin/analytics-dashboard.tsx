"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Navigation from "@/components/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertCircle,
  ArrowUpRight,
  Briefcase,
  Building2,
  Download,
  Eye,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Search as SearchIcon,
  TrendingUp,
} from "lucide-react"

/**
 * Admin analytics.
 *
 * Built in the same visual language as /jobs, /companies and the job detail
 * page -- slate surfaces, the shared Card/Badge/Button primitives, lucide
 * icons, the same Navigation -- rather than a separate admin skin. It is the
 * same product, and a second design system would be one more thing to keep in
 * step for no benefit.
 *
 * THE RULE THIS FILE FOLLOWS
 * --------------------------
 * Never render a number that is not backed by events. Where the sample is too
 * small the rate shows as a dash with the reason, and where the store cannot
 * persist the page says so at the top. A dashboard that renders zeros when it
 * is actually broken is worse than one that refuses to draw.
 */

/* --------------------------------- types ---------------------------------- */

interface Totals {
  searches: { raw: number; unique: number }
  impressions: { raw: number; unique: number }
  detailViews: { raw: number; unique: number }
  applyClicks: { raw: number; unique: number }
  uniqueVisitors: number
  detailCtr: number | null
  applyCtr: number | null
  searchToApply: number | null
  zeroResultSearches: number
  botEvents: number
  totalEvents: number
}

interface JobRow {
  jobId: string
  title: string | null
  company: string | null
  location: string | null
  source: string | null
  stillIndexed: boolean
  impressions: number
  uniqueImpressions: number
  detailViews: number
  applyClicks: number
  uniqueApplyClicks: number
  detailCtr: number | null
  applyCtr: number | null
  averagePosition: number | null
  trend: number
}

interface CompanyRow {
  companySlug: string
  name: string
  jobs: number
  impressions: number
  detailViews: number
  applyClicks: number
  detailCtr: number | null
  applyCtr: number | null
}

interface QueryRow {
  query: string
  searches: number
  uniqueSearchers: number
  averageResults: number
  zeroResultSearches: number
  jobClicks: number
  applyClicks: number
  lastSeen: string
  opportunity?: number
}

interface DimensionRow {
  value: string
  events: number
  sessions: number
}

interface Storage {
  driver: string
  writable: boolean
  durable: boolean
  detail: string
  dropped: number
}

interface Payload {
  ok: boolean
  error?: string
  detail?: string
  range: { key: string; days: number; from: string; to: string }
  storage: Storage
  minSample: number
  totals: Totals
  timeseries: { bucket: string; searches: number; impressions: number; detailViews: number; applyClicks: number }[]
  funnel: { stage: string; sessions: number; conversionFromPrevious: number | null }[]
  jobs: {
    topByApply: JobRow[]
    topByViews: JobRow[]
    trending: JobRow[]
    underperforming: JobRow[]
  }
  companies: CompanyRow[]
  queries: { top: QueryRow[]; zeroResult: QueryRow[] }
  sources: DimensionRow[]
  countries: DimensionRow[]
  devices: DimensionRow[]
  filterCombos: DimensionRow[]
}

/* -------------------------------- helpers --------------------------------- */

const RANGES = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
]

const num = (n: number) => n.toLocaleString("en-US")

/**
 * A rate, or an em-dash.
 *
 * `null` means the denominator was under the sample floor. Rendering it as
 * "0%" would be a lie, and rendering "100%" off three impressions is the number
 * that makes someone promote the wrong job.
 */
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`)

const jobHref = (id: string) => `/jobs/${id.split(":").map(encodeURIComponent).join("/")}`

/** Signed, human-readable trend. */
function trendLabel(t: number): { text: string; tone: string } {
  if (!Number.isFinite(t) || t === 0) return { text: "flat", tone: "text-slate-400" }
  const pctv = Math.round(t * 100)
  if (pctv > 0) return { text: `+${pctv}%`, tone: "text-emerald-600 dark:text-emerald-400" }
  return { text: `${pctv}%`, tone: "text-slate-500" }
}

/* ------------------------------- components -------------------------------- */

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span aria-hidden="true">{icon}</span>
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** Shared empty state. Says why there is nothing, not just that there is nothing. */
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">{children}</div>
}

/** Horizontal scroll container, so a wide table never widens the page. */
function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>
}

const th = "px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
const thNum = `${th} text-right`
const td = "px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300"
const tdNum = `${td} text-right tabular-nums`

/* -------------------------------- the page -------------------------------- */

export default function AnalyticsDashboard() {
  const [range, setRange] = useState("7d")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"apply" | "views" | "trending" | "underperforming">("apply")

  const load = async (key: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/analytics?range=${encodeURIComponent(key)}`, {
        credentials: "include",
      })
      if (res.status === 404) {
        // The API answers 404 rather than 403 for a non-admin, so the message
        // here covers both "not signed in as an admin" and "not configured".
        throw new Error(
          "This dashboard is not available for your account. It requires an admin address listed in ADMIN_EMAILS.",
        )
      }
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.detail || json.error || `Request failed (${res.status})`)
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  const chart = useMemo(
    () =>
      (data?.timeseries ?? []).map((b) => ({
        ...b,
        // Short label; the tooltip carries the full timestamp.
        label:
          data && data.range.days <= 2
            ? new Date(b.bucket).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
            : new Date(b.bucket).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      })),
    [data],
  )

  /** CSV of whatever table is on screen. Aggregates only -- never raw events. */
  const exportCsv = () => {
    if (!data) return
    const rows = data.jobs[tab === "apply" ? "topByApply" : tab === "views" ? "topByViews" : tab === "trending" ? "trending" : "underperforming"]
    const header = ["job_id", "title", "company", "location", "source", "impressions", "detail_views", "apply_clicks", "detail_ctr", "apply_ctr"]
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [r.jobId, r.title, r.company, r.location, r.source, r.impressions, r.detailViews, r.uniqueApplyClicks, r.detailCtr ?? "", r.applyCtr ?? ""]
          .map(esc)
          .join(","),
      ),
    ].join("\n")

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `jobspark-analytics-${tab}-${data.range.key}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const jobRows = data
    ? data.jobs[tab === "apply" ? "topByApply" : tab === "views" ? "topByViews" : tab === "trending" ? "trending" : "underperforming"]
    : []

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* ------------------------------ header ----------------------------- */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Analytics</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Search, job and employer engagement. Bots excluded; unique counts are per day.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900"
              role="group"
              aria-label="Date range"
            >
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  aria-pressed={range === r.key}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    range === r.key
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => void load(range)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              <span className="sr-only">Refresh</span>
            </Button>
          </div>
        </div>

        {/* --------------------------- error state --------------------------- */}
        {error && (
          <Card className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex gap-3 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">Analytics unavailable</p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------ storage health --------------------------- */}
        {/* A store that cannot persist must SAY so. Rendering zeros from a
            broken store is the most misleading thing this page could do. */}
        {data && !data.storage.durable && (
          <Card className="mb-6 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex gap-3 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Storage is not durable — driver: {data.storage.driver}
                </p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">{data.storage.detail}</p>
                {data.storage.dropped > 0 && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    {num(data.storage.dropped)} events were dropped, so totals below are a lower bound.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* --------------------------- loading ------------------------------- */}
        {loading && !data && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* ---------------------------- overview -------------------------- */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                icon={<SearchIcon className="h-3.5 w-3.5" />}
                label="Searches"
                value={num(data.totals.searches.raw)}
                sub={`${num(data.totals.searches.unique)} unique sessions`}
              />
              <Stat
                icon={<Eye className="h-3.5 w-3.5" />}
                label="Job views"
                value={num(data.totals.detailViews.raw)}
                sub={`${num(data.totals.impressions.raw)} results seen`}
              />
              <Stat
                icon={<MousePointerClick className="h-3.5 w-3.5" />}
                label="Apply clicks"
                value={num(data.totals.applyClicks.raw)}
                sub={`${num(data.totals.applyClicks.unique)} unique`}
              />
              <Stat
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label="Search → apply"
                value={pct(data.totals.searchToApply)}
                sub={
                  data.totals.searchToApply === null
                    ? `Needs ${data.minSample}+ searching sessions`
                    : "Sessions that searched, then applied"
                }
              />
            </div>

            {/* ---------------------------- chart ----------------------------- */}
            <Panel
              title="Engagement over time"
              hint={`${new Date(data.range.from).toLocaleDateString("en-GB")} – ${new Date(
                data.range.to,
              ).toLocaleDateString("en-GB")} · ${data.range.days <= 2 ? "hourly" : "daily"}`}
            >
              {data.totals.totalEvents === 0 ? (
                <Empty>
                  No events recorded in this window yet. Searches, job views and apply clicks will
                  appear here as people use the site.
                </Empty>
              ) : (
                <div className="h-64 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gSearch" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gApply" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        labelFormatter={(l) => String(l)}
                      />
                      <Area type="monotone" dataKey="searches" stroke="#6366f1" fill="url(#gSearch)" name="Searches" strokeWidth={2} />
                      <Area type="monotone" dataKey="detailViews" stroke="#0ea5e9" fill="transparent" name="Job views" strokeWidth={2} />
                      <Area type="monotone" dataKey="applyClicks" stroke="#10b981" fill="url(#gApply)" name="Apply clicks" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            {/* ---------------------------- funnel ---------------------------- */}
            <Panel
              title="Search → apply funnel"
              hint="Counted in sessions. Stages are not strictly nested: a visitor can reach a job from a search engine without searching here."
            >
              {data.funnel.every((f) => f.sessions === 0) ? (
                <Empty>Not enough data yet.</Empty>
              ) : (
                <div className="space-y-2 p-4">
                  {data.funnel.map((f) => {
                    const top = data.funnel[0].sessions || 1
                    const width = Math.max(2, (f.sessions / top) * 100)
                    return (
                      <div key={f.stage} className="flex items-center gap-3">
                        <div className="w-36 shrink-0 text-sm text-slate-600 dark:text-slate-400">{f.stage}</div>
                        <div className="h-7 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div
                            className="flex h-full items-center rounded bg-indigo-500/80 px-2 text-xs font-medium text-white"
                            style={{ width: `${width}%` }}
                          >
                            {num(f.sessions)}
                          </div>
                        </div>
                        <div className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
                          {f.conversionFromPrevious === null ? "—" : pct(f.conversionFromPrevious)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>

            {/* ----------------------------- jobs ----------------------------- */}
            <Panel
              title="Jobs"
              hint={`Rates are hidden below ${data.minSample} impressions — a rate built on a handful of views is noise.`}
              action={
                <div className="flex flex-wrap items-center gap-1">
                  {([
                    ["apply", "Most applied"],
                    ["views", "Most viewed"],
                    ["trending", "Trending"],
                    ["underperforming", "Seen, not clicked"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      aria-pressed={tab === key}
                      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                        tab === key
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!jobRows.length}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Export CSV</span>
                  </Button>
                </div>
              }
            >
              {!jobRows.length ? (
                <Empty>
                  {tab === "underperforming"
                    ? `No job has reached ${data.minSample} impressions yet, so none can be judged under-performing.`
                    : "No job engagement recorded in this window yet."}
                </Empty>
              ) : (
                <TableWrap>
                  <table className="w-full min-w-[820px]">
                    <thead className="border-b border-slate-100 dark:border-slate-800">
                      <tr>
                        <th className={th}>Job</th>
                        <th className={thNum}>Seen</th>
                        <th className={thNum}>Views</th>
                        <th className={thNum}>Applies</th>
                        <th className={thNum}>View rate</th>
                        <th className={thNum}>Apply rate</th>
                        <th className={thNum}>Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {jobRows.map((r) => {
                        const t = trendLabel(r.trend)
                        return (
                          <tr key={r.jobId} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                            <td className={td}>
                              <Link
                                href={jobHref(r.jobId)}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                {r.title ?? <span className="text-slate-400">Untitled</span>}
                              </Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                {r.company && <span>{r.company}</span>}
                                {r.location && <span>· {r.location}</span>}
                                {r.source && (
                                  <Badge variant="outline" className="text-[10px] capitalize">
                                    {r.source}
                                  </Badge>
                                )}
                                {/* A posting can leave the index while its
                                    events remain. Saying so beats a blank row. */}
                                {!r.stillIndexed && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    no longer listed
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className={tdNum}>{num(r.impressions)}</td>
                            <td className={tdNum}>{num(r.detailViews)}</td>
                            <td className={tdNum}>{num(r.uniqueApplyClicks)}</td>
                            <td className={tdNum}>{pct(r.detailCtr)}</td>
                            <td className={tdNum}>{pct(r.applyCtr)}</td>
                            <td className={`${tdNum} ${t.tone}`}>{t.text}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Panel>

            {/* -------------------- searches + zero results -------------------- */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Top searches" hint="What people actually typed.">
                {!data.queries.top.length ? (
                  <Empty>No searches recorded in this window yet.</Empty>
                ) : (
                  <TableWrap>
                    <table className="w-full min-w-[420px]">
                      <thead className="border-b border-slate-100 dark:border-slate-800">
                        <tr>
                          <th className={th}>Query</th>
                          <th className={thNum}>Searches</th>
                          <th className={thNum}>Avg results</th>
                          <th className={thNum}>Applies</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.queries.top.slice(0, 15).map((q) => (
                          <tr key={q.query} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                            <td className={td}>
                              <Link
                                href={`/jobs?q=${encodeURIComponent(q.query)}`}
                                className="hover:underline"
                              >
                                {q.query}
                              </Link>
                            </td>
                            <td className={tdNum}>{num(q.searches)}</td>
                            <td className={tdNum}>{Math.round(q.averageResults).toLocaleString("en-US")}</td>
                            <td className={tdNum}>{num(q.applyClicks)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Panel>

              {/* The most actionable panel on the page: what people want and we
                  do not have. Ranked by opportunity, not raw volume. */}
              <Panel
                title="Searches with no results"
                hint="Ranked by opportunity: volume × distinct searchers (log) × recency. This is the crawl backlog."
              >
                {!data.queries.zeroResult.length ? (
                  <Empty>
                    No zero-result searches in this window. Every search that ran found something.
                  </Empty>
                ) : (
                  <TableWrap>
                    <table className="w-full min-w-[420px]">
                      <thead className="border-b border-slate-100 dark:border-slate-800">
                        <tr>
                          <th className={th}>Query</th>
                          <th className={thNum}>Empty searches</th>
                          <th className={thNum}>People</th>
                          <th className={thNum}>Opportunity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.queries.zeroResult.slice(0, 15).map((q) => (
                          <tr key={q.query} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                            <td className={td}>{q.query}</td>
                            <td className={tdNum}>{num(q.zeroResultSearches)}</td>
                            <td className={tdNum}>{num(q.uniqueSearchers)}</td>
                            <td className={tdNum}>{(q.opportunity ?? 0).toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </Panel>
            </div>

            {/* ---------------------------- companies -------------------------- */}
            <Panel title="Employers by engagement" hint="Aggregated across every posting for that employer.">
              {!data.companies.length ? (
                <Empty>No employer engagement recorded in this window yet.</Empty>
              ) : (
                <TableWrap>
                  <table className="w-full min-w-[640px]">
                    <thead className="border-b border-slate-100 dark:border-slate-800">
                      <tr>
                        <th className={th}>Employer</th>
                        <th className={thNum}>Jobs seen</th>
                        <th className={thNum}>Views</th>
                        <th className={thNum}>Applies</th>
                        <th className={thNum}>Apply rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.companies.slice(0, 15).map((c) => (
                        <tr key={c.companySlug} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                          <td className={td}>
                            <Link
                              href={`/companies/${c.companySlug}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              {c.name}
                            </Link>
                          </td>
                          <td className={tdNum}>{num(c.jobs)}</td>
                          <td className={tdNum}>{num(c.detailViews)}</td>
                          <td className={tdNum}>{num(c.applyClicks)}</td>
                          <td className={tdNum}>{pct(c.applyCtr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Panel>

            {/* ------------------ sources / countries / devices ---------------- */}
            <div className="grid gap-6 md:grid-cols-3">
              {(
                [
                  ["Applicant tracking systems", data.sources, Briefcase, "Which board a posting came from."],
                  ["Countries", data.countries, Building2, "From the CDN's own header, never inferred."],
                  ["Devices", data.devices, ArrowUpRight, "Category only — no device fingerprinting."],
                ] as const
              ).map(([title, rows, Icon, hint]) => (
                <Panel key={title} title={title} hint={hint}>
                  {!rows.length ? (
                    <Empty>No data yet.</Empty>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rows.slice(0, 8).map((r) => (
                        <li key={r.value} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="truncate capitalize">{r.value}</span>
                          </span>
                          <span className="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
                            {num(r.events)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              ))}
            </div>

            {/* --------------------------- definitions ------------------------- */}
            {/* The definitions ARE the product: a dashboard whose numbers are not
                defined is one people act on and cannot tell when it is lying. */}
            <Panel title="What these numbers mean">
              <dl className="grid gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
                {[
                  ["Seen", "A result that scrolled into view and stayed at least half-visible for half a second — not every row the API returned."],
                  ["Views", "A job page opened."],
                  ["Applies", "The tracked Apply redirect being served. Recorded server-side, so it cannot be forged or lost to a page unload."],
                  ["View rate", "Unique job views ÷ unique results seen."],
                  ["Apply rate", "Unique apply clicks ÷ unique job views."],
                  ["Search → apply", "Sessions that both searched and applied ÷ sessions that searched."],
                  ["Trend", "Weighted engagement in the recent half of the window versus the older half. An apply counts 5, a view 2, a result seen 1."],
                  ["Opportunity", "Empty searches × log₂(1 + distinct searchers) × recency, halving every 7 days."],
                  ["Unique", "Distinct sessions. Session identifiers rotate daily, so “unique” means unique within a day."],
                  ["Excluded", "Self-identifying bots are stored but excluded from every figure above."],
                ].map(([term, def]) => (
                  <div key={term}>
                    <dt className="font-medium text-slate-900 dark:text-slate-100">{term}</dt>
                    <dd className="mt-0.5 text-slate-600 dark:text-slate-400">{def}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            <p className="pb-4 text-center text-xs text-slate-400">
              {num(data.totals.totalEvents)} events in this window
              {data.totals.botEvents > 0 && `, of which ${num(data.totals.botEvents)} were bots and are excluded`}
              . Driver: {data.storage.driver}.
            </p>
          </div>
        )}

        {loading && data && (
          <div className="pointer-events-none fixed bottom-4 right-4 flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Updating
          </div>
        )}
      </div>
    </div>
  )
}
