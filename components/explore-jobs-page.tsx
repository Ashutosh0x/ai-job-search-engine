"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Search,
  MapPin,
  Building2,
  ExternalLink,
  Filter,
  Briefcase,
  Users,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
} from "lucide-react"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { applyHref, APPLY_LINK_ATTRS } from "@/lib/analytics/links"
import { track } from "@/lib/analytics/client"
import { TrackImpression } from "@/components/analytics/impression"

// Mirrors JobSearchResult in app/api/jobs/route.ts. The previous shape here
// (numeric `id`, `absolute_url`) was the Greenhouse board API's, left over from
// when this page read one company's board directly. Nothing served that shape
// any more, and the `typeof job.id === "number"` guard below silently discarded
// every row the API returned.
interface Job {
  id: string
  title: string
  company: string
  companySlug: string
  companyDomain: string | null
  logoUrl: string | null
  earlyCareer: string | null
  location: string | null
  department: string | null
  employmentType: string | null
  isRemote: boolean
  postedAt: string | null
  applyUrl: string
  // The API has returned these all along; the card simply never read them.
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
}

interface Facet {
  value: string
  count: number
  label?: string
}

interface JobsResponse {
  success: boolean
  jobs: Job[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasMore: boolean
  /** Corpus-wide, not derived from this page of results. */
  departments: Facet[]
  earlyCareer: Facet[]
  companies: Facet[]
  countries: Facet[]
  deployment?: { companies?: number; corpusTotal?: number; bounded?: boolean }
  generatedAt?: string
  error?: string
  details?: string
}

const PAGE_SIZE = 24

/** A removable active-filter pill. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 py-1 pl-2.5 pr-1 text-xs capitalize text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        // 24px is below the 44px touch target guidance, so the hit area is
        // padded out beyond the visible glyph rather than the pill being grown.
        className="rounded-full p-1 hover:bg-purple-200 dark:hover:bg-purple-800/50"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * Salary, shown only when the posting carries one.
 *
 * /api/jobs has returned salaryMin/Max/Currency all along and the card simply
 * did not read them. 3.6% of the corpus has a figure -- small, but salary is
 * the single most-wanted field on a job card, and hiding the ones we have
 * helps nobody.
 */
function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (!min && !max) return null
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: currency ? "currency" : "decimal",
        currency: currency ?? undefined,
        maximumFractionDigits: 0,
        notation: n >= 10000 ? "compact" : "standard",
      }).format(n)
    } catch {
      return `${n.toLocaleString("en-US")}${currency ? ` ${currency}` : ""}`
    }
  }
  if (min && max) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`
  return min ? `From ${fmt(min)}` : `Up to ${fmt(max!)}`
}

/** Mirrors jobPath() in lib/job-index.ts. */
function jobHref(id: string): string {
  return `/jobs/${id.split(":").map(encodeURIComponent).join("/")}`
}

export default function ExploreJobsPage() {
  const router = useRouter()
  const params = useSearchParams()

  /**
   * THE URL IS THE SEARCH STATE.
   *
   * Query, department and category lived only in component state, so a search
   * could not be linked, bookmarked, reloaded or reached with the back button:
   * every one of those returned an unfiltered page while the box still showed
   * the old text. Reading them from the URL makes a result set addressable, and
   * makes Back mean what it says.
   */
  const searchQuery = params.get("q") ?? ""
  const selectedDepartment = params.get("department") ?? "all"
  const selectedCategory = params.get("category") ?? "all"
  const selectedCountry = params.get("country") ?? "all"
  const remoteOnly = params.get("remote") === "true"

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  /** Typed text, so the input stays responsive while the URL lags behind it. */
  const [draftQuery, setDraftQuery] = useState(searchQuery)

  /**
   * Write the search into the URL.
   *
   * `replace` rather than `push` for keystrokes: pushing one history entry per
   * character would make Back walk the user letter by letter out of their own
   * query. Committed changes (a chip, the dropdown) push, so Back undoes the
   * choice that was actually made.
   */
  const commit = useCallback(
    (
      next: Partial<{ q: string; department: string; category: string; country: string; remote: string }>,
      push = false,
    ) => {
      const sp = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (!v || v === "all" || v === "false") sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      const url = qs ? `/explore-jobs?${qs}` : "/explore-jobs"
      if (push) router.push(url, { scroll: false })
      else router.replace(url, { scroll: false })
    },
    [params, router],
  )

  // Keep the box in step when the URL changes underneath it -- Back/Forward, or
  // a link into a pre-filtered search.
  useEffect(() => {
    setDraftQuery((current) => (current === searchQuery ? current : searchQuery))
  }, [searchQuery])

  // Server-reported, never inferred from the rows on screen.
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [departments, setDepartments] = useState<Facet[]>([])
  const [categories, setCategories] = useState<Facet[]>([])
  const [countries, setCountries] = useState<Facet[]>([])
  const [employerCount, setEmployerCount] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  /** Monotonic id of the newest request; only it may write state. */
  const latestRequest = useRef(0)
  /** The request currently open, so a new one can cancel it. */
  const inFlight = useRef<AbortController | null>(null)

  // Cancel whatever is open when the page goes away, so an unmounted component
  // is never the target of a setState.
  useEffect(() => () => inFlight.current?.abort(), [])

  /**
   * Fetch one page from /api/jobs.
   *
   * WHY THIS IS SERVER-SIDE NOW
   * ---------------------------
   * This page used to request /api/jobs with no parameters -- one page of 20 --
   * and then filter those 20 in the browser. So the search box searched 20 of
   * 113,416 postings, the department dropdown offered only the departments that
   * happened to appear in them, and the headline "Open Positions" figure showed
   * 20. Every filter silently operated on 0.02% of the corpus.
   *
   * The API already accepted q, department, page and pageSize and already
   * returned corpus-wide facets. Nothing new was needed server-side; this page
   * simply was not asking.
   */
  const fetchJobs = async (opts: { page?: number; append?: boolean } = {}) => {
    const nextPage = opts.page ?? 1
    if (opts.append) setLoadingMore(true)
    else setLoading(true)
    setError(null)

    // RACE GUARD.
    //
    // Every keystroke starts a request and none of them were cancelled or
    // sequenced, so responses landed in whatever order the network returned
    // them. Typing "react" could leave the results for "rea" on screen -- a
    // slower earlier request overwriting a faster later one -- and there was no
    // way to tell from the UI, because the older results are also plausible
    // jobs. Broad queries are the slow ones, so the stale response that wins is
    // reliably the least specific.
    //
    // The request id settles which response may write state; the AbortController
    // stops the superseded request from occupying a connection at all.
    const requestId = ++latestRequest.current
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      })
      if (searchQuery.trim()) params.set("q", searchQuery.trim())
      if (selectedDepartment !== "all") params.set("department", selectedDepartment)
      if (selectedCategory !== "all") params.set("earlyCareer", selectedCategory)
      if (selectedCountry !== "all") params.set("location", selectedCountry)
      if (remoteOnly) params.set("workType", "remote")

      const response = await fetch(`/api/jobs?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!response.ok) {
        // 429 is the rate limiter, not a broken index, and telling someone
        // "failed to load" when they simply typed fast is the wrong story.
        if (response.status === 429) {
          throw new Error("Too many searches in a short time. Pause a moment and try again.")
        }
        throw new Error(`The job service returned ${response.status}.`)
      }

      const data: JobsResponse = await response.json()
      if (!data.success || !Array.isArray(data.jobs)) {
        throw new Error(data.error || "Invalid response format")
      }

      // Require only what the card cannot render without. `location` and
      // `department` are legitimately null for many employers -- Workday's list
      // endpoint publishes neither -- and demanding them throws away real rows.
      const valid = data.jobs.filter(
        (job) =>
          job &&
          typeof job.id === "string" &&
          typeof job.title === "string" &&
          typeof job.applyUrl === "string",
      )

      // A superseded request must not write. Checked after every await, since
      // the newest request can land while this one is still parsing.
      if (requestId !== latestRequest.current) return

      setJobs((prev) => {
        if (!opts.append) return valid
        // Appending must not duplicate: a retried or repeated page would
        // otherwise render the same posting twice and give React duplicate keys.
        const seen = new Set(prev.map((j) => j.id))
        return [...prev, ...valid.filter((j) => !seen.has(j.id))]
      })
      /**
       * Record the search, with the result count.
       *
       * Emitted HERE rather than when the request is sent, because the count is
       * the most valuable part: a search returning zero is the signal for what
       * to crawl next, and that is only known once the response arrives.
       *
       * First page only. "Load more" is paging through one search, not a new
       * one, and counting it again would inflate search volume and make the
       * search-to-apply rate look worse than it is.
       */
      if (!opts.append) {
        track({
          type: "search",
          query: searchQuery.trim() || undefined,
          location: selectedCountry !== "all" ? selectedCountry : undefined,
          filters: {
            ...(selectedDepartment !== "all" ? { department: selectedDepartment } : {}),
            ...(selectedCategory !== "all" ? { earlyCareer: selectedCategory } : {}),
            ...(selectedCountry !== "all" ? { country: selectedCountry } : {}),
            ...(remoteOnly ? { remote: "true" } : {}),
          },
          resultCount: data.total ?? 0,
          page: data.page ?? nextPage,
        })
      }

      setTotal(data.total ?? 0)
      setPage(data.page ?? nextPage)
      setTotalPages(data.totalPages ?? 1)
      setHasMore(Boolean(data.hasMore))
      if (data.generatedAt) setGeneratedAt(data.generatedAt)
      // Facets are corpus-wide and identical on every page, so only the first
      // response needs to populate them.
      if (!opts.append) {
        if (Array.isArray(data.departments)) setDepartments(data.departments)
        if (Array.isArray(data.earlyCareer)) setCategories(data.earlyCareer)
        if (Array.isArray(data.countries)) setCountries(data.countries)
        const employers = data.deployment?.companies ?? data.companies?.length ?? 0
        setEmployerCount(employers)
      }
    } catch (err) {
      // An abort is this component cancelling its own request. It is not a
      // failure and must never surface as one -- showing "Failed to load jobs"
      // because the user kept typing is the bug, not the report of one.
      if ((err as Error)?.name === "AbortError") return
      if (requestId !== latestRequest.current) return

      console.error("Error fetching jobs:", err)
      setError(err instanceof Error ? err.message : "Failed to load jobs")
      if (!opts.append) {
        setJobs([])
        setTotal(0)
      }
    } finally {
      // Only the newest request owns the spinner; an aborted one clearing it
      // would flash the empty state under a request still in flight.
      if (requestId === latestRequest.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  /**
   * Re-query when the search or department changes.
   *
   * Debounced at 350ms: each keystroke is a real search across the whole index,
   * and firing one per character would be both wasteful and enough traffic to
   * matter on a route with no rate limit.
   */
  /**
   * Push the typed text into the URL once typing settles.
   *
   * 350ms: each search is a real query across the whole index, and one per
   * character is both wasteful and enough traffic to trip the route's own rate
   * limit. The URL is the single source of truth, so this is the only writer.
   */
  useEffect(() => {
    if (draftQuery === searchQuery) return
    const id = setTimeout(() => commit({ q: draftQuery }), 350)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQuery])

  /** Fetch whenever the URL-held search changes. */
  useEffect(() => {
    void fetchJobs({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedDepartment, selectedCategory, selectedCountry, remoteOnly])

  const hasFilters =
    Boolean(searchQuery.trim()) ||
    selectedDepartment !== "all" ||
    selectedCategory !== "all" ||
    selectedCountry !== "all" ||
    remoteOnly

  /** Count of filters beyond the free-text query, for the Filters badge. */
  const activeFilterCount =
    (selectedDepartment !== "all" ? 1 : 0) +
    (selectedCategory !== "all" ? 1 : 0) +
    (selectedCountry !== "all" ? 1 : 0) +
    (remoteOnly ? 1 : 0)

  const clearAll = () => {
    setDraftQuery("")
    commit({ q: "", department: "all", category: "all", country: "all", remote: "false" }, true)
  }

  const handleRetry = () => {
    void fetchJobs({ page: 1 })
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-20">
            {/* Loading Header */}
            <div className="text-center mb-12">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
              </div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Explore Open Roles</h1>
              <p className="text-xl text-gray-600 dark:text-gray-400">
                Loading the latest openings across every employer we track...
              </p>
            </div>

            {/* Loading Cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {[...Array(6)].map((_, index) => (
                <Card key={index} className="card-glow animate-pulse">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                      </div>
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-lg"></div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
                      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
          <div className="max-w-4xl mx-auto px-6 py-20">
            <Card className="card-glow text-center p-12">
              <CardContent className="space-y-6">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Failed to Load Jobs</h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
                </div>
                <Button onClick={handleRetry} className="bg-purple-600 hover:bg-purple-700 text-white">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-20">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-0 mb-6">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-purple-600 rounded-xl flex items-center justify-center shrink-0 sm:mr-4">
                <Briefcase className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <div className="text-center sm:text-left">
                <h1 className="text-2xl sm:text-4xl font-bold text-gray-900 dark:text-white">Explore Open Roles</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  {employerCount > 0
                    ? `Across ${employerCount.toLocaleString("en-US")} employers`
                    : "Across every employer we track"}
                </p>
              </div>
            </div>
            <p className="text-base sm:text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              Every role here links straight to the employer's own application page — no reposts,
              no intermediaries.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6 mb-8 sm:mb-12">
            <Card className="card-glow text-center p-6">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {total.toLocaleString("en-US")}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {searchQuery || selectedDepartment !== "all" ? "Matching Positions" : "Open Positions"}
              </div>
            </Card>
            <Card className="card-glow text-center p-6">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              {/* The API returns the top 30 departments, not all of them, so
                  this counted the facet list and presented the cap as a fact.
                  It now says what it is actually showing. */}
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {departments.length}
                {departments.length >= 30 && "+"}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Departments</div>
            </Card>
            <Card className="card-glow text-center p-6">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">Global</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Remote & Hybrid</div>
            </Card>
          </div>

          {/* Early-career categories.
              These are a stored classification, not a text search: "apprentice"
              as a query returns 45 rows and includes "Apprenticeship Programme
              Manager", while the classifier finds 2,726 real early-career roles
              across ten languages. Counts come from the corpus facet, so a chip
              never promises results it cannot deliver. */}
          {categories.length > 0 && (
            <div className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="flex gap-2 pb-1 sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => commit({ category: "all" }, true)}
                  aria-pressed={selectedCategory === "all"}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    selectedCategory === "all"
                      ? "border-purple-600 bg-purple-600 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  All roles
                </button>
                {categories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => commit({ category: c.value }, true)}
                    aria-pressed={selectedCategory === c.value}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm capitalize transition-colors ${
                      selectedCategory === c.value
                        ? "border-purple-600 bg-purple-600 text-white"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    }`}
                  >
                    {c.value.replace("-", " ")}
                    <span className={`ml-1.5 ${selectedCategory === c.value ? "text-purple-200" : "text-gray-400"}`}>
                      {c.count.toLocaleString("en-US")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search and Filters */}
          <Card className="card-glow mb-8">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col md:flex-row gap-3 sm:gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    id="explore-search"
                    type="search"
                    placeholder="Search jobs, locations, or departments..."
                    value={draftQuery}
                    onChange={(e) => setDraftQuery(e.target.value)}
                    // A placeholder is not a label: it disappears on the first
                    // keystroke and is not reliably announced. This input had
                    // neither, so a screen reader read it as an unnamed text box.
                    aria-label="Search jobs by title, skill, company or location"
                    aria-describedby="explore-result-count"
                    className="pl-10 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                  />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <label htmlFor="department-filter" className="sr-only">
                    Filter by department
                  </label>
                  <select
                    id="department-filter"
                    value={selectedDepartment}
                    onChange={(e) => commit({ department: e.target.value }, true)}
                    className="min-w-0 flex-1 md:flex-none md:max-w-xs truncate px-3 sm:px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
                  >
                    <option value="all">All Departments</option>
                    {departments.map((dept) => (
                      <option key={dept.value} value={dept.value}>
                        {dept.value} ({dept.count.toLocaleString("en-US")})
                      </option>
                    ))}
                  </select>
                  {/* This button had no onClick at all -- it rendered, it was
                      focusable, it looked like the way to reach more filters,
                      and clicking it did nothing. It now opens the panel below. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFilters((v) => !v)}
                    aria-expanded={showFilters}
                    aria-controls="explore-filters"
                    className="shrink-0 text-gray-600 dark:text-gray-400"
                  >
                    <Filter className="w-4 h-4 mr-2" aria-hidden="true" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-purple-600 px-1.5 text-xs text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {showFilters && (
                <div
                  id="explore-filters"
                  className="mt-4 grid gap-3 border-t border-gray-200 pt-4 dark:border-gray-700 sm:grid-cols-2"
                >
                  <div>
                    <label
                      htmlFor="country-filter"
                      className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      Country
                    </label>
                    <select
                      id="country-filter"
                      value={selectedCountry}
                      onChange={(e) => commit({ country: e.target.value }, true)}
                      className="w-full truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white"
                    >
                      <option value="all">Anywhere</option>
                      {countries.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.value} ({c.count.toLocaleString("en-US")})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <label className="inline-flex cursor-pointer items-center gap-2 py-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={remoteOnly}
                        onChange={(e) => commit({ remote: e.target.checked ? "true" : "false" }, true)}
                        className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      Remote roles only
                    </label>
                  </div>
                </div>
              )}

              {/* Active filters, each removable where it is shown. A filter you
                  can see but cannot find your way back out of is worse than no
                  filter at all. */}
              {activeFilterCount > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Active:</span>
                  {selectedDepartment !== "all" && (
                    <FilterChip
                      label={selectedDepartment}
                      onRemove={() => commit({ department: "all" }, true)}
                    />
                  )}
                  {selectedCategory !== "all" && (
                    <FilterChip
                      label={selectedCategory.replace("-", " ")}
                      onRemove={() => commit({ category: "all" }, true)}
                    />
                  )}
                  {selectedCountry !== "all" && (
                    <FilterChip
                      label={selectedCountry}
                      onRemove={() => commit({ country: "all" }, true)}
                    />
                  )}
                  {remoteOnly && (
                    <FilterChip label="Remote only" onRemove={() => commit({ remote: "false" }, true)} />
                  )}
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-xs font-medium text-purple-600 hover:underline dark:text-purple-400"
                  >
                    Clear all
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between mt-4">
                {/* Announced, because the results change without the page
                    navigating -- a sighted user sees the grid update, a screen
                    reader user previously got no signal that anything had. */}
                <div
                  id="explore-result-count"
                  role="status"
                  aria-live="polite"
                  className="text-sm text-gray-600 dark:text-gray-400"
                >
                  {loading
                    ? "Searching…"
                    : `Showing ${jobs.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} jobs`}
                </div>
                <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                  <Clock className="w-4 h-4" />
                  <span>
                    {generatedAt
                      ? `Index built ${new Date(generatedAt).toLocaleDateString()}`
                      : "Loading index date"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Jobs Grid */}
          {jobs.length === 0 ? (
            <Card className="card-glow text-center p-12">
              <CardContent className="space-y-4">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                {/* An empty result and a failed request are different things.
                    This branch used to test jobs.length === 0 inside a block
                    already guarded by it, so a search that simply matched
                    nothing told the user the site was broken. */}
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {error ? "Could not load jobs" : "No jobs matched"}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {error
                      ? error
                      : hasFilters
                        ? "No posting in the index matches that search. Try a broader term or clear the department filter."
                        : "The index returned no postings."}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    if (error) {
                      handleRetry()
                    } else {
                      setDraftQuery("")
                      commit({ q: "", department: "all", category: "all" }, true)
                    }
                  }}
                  variant="ghost"
                  className="text-purple-600 dark:text-purple-400"
                >
                  {error ? "Retry" : "Clear filters"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {jobs.map((job, index) => {
                // Safety check to ensure job is valid
                if (!job || typeof job !== "object") return null

                const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)

                return (
                  <TrackImpression
                    key={job.id}
                    jobId={job.id}
                    companySlug={job.companySlug}
                    // 1-based rank in the list the user is looking at, so
                    // "average position" means what it says.
                    position={index + 1}
                    query={searchQuery.trim() || undefined}
                  >
                  <Card
                    // `hover:scale` on a grid of cards animates layout on every
                    // pointer move and ignores a reduced-motion preference.
                    // A shadow change reads the same and costs no motion.
                    className="card-glow transition-shadow duration-200 hover:shadow-lg"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* The title links to the posting's own page. Every
                              card's only link used to leave the site, so the job
                              pages had no internal links at all. */}
                          <CardTitle className="break-anywhere text-base sm:text-lg font-semibold text-gray-900 dark:text-white leading-tight mb-2">
                            <Link href={jobHref(job.id)} className="hover:underline">
                              {String(job.title || "Untitled Position")}
                            </Link>
                          </CardTitle>
                          <div className="flex items-center text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                            <Building2 className="w-4 h-4 mr-1 flex-shrink-0" />
                            <span className="truncate">{String(job.company || "Unknown employer")}</span>
                          </div>
                          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mb-2">
                            <MapPin className="w-4 h-4 mr-1 flex-shrink-0" />
                            <span className="truncate">{String(job.location || "Location not stated")}</span>
                          </div>
                        </div>
                        {/* Was a hard-coded cloud emoji on every card -- a
                            leftover from when this page read one Cloudflare
                            board, so Netflix and Visa both showed a cloud.
                            CompanyLogo is the same component /jobs uses, keyed
                            off the same domain, and degrades to the employer's
                            initials rather than a broken image. */}
                        <div className="ml-3 flex flex-col items-end gap-1.5">
                          <CompanyLogo
                            name={String(job.company || "Unknown employer")}
                            logoUrl={job.logoUrl}
                            size={48}
                          />
                          {job.earlyCareer && (
                            <span className="whitespace-nowrap rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium capitalize text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              {job.earlyCareer.replace("-", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <Badge
                          variant="secondary"
                          className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        >
                          {String(job.department || "General")}
                        </Badge>
                        {job.isRemote && (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                          >
                            Remote
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 text-sm text-gray-500 dark:text-gray-400">
                          {/* Fixed locale. `toLocaleDateString()` with no locale
                              renders with the SERVER's locale during SSR and the
                              BROWSER's on hydration, so a visitor whose format
                              differs from the host's gets a React hydration
                              mismatch on every dated card. */}
                          <span className="block truncate">
                            {job.postedAt
                              ? new Date(job.postedAt).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "Date not published"}
                          </span>
                          {salary && (
                            <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
                              {salary}
                            </span>
                          )}
                        </div>
                        <Button asChild className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2">
                          <a href={applyHref(job.id)} {...APPLY_LINK_ATTRS}>
                            Apply Now
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                  </TrackImpression>
                )
              })}
            </div>
          )}

          {/* Paging. The grid holds one server page at a time and appends, so
              the count below is what has actually been loaded, not an estimate. */}
          {jobs.length > 0 && hasMore && (
            <div className="mt-10 text-center">
              <Button
                onClick={() => {
                  track({ type: "pagination", page: page + 1, resultCount: total })
                  void fetchJobs({ page: page + 1, append: true })
                }}
                disabled={loadingMore}
                variant="outline"
                size="lg"
              >
                {loadingMore ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Loading
                  </>
                ) : (
                  `Load more (page ${page} of ${totalPages.toLocaleString("en-US")})`
                )}
              </Button>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {jobs.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} shown
              </p>
            </div>
          )}

          {jobs.length > 0 && !hasMore && total > PAGE_SIZE && (
            <p className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400">
              All {total.toLocaleString("en-US")} matching roles shown.
            </p>
          )}

          {/* Footer */}
          <div className="text-center mt-16 p-8 bg-gray-100 dark:bg-gray-800/50 rounded-xl">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Don't see the perfect role?</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              New roles are crawled continuously. Refresh, or widen your filters to see more employers.
            </p>
            <Button onClick={handleRetry} className="bg-purple-600 hover:bg-purple-700 text-white">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Jobs
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
