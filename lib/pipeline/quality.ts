import type { CanonicalJob } from '../sources/types'

/**
 * Posting quality, ghost-job detection and validation (§21-22).
 *
 * The honest framing matters here. A "ghost job" is a posting a real employer
 * has no live intention to fill, and from the outside it is INFERRED, never
 * observed: we can see that a requisition has sat unchanged for four months and
 * been reposted twice, but we cannot see the employer's intent.
 *
 * So this module produces *signals with evidence*, not verdicts. Nothing is
 * hidden from the user on suspicion alone -- a suspected ghost job is ranked
 * lower and labelled with the reason, so the user decides. Silently suppressing
 * a real job because a heuristic misfired is the worse error.
 */

export type Severity = 'CRITICAL' | 'WARNING' | 'INFO'

export interface ValidationIssue {
  rule: string
  severity: Severity
  message: string
}

export interface QualitySignal {
  signal: string
  /** Verbatim or factual evidence, never a paraphrase of intent. */
  evidence: string
  weight: number
}

export interface QualityAssessment {
  /** 0-1. Completeness and trustworthiness of the posting itself. */
  qualityScore: number
  issues: ValidationIssue[]
  /** True only when a CRITICAL rule fails. */
  shouldIndex: boolean

  /** 0-1 confidence that this is a stale/ghost posting. Inference, not fact. */
  ghostRisk: number
  ghostSignals: QualitySignal[]
  /** User-facing caution, or null when there is nothing worth saying. */
  ghostLabel: string | null
}

/* ------------------------------- validation ------------------------------- */

const GENERIC_TITLES = new Set([
  'various positions', 'click here', 'apply now', 'job opening', 'hiring',
  'we are hiring', 'open position', 'urgent hiring', 'immediate opening',
  'multiple openings', 'general application', 'talent pool', 'other',
  'future opportunities', 'speculative application',
])

/** Language that indicates a pipeline/talent-pool posting, not a live role. */
const PIPELINE_RE =
  /\b(talent\s*(pool|community|network)|general\s+application|speculative|expression\s+of\s+interest|future\s+(openings?|opportunit)|keep\s+your\s+(cv|resume)\s+on\s+file|we.?re\s+always\s+looking)\b/i

/** Signals of an outright fraudulent posting rather than a stale one. */
const SCAM_RE =
  /\b(application\s+fee|registration\s+fee|processing\s+fee|equipment\s+deposit|pay\s+(a\s+)?fee|western\s+union|send\s+money|wire\s+transfer\s+required)\b/i

const OFF_PLATFORM_CONTACT_RE =
  /\b(telegram|whatsapp|@gmail\.com|@yahoo\.com|@outlook\.com|@hotmail\.com)\b/i

export function validateJob(job: CanonicalJob): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (rule: string, severity: Severity, message: string) =>
    issues.push({ rule, severity, message })

  // --- CRITICAL: without these the record is not usable.
  if (!job.title || job.title.trim().length < 3) {
    add('missing_title', 'CRITICAL', 'Job has no usable title')
  }
  if (!job.company || job.company.trim().length < 2) {
    add('missing_company', 'CRITICAL', 'Job has no company name')
  }
  if (!job.applicationUrl || !/^https?:\/\//i.test(job.applicationUrl)) {
    add('invalid_application_url', 'CRITICAL', 'Application URL is missing or not HTTP(S)')
  }
  if (SCAM_RE.test(job.description ?? '')) {
    add('requests_payment', 'CRITICAL', 'Posting asks the candidate for money')
  }

  // --- WARNING: indexable, but worth flagging.
  if (GENERIC_TITLES.has(job.title.trim().toLowerCase())) {
    add('generic_title', 'WARNING', 'Title is generic rather than a specific role')
  }
  if (!job.city && !job.country && !job.remote) {
    add('missing_location', 'WARNING', 'No location and not marked remote')
  }
  if (job.postedAt && new Date(job.postedAt).getTime() > Date.now() + 86_400_000) {
    add('future_posting_date', 'WARNING', 'Posting date is in the future')
  }
  if (job.salaryMin != null && job.salaryMax != null && job.salaryMin > job.salaryMax) {
    add('salary_inverted', 'WARNING', 'Salary minimum exceeds maximum')
  }
  if (job.salaryMax != null && job.salaryMax > 10_000_000) {
    add('implausible_salary', 'WARNING', 'Salary is implausibly high')
  }
  if ((job.description ?? '').length > 0 && (job.description ?? '').length < 200) {
    add('very_short_description', 'WARNING', 'Description is unusually short')
  }
  if (OFF_PLATFORM_CONTACT_RE.test(job.description ?? '')) {
    add('off_platform_contact', 'WARNING', 'Posting directs applicants to a personal or messaging contact')
  }

  // --- INFO: absence worth recording but entirely normal.
  if (!job.salaryMin && !job.salaryMax) add('missing_salary', 'INFO', 'No salary disclosed')
  if (!job.employmentType) add('missing_employment_type', 'INFO', 'Employment type not stated')
  if (!(job.description ?? '').length) add('missing_description', 'INFO', 'No description available from this source')

  return issues
}

/* ---------------------------------- score --------------------------------- */

/**
 * Completeness-weighted quality score.
 *
 * Deliberately NOT a judgement of the job -- a terse posting from a small
 * company is not a bad job. It measures how much we know, which is what the
 * ranker should use when breaking ties.
 */
