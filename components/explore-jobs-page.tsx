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
  location: string | null
  department: string | null
  employmentType: string | null
  isRemote: boolean
  postedAt: string | null
  applyUrl: string
}

interface JobsResponse {
  success: boolean
  jobs: Job[]
  total: number
  fallback?: boolean
  error?: string
  details?: string
}

export default function ExploreJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all")

  // Derived, not hardcoded. This page reads /api/jobs -- every employer, not
  // one board -- but the copy still said "Cloudflare Careers" from back when it
  // read a single Greenhouse board, so it named the wrong employer on every
  // row it showed.
  const companyCount = useMemo(
    () => new Set(jobs.map((j) => j.company).filter(Boolean)).size,
    [jobs]
  )

  const fetchJobs = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/jobs")

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data: JobsResponse = await response.json()

      if (data.success && Array.isArray(data.jobs)) {
        // Ensure all job properties are properly typed
        // Require only what the card cannot render without. `location` and
        // `department` are legitimately null for many employers -- Workday's
        // list endpoint publishes neither -- and demanding them here threw away
        // real postings.
        const validJobs = data.jobs.filter(
          (job) =>
            job &&
            typeof job.id === "string" &&
            typeof job.title === "string" &&
            typeof job.applyUrl === "string",
        )

        setJobs(validJobs)
        setFilteredJobs(validJobs)

        if (data.fallback) {
          setError("Using demo data - API temporarily unavailable")
        }
      } else {
        throw new Error(data.error || "Invalid response format")
      }
    } catch (err) {
      console.error("Error fetching jobs:", err)
      setError(err instanceof Error ? err.message : "Failed to load jobs")

      // Set empty array as fallback
      setJobs([])
      setFilteredJobs([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  // Filter jobs based on search query and department
  useEffect(() => {
    let filtered = jobs

    if (searchQuery) {
      filtered = filtered.filter(
        (job) =>
          job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (job.company ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (job.location ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (job.department ?? "").toLowerCase().includes(searchQuery.toLowerCase()),
      )
    }

    if (selectedDepartment !== "all") {
      filtered = filtered.filter((job) => job.department === selectedDepartment)
    }

    setFilteredJobs(filtered)
  }, [jobs, searchQuery, selectedDepartment])

  // Get unique departments for filter
  const departments = Array.from(
    new Set(jobs.map((job) => job.department).filter((d): d is string => Boolean(d)))
  ).sort()

  const handleRetry = () => {
    fetchJobs()
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
                  {companyCount > 0
                    ? `Across ${companyCount.toLocaleString()} employers`
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
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{jobs.length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Open Positions</div>
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
                      <option key={dept} value={dept}>
                        {dept}
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
                  Showing {filteredJobs.length} of {jobs.length} jobs
                </div>
                <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                  <Clock className="w-4 h-4" />
                  <span>Updated {new Date().toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Jobs Grid */}
          {filteredJobs.length === 0 ? (
            <Card className="card-glow text-center p-12">
              <CardContent className="space-y-4">
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No Jobs Found</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {jobs.length === 0
                      ? "Unable to load jobs at this time. Please try again later."
                      : "Try adjusting your search criteria or browse all available positions."}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    if (jobs.length === 0) {
                      handleRetry()
                    } else {
                      setSearchQuery("")
                      setSelectedDepartment("all")
                    }
                  }}
                  variant="ghost"
                  className="text-purple-600 dark:text-purple-400"
                >
                  {jobs.length === 0 ? "Retry" : "Clear Filters"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredJobs.map((job) => {
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
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center ml-3">
                          <span className="text-lg">☁️</span>
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
