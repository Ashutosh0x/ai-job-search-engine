/**
 * Source adapter contract and the canonical job schema.
 *
 * The design goal is the one stated in the brief: adding a new ATS should
 * improve the whole network rather than require changes to the search engine.
 * Everything downstream of FETCH consumes `RawJob` and `CanonicalJob` only, so
 * an adapter is the single file you write to add a platform.
 */

export type SourceId =
  | 'workday' | 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'
  | 'recruitee' | 'teamtailor' | 'personio' | 'jobvite' | 'bamboohr'
  | 'breezy' | 'comeet' | 'jazzhr' | 'pinpoint' | 'rippling' | 'workable'
  | 'icims' | 'taleo' | 'successfactors' | 'eightfold' | 'avature'
  | 'phenom' | 'ukg' | 'dover' | 'gem' | 'wellfound'
  | 'custom' | 'search' | 'unknown'

/** How much we trust a source's data by default. Learned values override these. */
export const DEFAULT_SOURCE_CONFIDENCE: Record<string, number> = {
  company: 1.0,        // the employer's own site
  workday: 0.98, greenhouse: 0.98, lever: 0.98, ashby: 0.98,
  smartrecruiters: 0.98, recruitee: 0.97, teamtailor: 0.97, personio: 0.97,
  jobvite: 0.96, bamboohr: 0.96, breezy: 0.96, comeet: 0.96, jazzhr: 0.96,
  pinpoint: 0.96, rippling: 0.96, workable: 0.96,
  icims: 0.95, taleo: 0.95, successfactors: 0.95, eightfold: 0.95,
  avature: 0.95, phenom: 0.95, ukg: 0.95, dover: 0.94, gem: 0.94,
  wellfound: 0.90,
  custom: 0.92,
  search: 0.85,        // discovered via a search index, not yet resolved
  aggregator: 0.70,
  unknown: 0.40,
}

/** A board/tenant an adapter can crawl. */
export interface SourceTarget {
  source: SourceId
  /** Board token / tenant / slug. */
  token: string
  /** Secondary path segment (Workday site, iCIMS portal...). */
  site?: string
  /** Explicit host when the source is sharded. */
  host?: string
  /** Employer domain when known -- used to link to the company record. */
  companyDomain?: string
  companyName?: string
  /** Where this target came from, for the feedback loop. */
  discoveredVia?: string
  /** 0-1. How sure are we this target is what we think it is. */
  confidence?: number
}

/** Whatever the adapter got, before normalisation. Adapters do minimal work. */
export interface RawJob {
  source: SourceId
  target: SourceTarget
  /** Provider's own id. Combined with the target this is the strong dedupe key. */
  sourceId: string
  requisitionId?: string | null
  title: string
  company?: string | null
  companyDomain?: string | null
  locationRaw?: string | null
  /** Some providers list several locations per posting. */
  additionalLocations?: string[]
  description?: string | null
  descriptionHtml?: string | null
  department?: string | null
  team?: string | null
  employmentType?: string | null
  remoteFlag?: boolean | null
  postedAt?: string | null
  updatedAt?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  applicationUrl: string
  canonicalUrl?: string | null
  /** Anything provider-specific worth keeping for later mining. */
  extra?: Record<string, unknown>
}

export type JobStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN'
export type LocationType = 'onsite' | 'remote' | 'hybrid' | 'unknown'

/** The single normalised record everything downstream reads. */
export interface CanonicalJob {
  id: string
  sourceId: string
  source: SourceId

  company: string
  companyDomain: string | null
  companySlug: string

  title: string
  normalizedTitle: string
  description: string

  locationRaw: string | null
  locationDisplay: string | null
  city: string | null
  state: string | null
  country: string | null
  locationType: LocationType
  /** Every location the posting names, normalised. */
  locations: {
    display: string
    city: string | null
    state: string | null
    country: string | null
  }[]

  remote: boolean
  hybrid: boolean
  onsite: boolean

  employmentType: string | null
  seniority: string | null

  department: string | null
  team: string | null

  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null

  postedAt: string | null
  updatedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  lastVerifiedAt: string | null

  applicationUrl: string
  canonicalUrl: string
  sourceUrls: string[]
  sourceTypes: string[]
  /** True when applicationUrl points at the employer or their ATS, not an aggregator. */
  isDirectApplication: boolean

  skills: string[]
  technologies: string[]

  companyValuationUsd: number | null

  status: JobStatus
  freshnessScore: number
  sourceConfidence: number
  duplicateConfidence: number
  canonicalJobId: string | null
  /** requisitionId reused with a newer postedAt. */
  isRepost: boolean

  /** Content hash for cheap change detection on re-ingest. */
  contentHash: string
}

export interface HealthStatus {
  source: SourceId
  healthy: boolean
  latencyMs: number | null
  checkedAt: string
  error?: string
}

export interface FetchOptions {
  /** Only return postings updated after this. Adapters honour it when able. */
  since?: string
  /** Opaque per-target cursor from the previous run. */
  cursor?: string | null
  signal?: AbortSignal
  maxPages?: number
}

export interface FetchResult {
  jobs: RawJob[]
  /** Cursor to persist for the next incremental run. */
  cursor?: string | null
  /** Whether the adapter genuinely supports incremental fetch. */
  incremental: boolean
  warnings: string[]
}

/**
 * The interface every ATS adapter implements. Nothing else in the system needs
 * to know a platform exists.
 */
export interface JobSource {
  readonly id: SourceId
  readonly displayName: string
  /** Host patterns this adapter claims, used by the detector. */
  readonly hostPatterns: RegExp[]

  /** Find crawlable targets for this platform (open index, sitemaps, etc.). */
  discover(opts?: { limit?: number; signal?: AbortSignal }): Promise<SourceTarget[]>

  /** Pull postings for one target. Must never throw: return warnings instead. */
  fetchJobs(target: SourceTarget, opts?: FetchOptions): Promise<FetchResult>

  /** Fetch one posting, used for closed-job verification. */
  fetchJob?(target: SourceTarget, id: string): Promise<RawJob | null>

  /** Is the platform reachable right now? */
  healthCheck(): Promise<HealthStatus>

  /** Turn a public URL into a target, when this adapter recognises it. */
  parseUrl?(url: string): SourceTarget | null
}

/* --------------------------------- helpers -------------------------------- */

export function nowIso(): string {
  return new Date().toISOString()
}

/** Stable, dependency-free 64-bit-ish content hash (FNV-1a, hex). */
export function contentHash(...parts: (string | number | null | undefined)[]): string {
  const text = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (Math.imul(h2 ^ c, 0x85ebca6b) + i) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** ISO 8601 or null. Accepts epoch seconds, epoch ms, and date strings. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return null
  // Guard against a provider sending a year-3000 placeholder.
  const year = d.getUTCFullYear()
  if (year < 1990 || year > new Date().getUTCFullYear() + 2) return null
  return d.toISOString()
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
