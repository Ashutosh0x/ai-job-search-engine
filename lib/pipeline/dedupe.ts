import type { CanonicalJob } from '../sources/types'
import { DEFAULT_SOURCE_CONFIDENCE } from '../sources/types'

/**
 * Deduplication.
 *
 * The same requisition legitimately appears on the employer's site, its ATS,
 * and every aggregator that syndicates it. Treating those as five jobs is the
 * single most visible quality failure a job search can have, so this runs as a
 * cascade from certain to probabilistic and records how certain it was.
 *
 *   TIER 1  company + source + requisitionId      exact, ~1.0
 *   TIER 2  same application URL (normalised)     exact, ~0.98
 *   TIER 3  company + normalised title + location exact-ish, ~0.9
 *   TIER 4  fuzzy: title/location/description     probabilistic, 0.75-0.95
 *
 * Nothing is discarded. The survivor becomes canonical and absorbs the others'
 * source URLs, so a user can still see every place the job was found and we
 * keep the best (most direct) application link.
 */

export interface DedupeResult {
  /** One entry per distinct real job. */
  jobs: CanonicalJob[]
  duplicatesRemoved: number
  /** Duplicate id -> canonical id, kept for auditing. */
  mapping: Record<string, string>
  tierCounts: Record<string, number>
}

/* ------------------------------ normalisation ----------------------------- */

/** Words that vary between postings of the same role and carry no identity. */
const TITLE_NOISE = new Set([
  'senior', 'sr', 'junior', 'jr', 'staff', 'principal', 'lead', 'i', 'ii', 'iii', 'iv',
  'remote', 'hybrid', 'onsite', 'contract', 'fulltime', 'parttime', 'intern',
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'at', 'in', 'with',
  'f', 'm', 'd', 'w', 'x', // German "(m/w/d)" style gender markers
])

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Strip bracketed qualifiers: "(Remote)", "[Contract]", "(m/w/d)".
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    // Strip trailing req ids: "- 12345", "#R-4821".
    .replace(/[-#]\s*[a-z]?[-_]?\d{3,}\s*$/i, ' ')
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !TITLE_NOISE.has(w))
    .sort() // order-insensitive: "Engineer, Backend" == "Backend Engineer"
    .join(' ')
    .trim()
}

/**
 * Canonical form of an application URL for comparison: drop tracking
 * parameters, fragments, trailing slashes and case in the host. Two links to
 * the same posting differing only by `?utm_source=` are the same link.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const drop = /^(utm_|gh_src$|gh_jid_src|src$|source$|ref$|referrer$|trk$|trackingId$|lever-source|_gl$)/i
    const keep: [string, string][] = []
    u.searchParams.forEach((v, k) => {
      if (!drop.test(k)) keep.push([k, v])
    })
    keep.sort(([a], [b]) => a.localeCompare(b))
    const qs = keep.map(([k, v]) => `${k}=${v}`).join('&')
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.host.toLowerCase().replace(/^www\./, '')}${path}${qs ? `?${qs}` : ''}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

function locationKey(job: CanonicalJob): string {
  if (job.remote && !job.city) return 'remote'
  return [job.city, job.country].filter(Boolean).join('|').toLowerCase() || 'unknown'
}

function companyKey(job: CanonicalJob): string {
  return (job.companyDomain || job.companySlug || job.company)
    .toLowerCase()
    .replace(/^www\./, '')
    .trim()
}

/* -------------------------------- similarity ------------------------------ */

/** Token-set Jaccard: cheap, order-insensitive, good enough for titles. */
export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(/\s+/).filter(Boolean))
  const B = new Set(b.split(/\s+/).filter(Boolean))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/** Trigram similarity over the first N chars -- used for descriptions. */
export function trigramSimilarity(a: string, b: string, limit = 1500): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/\s+/g, ' ').slice(0, limit)
    const g = new Set<string>()
    for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3))
    return g
  }
  const A = grams(a)
  const B = grams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / Math.min(A.size, B.size)
}

/**
 * Probabilistic match score for two postings already known to share an
 * employer. Weighted so that title agreement is necessary but not sufficient:
 * two different openings on the same team often share a title and differ only
 * by location, and merging those would be worse than showing both.
 */
