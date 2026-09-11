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

/**
 * Phrases that describe a candidate being asked for money.
 *
 * A match is NOT by itself evidence of fraud -- see `requestsPayment`. The most
 * common place these words appear is in a legitimate employer's own anti-fraud
 * warning, which says the opposite of what the words say in isolation.
 */
const SCAM_PHRASE_RE =
  /\b(application\s+fee|registration\s+fee|processing\s+fee|equipment\s+deposit|pay\s+(?:a\s+)?fee|send\s+money|wire\s+transfer\s+required)\b/gi

/**
 * Money-transfer brands. Far weaker evidence than the phrases above, because
 * these are company names that appear in ordinary prose -- a fintech listing
 * its customers, a payments role naming the rails it works on. Only counted
 * when the sentence also demands payment.
 */
const MONEY_RAIL_RE = /\b(western\s+union|moneygram)\b/gi

/**
 * Negation and disclaimer triggers, scoped to the sentence containing a match.
 *
 * WHY SENTENCE SCOPE AND NOT CLAUSE SCOPE
 * ---------------------------------------
 * `lib/resume/assertion.ts` deliberately bounds negation at the nearest CLAUSE,
 * because for resume skills a fixed window over-negates. Anti-fraud disclaimers
 * have the opposite shape -- one negation governing a long coordinated list:
 *
 *   "We will never ask you to pay a fee, send money, deposit or cash a check,
 *    or purchase work-related equipment."
 *     |_ the only negation is at the front; "send money" sits two commas away
 *
 * Clause scope would negate "pay a fee" and miss "send money" in the same
 * sentence, which is the worst of both. So the scope here is the sentence.
 *
 * The cost is a false negative on a scam written as "Do not worry, just pay a
 * $200 registration fee". That trade is deliberate and heavily asymmetric: this
 * corpus is crawled exclusively from employers' own ATS boards -- Greenhouse,
 * Ashby, Workday -- where the prior on an actual advance-fee scam is close to
 * zero, while the cost of a false positive is measured in `requestsPayment`.
 */
const PAYMENT_DISCLAIMER_RE =
  /\b(never|not|no|without|beware|scam|fraud|phishing|impersonat|won't|don't|doesn't|nor)\b/i

/** The sentence around [start, end), used to scope the disclaimer check. */
function sentenceAround(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && !/[.!?\n]/.test(text[from - 1])) from--
  let to = end
  while (to < text.length && !/[.!?\n]/.test(text[to])) to++
  return text.slice(from, to)
}

/**
 * Does this posting actually demand money from the candidate?
 *
 * THE FALSE POSITIVE THIS EXISTS TO PREVENT
 * -----------------------------------------
 * The previous version was a bare regex over the description, and it was wrong
 * in the most damaging possible way -- it fired on the employers most careful
 * about fraud, because warning candidates about advance-fee scams requires
 * naming the thing being warned about. Measured against live boards:
 *
 *   Airbnb      167 of 167 postings rejected. Trigger: their own warning,
 *               "We'll also never ask you to pay a fee, send money, ..."
 *   Fireblocks   75 of 75 postings rejected. Trigger: "Western Union" --
 *               named as a CUSTOMER, alongside BNY Mellon and Stripe.
 *
 * `requests_payment` is a CRITICAL rule, so every one of those postings was
 * dropped from the index. Both employers were in the registry, both boards
 * returned 200 OK, and the crawl report showed zero failures. The jobs simply
 * were not there.
 */
export function requestsPayment(description: string): { hit: boolean; evidence: string | null } {
  const text = description ?? ''
  if (!text) return { hit: false, evidence: null }

  for (const re of [SCAM_PHRASE_RE, MONEY_RAIL_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const sentence = sentenceAround(text, m.index, m.index + m[0].length)
      // A disclaimer in the same sentence flips the meaning entirely.
      if (PAYMENT_DISCLAIMER_RE.test(sentence)) continue
      // A brand name alone is not a demand; the sentence must also contain an
      // act of paying. Deliberately VERBS ONLY -- "payment" and "fee" as nouns
      // are far too common in ordinary prose. Fireblocks describes itself as
      // trusted by "banks, payment providers, fintechs ... Western Union,
      // Stripe, and Revolut", and a guard that accepted the noun "payment"
      // still flagged all 75 of its postings.
      if (re === MONEY_RAIL_RE && !/\b(pay|paid|pays|send|sends|sent|transferring|transfer|wire|wired|deposit|remit)\b/i.test(sentence)) {
        continue
      }
      return { hit: true, evidence: sentence.trim().slice(0, 300) }
    }
  }
  return { hit: false, evidence: null }
}

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
  const payment = requestsPayment(job.description ?? '')
  if (payment.hit) {
    add('requests_payment', 'CRITICAL', `Posting asks the candidate for money: "${payment.evidence}"`)
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
