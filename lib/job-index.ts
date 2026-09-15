import { readFile, stat } from 'fs/promises'
import path from 'path'
import { parseIntent, describeIntent, type ParsedIntent } from './search/intent'
import { buildIndex, retrieve, type BuiltIndex } from './search/inverted-index'
import { rankJob, explainRank, DEFAULT_WEIGHTS } from './search/rank'
import { diversify } from './search/diversify'
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
  /** apprenticeship | graduate | internship | placement | trainee | entry-level | junior */
  earlyCareer?: string | null
  earlyCareerLevel?: number | null
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
  /** Present ONLY when shards failed to load and the index is incomplete. */
  degraded?: { expectedJobs: number | null; loadedJobs: number; missingShards: string[] } | null
  sources: string[]
  companies: IndexedCompany[]
  jobs: IndexedJob[]
  warnings: string[]
}

let cache: { data: Snapshot; loadedAt: number; mtimeMs: number; file?: string | null } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * THE PRODUCTION INDEX IS ONE FILE, NAMED HERE.
 *
 * `jobs-deploy.json` (plus the shards it names) is the only thing this app
 * serves. It is built by scripts/build-deploy-index.mjs, committed to the repo,
 * and is the sole index that survives .vercelignore into a deployment.
 *
 * WHY THIS IS NOT A CANDIDATE LIST ANY MORE
 * -----------------------------------------
 * It used to try `jobs-v2.json` first and fall back. That file is not a serving
 * artifact at all -- it is the PIPELINE INTERMEDIATE, the raw full-corpus output
 * of scripts/refresh.mjs that build-deploy-index.mjs then reduces into the
 * bounded slice. The CI workflows cache it between runs; .gitignore and
 * .vercelignore both exclude it. Serving from it meant serving from whatever
 * state the crawler happened to leave on disk.
 *
 * MEASURED, 2026-09-15: an interrupted `npm run ingest` left a well-formed
 * jobs-v2.json holding 935 postings beside a jobs-deploy.json holding 113,416.
 * It parsed fine, so it won, and searching "London" returned ZERO results while
 * 2,768 London postings sat in the file next to it.
 *
 * A first pass fixed that by ranking candidates on job count. That stopped the
 * specific failure but kept the real defect: which file gets served was still
 * decided by whatever happened to be on disk. Two machines with the same commit
 * could serve different corpora, and neither would say so.
 *
 * So there is now exactly one production index, and no automatic fallback to a
 * different one. If it is missing, every read says the index is unavailable --
 * loudly, and with the command that builds it -- rather than quietly serving
 * something smaller that looks like a working site with a thin job market.
 *
 * THE LOCAL FULL-CORPUS CASE
 * --------------------------
 * A developer who has run a full ingest can still serve all of it, by saying so
 * explicitly:
 *
 *   JOB_INDEX_FILE=public/data/jobs-v2.json npm run dev
 *
 * That is an override someone chose, not a guess the loader made, and it is
 * reported in the startup log and on /api/health.
 */
const PRODUCTION_INDEX = 'jobs-deploy.json'

/**
 * What the last successful load actually served.
 *
 * Exposed so an operator can answer "which corpus is this deployment serving?"
 * from outside the process -- see app/api/health/route.ts. A wrong index is
 * invisible from the UI: it looks like a working site with a thin job market.
 */
export interface IndexLoadInfo {
  file: string
  origin: IndexSource['origin']
  jobs: number
  generatedAt: string | null
  at: string
}
let lastLoad: IndexLoadInfo | null = null
export function lastIndexLoad(): IndexLoadInfo | null {
  return lastLoad
}

/**
 * Legacy v1 snapshot, used only when the production index is absent AND the
 * operator has not overridden it. Kept because it is the one artifact that
 * predates the v2 pipeline and some local checkouts still have only that.
 * It is never preferred, and serving it is announced.
 */
const LEGACY_SNAPSHOT = 'jobs-snapshot.json'

const dataPath = (f: string) =>
  path.isAbsolute(f) ? f : path.join(process.cwd(), 'public', 'data', f)

