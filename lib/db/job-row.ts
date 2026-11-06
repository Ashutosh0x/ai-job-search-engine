/**
 * Pipeline job (camelCase, lib/sources/types.ts) -> `jobs` table row
 * (snake_case, supabase/migrations/20260920_jobs_bm25.sql).
 *
 * Pure and dependency-free so the mapping is tested without a database
 * (scripts/test-job-row.mjs). The loader (scripts/load-jobs-postgres.mjs) feeds
 * these rows to buildUpsertQuery().
 *
 * Nothing is invented on the way in: a field the crawl did not produce is NULL,
 * not a default. The one derived column is `board_key`, which the prune step
 * depends on, so a job whose id does not carry one is rejected rather than
 * filed under a guessed board.
 */

export interface PipelineJob {
  id: string
  source: string
  company: string
  companySlug: string
  companyDomain?: string | null
  title: string
  normalizedTitle?: string | null
  description?: string | null
  locationRaw?: string | null
  locationDisplay?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  remote?: boolean | null
  workplaceType?: string | null
  employmentType?: string | null
  department?: string | null
  seniority?: string | null
  earlyCareer?: string | null
  earlyCareerLevel?: number | null
  skills?: string[] | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  postedAt?: string | null
  firstSeenAt?: string | null
  applicationUrl?: string | null
  isDirectApplication?: boolean | null
  freshnessScore?: number | null
  qualityScore?: number | null
  ghostRisk?: number | null
  ghostLabel?: string | null
  visaStatus?: string | null
}

/**
 * The board a job came from: the first two segments of the pipeline id,
 * `provider:token:requisition` -> `provider:token`. Requisition ids may contain
 * colons themselves, so only the first two separators count.
 */
export function boardKeyOf(id: string): string {
  const parts = id.split(':')
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts.slice(2).join(':')) {
    throw new Error(`job id ${JSON.stringify(id)} is not provider:token:requisition`)
  }
  return `${parts[0]}:${parts[1]}`
}

const iso = (v: string | null | undefined): string | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

const num = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function toJobRow(j: PipelineJob, seenAt: string): Record<string, unknown> {
  if (!j.id || !j.title || !j.company || !j.companySlug || !j.source) {
    throw new Error(`job ${JSON.stringify(j.id)} is missing a required field`)
  }
  return {
    id: j.id,
    source: j.source,
    company: j.company,
    company_slug: j.companySlug,
    company_domain: j.companyDomain ?? null,
    title: j.title,
    normalized_title: j.normalizedTitle ?? null,
    description: j.description ?? null,
    location_raw: j.locationRaw ?? null,
    location_display: j.locationDisplay ?? null,
    city: j.city ?? null,
    state: j.state ?? null,
    country: j.country ?? null,
    remote: j.remote === true,
    workplace_type: j.workplaceType ?? null,
    employment_type: j.employmentType ?? null,
    department: j.department ?? null,
    seniority: j.seniority ?? null,
    early_career: j.earlyCareer ?? null,
    early_career_level: num(j.earlyCareerLevel),
    skills: Array.isArray(j.skills) ? j.skills.filter((s) => typeof s === 'string') : [],
    salary_min: num(j.salaryMin),
    salary_max: num(j.salaryMax),
    salary_currency: j.salaryCurrency ?? null,
    posted_at: iso(j.postedAt),
    // When the pipeline does not know, "now" is the honest first sighting; the
    // upsert keeps the EARLIER of stored and incoming, so this never moves a
    // known first_seen_at forward.
    first_seen_at: iso(j.firstSeenAt) ?? seenAt,
    last_seen_at: seenAt,
    application_url: j.applicationUrl ?? null,
    is_direct_application: j.isDirectApplication === true,
    freshness_score: num(j.freshnessScore),
    quality_score: num(j.qualityScore),
    ghost_risk: num(j.ghostRisk),
    ghost_label: j.ghostLabel ?? null,
    visa_status: j.visaStatus ?? null,
    board_key: boardKeyOf(j.id),
  }
}