export function computeQualityScore(job: CanonicalJob, issues: ValidationIssue[]): number {
  const factors: [boolean, number][] = [
    [Boolean(job.title), 10],
    [(job.description ?? '').length > 200, 10],
    [Boolean(job.company), 10],
    [Boolean(job.applicationUrl), 10],
    [Boolean(job.city || job.country || job.remote), 8],
    [Boolean(job.postedAt), 8],
    [Boolean(job.employmentType), 5],
    [Boolean(job.salaryMin || job.salaryMax), 8],
    [(job.skills ?? []).length > 0, 7],
    [Boolean(job.seniority), 5],
    [Boolean(job.department), 3],
    [job.workplaceType !== 'UNKNOWN', 7],
    [job.visaStatus !== 'SPONSORSHIP_NOT_MENTIONED', 5],
    [(job.description ?? '').length > 1000, 4],
    [job.isDirectApplication === true, 5],
  ]

  const max = factors.reduce((s, [, w]) => s + w, 0)
  let score = factors.reduce((s, [ok, w]) => s + (ok ? w : 0), 0) / max

  // Penalties for things that actively reduce trust.
  if (issues.some((i) => i.severity === 'CRITICAL')) score *= 0.3
  if (issues.some((i) => i.rule === 'generic_title')) score *= 0.7
  if (issues.some((i) => i.rule === 'off_platform_contact')) score *= 0.5

  return Math.round(score * 1000) / 1000
}

/* ------------------------------ ghost signals ----------------------------- */

export interface GhostContext {
  /** Earliest date we have ever seen this requisition. */
  firstSeenAt?: string | null
  /** Times the same requisition id has been re-dated. */
  repostCount?: number
  now?: number
}

/**
 * Assess ghost-posting risk from observable facts only.
 *
 * Each signal names what was observed. None of them prove intent, and the
 * combined score is capped below certainty on purpose: this ranks and labels,
 * it never hides.
 */
export function assessGhostRisk(job: CanonicalJob, ctx: GhostContext = {}): {
  risk: number
  signals: QualitySignal[]
  label: string | null
} {
  const now = ctx.now ?? Date.now()
  const signals: QualitySignal[] = []

  const ageDays = job.postedAt ? (now - new Date(job.postedAt).getTime()) / 86_400_000 : null
  const firstSeen = ctx.firstSeenAt ?? job.firstSeenAt
  const trackedDays = firstSeen ? (now - new Date(firstSeen).getTime()) / 86_400_000 : null

  // 1. Open a long time without the content changing.
  if (trackedDays !== null && trackedDays > 90) {
    signals.push({
      signal: 'long_open',
      evidence: `Seen unchanged for ${Math.round(trackedDays)} days`,
      weight: 0.3,
    })
  } else if (ageDays !== null && ageDays > 120) {
    signals.push({
      signal: 'stale_posting',
      evidence: `Posted ${Math.round(ageDays)} days ago`,
      weight: 0.25,
    })
  }

  // 2. Repeatedly re-dated under the same requisition -- the classic pattern
  //    for a listing kept "fresh" without being refilled.
  if ((ctx.repostCount ?? 0) >= 2) {
    signals.push({
      signal: 'repeated_repost',
      evidence: `Requisition re-dated ${ctx.repostCount} times`,
      weight: 0.35,
    })
  } else if (job.isRepost) {
    signals.push({
      signal: 'repost',
      evidence: 'Requisition re-dated after previously being seen',
      weight: 0.2,
    })
  }

  // 3. Explicitly a pipeline posting. This is the one case where the employer
  //    is telling us directly, so it is high weight and not really an inference.
  const text = `${job.title} ${(job.description ?? '').slice(0, 3000)}`
  const pipelineMatch = text.match(PIPELINE_RE)
  if (pipelineMatch) {
    signals.push({
      signal: 'talent_pipeline',
      evidence: `Posting says "${pipelineMatch[0]}"`,
      weight: 0.5,
    })
  }

  // 4. Vague posting: no team, no seniority, no requirements to speak of.
  const vague =
    !job.department && !job.seniority && (job.skills ?? []).length === 0 &&
    (job.description ?? '').length < 400
  if (vague) {
    signals.push({
      signal: 'vague_posting',
      evidence: 'No team, seniority, skills or substantive description',
      weight: 0.15,
    })
  }

  // Combine as independent evidence rather than a sum, so three weak signals
  // cannot masquerade as certainty.
  let risk = 0
  for (const s of signals) risk = risk + s.weight * (1 - risk)
  risk = Math.min(0.85, Math.round(risk * 100) / 100) // never claim certainty

  let label: string | null = null
  if (signals.some((s) => s.signal === 'talent_pipeline')) {
    label = 'Talent pipeline — may not be a specific opening'
  } else if (risk >= 0.5) {
    label = 'Open a long time — may not be actively filling'
  } else if (risk >= 0.3) {
    label = 'Older posting'
  }

  return { risk, signals, label }
}

/* --------------------------------- entry ---------------------------------- */

export function assessJob(job: CanonicalJob, ctx: GhostContext = {}): QualityAssessment {
  const issues = validateJob(job)
  const qualityScore = computeQualityScore(job, issues)
  const ghost = assessGhostRisk(job, ctx)

  return {
    qualityScore,
    issues,
    // Only a CRITICAL failure keeps a posting out of the index.
    shouldIndex: !issues.some((i) => i.severity === 'CRITICAL'),
    ghostRisk: ghost.risk,
    ghostSignals: ghost.signals,
    ghostLabel: ghost.label,
  }
}
