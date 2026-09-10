"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Search,
  MapPin,
  Clock,
  Building2,
  ExternalLink,
  TrendingUp,
  Briefcase,
  X,
  SlidersHorizontal,
  AlertCircle,
  Loader2,
} from "lucide-react"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"

/**
 * Job search UI.
 *
 * Replaces a page that rendered four hard-coded fictional employers
 * ("TechCorp", "StartupXYZ", "DesignStudio", "DataFlow Inc") with emoji stand-in
 * logos and never called an API. Everything here comes from /api/search, which
 * serves postings ingested from each employer's own ATS.
 *
 * The filter rail carries three facets the mainstream boards do not offer:
 * company valuation, company hiring volume, and true posting freshness. See
 * app/api/search/route.ts for why each one earns its place.
 */

const VALUATION_TIERS = [
  { id: "mega", label: "$100B+" },
  { id: "decacorn", label: "$10B – $100B" },
  { id: "unicorn", label: "$1B – $10B" },
  { id: "growth", label: "Under $1B" },
]

const FRESHNESS = [
  { days: 1, label: "Past 24 hours" },
  { days: 3, label: "Past 3 days" },
  { days: 7, label: "Past week" },
  { days: 30, label: "Past month" },
]

const OPENINGS = [
  { min: 10, label: "10+ open roles" },
  { min: 50, label: "50+ open roles" },
  { min: 200, label: "200+ open roles" },
  { min: 500, label: "500+ open roles" },
]

const SORTS = [
  { id: "relevance", label: "Relevance" },
  { id: "recent", label: "Most recent" },
  { id: "valuation", label: "Company valuation" },
  { id: "openings", label: "Hiring volume" },
  { id: "salary", label: "Salary" },
]

