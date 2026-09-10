import { readFile } from 'fs/promises'
import path from 'path'
import {
  COMPANY_BY_SLUG,
  companyLogoUrl,
  valuationTier,
  type CompanyRecord,
} from './companies/registry'

/**
 * Search index over the ingested snapshot.
 *
 * The snapshot is a cache of real responses from the employers' own ATS APIs
 * (see scripts/ingest-jobs.mjs), so serving from it is serving real listings --
 * it is not a fixture. Every response says which source it came from and when
 * it was generated, so a stale index is visible rather than passed off as live.
 *
 * When Supabase is configured the same records live there and this becomes a
 * fallback; the query shape below is deliberately the one Postgres can execute
 * directly, so moving it is mechanical.
 */

export interface IndexedJob {
  externalId: string
  provider: string
  companySlug: string
  companyName: string
  companyDomain: string
  title: string
  location: string | null
  department: string | null
  employmentType: string | null
  isRemote: boolean
  descriptionText: string
  postedAt: string | null
  applyUrl: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  /** Normalised location fields, produced at ingest by lib/location.ts. */
  locationDisplay?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  locationKeys?: string[]
}

export interface IndexedCompany extends CompanyRecord {
  openRoles: number
  valuationUsd?: number
  logoUrl: string
  valuationTier: string | null
}

interface Snapshot {
  generatedAt: string
  sources: string[]
  companies: IndexedCompany[]
  jobs: IndexedJob[]
  warnings: string[]
}

let cache: { data: Snapshot; loadedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Load the search index.
 *
 * Prefers the v2 pipeline output (multi-source, deduplicated, freshness-scored)
 * and falls back to the v1 snapshot when v2 has not been generated. The two
 * differ in field names, so v2 records are mapped onto the shape the UI reads
 * rather than changing every component -- the canonical schema is the source of
 * truth, this is the presentation adapter.
 */
async function loadV2(): Promise<Snapshot | null> {
  try {
    const file = path.join(process.cwd(), 'public', 'data', 'jobs-v2.json')
    const raw = await readFile(file, 'utf8')
    const v2 = JSON.parse(raw) as { generatedAt: string; jobs: any[]; report?: any }
    if (!Array.isArray(v2.jobs) || v2.jobs.length === 0) return null

    // Companies are derived from the jobs themselves: the v2 pipeline discovers
    // employers rather than reading them from a curated list.
    const companyMap = new Map<string, any>()
    for (const j of v2.jobs) {
      const existing = companyMap.get(j.companySlug)
      if (existing) {
        existing.openRoles++
        if (!existing.valuationUsd && j.companyValuationUsd) existing.valuationUsd = j.companyValuationUsd
      } else {
        // Join back to the curated registry for the metadata a crawl cannot
        // derive -- industry, HQ, and crucially the valuation's SOURCE and
        // AS-OF DATE. Carrying the figure without its provenance would present
        // a possibly-years-old private round as a current fact.
        const curated = COMPANY_BY_SLUG.get(j.companySlug)
        companyMap.set(j.companySlug, {
          slug: j.companySlug,
          name: curated?.name ?? j.company,
          domain: curated?.domain ?? j.companyDomain ?? `${j.companySlug}.com`,
          boards: curated?.boards ?? [{ provider: j.source, token: j.companySlug }],
          industry: curated?.industry,
          hqLocation: curated?.hqLocation,
          foundedYear: curated?.foundedYear,
          ticker: curated?.ticker,
          valuationKind: curated?.valuationKind ?? (j.companyValuationUsd ? 'public' : 'unknown'),
          valuationUsd: j.companyValuationUsd ?? curated?.reportedValuationUsd ?? undefined,
          valuationAsOf: curated?.valuationAsOf,
          valuationSource: curated?.valuationSource,
          openRoles: 1,
        })
      }
    }

    return {
      generatedAt: v2.generatedAt,
      sources: [...new Set(v2.jobs.map((j) => j.source))],
      companies: [...companyMap.values()],
      jobs: v2.jobs.map((j) => ({
        externalId: j.id,
        provider: j.source,
        companySlug: j.companySlug,
        companyName: j.company,
        companyDomain: j.companyDomain || `${j.companySlug}.com`,
        title: j.title,
        location: j.locationRaw,
        department: j.department,
        employmentType: j.employmentType,
        isRemote: j.remote,
        descriptionText: (j.description || '').slice(0, 1200),
        postedAt: j.postedAt,
        applyUrl: j.applicationUrl,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency: j.salaryCurrency,
        locationDisplay: j.locationDisplay,
        city: j.city,
        region: j.state,
        country: j.country,
        // Rebuild match keys from the normalised fields.
        locationKeys: [j.city, j.state, j.country, j.locationRaw]
          .filter(Boolean)
          .map((v: string) => v.toLowerCase())
          .concat(j.remote ? ['remote', 'anywhere'] : []),
        // v2-only fields surfaced to the UI.
        skills: j.skills ?? [],
        seniority: j.seniority ?? null,
        freshnessScore: j.freshnessScore ?? 0,
        isDirectApplication: j.isDirectApplication ?? true,
        sourceUrls: j.sourceUrls ?? [],
      })),
      warnings: [],
    } as unknown as Snapshot
  } catch {
    return null
  }
}

export async function loadIndex(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.data

  const v2 = await loadV2()
  if (v2) {
    v2.companies = v2.companies.map((c) => ({
      ...c,
      logoUrl: companyLogoUrl(c.domain),
      valuationTier: valuationTier(c.valuationUsd),
    }))
    cache = { data: v2, loadedAt: Date.now() }
    return v2
  }

  try {
    const file = path.join(process.cwd(), 'public', 'data', 'jobs-snapshot.json')
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Snapshot

    // Decorate companies with derived display fields once, at load.
    parsed.companies = parsed.companies.map((c) => ({
      ...c,
      logoUrl: companyLogoUrl(c.domain),
      valuationTier: valuationTier(c.valuationUsd),
    }))

    cache = { data: parsed, loadedAt: Date.now() }
    return parsed
  } catch {
    return null
  }
}

/* ----------------------------- Query interface ---------------------------- */

export interface JobQuery {
  q?: string
  location?: string
  remote?: boolean
  /** Company valuation tier ids (see VALUATION_TIERS). */
  valuationTiers?: string[]
  /** Minimum company valuation in USD. */
  minValuation?: number
  /** Minimum open roles at the company. */
  minOpenRoles?: number
  /** Only postings newer than this many days. */
  postedWithinDays?: number
  departments?: string[]
  /** Exact normalised city names. */
  cities?: string[]
  /** Exact normalised country names. */
  countries?: string[]
  companies?: string[]
  providers?: string[]
  employmentTypes?: string[]
  minSalary?: number
  sort?: 'relevance' | 'recent' | 'valuation' | 'openings' | 'salary'
  page?: number
  pageSize?: number
}

/** Tokenise once; used for both matching and scoring. */
function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1)
}