/** The operator's explicit choice, if there is one. */
function configuredIndexFile(): string | null {
  const v = process.env.JOB_INDEX_FILE?.trim()
  if (!v) return null
  // Accept either a bare filename or a repo-relative path, so both
  // `JOB_INDEX_FILE=jobs-v2.json` and `JOB_INDEX_FILE=public/data/jobs-v2.json`
  // do what the person meant.
  return path.isAbsolute(v) ? v : path.join(process.cwd(), v.replace(/^\.?[\/]/, ''))
}

export interface IndexSource {
  file: string
  /** How this file came to be chosen, for logs and /api/health. */
  origin: 'configured' | 'production' | 'legacy-snapshot'
}

/**
 * Resolve which file to serve. Deterministic: the same filesystem always yields
 * the same answer, and the answer does not depend on file sizes or mtimes.
 */
async function resolveIndexSource(): Promise<IndexSource | null> {
  const configured = configuredIndexFile()
  if (configured) {
    try {
      await stat(configured)
      return { file: configured, origin: 'configured' }
    } catch {
      // An override that points at nothing is an operator error and must not be
      // silently ignored -- that is how you end up debugging the wrong corpus.
      console.error(
        `[job-index] JOB_INDEX_FILE points at ${configured}, which does not exist. ` +
          'Refusing to guess; set it correctly or unset it to use the production index.',
      )
      return null
    }
  }

  const production = dataPath(PRODUCTION_INDEX)
  try {
    await stat(production)
    return { file: production, origin: 'production' }
  } catch { /* fall through to the legacy snapshot */ }

  const legacy = dataPath(LEGACY_SNAPSHOT)
  try {
    await stat(legacy)
    console.warn(
      `[job-index] ${PRODUCTION_INDEX} is missing; serving the legacy ${LEGACY_SNAPSHOT}. ` +
        'Rebuild with `npx tsx scripts/build-deploy-index.mjs`.',
    )
    return { file: legacy, origin: 'legacy-snapshot' }
  } catch { /* nothing to serve */ }

  console.error(
    `[job-index] No job index found. Expected public/data/${PRODUCTION_INDEX}. ` +
      'Build it with `npx tsx scripts/build-deploy-index.mjs`.',
  )
  return null
}

async function resolveIndexFile(): Promise<string | null> {
  return (await resolveIndexSource())?.file ?? null
}

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
 *
 * IT MUST WATCH THE FILE WE ACTUALLY LOADED. This used to re-resolve the
 * preferred candidate independently of the load, so when the preferred file was
 * skipped -- too large, unparseable, or now out-ranked -- the cache key tracked
 * a file the served data had not come from. Rewriting the file being served
 * then changed no mtime the cache could see, and the refresh stayed invisible
 * for the full TTL: exactly the staleness this function exists to prevent.
 */
