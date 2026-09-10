import type { CanonicalJob, RawJob, LocationType } from '../sources/types'
import { DEFAULT_SOURCE_CONFIDENCE, contentHash, htmlToText, nowIso } from '../sources/types'
import { parseLocation, parseLocations } from '../location'
import { extractSkills, normalizedTitleOf, inferSeniority } from './skills'
import { normalizeTitle } from './dedupe'
import { isAggregatorUrl } from '../sources/detector'

/**
 * RawJob -> CanonicalJob.
 *
 * This stage is pure and total: it never throws and never performs I/O, so a
 * malformed posting degrades to a thinner record rather than taking down the
 * batch (§23). Enrichment that CAN fail (valuation, verification) happens in
 * later, independent stages.
 */

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function locationTypeOf(remote: boolean, raw: string | null, description: string): LocationType {
  const text = `${raw ?? ''} ${description.slice(0, 600)}`
  if (/\bhybrid\b/i.test(text)) return 'hybrid'
  if (remote) return 'remote'
  if (/\bon[- ]?site\b|\bin[- ]?office\b/i.test(text)) return 'onsite'
  return raw ? 'onsite' : 'unknown'
}

export function normalizeJob(raw: RawJob, opts: { companySlug?: string; companyName?: string } = {}): CanonicalJob {
  const now = nowIso()

  const description = raw.description?.trim() || htmlToText(raw.descriptionHtml)
  const company = raw.company || opts.companyName || raw.target.companyName || raw.target.token
  const companyDomain = raw.companyDomain || raw.target.companyDomain || null
  const companySlug = opts.companySlug || slugify(companyDomain?.replace(/\.[a-z.]+$/, '') || company)

  // Every location the posting names, not just the first.
  const allLocationStrings = [raw.locationRaw, ...(raw.additionalLocations ?? [])].filter(Boolean) as string[]
  const parsedList = allLocationStrings.length
    ? allLocationStrings.flatMap((l) => parseLocations(l))
    : [parseLocation(null)]
  const primary = parsedList[0]

  const remote =
    raw.remoteFlag === true || parsedList.some((p) => p.isRemote)
  const locationType = locationTypeOf(remote, raw.locationRaw ?? null, description)

  const skills = extractSkills(`${raw.title}\n${description}`)

  const sourceConfidence =
    DEFAULT_SOURCE_CONFIDENCE[raw.source] ?? DEFAULT_SOURCE_CONFIDENCE.unknown

  const applicationUrl = raw.applicationUrl
  const canonicalUrl = raw.canonicalUrl || raw.applicationUrl
  // "Direct" means the employer or their ATS receives the application, rather
  // than an aggregator that will bounce the candidate onward.
  const isDirectApplication = Boolean(applicationUrl) && !isAggregatorUrl(applicationUrl)

  const id = `${raw.source}:${raw.target.token}:${raw.sourceId}`

  return {
    id,
    sourceId: raw.sourceId,
    source: raw.source,

    company,
    companyDomain,
    companySlug,

    title: raw.title.trim(),
    normalizedTitle: normalizeTitle(raw.title),
    description,

    locationRaw: raw.locationRaw ?? null,
    locationDisplay: primary.display,
    city: primary.city,
    state: primary.region,
    country: primary.country,
    locationType,
    locations: parsedList.map((p) => ({
      display: p.display,
      city: p.city,
      state: p.region,
      country: p.country,
    })),

    remote,
    hybrid: locationType === 'hybrid',
    onsite: locationType === 'onsite',

    employmentType: raw.employmentType ?? null,
    seniority: inferSeniority(raw.title, description),

    department: raw.department ?? null,
    team: raw.team ?? null,

    salaryMin: raw.salaryMin ?? null,
    salaryMax: raw.salaryMax ?? null,
    salaryCurrency: raw.salaryCurrency ?? null,

    postedAt: raw.postedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: now,

    applicationUrl,
    canonicalUrl,
    sourceUrls: [canonicalUrl, applicationUrl].filter((v, i, a) => v && a.indexOf(v) === i),
    sourceTypes: [raw.source],
    isDirectApplication,

    skills: skills.skills,
    technologies: skills.technologies,

    companyValuationUsd: null, // filled by the (optional) enrichment stage

    status: 'OPEN',
    freshnessScore: 0, // filled by the freshness stage
    sourceConfidence,
    duplicateConfidence: 0,
    canonicalJobId: null,
    isRepost: false,

    contentHash: contentHash(
      raw.title, raw.locationRaw, description.slice(0, 2000),
      raw.salaryMin, raw.salaryMax, raw.employmentType, raw.department
    ),

    // Strongest dedupe key: same employer, same platform, same requisition.
    requisitionKey: raw.requisitionId
      ? `${companySlug}|${raw.source}|${raw.requisitionId}`
      : null,
  }
}

/* -------------------------------- freshness ------------------------------- */

export type FreshnessBand = 'very-fresh' | 'fresh' | 'recent' | 'aging' | 'stale' | 'unknown'

export interface Freshness {
  band: FreshnessBand
  /** 0-1, used directly by the ranker. */
  score: number
  ageDays: number | null
}

/**
 * Freshness from the employer's own posting date, with the age bands from §14.
 *
 * Posting dates are not blindly trusted: an employer that closes and reopens a
 * requisition gets a new date on an old role. `detectReposts` flags those so a
 * "posted today" badge cannot be gamed by a repost.
 */
export function computeFreshness(job: CanonicalJob, referenceNow = Date.now()): Freshness {
  const iso = job.postedAt ?? job.updatedAt
  if (!iso) return { band: 'unknown', score: 0.3, ageDays: null }

  const ageMs = referenceNow - new Date(iso).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return { band: 'unknown', score: 0.3, ageDays: null }

  const ageDays = ageMs / 86_400_000

  if (ageDays < 1) return { band: 'very-fresh', score: 1, ageDays }
  if (ageDays <= 3) return { band: 'fresh', score: 0.9, ageDays }
  if (ageDays <= 7) return { band: 'recent', score: 0.75, ageDays }
  if (ageDays <= 30) return { band: 'aging', score: 0.45, ageDays }
  // Decays toward zero rather than dropping off a cliff at 30 days.
  return { band: 'stale', score: Math.max(0.05, 0.45 * Math.exp(-(ageDays - 30) / 60)), ageDays }
}

/**
 * Flag reposts: the same requisition seen before under an older date.
 *
 * `previous` maps requisitionKey -> the earliest postedAt we have recorded.
 * A posting whose date moved forward by more than a week while keeping its
 * requisition id is a repost, not a new role.
 */
export function detectReposts(
  jobs: CanonicalJob[],
  previous: Record<string, string>
): { jobs: CanonicalJob[]; repostCount: number } {
  let repostCount = 0
  const out = jobs.map((job) => {
    const key = job.requisitionKey
    if (!key || !job.postedAt) return job
    const seenBefore = previous[key]
    if (!seenBefore) return job

    const drift = new Date(job.postedAt).getTime() - new Date(seenBefore).getTime()
    if (drift > 7 * 86_400_000) {
      repostCount++
      return { ...job, isRepost: true, firstSeenAt: seenBefore }
    }
    return { ...job, firstSeenAt: seenBefore }
  })
  return { jobs: out, repostCount }
}
