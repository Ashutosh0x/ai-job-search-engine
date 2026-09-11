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
  /** Requisition ids that turned out not to identify anything. See below. */
  degenerateRequisitionKeys: number
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

/* ------------------------ requisition key sanity -------------------------- */

/**
 * Find requisition keys that are not actually identifiers, so tier 1 can ignore
 * them.
 *
 * WHY THIS IS NECESSARY
 * ---------------------
 * `requisition_id` reads like a primary key and is not one. On Greenhouse it is
 * a FREE-TEXT FIELD THE EMPLOYER FILLS IN, and employers put whatever they like
 * in it. Airbnb puts the literal string "ONE" in it on most of its postings.
 *
 * Tier 1 treats a shared requisition as definitive proof of duplication, so
 * that one field collapsed 167 distinct Airbnb roles -- different titles,
 * different countries, different req numbers in the URL -- into 12 records.
 * Every survivor then failed validation, and Airbnb vanished from the index
 * entirely while its board answered 200 OK with 167 jobs. Nothing in the crawl
 * report showed a failure, because from the pipeline's point of view none had
 * occurred.
 *
 * HOW A BAD KEY IS TOLD FROM A GOOD ONE
 * -------------------------------------
 * Not by a list of banned words -- that would need maintaining forever and
 * would still miss the next employer's quirk. By what the data does:
 *
 *   same requisition + same normalised title, many locations
 *       -> a genuine multi-location requisition. MERGE. This is tier 1's
 *          entire reason for existing.
 *
 *   same requisition + MANY DIFFERENT titles
 *       -> the field is not identifying anything. Distinct roles cannot share
 *          one requisition. IGNORE IT for those postings.
 *
 * Ignoring a requisition key is safe: tiers 2-4 (identical URL, title+location,
 * fuzzy) still catch real duplicates. Under-merging costs a duplicate row.
 * Over-merging deleted 93% of an employer, silently.
 */
export function degenerateRequisitionKeys(jobs: CanonicalJob[]): Set<string> {
  const titlesByKey = new Map<string, Set<string>>()
  for (const job of jobs) {
    if (!job.requisitionKey) continue
    let titles = titlesByKey.get(job.requisitionKey)
    if (!titles) titlesByKey.set(job.requisitionKey, (titles = new Set()))
    titles.add(job.normalizedTitle || '')
  }
  const bad = new Set<string>()
  for (const [key, titles] of titlesByKey) if (titles.size > 1) bad.add(key)
  return bad
}

/**
 * Do these two postings carry DIFFERENT real requisition ids from the SAME
 * source?
 *
 * If so they are different openings and the probabilistic tiers must not merge
 * them, however alike they look. A requisition id is the employer's own
 * statement of identity: tier 1 already trusts a shared one as proof of
 * sameness, and the converse is the same evidence read the other way.
 *
 * WHY THE SOURCE HAS TO MATCH BEFORE THIS CAN VETO ANYTHING
 * ---------------------------------------------------------
 * `requisitionKey` is `companySlug|source|requisitionId`, so the SAME job seen
 * through two different sources always has two different keys. A veto on raw
 * key inequality would therefore refuse every cross-source merge -- which is
 * the original reason dedupe exists, and the most visible quality failure a job
 * search can have. Only ids issued by the same system are comparable.
 *
 * Returns false when either id is missing (most sources publish none) or when
 * either is degenerate -- an unreliable id must not be allowed to SPLIT records
 * any more than it is allowed to merge them.
 */
function differentRequisitions(
  a: CanonicalJob,
  b: CanonicalJob,
  degenerate: Set<string>
): boolean {
  const ka = a.requisitionKey
  const kb = b.requisitionKey
  if (!ka || !kb) return false
  if (degenerate.has(ka) || degenerate.has(kb)) return false
  if (ka === kb) return false

  // `companySlug|source|id` -- the id itself may contain "|", so split off only
  // the first two segments and keep the remainder whole.
  const parts = (k: string) => {
    const i = k.indexOf('|')
    const j = k.indexOf('|', i + 1)
    return i < 0 || j < 0 ? null : { source: k.slice(i + 1, j), id: k.slice(j + 1) }
  }
  const pa = parts(ka)
  const pb = parts(kb)
  if (!pa || !pb) return false
  if (pa.source !== pb.source) return false
  return pa.id !== pb.id
}

/* ---------------------------------- entry --------------------------------- */

export function deduplicate(jobs: CanonicalJob[]): DedupeResult {
  const mapping: Record<string, string> = {}
  const tierCounts: Record<string, number> = { requisition: 0, url: 0, titleLocation: 0, fuzzy: 0 }
  const degenerateKeys = degenerateRequisitionKeys(jobs)

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

    // TIER 1 -- requisition id within the same company+source is definitive,
    // but only when the id is actually identifying. See
    // `degenerateRequisitionKeys` for why that has to be checked.
    const rawReqKey = job.requisitionKey ?? null
    const reqKey = rawReqKey && !degenerateKeys.has(rawReqKey) ? rawReqKey : null
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
    //
    // Vetoed when both postings carry different real requisition ids. Tier 1
    // treats a SHARED requisition as proof two records are the same opening;
    // the converse is just as strong evidence and was not being used. An
    // employer that issues two requisition numbers has two openings, whatever
    // the title and city say.
    //
    // This matters most at exactly the employers that hire in volume. Barclays
    // posts 22 separate "Full Stack Engineer" requisitions at its Pune site --
    // distinct JR numbers, distinct application links -- and this tier folded
    // all 22 into one row, hiding 21 real openings and 21 real links behind a
    // key (company|title|location) that cannot tell them apart by construction.
    // Measured on one crawl: BNY 1,374 -> 949 and Barclays 1,034 -> 826, with
    // every merge coming from this tier.
    if (!match) {
      const tlKey = `${company}|${job.normalizedTitle}|${locationKey(job)}`
      const candidate = job.normalizedTitle ? byTitleLocation.get(tlKey) : undefined
      if (candidate && !differentRequisitions(job, candidate, degenerateKeys)) {
        match = candidate
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
        // Same veto as tier 3, and it matters more here: fuzzy matching on
        // title and description is exactly what two sibling requisitions from
        // one hiring drive look like.
        if (differentRequisitions(job, peer, degenerateKeys)) continue
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
    // Reported, not just handled: a spike here means an employer's ATS field is
    // being misused, which is worth seeing in the crawl report.
    degenerateRequisitionKeys: degenerateKeys.size,
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