async function indexMtime(file?: string | null): Promise<number> {
  const f = file ?? (await resolveIndexFile())
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
 * (say country=Vietnam) can empty an otherwise good candidate set.
 *
 * IT WAS 1,500, WHICH WAS COSTING RECALL FOR NOTHING
 * --------------------------------------------------
 * The assumption behind the old value was that a bigger depth means more work.
 * It does not. `retrieve` walks every posting for every query term and
 * accumulates into a score map -- that pass is O(matches) whatever the limit
 * is. The limit only decides how much of the sorted result is handed back.
 *
 * Measured over the 101,508-posting served index, 5 runs each:
 *
 *   query               depth 1,500   depth 10,000   depth 50,000   matched
 *   "nvidia"                   8ms            5ms            5ms      2,009
 *   "engineer"                81ms           84ms           81ms     24,332
 *   "software engineer"       97ms          107ms          113ms     26,837
 *
 * "nvidia" is FASTER at the larger depth, and the two broad queries are flat.
 * Meanwhile 1,500 truncated every employer bigger than that: searching NVIDIA
 * returned 1,500 of 2,009, and no amount of paging could reach the rest.
 *
 * 10,000 covers the largest single employer in the corpus (JPMorgan, 7,464)
 * with headroom, at no measurable cost.
 */
const RETRIEVAL_DEPTH = 10000

/**
 * Depth to use when the query ALSO carries structured filters.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Retrieval truncates by relevance, and the structured filters run afterwards
 * over whatever survived. So a broad keyword plus a narrow filter loses almost
 * everything: the filter can only choose from the top N by BM25, and a London
 * posting ranked 12,000th for "engineer" is discarded before the location
 * filter ever sees it.
 *
 * MEASURED, 2026-09-15, over the 113,416-posting served index:
 *
 *   q=engineer&location=London   ->      34 results
 *   true number in the corpus    ->     829
 *
 * 96% of the matching jobs were gone, and nothing on the page said so -- 34
 * looks like a complete answer to a reasonable search. It gets worse as the
 * corpus grows, because the truncation point moves further up the ranking.
 *
 * WHY A BIGGER NUMBER IS THE RIGHT FIX
 * ------------------------------------
 * Because depth is very nearly free. `retrieve` walks every posting containing
 * a query term whatever the limit is -- the limit only decides how much of the
 * sorted result is handed back. Re-measured at five runs each, median:
 *
 *   query                      10,000   30,000   60,000   120,000   matched
 *   engineer                     13ms     10ms     10ms       9ms    29,335
 *   software engineer            12ms     13ms     12ms      12ms    32,054
 *   senior backend engineer      15ms     15ms     16ms      15ms    40,052
 *   react developer               1ms      1ms      1ms       2ms     4,009
 *
 * Flat. 100,000 sits above the largest match count in the corpus, so filtering
 * sees the whole match set rather than a relevance-truncated prefix.
 *
 * It stays conditional because the cost that IS real is downstream: every
 * candidate is spread into a new object before filtering. Paying that for 40k
 * rows to show 20 of them is pointless when there is no filter to apply, and
 * the unfiltered case genuinely only needs the top of the ranking.
 */
const FILTERED_RETRIEVAL_DEPTH = 100000

/**
 * Does this query narrow by anything other than the keyword?
 *
 * Only these make the truncation lossy -- sort and paging operate on whatever
 * survived, so they do not change how much must be retrieved.
 */
function hasStructuredFilter(q: JobQuery): boolean {
  return Boolean(
    q.location ||
      q.remote ||
      q.postedWithinDays ||
      q.minSalary ||
      q.minValuation ||
      q.minOpenRoles ||
      q.cities?.length ||
      q.countries?.length ||
      q.departments?.length ||
      q.companies?.length ||
      q.providers?.length ||
      q.employmentTypes?.length ||
      q.earlyCareer?.length ||
      q.valuationTiers?.length,
  )
}

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
  const parsed = JSON.parse(await readFile(file, 'utf8'))

  // The deploy index is delivered through git, and GitHub hard-rejects blobs
  // over 100 MiB, so it is written as shards -- the primary file naming the
  // rest. Reading only the primary would serve a fraction of the index and look
  // entirely healthy doing it, which is the failure mode this codebase keeps
  // running into. So a named shard that cannot be read is LOUD.
  const missingShards: string[] = []
  if (Array.isArray(parsed?.shards) && parsed.shards.length) {
    for (const name of parsed.shards) {
      const shardFile = dataPath(String(name))
      try {
        const shard = JSON.parse(await readFile(shardFile, 'utf8'))
        if (!Array.isArray(shard?.jobs)) throw new Error('shard has no jobs array')
        parsed.jobs.push(...shard.jobs)
      } catch (err) {
        console.error(
          `[job-index] ${file} names shard "${name}" but it could not be read ` +
            `(${(err as Error).message}). Serving a PARTIAL index: ` +
            `${parsed.jobs.length} jobs loaded of an expected ${parsed.jobCount ?? '?'}.`
        )
        // Logging alone leaves the API answering as though nothing is wrong.
        // Record it so the response can say so too.
        missingShards.push(String(name))
      }
    }
    if (typeof parsed.jobCount === 'number' && parsed.jobs.length !== parsed.jobCount) {
      console.error(
        `[job-index] shard total mismatch: loaded ${parsed.jobs.length}, ` +
          `header says ${parsed.jobCount}.`
      )
    }
  }

  // A degraded index must be able to SAY it is degraded. Serving 53,439 of
  // 101,496 jobs while reporting success is the failure this file keeps
  // guarding against, and a server-side console.error is invisible to the
  // caller deciding whether to trust the result.
  if (missingShards.length > 0 || (typeof parsed?.jobCount === 'number' && parsed.jobs.length !== parsed.jobCount)) {
    parsed.degraded = {
      expectedJobs: parsed.jobCount ?? null,
      loadedJobs: parsed.jobs.length,
      missingShards,
    }
  }

  return parsed
}

