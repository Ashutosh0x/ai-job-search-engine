"use client"

import { useState, useEffect, useMemo } from "react"
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
} from "lucide-react"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"

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
  location: string | null
  department: string | null
  employmentType: string | null
  isRemote: boolean
  postedAt: string | null
  applyUrl: string
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
  companies: Facet[]
  countries: Facet[]
  deployment?: { companies?: number; corpusTotal?: number; bounded?: boolean }
  generatedAt?: string
  error?: string
  details?: string
}

const PAGE_SIZE = 24

export default function ExploreJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all")

  // Server-reported, never inferred from the rows on screen.
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [departments, setDepartments] = useState<Facet[]>([])
  const [employerCount, setEmployerCount] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

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

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      })
      if (searchQuery.trim()) params.set("q", searchQuery.trim())
      if (selectedDepartment !== "all") params.set("department", selectedDepartment)

      const response = await fetch(`/api/jobs?${params.toString()}`)
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

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

      setJobs((prev) => (opts.append ? [...prev, ...valid] : valid))
      setTotal(data.total ?? 0)
      setPage(data.page ?? nextPage)
      setTotalPages(data.totalPages ?? 1)
      setHasMore(Boolean(data.hasMore))
      if (data.generatedAt) setGeneratedAt(data.generatedAt)
      // Facets are corpus-wide and identical on every page, so only the first
      // response needs to populate them.
      if (!opts.append) {
        if (Array.isArray(data.departments)) setDepartments(data.departments)
        const employers = data.deployment?.companies ?? data.companies?.length ?? 0
        setEmployerCount(employers)
      }
    } catch (err) {
      console.error("Error fetching jobs:", err)
      setError(err instanceof Error ? err.message : "Failed to load jobs")
      if (!opts.append) {
        setJobs([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  /**
   * Re-query when the search or department changes.
   *
   * Debounced at 350ms: each keystroke is a real search across the whole index,
   * and firing one per character would be both wasteful and enough traffic to
   * matter on a route with no rate limit.
   */
  useEffect(() => {
    const id = setTimeout(() => { void fetchJobs({ page: 1 }) }, searchQuery ? 350 : 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedDepartment])

  const hasFilters = Boolean(searchQuery.trim()) || selectedDepartment !== "all"

  const handleRetry = () => {
    void fetchJobs({ page: 1 })
  }

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-6 py-20">
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
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-purple-600 rounded-xl flex items-center justify-center mr-4">
                <Briefcase className="w-8 h-8 text-white" />
              </div>
              <div className="text-left">
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Explore Open Roles</h1>
                <p className="text-gray-600 dark:text-gray-400">
                  {employerCount > 0
                    ? `Across ${employerCount.toLocaleString()} employers`
                    : "Across every employer we track"}
                </p>
              </div>
            </div>
            <p className="text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
              Every role here links straight to the employer's own application page — no reposts,
              no intermediaries.
            </p>
          </div>

          {/* Stats */}
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <Card className="card-glow text-center p-6">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Briefcase className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {total.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {searchQuery || selectedDepartment !== "all" ? "Matching Positions" : "Open Positions"}
              </div>
            </Card>
            <Card className="card-glow text-center p-6">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{departments.length}</div>
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

          {/* Search and Filters */}
          <Card className="card-glow mb-8">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <Input
                    placeholder="Search jobs, locations, or departments..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                  />
                </div>
                <div className="flex items-center space-x-4">
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white"
                  >
                    <option value="all">All Departments</option>
                    {departments.map((dept) => (
                      <option key={dept.value} value={dept.value}>
                        {dept.value} ({dept.count.toLocaleString()})
                      </option>
                    ))}
                  </select>
                  <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-400">
                    <Filter className="w-4 h-4 mr-2" />
                    Filters
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Showing {jobs.length.toLocaleString()} of {total.toLocaleString()} jobs
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
                      setSearchQuery("")
                      setSelectedDepartment("all")
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
              {jobs.map((job) => {
                // Safety check to ensure job is valid
                if (!job || typeof job !== "object") return null

                return (
                  <Card key={job.id} className="card-glow hover:scale-[1.02] transition-transform duration-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white leading-tight mb-2">
                            {String(job.title || "Untitled Position")}
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
                        <CompanyLogo
                          name={String(job.company || "Unknown employer")}
                          logoUrl={job.logoUrl}
                          size={48}
                          className="ml-3"
                        />
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

                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {job.postedAt
                            ? new Date(job.postedAt).toLocaleDateString()
                            : "Date not published"}
                        </div>
                        <Button asChild className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2">
                          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                            Apply Now
                            <ExternalLink className="w-3 h-3 ml-1" />
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Paging. The grid holds one server page at a time and appends, so
              the count below is what has actually been loaded, not an estimate. */}
          {jobs.length > 0 && hasMore && (
            <div className="mt-10 text-center">
              <Button
                onClick={() => void fetchJobs({ page: page + 1, append: true })}
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
                  `Load more (page ${page} of ${totalPages.toLocaleString()})`
                )}
              </Button>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {jobs.length.toLocaleString()} of {total.toLocaleString()} shown
              </p>
            </div>
          )}

          {jobs.length > 0 && !hasMore && total > PAGE_SIZE && (
            <p className="mt-10 text-center text-sm text-gray-500 dark:text-gray-400">
              All {total.toLocaleString()} matching roles shown.
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