function formatValuation(usd?: number | null) {
  if (!usd || !Number.isFinite(usd)) return null
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`
  return `$${usd.toLocaleString()}`
}

function timeAgo(iso?: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return "Just now"
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function formatSalary(min?: number | null, max?: number | null, currency?: string | null) {
  if (!min && !max) return null
  const sym = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$"
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
  if (min && max) return `${sym}${k(min)} – ${sym}${k(max)}`
  return `${sym}${k((min ?? max)!)}`
}

interface SearchResponse {
  success: boolean
  error?: string
  hint?: string
  jobs?: any[]
  total?: number
  page?: number
  totalPages?: number
  facets?: any
  generatedAt?: string
}

export default function JobListings() {
  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [location, setLocation] = useState("")
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [tiers, setTiers] = useState<string[]>([])
  const [minOpenRoles, setMinOpenRoles] = useState<number | null>(null)
  const [postedWithinDays, setPostedWithinDays] = useState<number | null>(null)
  const [departments, setDepartments] = useState<string[]>([])
  const [cities, setCities] = useState<string[]>([])
  const [countries, setCountries] = useState<string[]>([])
  const [companies, setCompanies] = useState<string[]>([])
  const [sort, setSort] = useState("relevance")
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)

  const [data, setData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // Debounce the free-text box so each keystroke does not fire a request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(t)
  }, [q])

  // Any filter change resets to the first page; without this you can end up
  // on page 7 of a 2-page result set and see an empty list.
  useEffect(() => {
    setPage(1)
  }, [debouncedQ, location, remoteOnly, tiers, minOpenRoles, postedWithinDays, departments, cities, countries, companies, sort])

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (debouncedQ) p.set("q", debouncedQ)
    if (location) p.set("location", location)
    if (remoteOnly) p.set("remote", "true")
    if (tiers.length) p.set("valuationTier", tiers.join(","))
    if (minOpenRoles) p.set("minOpenRoles", String(minOpenRoles))
    if (postedWithinDays) p.set("postedWithinDays", String(postedWithinDays))
    if (departments.length) p.set("department", departments.join(","))
    if (cities.length) p.set("city", cities.join(","))
    if (countries.length) p.set("country", countries.join(","))
    if (companies.length) p.set("company", companies.join(","))
    if (sort) p.set("sort", sort)
    p.set("page", String(page))
    p.set("pageSize", "20")
    return p.toString()
  }, [debouncedQ, location, remoteOnly, tiers, minOpenRoles, postedWithinDays, departments, cities, countries, companies, sort, page])

  const reqId = useRef(0)
  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    fetch(`/api/search?${queryString}`)
      .then((r) => r.json())
      .then((json) => {
        // Ignore responses from superseded requests so a slow early query
        // cannot overwrite a fast later one.
        if (id === reqId.current) setData(json)
      })
      .catch(() => {
        if (id === reqId.current) setData({ success: false, error: "Could not reach the search service" })
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false)
      })
  }, [queryString])

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) =>
      setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value])),
    []
  )

  const activeFilterCount =
    tiers.length +
    cities.length +
    countries.length +
    departments.length +
    companies.length +
    (remoteOnly ? 1 : 0) +
    (minOpenRoles ? 1 : 0) +
    (postedWithinDays ? 1 : 0) +
    (location ? 1 : 0)

  const clearAll = () => {
    setTiers([]); setDepartments([]); setCompanies([]); setCities([]); setCountries([])
    setRemoteOnly(false); setMinOpenRoles(null); setPostedWithinDays(null); setLocation("")
  }

  const facets = data?.facets
  const jobs = data?.jobs ?? []

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Search bar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Job title, skill or keyword"
              className="pl-9"
              aria-label="Search jobs"
            />
          </div>
          <div className="relative sm:w-64">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location"
              className="pl-9"
              aria-label="Filter by location"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters((s) => !s)}
            className="lg:hidden"
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
        </div>

        <div className="flex gap-6">
          {/* Filter rail */}
          <aside
            className={`${showFilters ? "block" : "hidden"} w-full shrink-0 lg:block lg:w-72`}
          >
            <div className="sticky top-4 space-y-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Filters</h2>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-slate-500 underline hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <FilterGroup title="Company valuation" hint="Not offered by LinkedIn or Indeed">
                {VALUATION_TIERS.map((t) => {
                  const count = facets?.valuationTiers?.find((f: any) => f.value === t.id)?.count
                  return (
                    <CheckRow
                      key={t.id}
                      checked={tiers.includes(t.id)}
                      onChange={() => toggle(setTiers, t.id)}
                      label={t.label}
                      count={count}
                    />
                  )
                })}
              </FilterGroup>

              <FilterGroup title="Hiring volume" hint="How much the company is growing">
                {OPENINGS.map((o) => (
                  <RadioRow
                    key={o.min}
                    checked={minOpenRoles === o.min}
                    onChange={() => setMinOpenRoles(minOpenRoles === o.min ? null : o.min)}
                    label={o.label}
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="Date posted" hint="From the employer's own ATS">
                {FRESHNESS.map((f) => (
                  <RadioRow
                    key={f.days}
                    checked={postedWithinDays === f.days}
                    onChange={() => setPostedWithinDays(postedWithinDays === f.days ? null : f.days)}
                    label={f.label}
                  />
                ))}
              </FilterGroup>

              <FilterGroup title="Workplace">
                <CheckRow
                  checked={remoteOnly}
                  onChange={() => setRemoteOnly((r) => !r)}
                  label="Remote only"
                  count={facets?.remote}
                />
              </FilterGroup>

              {facets?.countries?.length > 0 && (
                <FilterGroup title="Country" scroll>
                  {facets.countries.slice(0, 20).map((c: any) => (
                    <CheckRow
                      key={c.value}
                      checked={countries.includes(c.value)}
                      onChange={() => toggle(setCountries, c.value)}
                      label={c.value}
                      count={c.count}
                    />
                  ))}
                </FilterGroup>
              )}

              {facets?.cities?.length > 0 && (
                <FilterGroup title="City" hint="Normalised across every ATS spelling" scroll>
                  {facets.cities.slice(0, 25).map((c: any) => (
                    <CheckRow
                      key={c.value}
                      checked={cities.includes(c.value)}
                      onChange={() => toggle(setCities, c.value)}
                      label={c.value}
                      count={c.count}
                    />
                  ))}
                </FilterGroup>
              )}

              {facets?.departments?.length > 0 && (
                <FilterGroup title="Team" scroll>
                  {facets.departments.slice(0, 15).map((d: any) => (
                    <CheckRow
                      key={d.value}
                      checked={departments.includes(d.value)}
                      onChange={() => toggle(setDepartments, d.value)}
                      label={d.value}
                      count={d.count}
                    />
                  ))}
                </FilterGroup>
              )}

              {facets?.companies?.length > 0 && (
                <FilterGroup title="Company" scroll>
                  {facets.companies.slice(0, 20).map((c: any) => (
                    <CheckRow
                      key={c.value}
                      checked={companies.includes(c.value)}
                      onChange={() => toggle(setCompanies, c.value)}
                      label={c.label}
                      count={c.count}
                    />
                  ))}
                </FilterGroup>
              )}
            </div>
          </aside>

          {/* Results */}
          <main className="min-w-0 flex-1">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                  </span>
                ) : data?.success ? (
                  <>
                    <strong className="text-slate-900 dark:text-slate-100">
                      {data.total?.toLocaleString()}
                    </strong>{" "}
                    {data.total === 1 ? "role" : "roles"}
                    {data.generatedAt && (
                      <span className="ml-2 text-xs text-slate-400">
                        indexed {timeAgo(data.generatedAt)}
                      </span>
                    )}
                  </>
                ) : null}
              </p>

              <div className="flex items-center gap-2">
                <label htmlFor="sort" className="text-xs text-slate-500">Sort</label>
                <select
                  id="sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {tiers.map((t) => (
                  <Chip key={t} onRemove={() => toggle(setTiers, t)}>
                    {VALUATION_TIERS.find((v) => v.id === t)?.label}
                  </Chip>
                ))}
                {minOpenRoles && (
                  <Chip onRemove={() => setMinOpenRoles(null)}>{minOpenRoles}+ open roles</Chip>
                )}
                {postedWithinDays && (
                  <Chip onRemove={() => setPostedWithinDays(null)}>
                    {FRESHNESS.find((f) => f.days === postedWithinDays)?.label}
                  </Chip>
                )}
                {remoteOnly && <Chip onRemove={() => setRemoteOnly(false)}>Remote only</Chip>}
                {location && <Chip onRemove={() => setLocation("")}>{location}</Chip>}
                {countries.map((c) => (
                  <Chip key={c} onRemove={() => toggle(setCountries, c)}>{c}</Chip>
                ))}
                {cities.map((c) => (
                  <Chip key={c} onRemove={() => toggle(setCities, c)}>{c}</Chip>
                ))}
                {departments.map((d) => (
                  <Chip key={d} onRemove={() => toggle(setDepartments, d)}>{d}</Chip>
                ))}
                {companies.map((c) => (
                  <Chip key={c} onRemove={() => toggle(setCompanies, c)}>
                    {facets?.companies?.find((f: any) => f.value === c)?.label ?? c}
                  </Chip>
                ))}
              </div>
            )}

            {/* Error state -- explicit, never fabricated placeholder results */}
            {!loading && data && !data.success && (
              <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                <CardContent className="flex gap-3 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-200">{data.error}</p>
                    {data.hint && <p className="mt-1 text-amber-700 dark:text-amber-300">{data.hint}</p>}
                  </div>
                </CardContent>
              </Card>
            )}

            {!loading && data?.success && jobs.length === 0 && (
              <Card>
                <CardContent className="p-10 text-center">
                  <Briefcase className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p className="font-medium">No roles match these filters</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Try widening the valuation range or the date posted.
                  </p>
                  {activeFilterCount > 0 && (
                    <Button variant="outline" size="sm" className="mt-4" onClick={clearAll}>
                      Clear all filters
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {jobs.map((job: any) => {
                const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)
                const posted = timeAgo(job.postedAt)
                const valuation = formatValuation(job.company?.valuationUsd)

                return (
                  <Card key={job.externalId} className="transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        <Link href={`/companies/${job.companySlug}`} aria-label={job.companyName}>
                          <CompanyLogo
                            name={job.companyName}
                            logoUrl={job.company?.logoUrl}
                            size={48}
                          />
                        </Link>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                                {job.title}
                              </h3>
                              <Link
                                href={`/companies/${job.companySlug}`}
                                className="text-sm text-slate-600 hover:underline dark:text-slate-400"
                              >
                                {job.companyName}
                              </Link>
                            </div>
                            <Button asChild size="sm" variant="outline">
                              <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
                                Apply <ExternalLink className="ml-1.5 h-3 w-3" />
                              </a>
                            </Button>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            {(job.locationDisplay || job.location) && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {job.locationDisplay || job.location}
                              </span>
                            )}
                            {posted && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {posted}
                              </span>
                            )}
                            {job.company?.openRoles ? (
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {job.company.openRoles} open roles
                              </span>
                            ) : null}
                            {valuation && (
                              <span className="inline-flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                {valuation}
                                {job.company?.valuationKind === "public" ? " mkt cap" : " valuation"}
                              </span>
                            )}
                          </div>

                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {job.isRemote && <Badge variant="secondary" className="text-xs">Remote</Badge>}
                            {job.department && (
                              <Badge variant="outline" className="text-xs">{job.department}</Badge>
                            )}
                            {job.employmentType && (
                              <Badge variant="outline" className="text-xs">{job.employmentType}</Badge>
                            )}
                            {salary && <Badge variant="outline" className="text-xs">{salary}</Badge>}
                            <Badge variant="outline" className="text-xs capitalize text-slate-400">
                              via {job.provider}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Pagination */}
            {data?.success && (data.totalPages ?? 1) > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-slate-500">
                  Page {data.page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (data.totalPages ?? 1)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ small pieces ------------------------------ */

function FilterGroup({
  title,
  hint,
  scroll,
  children,
}: {
  title: string
  hint?: string
  scroll?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      <div className={`mt-2 space-y-1 ${scroll ? "max-h-52 overflow-y-auto pr-1" : ""}`}>
        {children}
      </div>
    </div>
  )
}

function CheckRow({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean
  onChange: () => void
  label: string
  count?: number
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-slate-300"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span className="text-xs tabular-nums text-slate-400">{count}</span>
      )}
    </label>
  )
}

function RadioRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        onClick={onChange}
        className="h-3.5 w-3.5 border-slate-300"
      />
      <span className="flex-1 truncate">{label}</span>
    </label>
  )
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-1 text-xs dark:bg-slate-800">
      {children}
      <button onClick={onRemove} aria-label="Remove filter" className="hover:text-red-600">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
