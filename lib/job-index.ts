import { readFile, stat } from 'fs/promises'
import path from 'path'
import { parseIntent, describeIntent, type ParsedIntent } from './search/intent'
import { buildIndex, retrieve, type BuiltIndex } from './search/inverted-index'
import { rankJob, explainRank, DEFAULT_WEIGHTS } from './search/rank'
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
  /**
   * When this pipeline first observed the posting -- not when the employer
   * published it. Optional because indexes built before incremental delivery
   * do not carry it; `/api/jobs/delta` detects that and says so rather than
   * returning an empty delta.
   */
  firstSeenAt?: string
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
  /** v2-only fields the loader attaches; optional so the v1 snapshot still types. */
  skills?: string[]
  seniority?: string | null
  freshnessScore?: number
  isDirectApplication?: boolean
  sourceCount?: number
}

export interface IndexedCompany extends CompanyRecord {
  openRoles: number
  valuationUsd?: number
  logoUrl: string
  valuationTier: string | null
}

interface Snapshot {
  generatedAt: string
  /** Present when this index is a bounded deployment slice, not the full corpus. */
  deployment?: { bounded: boolean; corpusTotal: number; note: string } | null
  sources: string[]
  companies: IndexedCompany[]
  jobs: IndexedJob[]
  warnings: string[]
}