async function loadV2(source: IndexSource): Promise<(Snapshot & { loadedFile?: string }) | null> {
  try {
    // The source is already resolved. If the chosen file cannot be read that is
    // reported as a failure rather than worked around by serving a different
    // corpus -- see resolveIndexSource().
    let v2: any = null
    try {
      v2 = await readIndexFile(source.file)
    } catch (err) {
      console.error(`[job-index] failed to read ${source.file}:`, (err as Error).message)
      return null
    }
    if (!v2 || !Array.isArray(v2.jobs) || !v2.jobs.length) {
      console.error(
        `[job-index] ${source.file} holds no postings. Refusing to serve an empty index as though ` +
          'it were a job market with nothing in it.',
      )
      return null
    }

    const loadedFile = source.file
    lastLoad = {
      file: source.file,
      origin: source.origin,
      jobs: v2.jobs.length,
      generatedAt: v2.generatedAt ?? null,
      at: new Date().toISOString(),
    }
    console.info(
      `[job-index] serving ${path.basename(source.file)} ` +
        `(${v2.jobs.length.toLocaleString('en-US')} postings, origin=${source.origin})`,
    )

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
      degraded: v2.degraded ?? null,
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
        earlyCareer: j.earlyCareer ?? null,
        earlyCareerLevel: j.earlyCareerLevel ?? null,
        freshnessScore: j.freshnessScore ?? 0,
        isDirectApplication: j.isDirectApplication ?? true,
        // The slim index carries the count; the URLs themselves stay in the archive.
        sourceCount: j.sourceCount ?? (j.sourceUrls ?? []).length,
      })),
      warnings: [],
      // Which file this came from, so the cache watches the file actually
      // served rather than re-deriving a preference that may differ.
      loadedFile,
    } as unknown as Snapshot & { loadedFile?: string }
  } catch {
    return null
  }
}

export async function loadIndex(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    // Serve the cache only while the file behind it is unchanged. A refresh
    // rewrites the index, and the whole point of refreshing is that the new
    // jobs become visible -- not that they wait for a timer. Watch the file the
    // cached data actually came from; see indexMtime().
    const mtime = await indexMtime(cache.file)
    if (mtime === cache.mtimeMs) return cache.data
  }

  /**
   * Resolve ONCE, then load what was resolved.
   *
   * The legacy path used to be an unconditional `catch`-style fallback: if
   * loadV2 returned null for ANY reason, the v1 snapshot was loaded instead. So
   * a typo in JOB_INDEX_FILE, or a corrupt production index, quietly served a
   * different 9,648-posting corpus and reported success. That is the same class
   * of failure as the 935-row file, arrived at from the other direction.
   *
   * Now the source decides the loader, and a resolution failure is a failure.
   */
  const source = await resolveIndexSource()
  if (!source) return null

  const loaded =
    source.origin === 'legacy-snapshot' ? await loadLegacySnapshot(source) : await loadV2(source)
  if (!loaded) return null

  loaded.companies = loaded.companies.map((c) => ({
    ...c,
    logoUrl: companyLogoUrl(c.domain),
    valuationTier: valuationTier(c.valuationUsd),
  }))
  cache = {
    data: loaded,
    loadedAt: Date.now(),
    mtimeMs: await indexMtime(source.file),
    file: source.file,
  }
  return loaded
}

/**
 * The pre-v2 snapshot. A different schema, so it gets its own reader rather
 * than being coerced through the v2 mapper.
 */
async function loadLegacySnapshot(source: IndexSource): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(source.file, 'utf8')) as Snapshot
    if (!Array.isArray(parsed?.jobs) || !parsed.jobs.length) return null
    lastLoad = {
      file: source.file,
      origin: source.origin,
      jobs: parsed.jobs.length,
      generatedAt: parsed.generatedAt ?? null,
      at: new Date().toISOString(),
    }
    return parsed
  } catch (err) {
    console.error(`[job-index] failed to read legacy snapshot ${source.file}:`, (err as Error).message)
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
  /** apprenticeship | graduate | internship | placement | trainee | entry-level | junior */
  earlyCareer?: string[]
  minSalary?: number
  sort?: 'relevance' | 'recent' | 'valuation' | 'openings' | 'salary'
  page?: number
  pageSize?: number
}

/** The page size actually used, clamped. Shared so diversification blocks
 *  line up exactly with the pages the caller will slice. */