export function similarityScore(a: CanonicalJob, b: CanonicalJob): number {
  const title = jaccard(a.normalizedTitle, b.normalizedTitle)
  if (title < 0.6) return 0 // cheap reject before touching descriptions

  const sameLocation = locationKey(a) === locationKey(b)
  const bothRemote = a.remote && b.remote
  const location = sameLocation ? 1 : bothRemote ? 0.7 : 0

  const desc =
    a.description && b.description ? trigramSimilarity(a.description, b.description) : 0.5

  const dept =
    a.department && b.department
      ? a.department.toLowerCase() === b.department.toLowerCase() ? 1 : 0.3
      : 0.5

  return title * 0.45 + location * 0.3 + desc * 0.15 + dept * 0.1
}

/* --------------------------------- merging -------------------------------- */

/** Which of two records should survive as canonical. */
function preferred(a: CanonicalJob, b: CanonicalJob): CanonicalJob {
  // 1. A direct employer/ATS application always beats an aggregator link.
  if (a.isDirectApplication !== b.isDirectApplication) return a.isDirectApplication ? a : b
  // 2. Higher source confidence.
  if (Math.abs(a.sourceConfidence - b.sourceConfidence) > 0.02) {
    return a.sourceConfidence > b.sourceConfidence ? a : b
  }
  // 3. Richer record: a real posted date and a description are worth keeping.
  const richness = (j: CanonicalJob) =>
    (j.postedAt ? 2 : 0) + (j.description ? 1 : 0) + (j.salaryMin || j.salaryMax ? 1 : 0) +
    (j.city ? 1 : 0) + (j.department ? 1 : 0)
  const ra = richness(a)
  const rb = richness(b)
  if (ra !== rb) return ra > rb ? a : b
  // 4. Fresher.
  return (a.postedAt ?? '') >= (b.postedAt ?? '') ? a : b
}

/** Fold a duplicate into the canonical record without losing provenance. */
function merge(canonical: CanonicalJob, dup: CanonicalJob, confidence: number): CanonicalJob {
  const urls = new Set([
    ...canonical.sourceUrls, ...dup.sourceUrls,
    canonical.applicationUrl, canonical.canonicalUrl,
    dup.applicationUrl, dup.canonicalUrl,
  ])
  // Include both records' own `source`, not just the duplicate's: otherwise a
  // job first seen via Greenhouse and later via search reports only "search".
  const types = new Set([
    ...canonical.sourceTypes, ...dup.sourceTypes,
    canonical.source, dup.source,
  ])

  return {
    ...canonical,
    sourceUrls: [...urls].filter(Boolean),
    sourceTypes: [...types].filter(Boolean),
    // Fill gaps from the duplicate rather than preferring one record wholesale.
    description: canonical.description || dup.description,
    department: canonical.department ?? dup.department,
    team: canonical.team ?? dup.team,
    employmentType: canonical.employmentType ?? dup.employmentType,
    seniority: canonical.seniority ?? dup.seniority,
    salaryMin: canonical.salaryMin ?? dup.salaryMin,
    salaryMax: canonical.salaryMax ?? dup.salaryMax,
    salaryCurrency: canonical.salaryCurrency ?? dup.salaryCurrency,
    city: canonical.city ?? dup.city,
    state: canonical.state ?? dup.state,
    country: canonical.country ?? dup.country,
    // Earliest sighting and latest posting date across all copies.
    postedAt:
      canonical.postedAt && dup.postedAt
        ? (canonical.postedAt > dup.postedAt ? canonical.postedAt : dup.postedAt)
        : canonical.postedAt ?? dup.postedAt,
    firstSeenAt:
      canonical.firstSeenAt < dup.firstSeenAt ? canonical.firstSeenAt : dup.firstSeenAt,
    lastSeenAt: canonical.lastSeenAt > dup.lastSeenAt ? canonical.lastSeenAt : dup.lastSeenAt,
    skills: [...new Set([...canonical.skills, ...dup.skills])],
    technologies: [...new Set([...canonical.technologies, ...dup.technologies])],
    duplicateConfidence: Math.max(canonical.duplicateConfidence, confidence),
  }
}

/* ---------------------------------- entry --------------------------------- */

