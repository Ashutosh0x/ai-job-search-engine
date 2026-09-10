import type { ParsedIntent } from './intent'

/**
 * Transparent, explainable ranking.
 *
 * Two design commitments, both from the brief:
 *
 *  1. **Every point is attributable.** The score is a sum of named signals, and
 *     each result carries the breakdown. "Why is this ranked here?" has an
 *     answer you can read, which is what makes the ranking improvable rather
 *     than mystical.
 *
 *  2. **Relevance dominates.** Company valuation and size contribute at most 3
 *     of 100 points, deliberately. A ranker that lets prestige outweigh fit
 *     turns into a popularity list, and the whole point of a job search is that
 *     the right small company beats the wrong famous one.
 *
 * Weights are data, not code, so they can be tuned per surface or A/B tested
 * without touching the scorer.
 */

export interface RankWeights {
  titleMatch: number
  descriptionMatch: number
  skillMatch: number
  locationMatch: number
  freshness: number
  workplaceMatch: number
  visaMatch: number
  seniorityMatch: number
  sourceQuality: number
  completeness: number
  directApply: number
  companyQuality: number
  duplicatePenalty: number
}

/** Defaults sum to 100 before the penalty. */
export const DEFAULT_WEIGHTS: RankWeights = {
  titleMatch: 15,
  descriptionMatch: 9,
  skillMatch: 15,
  locationMatch: 10,
  freshness: 10,
  workplaceMatch: 8,
  visaMatch: 8,
  seniorityMatch: 7,
  sourceQuality: 5,
  completeness: 5,
  directApply: 5,
  companyQuality: 3,
  duplicatePenalty: -5,
}

export interface SignalScore {
  signal: string
  points: number
  max: number
  /** Human-readable reason, shown in the debug view and the UI. */
  reason: string
}

export interface RankedResult {
  score: number
  signals: SignalScore[]
  /** Short badges for the result card: the reasons that actually earned points. */
  matchReasons: string[]
}

/* ------------------------------- text scoring ----------------------------- */

/**
 * Lightweight BM25-style term scoring.
 *
 * Real BM25 needs corpus-wide document frequencies; this approximates the part
 * that matters for short fields -- saturation (a term appearing five times is
 * not five times as relevant) and length normalisation -- without an index
 * build. It is deliberately swappable for Postgres `ts_rank_cd` or a real BM25
 * extension once search moves into the database.
 */
function fieldScore(terms: string[], field: string, { k1 = 1.2, b = 0.6, avgLen = 8 } = {}): number {
  if (terms.length === 0 || !field) return 0
  const tokens = field.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean)
  if (tokens.length === 0) return 0

  const lengthNorm = 1 - b + b * (tokens.length / avgLen)
  let total = 0
  for (const term of terms) {
    let tf = 0
    for (const tok of tokens) {
      if (tok === term) tf += 1
      else if (tok.startsWith(term) && term.length >= 4) tf += 0.5 // prefix credit
    }
    if (tf > 0) total += (tf * (k1 + 1)) / (tf + k1 * lengthNorm)
  }
  return total / terms.length // 0..~1.8
}

/** Exact phrase in the title is the single strongest relevance signal. */
function phraseBonus(topic: string, title: string): number {
  if (!topic || topic.split(' ').length < 2) return 0
  return title.toLowerCase().includes(topic.toLowerCase()) ? 1 : 0
}

/* --------------------------------- scoring -------------------------------- */

export interface RankableJob {
  title: string
  normalizedTitle?: string
  description?: string
  skills?: string[]
  city?: string | null
  state?: string | null
  country?: string | null
  remote?: boolean
  workplaceType?: string
  remoteCountries?: string[]
  remoteScope?: string | null
  seniority?: string | null
  visaStatus?: string
  postedAt?: string | null
  freshnessScore?: number
  sourceConfidence?: number
  isDirectApplication?: boolean
  salaryMin?: number | null
  salaryMax?: number | null
  employmentType?: string | null
  department?: string | null
  duplicateConfidence?: number
  companySlug?: string
  companyValuationUsd?: number | null
}