function pageSizeFor(query: JobQuery): number {
  return Math.min(100, Math.max(1, query.pageSize ?? 20))
}

/** Tokenise once; used for both matching and scoring. */
function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1)
}

/* --------------------------- location matching ---------------------------- */

/**
 * Split a place name into comparable tokens.
 *
 * Accents are folded so "Asuncion" finds "Asunción" and "Dusseldorf" finds
 * "Düsseldorf" -- the corpus carries the accented form, almost nobody types it.
 */
export function locationTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Shortest token that may be matched by PREFIX rather than in full.
 *
 * Prefix matching is what lets "san fran" find San Francisco. Allowing it on
 * very short tokens is what broke the filter, so it is gated on length.
 */
const LOCATION_PREFIX_MIN = 3

/** Does `needle` equal `hay`, or prefix it when it is long enough to be meant? */
function tokenHit(needle: string, hay: string): boolean {
  if (needle === hay) return true
  return needle.length >= LOCATION_PREFIX_MIN && hay.startsWith(needle)
}

/**
 * Does one normalised location key satisfy a location query?
 *
 * WHY THIS IS NOT A SUBSTRING TEST
 * --------------------------------
 * It used to be `k.includes(loc) || loc.includes(k)` over raw strings. The
 * second half is there for a real reason -- a query of "London, United Kingdom"
 * has to match a row keyed only "london" -- but on raw substrings it also makes
 * every SHORT key match inside any longer word.
 *
 * The corpus carries 2,577 keys of "us", 441 of "in", 84 of "ca", 43 of "it"
 * and 30 of "il", because ATS feeds emit fragments like "IN, KA, Bengaluru".
 * So, MEASURED over the 113,416-posting served index:
 *
 *   query     matched   wrong   how wrong
 *   Austin      5,349   3,969   74.2%  -- "au[stin]" pulled in all of Australia
 *   Berlin        710     448   63.1%  -- "berl[in]" pulled in all of India
 *   Dublin      1,289     442   34.3%  -- same "in"
 *   Milan         181      50   27.6%  -- "m[il]an" pulled in Tel Aviv
 *   Chicago     1,339      91    6.8%  -- "chi[ca]go" pulled in Canada
 *
 * Three quarters of an Austin search was Sydney. Comparing WHOLE TOKENS keeps
 * the containment in both directions -- which is the useful part -- while
 * making "au" stop matching inside "austin".
 */
export function locationKeyMatches(locTokens: string[], key: string): boolean {
  const keyTokens = locationTokens(key)
  if (!keyTokens.length || !locTokens.length) return false

  // Query narrows the key: "london" against "greater london area".
  const queryInKey = locTokens.every((q) => keyTokens.some((k) => tokenHit(q, k)))
  if (queryInKey) return true

  // Key narrows the query: a row keyed only "london" against a "london, united
  // kingdom" query. Guarded by the same length rule, so a two-letter key
  // fragment can no longer swallow an unrelated city.
  //
  // It must also cover the query's HEAD -- the most specific thing asked for.
  // Without that, "London, United Kingdom" also matches every row keyed just
  // "United Kingdom", because those tokens are all present in the query too:
  // the search widens from a city to a country the moment you name the country,
  // which is the opposite of what adding detail should do. Measured: 3,380
  // results against 2,768 for "London" alone, the extra 612 being UK rows with
  // no city at all.
  const head = queryHead(locTokens)
  if (head && !keyTokens.some((k) => tokenHit(k, head) || tokenHit(head, k))) return false

  return keyTokens.every((k) => locTokens.some((q) => tokenHit(k, q)))
}

/**
 * The most specific token in a location query.
 *
 * Place names are written most-specific-first in both user input and ATS feeds
 * ("Munich, Bavaria, Germany"), so that is the first token -- after skipping
 * qualifiers that describe a place rather than name one, which is what keeps
 * "Greater London" pointed at London.
 */
const LOCATION_QUALIFIERS = new Set([
  'greater', 'metro', 'metropolitan', 'area', 'region', 'city', 'county',
  'district', 'state', 'province', 'downtown', 'central', 'near', 'in',
])