/**
 * Lightweight relevance score.
 *
 * Title matches dominate, because a query like "data engineer" should not be
 * outranked by a posting that merely mentions data engineering in its body.
 * This is deliberately the same shape as a BM25 field-boost so it can be
 * swapped for a real Postgres ranking without changing the API.
 */
function relevance(job: IndexedJob, qTokens: string[]): number {
  if (qTokens.length === 0) return 0
  const title = job.title.toLowerCase()
  const dept = (job.department ?? '').toLowerCase()
  const body = job.descriptionText.toLowerCase()

  let score = 0
  for (const t of qTokens) {
    if (title.includes(t)) score += 10
    if (dept.includes(t)) score += 4
    if (body.includes(t)) score += 1
  }
  // Exact phrase in the title is the strongest signal available here.
  if (title.includes(qTokens.join(' '))) score += 15
  return score
}

export interface SearchResult {
  jobs: (IndexedJob & { company: IndexedCompany | null; score: number })[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: {
    departments: { value: string; count: number }[]
    companies: { value: string; label: string; count: number }[]
    providers: { value: string; count: number }[]
    employmentTypes: { value: string; count: number }[]
    valuationTiers: { value: string; count: number }[]
    cities: { value: string; count: number }[]
    countries: { value: string; count: number }[]
    remote: number
  }
  generatedAt: string
  source: 'snapshot'
}

export async function searchJobs(query: JobQuery): Promise<SearchResult | null> {
  const index = await loadIndex()
  if (!index) return null

  const companyBySlug = new Map(index.companies.map((c) => [c.slug, c]))
  const qTokens = query.q ? tokens(query.q) : []

  const cutoff = query.postedWithinDays
    ? Date.now() - query.postedWithinDays * 24 * 60 * 60 * 1000
    : null

  let rows = index.jobs.map((job) => ({
    ...job,
    company: companyBySlug.get(job.companySlug) ?? null,
    score: relevance(job, qTokens),
  }))

  // ---- Filters ------------------------------------------------------------
  if (qTokens.length) {
    rows = rows.filter((r) => r.score > 0)
  }
  if (query.location) {
    const loc = query.location.trim().toLowerCase()
    // Match against the normalised keys (city / region / country / aliases)
    // and fall back to the raw string for rows ingested before normalisation.
    rows = rows.filter((r) =>
      r.locationKeys?.length
        ? r.locationKeys.some((k) => k.includes(loc) || loc.includes(k))
        : (r.location ?? '').toLowerCase().includes(loc)
    )
  }
  if (query.remote) {
    rows = rows.filter((r) => r.isRemote)
  }
  if (cutoff !== null) {
    // A posting with no date cannot be proven fresh, so it is excluded when a
    // freshness filter is active rather than assumed recent.
    rows = rows.filter((r) => r.postedAt !== null && new Date(r.postedAt).getTime() >= cutoff)
  }
  if (query.cities?.length) {
    const set = new Set(query.cities.map((c) => c.toLowerCase()))
    rows = rows.filter((r) => r.city && set.has(r.city.toLowerCase()))
  }
  if (query.countries?.length) {
    const set = new Set(query.countries.map((c) => c.toLowerCase()))
    rows = rows.filter((r) => r.country && set.has(r.country.toLowerCase()))
  }
  if (query.departments?.length) {
    const set = new Set(query.departments.map((d) => d.toLowerCase()))
    rows = rows.filter((r) => r.department && set.has(r.department.toLowerCase()))
  }
  if (query.companies?.length) {
    const set = new Set(query.companies)
    rows = rows.filter((r) => set.has(r.companySlug))
  }
  if (query.providers?.length) {
    const set = new Set(query.providers)
    rows = rows.filter((r) => set.has(r.provider))
  }
  if (query.employmentTypes?.length) {
    const set = new Set(query.employmentTypes.map((t) => t.toLowerCase()))
    rows = rows.filter((r) => r.employmentType && set.has(r.employmentType.toLowerCase()))
  }
  if (query.minSalary) {
    rows = rows.filter((r) => (r.salaryMax ?? r.salaryMin ?? 0) >= query.minSalary!)
  }
  // ---- Company-level filters: the ones no major job board offers ----------
  if (query.valuationTiers?.length) {
    const set = new Set(query.valuationTiers)
    rows = rows.filter((r) => r.company?.valuationTier && set.has(r.company.valuationTier))
  }
  if (query.minValuation) {
    rows = rows.filter((r) => (r.company?.valuationUsd ?? 0) >= query.minValuation!)
  }
  if (query.minOpenRoles) {
    rows = rows.filter((r) => (r.company?.openRoles ?? 0) >= query.minOpenRoles!)
  }

  // ---- Facets (computed over the filtered set) ----------------------------
  const countBy = <T>(items: T[], key: (t: T) => string | null | undefined) => {
    const m = new Map<string, number>()
    for (const it of items) {
      const k = key(it)
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
  }

  const facets = {
    departments: countBy(rows, (r) => r.department).slice(0, 30),
    companies: countBy(rows, (r) => r.companySlug)
      .slice(0, 50)
      .map((f) => ({ ...f, label: companyBySlug.get(f.value)?.name ?? f.value })),
    providers: countBy(rows, (r) => r.provider),
    employmentTypes: countBy(rows, (r) => r.employmentType).slice(0, 15),
    valuationTiers: countBy(rows, (r) => r.company?.valuationTier),
    cities: countBy(rows, (r) => r.city).slice(0, 40),
    countries: countBy(rows, (r) => r.country).slice(0, 40),
    remote: rows.filter((r) => r.isRemote).length,
  }

  // ---- Sort ---------------------------------------------------------------
  const sort = query.sort ?? (qTokens.length ? 'relevance' : 'recent')
  const time = (v: string | null) => (v ? new Date(v).getTime() : 0)

  rows.sort((a, b) => {
    switch (sort) {
      case 'recent':
        return time(b.postedAt) - time(a.postedAt)
      case 'valuation':
        return (b.company?.valuationUsd ?? 0) - (a.company?.valuationUsd ?? 0)
      case 'openings':
        return (b.company?.openRoles ?? 0) - (a.company?.openRoles ?? 0)
      case 'salary':
        return (b.salaryMax ?? b.salaryMin ?? 0) - (a.salaryMax ?? a.salaryMin ?? 0)
      case 'relevance':
      default:
        return b.score - a.score || time(b.postedAt) - time(a.postedAt)
    }
  })

  const total = rows.length
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  const page = Math.max(1, query.page ?? 1)
  const start = (page - 1) * pageSize

  return {
    jobs: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets,
    generatedAt: index.generatedAt,
    source: 'snapshot',
  }
}

export async function listCompanies(): Promise<IndexedCompany[] | null> {
  const index = await loadIndex()
  if (!index) return null
  return [...index.companies].sort((a, b) => (b.valuationUsd ?? 0) - (a.valuationUsd ?? 0))
}

export async function getCompany(
  slug: string
): Promise<{ company: IndexedCompany; jobs: IndexedJob[] } | null> {
  const index = await loadIndex()
  if (!index) return null
  const company = index.companies.find((c) => c.slug === slug)
  if (!company) return null
  const jobs = index.jobs
    .filter((j) => j.companySlug === slug)
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  return { company, jobs }
}

export { COMPANY_BY_SLUG }