let cache: { data: Snapshot; loadedAt: number; mtimeMs: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Index file, in preference order.
 *
 * `jobs-deploy.json` is a bounded slice built by scripts/build-deploy-index.mjs
 * and is what ships to a serverless host: the full index is 382MB and cannot be
 * loaded by a Vercel function at any field projection (measured -- 199MB even
 * with descriptions stripped entirely). Locally the full file is present and
 * wins, so development sees the whole corpus and production sees the slice,
 * with no code difference between them.
 */
const INDEX_CANDIDATES = ['jobs-v2.json', 'jobs-deploy.json']
const dataPath = (f: string) => path.join(process.cwd(), 'public', 'data', f)

async function resolveIndexFile(): Promise<string | null> {
  for (const f of INDEX_CANDIDATES) {
    try {
      await stat(dataPath(f))
      return dataPath(f)
    } catch { /* try the next */ }
  }
  return null
}

const V2_PATH = () => dataPath('jobs-v2.json')

/**
 * Has the index file changed since we cached it?
 *
 * The cache was purely time-based, so a refresh that wrote a new index was
 * invisible for up to five minutes -- jobs the crawler had already found sat
 * unserved while the clock ran down. Checking mtime costs one stat() and makes
 * the pipeline-to-page path responsive: a completed refresh is live on the next
 * request.
 *
 * The TTL stays as the upper bound for the case stat cannot answer (the v1
 * fallback snapshot, or a filesystem that does not report mtime usefully).
 */
async function indexMtime(): Promise<number> {
  const f = await resolveIndexFile()
  if (!f) return 0
  try {
    return (await stat(f)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * How many candidates the inverted index returns before filtering and ranking.
 *
 * This is the recall/latency dial. Too small and a narrow structured filter
 * (say country=Vietnam) can empty an otherwise good candidate set; too large
 * and we are back to scanning. 1,500 keeps the pool wide enough that the
 * filters below still have material to work with.
 */
const RETRIEVAL_DEPTH = 1500

/**
 * Load the search index.
 *
 * Prefers the v2 pipeline output (multi-source, deduplicated, freshness-scored)
 * and falls back to the v1 snapshot when v2 has not been generated. The two
 * differ in field names, so v2 records are mapped onto the shape the UI reads
 * rather than changing every component -- the canonical schema is the source of
 * truth, this is the presentation adapter.
 */
/**
 * Node cannot hold a string larger than ~512MB, so `readFile(f,'utf8')` throws
 * ERR_STRING_TOO_LONG on a big index. That is a hard runtime ceiling, not a
 * tuning knob: the full corpus passed it at 530MB.
 */
const NODE_MAX_STRING = 0x1fffffe8

async function readIndexFile(file: string): Promise<any | null> {
  const size = (await stat(file)).size
  if (size > NODE_MAX_STRING) {
    // Say it. This previously threw, got caught, and fell silently through to
    // the 14MB v1 snapshot -- so the app served 9,648 jobs while a 238,620-job
    // index sat on disk looking fine. A capacity limit must never present as
    // "no data".
    console.error(
      `[job-index] ${file} is ${(size / 1048576).toFixed(0)}MB, over Node's ` +
        `${(NODE_MAX_STRING / 1048576).toFixed(0)}MB string limit. Skipping it. ` +
        'Build a bounded index with scripts/build-deploy-index.mjs.'
    )
    return null
  }
  return JSON.parse(await readFile(file, 'utf8'))
}

async function loadV2(): Promise<Snapshot | null> {
  try {
    // Try each candidate in turn rather than committing to the first that
    // EXISTS. A file being present is not the same as it being loadable.
    let v2: any = null
    for (const name of INDEX_CANDIDATES) {
      const path = dataPath(name)
      try {
        await stat(path)
      } catch { continue }
      try {
        const parsed = await readIndexFile(path)
        if (parsed && Array.isArray(parsed.jobs) && parsed.jobs.length) { v2 = parsed; break }
      } catch (err) {
        console.error(`[job-index] failed to load ${name}:`, (err as Error).message)
      }
    }
    if (!v2) return null

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
      // Surfaced so an API response can say it is serving a slice. A bounded
      // index that does not announce itself is indistinguishable from a corpus
      // that simply has fewer jobs in it.
      deployment: v2.deployment ?? null,
      sources: [...new Set(v2.jobs.map((j: any) => j.source))],
      companies: [...companyMap.values()],
      jobs: v2.jobs.map((j: any) => ({
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
        // Must be carried, not just declared on the interface. The field was
        // added to IndexedJob and to the snapshot writer but never mapped here,
        // so /api/jobs/delta saw no cursor on any row and reported the index as
        // predating incremental delivery -- while the file on disk had it on
        // all 241,586 jobs.
        firstSeenAt: j.firstSeenAt,
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
        // The slim index carries the count; the URLs themselves stay in the archive.
        sourceCount: j.sourceCount ?? (j.sourceUrls ?? []).length,
      })),
      warnings: [],
    } as unknown as Snapshot
  } catch {
    return null
  }
}

export async function loadIndex(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    // Serve the cache only while the file behind it is unchanged. A refresh
    // rewrites jobs-v2.json, and the whole point of refreshing is that the new
    // jobs become visible -- not that they wait for a timer.
    const mtime = await indexMtime()
    if (mtime === cache.mtimeMs) return cache.data
  }

  const v2 = await loadV2()
  if (v2) {
    v2.companies = v2.companies.map((c) => ({
      ...c,
      logoUrl: companyLogoUrl(c.domain),
      valuationTier: valuationTier(c.valuationUsd),
    }))
    cache = { data: v2, loadedAt: Date.now(), mtimeMs: await indexMtime() }
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

    cache = { data: parsed, loadedAt: Date.now(), mtimeMs: await indexMtime() }
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
  const company = (job.companyName ?? '').toLowerCase()
  const dept = (job.department ?? '').toLowerCase()
  const body = job.descriptionText.toLowerCase()

  let score = 0
  for (const t of qTokens) {
    if (title.includes(t)) score += 10
    // Same omission as the BM25 index had: an employer's name is the most
    // likely thing typed into a job search and was not scored at all.
    if (company.includes(t)) score += 10
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
  /**
   * Present when a keyword query ran. `matchedInCorpus` is how many postings
   * contain a query term; `examined` is how many the ranker actually saw.
   */
  retrieval?: { matchedInCorpus: number | null; examined: number; truncated: boolean }
  /** Set when this deployment serves a bounded slice rather than the full corpus. */
  deployment?: { bounded: boolean; corpusTotal: number; note: string }
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

/**
 * Inverted index over the loaded snapshot.
 *
 * Built lazily on first keyword search and keyed by the snapshot object itself,
 * so a snapshot reload naturally invalidates it without any explicit cache
 * plumbing. Building costs one pass; not building costs a full corpus scan on
 * every single request.
 */
let bm25: { forSnapshot: unknown; index: BuiltIndex } | null = null

function indexFor(snapshot: Snapshot): BuiltIndex {
  if (bm25 && bm25.forSnapshot === snapshot) return bm25.index
  const built = buildIndex(
    snapshot.jobs.map((j) => ({
      title: j.title,
      // Without this, searching an employer's name misses its own postings.
      company: j.companyName,
      department: j.department,
      descriptionText: j.descriptionText,
      skills: j.skills,
    }))
  )
  bm25 = { forSnapshot: snapshot, index: built }
  return built
}

export async function searchJobs(query: JobQuery): Promise<SearchResult | null> {
  const index = await loadIndex()
  if (!index) return null

  const companyBySlug = new Map(index.companies.map((c) => [c.slug, c]))
  const qTokens = query.q ? tokens(query.q) : []

  const cutoff = query.postedWithinDays
    ? Date.now() - query.postedWithinDays * 24 * 60 * 60 * 1000
    : null

  // RETRIEVE, then score. Spreading all 225k rows before filtering was the
  // single largest cost in this function; the inverted index visits only the
  // postings that contain a query term. With no keyword query there is nothing
  // to retrieve on, so the structured filters below do the narrowing instead.
  let rows: (IndexedJob & { company: IndexedCompany | null; score: number })[]
  // Corpus-wide match count, so `total` never reports the retrieval depth as
  // though it were the number of matching jobs.
  let retrievalTotal: number | null = null
  let retrievalTruncated = false

  if (qTokens.length) {
    const result = retrieve(indexFor(index), query.q!, RETRIEVAL_DEPTH)
    retrievalTotal = result.totalMatched
    retrievalTruncated = result.truncated
    rows = result.candidates.map((c) => {
      const job = index.jobs[c.doc]
      return {
        ...job,
        company: companyBySlug.get(job.companySlug) ?? null,
        // BM25 is on a different scale from the old field-boost sum. Scale it
        // so downstream consumers comparing against historical values are not
        // silently surprised by a 30x shift in magnitude.
        score: c.score * 5,
      }
    })
  } else {
    rows = index.jobs.map((job) => ({
      ...job,
      company: companyBySlug.get(job.companySlug) ?? null,
      score: 0,
    }))
  }

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
    // Announce a bounded index. Without this a deployment serving 25k of
    // 242k jobs looks identical to one where the market only has 25k.
    ...(index.deployment?.bounded ? { deployment: index.deployment } : {}),
    // Retrieval is depth-capped, so `total` counts what survived filtering
    // WITHIN that cap -- it is not the corpus-wide match count. Saying so is
    // the difference between an honest "showing the top 1,500 of 8,214" and a
    // silent "1,500 results" that looks like the whole truth.
    ...(retrievalTruncated
      ? { retrieval: { matchedInCorpus: retrievalTotal, examined: RETRIEVAL_DEPTH, truncated: true } }
      : retrievalTotal !== null
        ? { retrieval: { matchedInCorpus: retrievalTotal, examined: retrievalTotal, truncated: false } }
        : {}),
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


/* ------------------------- natural-language search ------------------------ */

/**
 * Vocabulary for the intent parser, derived from the live index.
 *
 * Deriving it from the corpus rather than a static gazetteer means the parser
 * only ever recognises places and companies we can actually return, so a query
 * never gets filtered down to nothing by a term the index has never seen.
 */
/**
 * How many candidates retrieval hands to the ranker.
 * Large enough that ranking has real choice, small enough to stay fast.
 */
const CANDIDATE_POOL = 400

let vocabCache: {
  cities: Set<string>
  countries: Set<string>
  companies: Map<string, string>
  cityCountries: Map<string, string>
  loadedAt: number
} | null = null

async function buildVocabulary() {
  if (vocabCache && Date.now() - vocabCache.loadedAt < CACHE_TTL_MS) return vocabCache
  const index = await loadIndex()
  if (!index) return null

  const cities = new Set<string>()
  const countries = new Set<string>()
  const cityCountries = new Map<string, string>()
  for (const j of index.jobs as any[]) {
    if (j.city) {
      cities.add(j.city)
      if (j.country && !cityCountries.has(j.city.toLowerCase())) {
        cityCountries.set(j.city.toLowerCase(), j.country)
      }
    }
    if (j.country) countries.add(j.country)
  }
  const companies = new Map<string, string>()
  for (const c of index.companies) companies.set(c.name, c.slug)

  vocabCache = { cities, countries, companies, cityCountries, loadedAt: Date.now() }
  return vocabCache
}

export interface SmartSearchResult extends SearchResult {
  intent: ParsedIntent
  intentSummary: string[]
}

/**
 * Natural-language search: parse the sentence into constraints, apply them as
 * real filters, then rank what survives with the explainable scorer.
 */
export async function smartSearch(
  rawQuery: string,
  overrides: Partial<JobQuery> = {}
): Promise<SmartSearchResult | null> {
  const vocab = await buildVocabulary()
  const intent = parseIntent(rawQuery, vocab ?? {})

  // Two-stage search: RETRIEVE a candidate pool, then RANK it.
  //
  // The topic has to narrow retrieval, not merely influence the score. Scoring
  // alone over an unfiltered pool is how a search for "senior machine learning
  // engineer" returned a French supermarket cashier role -- nothing excluded
  // it, so it survived to be ranked, and with no competition it placed.
  const { page: outPage, pageSize: outPageSize, ...filterOverrides } = overrides

  const query: JobQuery = {
    // The topic is the retrieval query; the lifted constraints are filters.
    q: intent.topic || undefined,
    cities: intent.locations.length ? intent.locations : undefined,
    countries: intent.countries.length ? intent.countries : undefined,
    companies: intent.companies.length ? intent.companies : undefined,
    remote: intent.remoteOnly || undefined,
    postedWithinDays: intent.postedWithinDays ?? undefined,
    minSalary: intent.salaryMin ?? undefined,
    ...filterOverrides,
    // Pool size is a retrieval concern and must not be overwritten by the
    // caller's display page size, or the ranker only ever sees one page.
    pageSize: CANDIDATE_POOL,
    page: 1,
  }

  let base = await searchJobs(query)
  if (!base) return null

  // If the topic was too specific to match anything, fall back to the
  // constraints alone rather than returning nothing -- the user's filters are
  // still meaningful even when their wording finds no literal match.
  if (base.total === 0 && query.q) {
    base = await searchJobs({ ...query, q: undefined })
    if (!base) return null
  }

  // Re-rank the candidate set with the transparent scorer.
  const ranked = base.jobs
    .map((job: any) => {
      const r = rankJob(
        {
          title: job.title,
          description: job.descriptionText,
          skills: job.skills ?? [],
          city: job.city, state: job.region, country: job.country,
          remote: job.isRemote,
          workplaceType: job.workplaceType ?? (job.isRemote ? 'REMOTE' : 'UNKNOWN'),
          remoteCountries: job.remoteCountries ?? [],
          remoteScope: job.remoteScope ?? null,
          seniority: job.seniority ?? null,
          visaStatus: job.visaStatus ?? 'SPONSORSHIP_NOT_MENTIONED',
          postedAt: job.postedAt,
          freshnessScore: job.freshnessScore ?? 0,
          sourceConfidence: job.company?.sourceConfidence ?? 0.95,
          isDirectApplication: job.isDirectApplication ?? true,
          salaryMin: job.salaryMin, salaryMax: job.salaryMax,
          department: job.department,
          duplicateConfidence: job.duplicateConfidence ?? 0,
          companyValuationUsd: job.company?.valuationUsd ?? null,
        },
        intent,
        DEFAULT_WEIGHTS
      )
      return { ...job, rankScore: r.score, matchReasons: r.matchReasons, rankSignals: r.signals, rankExplain: explainRank(r) }
    })
    .sort((a, b) => b.rankScore - a.rankScore)

  const pageSize = outPageSize ?? 20
  const page = outPage ?? 1
  const start = (page - 1) * pageSize

  return {
    ...base,
    jobs: ranked.slice(start, start + pageSize),
    total: ranked.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(ranked.length / pageSize)),
    intent,
    intentSummary: describeIntent(intent),
  }
}