function queryHead(locTokens: string[]): string | null {
  for (const t of locTokens) {
    if (!LOCATION_QUALIFIERS.has(t)) return t
  }
  return null
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
  /** Set when shards failed to load, so the caller can distrust the result. */
  degraded?: { expectedJobs: number | null; loadedJobs: number; missingShards: string[] } | null
  facets: {
    departments: { value: string; count: number }[]
    companies: { value: string; label: string; count: number }[]
    providers: { value: string; count: number }[]
    employmentTypes: { value: string; count: number }[]
    valuationTiers: { value: string; count: number }[]
    cities: { value: string; count: number }[]
    countries: { value: string; count: number }[]
    /** Early-career category, so the UI can offer it as a first-class filter. */
    earlyCareer: { value: string; count: number }[]
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
  // Reported back so a truncated result can say how deep it actually looked.
  let retrievalDepth = RETRIEVAL_DEPTH

  if (qTokens.length) {
    retrievalDepth = hasStructuredFilter(query) ? FILTERED_RETRIEVAL_DEPTH : RETRIEVAL_DEPTH
    const result = retrieve(indexFor(index), query.q!, retrievalDepth)
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
    const locTokens = locationTokens(query.location)
    if (locTokens.length) {
      // Match against the normalised keys (city / region / country / aliases)
      // and fall back to the raw string for rows ingested before normalisation.
      rows = rows.filter((r) =>
        r.locationKeys?.length
          ? r.locationKeys.some((k) => locationKeyMatches(locTokens, k))
          : locationKeyMatches(locTokens, r.location ?? '')
      )
    }
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
  if (query.earlyCareer?.length) {
    // "any" means "any early-career category", which is the filter most people
    // actually want -- a student does not care whether it is called an
    // internship or a placement, only that it is not a senior role.
    const set = new Set(query.earlyCareer.map((t) => t.toLowerCase()))
    rows = set.has('any')
      ? rows.filter((r) => Boolean(r.earlyCareer))
      : rows.filter((r) => r.earlyCareer && set.has(r.earlyCareer.toLowerCase()))
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
    earlyCareer: countBy(rows, (r) => r.earlyCareer),
    remote: rows.filter((r) => r.isRemote).length,
  }

  // ---- Sort ---------------------------------------------------------------
  const sort = query.sort ?? (qTokens.length ? 'relevance' : 'recent')
  const time = (v: string | null) => (v ? new Date(v).getTime() : 0)

  rows.sort((a, b) => {
    let primary: number
    switch (sort) {
      case 'recent':
        primary = time(b.postedAt) - time(a.postedAt)
        break
      case 'valuation':
        primary = (b.company?.valuationUsd ?? 0) - (a.company?.valuationUsd ?? 0)
        break
      case 'openings':
        primary = (b.company?.openRoles ?? 0) - (a.company?.openRoles ?? 0)
        break
      case 'salary':
        primary = (b.salaryMax ?? b.salaryMin ?? 0) - (a.salaryMax ?? a.salaryMin ?? 0)
        break
      case 'relevance':
      default:
        primary = b.score - a.score || time(b.postedAt) - time(a.postedAt)
    }
    if (primary !== 0) return primary
    /**
     * Explicit tiebreak on a unique key.
     *
     * Every sort here has enormous tie groups -- 57.9% of the corpus has no
     * posted date, 96.4% no salary -- and ordering within a tie was left to
     * Array.prototype.sort's stability. That happens to be deterministic in V8,
     * but it makes pagination correctness depend on an engine guarantee rather
     * than on this code. With a unique final key the order is total, so page 2
     * cannot repeat or skip a row from page 1 under any implementation.
     */
    return a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0
  })

  /**
   * Stop one employer owning the page.
   *
   * Only for relevance, and only when a keyword query ran: that is the sort
   * that places near-identical requisitions next to each other. "recent" and
   * "salary" already interleave employers naturally, and reordering them would
   * break the promise the sort makes.
   *
   * Nothing is removed -- `total` below is taken after this and is unchanged.
   */
  if (sort === 'relevance' && qTokens.length) {
    rows = diversify(rows, (r) => r.companySlug, { blockSize: pageSizeFor(query) })
  }

  const total = rows.length
  const pageSize = pageSizeFor(query)
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
    // Always surfaced when set. A partial index is not a smaller market.
    ...(index.degraded ? { degraded: index.degraded } : {}),
    // Retrieval is depth-capped, so `total` counts what survived filtering
    // WITHIN that cap -- it is not the corpus-wide match count. Saying so is
    // the difference between an honest "showing the top 1,500 of 8,214" and a
    // silent "1,500 results" that looks like the whole truth.
    ...(retrievalTruncated
      ? { retrieval: { matchedInCorpus: retrievalTotal, examined: retrievalDepth, truncated: true } }
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

/* ------------------------------ single job -------------------------------- */

/**
 * A posting's URL path.
 *
 * Every id in the corpus is exactly three colon-separated parts
 * (`provider:companyToken:sourceId`), all 113,416 unique, none containing a
 * slash -- so the parts map onto path segments losslessly and
 * `/jobs/ashby/openai/9471b38b-...` round-trips back to the id exactly.
 *
 * Encoding the whole id into one segment would have worked too, but a URL is
 * read by people as well as parsers, and a path that names the board and the
 * employer says something useful before the page loads.
 */
export function jobPath(job: Pick<IndexedJob, 'externalId'>): string {
  return `/jobs/${job.externalId.split(':').map(encodeURIComponent).join('/')}`
}

/** Inverse of jobPath. Returns null for a shape that cannot be an id. */
export function jobIdFromSegments(segments: string[]): string | null {
  if (!Array.isArray(segments) || segments.length !== 3) return null
  const parts = segments.map((s) => {
    try { return decodeURIComponent(s) } catch { return s }
  })
  if (parts.some((p) => !p || p.includes(':'))) return null
  return parts.join(':')
}

/**
 * One posting by id.
 *
 * A linear scan of the loaded array, which is the same cost the company page
 * already pays and is dominated by the index load itself. Building a Map keyed
 * by id would add a 113k-entry structure to every server instance to save a few
 * milliseconds on a page that is not the hot path; measure before adding it.
 */
export async function getJobById(
  id: string,
): Promise<{ job: IndexedJob; company: IndexedCompany | null } | null> {
  const index = await loadIndex()
  if (!index) return null
  const job = index.jobs.find((j) => j.externalId === id)
  if (!job) return null
  const company = index.companies.find((c) => c.slug === job.companySlug) ?? null
  return { job, company }
}

/**
 * Postings a reader of this one would plausibly want next.
 *
 * Ranked on overlap that is actually present in the data rather than on a
 * similarity model there is no room for here: shared title tokens first (the
 * strongest signal available), then shared skills, same company, same city.
 * Only 20.7% of rows carry skills and 42.1% a posted date, so a rule that
 * depended on either would return nothing for most jobs -- each signal
 * contributes when present instead of being required.
 */
export async function similarJobs(job: IndexedJob, limit = 6): Promise<IndexedJob[]> {
  const index = await loadIndex()
  if (!index) return []

  const stop = new Set(['the', 'and', 'for', 'with', 'senior', 'staff', 'lead', 'junior'])
  const titleTokens = new Set(tokens(job.title).filter((t) => !stop.has(t)))
  const skills = new Set((job.skills ?? []).map((s) => s.toLowerCase()))

  const scored: { job: IndexedJob; score: number }[] = []
  for (const other of index.jobs) {
    if (other.externalId === job.externalId) continue

    let score = 0
    for (const t of tokens(other.title)) if (titleTokens.has(t)) score += 3
    // A title-token overlap is the floor: without it the rest is noise, and
    // "same company" alone would fill the list with unrelated departments.
    if (score === 0) continue

    if (skills.size) {
      for (const sk of other.skills ?? []) if (skills.has(sk.toLowerCase())) score += 2
    }
    if (other.companySlug === job.companySlug) score += 1
    if (job.city && other.city && other.city === job.city) score += 2
    if (job.isRemote && other.isRemote) score += 1
    if (other.postedAt) score += 0.5

    scored.push({ job: other, score })
  }

  scored.sort((a, b) => b.score - a.score || (b.job.postedAt ?? '').localeCompare(a.job.postedAt ?? ''))

  // Spread across employers so the list is not six roles at one company.
  const out: IndexedJob[] = []
  const perCompany = new Map<string, number>()
  for (const { job: candidate } of scored) {
    const seen = perCompany.get(candidate.companySlug) ?? 0
    if (seen >= 2) continue
    perCompany.set(candidate.companySlug, seen + 1)
    out.push(candidate)
    if (out.length >= limit) break
  }
  return out
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