const SENIORITY_ORDER = ['internship', 'entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'executive']

export function rankJob(
  job: RankableJob,
  intent: ParsedIntent,
  weights: RankWeights = DEFAULT_WEIGHTS,
  now = Date.now()
): RankedResult {
  const signals: SignalScore[] = []
  const reasons: string[] = []
  const push = (signal: string, points: number, max: number, reason: string, badge?: string) => {
    signals.push({ signal, points: Math.round(points * 100) / 100, max, reason })
    if (badge && points > max * 0.5) reasons.push(badge)
  }

  const terms = intent.titleTerms
  const title = job.title ?? ''

  /* --- title relevance --- */
  const titleRaw = Math.min(1, fieldScore(terms, title) + phraseBonus(intent.topic, title) * 0.6)
  push('titleMatch', weights.titleMatch * titleRaw, weights.titleMatch,
    terms.length ? `title matches ${(titleRaw * 100).toFixed(0)}% of query terms` : 'no query terms',
    titleRaw > 0.6 ? `Matches "${intent.topic}"` : undefined)

  /* --- description relevance --- */
  const descRaw = Math.min(1, fieldScore(terms, (job.description ?? '').slice(0, 3000), { avgLen: 300 }))
  push('descriptionMatch', weights.descriptionMatch * descRaw, weights.descriptionMatch,
    `description relevance ${(descRaw * 100).toFixed(0)}%`)

  /* --- skills --- */
  if (intent.skills.length > 0) {
    const have = new Set((job.skills ?? []).map((s) => s.toLowerCase()))
    const matched = intent.skills.filter((s) => have.has(s.toLowerCase()))
    const ratio = matched.length / intent.skills.length
    push('skillMatch', weights.skillMatch * ratio, weights.skillMatch,
      matched.length ? `has ${matched.join(', ')}` : `missing ${intent.skills.join(', ')}`,
      matched.length ? `${matched.slice(0, 3).join(', ')}` : undefined)
  } else {
    // No skill constraint: award the neutral midpoint so jobs are not punished
    // for a filter the user never applied.
    push('skillMatch', weights.skillMatch * 0.5, weights.skillMatch, 'no skill filter applied')
  }

  /* --- location --- */
  const wantsPlace = intent.locations.length > 0 || intent.countries.length > 0
  if (wantsPlace) {
    const jobPlaces = [job.city, job.state, job.country].filter(Boolean).map((s) => s!.toLowerCase())
    const wanted = [...intent.locations, ...intent.countries].map((s) => s.toLowerCase())

    // A city query implies its country. Without this, a "Remote — India" job
    // scored zero against a search for "Bangalore", because the strings never
    // matched -- even though the role is plainly open to someone in Bangalore.
    // `cityCountries` is resolved from the live index, so it knows exactly the
    // city/country pairs we actually hold.
    const impliedCountries = (intent.impliedCountries ?? []).map((c) => c.toLowerCase())
    const wantedWithImplied = [...wanted, ...impliedCountries]

    const exact = wanted.some((w) => jobPlaces.includes(w))
    // A remote job open to the requested country is as good as being there.
    const remoteCovers =
      job.remote === true &&
      (job.remoteScope === 'WORLDWIDE' ||
        (job.remoteCountries ?? []).some((c) => wantedWithImplied.includes(c.toLowerCase())))

    if (exact) push('locationMatch', weights.locationMatch, weights.locationMatch, `located in ${job.city ?? job.country}`, job.city ?? job.country ?? undefined)
    else if (remoteCovers) push('locationMatch', weights.locationMatch * 0.9, weights.locationMatch, 'remote and open to your location', 'Remote — open to you')
    else if (job.remote && job.remoteScope === 'UNSPECIFIED') push('locationMatch', weights.locationMatch * 0.4, weights.locationMatch, 'remote, scope unstated')
    else push('locationMatch', 0, weights.locationMatch, `located in ${job.city ?? job.country ?? 'an unlisted place'}`)
  } else {
    push('locationMatch', weights.locationMatch * 0.5, weights.locationMatch, 'no location filter applied')
  }

  /* --- workplace --- */
  if (intent.workplace) {
    if (job.workplaceType === intent.workplace) {
      push('workplaceMatch', weights.workplaceMatch, weights.workplaceMatch, `is ${intent.workplace.toLowerCase()}`, intent.workplace === 'REMOTE' ? 'Remote' : 'Hybrid')
    } else if (job.workplaceType === 'UNKNOWN') {
      // Unknown is not a mismatch. Scoring it zero would systematically bury
      // the ~80% of postings that simply do not state a workplace.
      push('workplaceMatch', weights.workplaceMatch * 0.35, weights.workplaceMatch, 'workplace not stated by employer')
    } else {
      push('workplaceMatch', 0, weights.workplaceMatch, `is ${String(job.workplaceType).toLowerCase()}, not ${intent.workplace.toLowerCase()}`)
    }
  } else {
    push('workplaceMatch', weights.workplaceMatch * 0.5, weights.workplaceMatch, 'no workplace filter applied')
  }

  /* --- visa --- */
  if (intent.visa === 'required') {
    const s = job.visaStatus ?? 'SPONSORSHIP_NOT_MENTIONED'
    if (s === 'SPONSORSHIP_EXPLICIT') push('visaMatch', weights.visaMatch, weights.visaMatch, 'employer states sponsorship is available', 'Visa sponsorship')
    else if (s === 'SPONSORSHIP_LIKELY') push('visaMatch', weights.visaMatch * 0.75, weights.visaMatch, 'sponsorship likely (named visa programme)', 'Likely sponsors')
    else if (s === 'SPONSORSHIP_POSSIBLE') push('visaMatch', weights.visaMatch * 0.45, weights.visaMatch, 'weak sponsorship signal')
    else if (s === 'SPONSORSHIP_NOT_AVAILABLE') push('visaMatch', 0, weights.visaMatch, 'employer states sponsorship is NOT available')
    // Not-mentioned is ranked below stated sponsorship but is NOT excluded:
    // most employers who do sponsor never say so in the posting.
    else push('visaMatch', weights.visaMatch * 0.25, weights.visaMatch, 'sponsorship not mentioned')
  } else {
    push('visaMatch', weights.visaMatch * 0.5, weights.visaMatch, 'no visa filter applied')
  }

  /* --- seniority --- */
  if (intent.seniority) {
    const want = SENIORITY_ORDER.indexOf(intent.seniority)
    const have = SENIORITY_ORDER.indexOf(job.seniority ?? '')
    if (have === -1) push('seniorityMatch', weights.seniorityMatch * 0.35, weights.seniorityMatch, 'seniority not stated')
    else if (have === want) push('seniorityMatch', weights.seniorityMatch, weights.seniorityMatch, `is ${intent.seniority} level`, `${intent.seniority} level`)
    else if (Math.abs(have - want) === 1) push('seniorityMatch', weights.seniorityMatch * 0.55, weights.seniorityMatch, `adjacent level (${job.seniority})`)
    else push('seniorityMatch', 0, weights.seniorityMatch, `is ${job.seniority}, not ${intent.seniority}`)
  } else {
    push('seniorityMatch', weights.seniorityMatch * 0.5, weights.seniorityMatch, 'no seniority filter applied')
  }

  /* --- freshness --- */
  const fresh = job.freshnessScore ?? 0
  const ageDays = job.postedAt ? (now - new Date(job.postedAt).getTime()) / 86_400_000 : null
  push('freshness', weights.freshness * fresh, weights.freshness,
    ageDays === null ? 'posting date unknown' : `posted ${Math.max(0, Math.round(ageDays))}d ago`,
    ageDays !== null && ageDays < 1 ? 'Just posted' : ageDays !== null && ageDays <= 3 ? 'New this week' : undefined)

  /* --- source quality --- */
  push('sourceQuality', weights.sourceQuality * (job.sourceConfidence ?? 0.5), weights.sourceQuality,
    `source confidence ${((job.sourceConfidence ?? 0.5) * 100).toFixed(0)}%`)

  /* --- completeness: a fuller posting is a more actively managed one --- */
  const fields = [job.description && job.description.length > 200, job.city, job.seniority,
    job.salaryMin || job.salaryMax, job.department, (job.skills ?? []).length > 0]
  const completeness = fields.filter(Boolean).length / fields.length
  push('completeness', weights.completeness * completeness, weights.completeness,
    `${Math.round(completeness * 100)}% of key fields present`)

  /* --- direct apply --- */
  push('directApply', job.isDirectApplication ? weights.directApply : 0, weights.directApply,
    job.isDirectApplication ? 'applies directly with the employer' : 'application goes via a third party',
    job.isDirectApplication ? 'Direct application' : undefined)

  /* --- company quality: deliberately small --- */
  const val = job.companyValuationUsd ?? 0
  const companyPoints = val >= 1e9 ? weights.companyQuality : val > 0 ? weights.companyQuality * 0.6 : weights.companyQuality * 0.3
  push('companyQuality', companyPoints, weights.companyQuality,
    val ? `company valued at $${(val / 1e9).toFixed(1)}B` : 'company valuation unknown')

  /* --- salary constraint --- */
  if (intent.salaryMin) {
    const top = job.salaryMax ?? job.salaryMin ?? 0
    if (top >= intent.salaryMin) reasons.push('Meets salary')
    // Salary is a filter rather than a ranking signal: an undisclosed salary
    // must not be punished, since most postings never state one.
  }

  /* --- duplicate penalty --- */
  if ((job.duplicateConfidence ?? 0) > 0.9) {
    push('duplicatePenalty', weights.duplicatePenalty, 0, 'merged from multiple sources')
  }

  const total = signals.reduce((sum, s) => sum + s.points, 0)
  return {
    score: Math.max(0, Math.min(100, Math.round(total * 10) / 10)),
    signals: signals.sort((a, b) => b.points - a.points),
    matchReasons: [...new Set(reasons)].slice(0, 5),
  }
}

/** One-line explanation of the top contributors, for the debug view (§53). */
export function explainRank(result: RankedResult): string {
  return result.signals
    .filter((s) => s.points > 0.5)
    .slice(0, 5)
    .map((s) => `${s.signal} +${s.points} (${s.reason})`)
    .join(' · ')
}