export function deduplicate(jobs: CanonicalJob[]): DedupeResult {
  const mapping: Record<string, string> = {}
  const tierCounts: Record<string, number> = { requisition: 0, url: 0, titleLocation: 0, fuzzy: 0 }

  // Deterministic index tiers.
  const byRequisition = new Map<string, CanonicalJob>()
  const byUrl = new Map<string, CanonicalJob>()
  const byTitleLocation = new Map<string, CanonicalJob>()
  // Fuzzy comparison is scoped per company; comparing across employers is both
  // wrong and quadratic in the worst way.
  const byCompany = new Map<string, CanonicalJob[]>()

  const out = new Map<string, CanonicalJob>()

  const absorb = (winner: CanonicalJob, loser: CanonicalJob, conf: number, tier: string) => {
    const merged = merge(winner, loser, conf)
    out.set(merged.id, merged)
    if (loser.id !== merged.id) out.delete(loser.id)
    mapping[loser.id] = merged.id
    tierCounts[tier]++
    return merged
  }

  // Process the most trustworthy sources first so they tend to become canonical.
  const ordered = [...jobs].sort(
    (a, b) =>
      (b.sourceConfidence ?? DEFAULT_SOURCE_CONFIDENCE.unknown) -
      (a.sourceConfidence ?? DEFAULT_SOURCE_CONFIDENCE.unknown)
  )

  for (const job of ordered) {
    const company = companyKey(job)
    let match: CanonicalJob | undefined
    let tier = ''
    let confidence = 0

    // TIER 1 -- requisition id within the same company+source is definitive.
    const reqKey = job.requisitionKey ?? null
    if (reqKey && byRequisition.has(reqKey)) {
      match = byRequisition.get(reqKey)
      tier = 'requisition'
      confidence = 1
    }

    // TIER 2 -- identical application URL.
    if (!match) {
      const uKey = normalizeUrl(job.applicationUrl)
      if (uKey && byUrl.has(uKey)) {
        match = byUrl.get(uKey)
        tier = 'url'
        confidence = 0.98
      }
    }

    // TIER 3 -- company + normalised title + location.
    if (!match) {
      const tlKey = `${company}|${job.normalizedTitle}|${locationKey(job)}`
      if (job.normalizedTitle && byTitleLocation.has(tlKey)) {
        match = byTitleLocation.get(tlKey)
        tier = 'titleLocation'
        confidence = 0.9
      }
    }

    // TIER 4 -- fuzzy, within the same employer only.
    if (!match) {
      const peers = byCompany.get(company) ?? []
      let bestScore = 0
      let best: CanonicalJob | undefined
      // Bound the comparison window: employers with thousands of openings would
      // otherwise make this quadratic.
      for (const peer of peers.slice(-400)) {
        const score = similarityScore(job, peer)
        if (score > bestScore) {
          bestScore = score
          best = peer
        }
      }
      if (best && bestScore >= 0.82) {
        match = best
        tier = 'fuzzy'
        confidence = bestScore
      }
    }

    if (match) {
      const current = out.get(match.id) ?? match
      const winner = preferred(current, job)
      const loser = winner === current ? job : current
      const merged = absorb(winner, loser, confidence, tier)

      // Re-point the indexes at the merged record.
      if (reqKey) byRequisition.set(reqKey, merged)
      byUrl.set(normalizeUrl(merged.applicationUrl), merged)
      byTitleLocation.set(`${company}|${merged.normalizedTitle}|${locationKey(merged)}`, merged)
      const peers = byCompany.get(company) ?? []
      const idx = peers.findIndex((p) => p.id === current.id || p.id === job.id)
      if (idx >= 0) peers[idx] = merged
      else peers.push(merged)
      byCompany.set(company, peers)
      continue
    }

    // First time we have seen this job.
    out.set(job.id, job)
    if (reqKey) byRequisition.set(reqKey, job)
    byUrl.set(normalizeUrl(job.applicationUrl), job)
    if (job.normalizedTitle) {
      byTitleLocation.set(`${company}|${job.normalizedTitle}|${locationKey(job)}`, job)
    }
    const peers = byCompany.get(company) ?? []
    peers.push(job)
    byCompany.set(company, peers)
  }

  const result = [...out.values()].map((j) => ({ ...j, canonicalJobId: null }))
  return {
    jobs: result,
    duplicatesRemoved: jobs.length - result.length,
    mapping,
    tierCounts,
  }
}

/** Extra field the pipeline attaches before dedupe; declared here to keep the
 *  canonical schema clean of index-only concerns. */
declare module '../sources/types' {
  interface CanonicalJob {
    /** `${companyKey}|${source}|${requisitionId}` when a req id exists. */
    requisitionKey?: string | null
  }
}
