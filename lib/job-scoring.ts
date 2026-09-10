/**
 * Job matching.
 *
 * Shape of the pipeline (standard two-stage recommender):
 *
 *   1. RETRIEVAL  - cheap, runs in Postgres, narrows the corpus to a few
 *                   hundred plausible rows using full-text search plus hard
 *                   filters (location, work type, salary floor).
 *   2. RANKING    - richer per-candidate scoring in application code over that
 *                   shortlist only.
 *
 * The previous implementation had no retrieval stage at all: it did
 * `select('*')` over the whole jobs table with no limit, pulled every row into
 * memory and scored all of them on every request. That is fine for a seed
 * dataset and falls over the moment the table is real.
 *
 * Scoring correctness is the other half. See `scoreJob` for the specific
 * defects that were fixed; they systematically distorted results rather than
 * just being imprecise.
 */

export interface JobMatch {
  jobId: string
  score: number
  reasons: string[]
  skillMatch: number
  experienceMatch: number
  locationMatch: number
  salaryMatch: number
  /** Which signals actually contributed, so the score is explainable. */
  appliedSignals: string[]
}

export interface UserProfile {
  skills: string[]
  experience: string
  location: string
  /** Desired minimum salary in whole currency units (not thousands). */
  salary: number
  preferences?: Record<string, any>
}

/** Relative importance of each signal. Only the signals we can actually
 *  evaluate for a given job are used, and the weights are renormalised over
 *  those -- see scoreJob. */
const WEIGHTS = {
  skills: 0.4,
  experience: 0.25,
  location: 0.2,
  salary: 0.15,
} as const

/* -------------------------------------------------------------------------- */
/* Parsing helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Parse a free-text salary range into whole currency units.
 *
 * The old version did `parseInt(x.replace(/[$,k]/gi,'')) * 1000` and so
 * multiplied by 1000 whether or not a "k" suffix was present: "$50,000"
 * became 50,000,000. It also stripped the "k" before it could be detected.
 * Here the suffix is detected per-number, before stripping.
 */
export function parseSalary(salary: string | null | undefined): { min: number; max: number } | null {
  if (!salary) return null

  const matches = [...String(salary).matchAll(/(\d[\d,.]*)\s*(k|m)?\b/gi)]
  if (matches.length === 0) return null

  const values = matches
    .map((m) => {
      const digits = Number(m[1].replace(/,/g, ''))
      if (!Number.isFinite(digits)) return NaN
      const suffix = (m[2] || '').toLowerCase()
      if (suffix === 'k') return digits * 1_000
      if (suffix === 'm') return digits * 1_000_000
      // A bare number under 1000 in a salary field almost always means
      // thousands ("50 - 80"); above that it is already absolute.
      return digits < 1000 ? digits * 1_000 : digits
    })
    .filter((n) => Number.isFinite(n) && n > 0)

  if (values.length === 0) return null
  if (values.length === 1) {
    // Single figure: treat as a point estimate with a modest band.
    return { min: values[0] * 0.9, max: values[0] * 1.1 }
  }
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** Parse "3-5 years", "5+ years", "senior" into a year range. */
export function parseExperience(experience: string | null | undefined): { min: number; max: number } | null {
  if (!experience) return null
  const text = String(experience).toLowerCase()

  const years = text.match(/\d+/g)
  if (years && years.length >= 2) {
    const nums = years.map(Number).filter((n) => n <= 50)
    if (nums.length >= 2) return { min: Math.min(...nums), max: Math.max(...nums) }
  }
  if (years && years.length === 1) {
    const n = Number(years[0])
    if (n <= 50) {
      // "5+" is open-ended; a bare "5" implies a band around it.
      return /\+|\bor more\b|\bplus\b/.test(text) ? { min: n, max: 50 } : { min: n, max: n + 2 }
    }
  }

  // Fall back to seniority words when no number is present.
  if (/\bintern(ship)?\b/.test(text)) return { min: 0, max: 1 }
  if (/\b(entry|junior|graduate|new grad)\b/.test(text)) return { min: 0, max: 2 }
  if (/\b(mid|intermediate)\b/.test(text)) return { min: 2, max: 5 }
  if (/\bsenior\b/.test(text)) return { min: 5, max: 10 }
  if (/\b(staff|principal|lead|director)\b/.test(text)) return { min: 8, max: 50 }

  return null
}

/** Normalise a skill for comparison: lowercase, strip punctuation/spacing. */
function normalizeSkill(skill: string): string {
  return String(skill).toLowerCase().replace(/[^a-z0-9+#.]/g, '')
}

/**
 * Common aliases so "JS" matches "JavaScript". Deliberately small and explicit:
 * a hand-maintained alias table beats fuzzy substring matching, which is what
 * produced the "Java matches JavaScript" class of false positive here.
 */
const SKILL_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  golang: 'go',
  postgres: 'postgresql',
  py: 'python',
  k8s: 'kubernetes',
  reactjs: 'react',
  nodejs: 'node',
  'node.js': 'node',
  cpp: 'c++',
  csharp: 'c#',
  ml: 'machinelearning',
  ai: 'artificialintelligence',
}

function canonicalSkill(skill: string): string {
  const n = normalizeSkill(skill)
  return SKILL_ALIASES[n] ?? n
}

/**
 * Do two skills refer to the same thing?
 *
 * The old code used bidirectional `includes()`, so "Java" matched
 * "JavaScript", "R" matched every skill containing an r, and a user listing
 * both "React" and "React Native" double-counted against a single required
 * "React". Exact match on canonical form, with word-boundary containment only
 * for multi-word skills, avoids all three.
 */
function skillsEqual(a: string, b: string): boolean {
  const ca = canonicalSkill(a)
  const cb = canonicalSkill(b)
  if (!ca || !cb) return false
  if (ca === cb) return true
  // Allow "amazonwebservices" vs "aws"-style containment only when the shorter
  // token is long enough that containment is meaningful.
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca]
  return short.length >= 5 && long.includes(short)
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Score a single job against a profile, 0-100.
 *
 * Fixes relative to the previous implementation:
 *
 *  - WEIGHT RENORMALISATION. Weights were added to the total only when the
 *    corresponding field existed, but the total was never rescaled. A job with
 *    no salary listed could therefore never score above 85, and one missing
 *    salary and location capped at 65 -- so sparser postings were ranked below
 *    richer ones regardless of fit. Now the applicable weights are renormalised
 *    to sum to 1.
 *  - SKILL RATIO OVERFLOW. skillMatch counted matches from the *user's* skill
 *    list but divided by the *job's* requirement count, so a user with many
 *    overlapping skills could score >100% on one requirement. Now it counts
 *    distinct job requirements satisfied.
 *  - DIVISION BY ZERO. An empty requirements array produced NaN, which
 *    propagated through the total and made the whole score NaN.
 *  - LOCATION UNITS. The old helper returned a constant 50 for anything that
 *    was not a substring match, which fell into the `< 100` branch and gave
 *    every non-matching job a flat 75/100 "reasonable distance". Location is
 *    now a categorical match (exact / same region / remote / unknown) rather
 *    than pretending to compute a distance it never had the data for.
 */
export function scoreJob(job: any, profile: UserProfile): JobMatch {
  const reasons: string[] = []
  const appliedSignals: string[] = []
  const parts: { weight: number; value: number }[] = []

  let skillMatch = 0
  let experienceMatch = 0
  let locationMatch = 0
  let salaryMatch = 0

  // ---- Skills -------------------------------------------------------------
  const rawJobSkills = job?.requirements?.skills
  const jobSkills: string[] = Array.isArray(rawJobSkills)
    ? rawJobSkills.filter(Boolean)
    : rawJobSkills
      ? [rawJobSkills]
      : []
  const userSkills = (profile.skills || []).filter(Boolean)

  if (jobSkills.length > 0 && userSkills.length > 0) {
    // Count distinct *job requirements* covered, never user skills, so the
    // ratio cannot exceed 1.
    const covered = jobSkills.filter((js) => userSkills.some((us) => skillsEqual(us, js)))
    skillMatch = (covered.length / jobSkills.length) * 100
    parts.push({ weight: WEIGHTS.skills, value: skillMatch })
    appliedSignals.push('skills')

    if (covered.length > 0) {
      reasons.push(
        `Matches ${covered.length} of ${jobSkills.length} required skills: ${covered.slice(0, 5).join(', ')}`
      )
    } else {
      reasons.push('No listed skills overlap with the requirements')
    }
  }

  // ---- Experience ---------------------------------------------------------
  const jobExp = parseExperience(job?.experience)
  const userExp = parseExperience(profile.experience)
  if (jobExp && userExp) {
    const userYears = userExp.max // most favourable reading of the candidate
    if (userYears >= jobExp.min && userYears <= jobExp.max) {
      experienceMatch = 100
      reasons.push('Experience level matches the requirement')
    } else if (userYears > jobExp.max) {
      // Overqualified is a mild penalty, not a disqualification.
      experienceMatch = 85
      reasons.push('More experience than required')
    } else {
      const shortfall = jobExp.min - userYears
      experienceMatch = Math.max(0, 100 - shortfall * 20)
      reasons.push(`About ${shortfall} year${shortfall === 1 ? '' : 's'} short of the requirement`)
    }
    parts.push({ weight: WEIGHTS.experience, value: experienceMatch })
    appliedSignals.push('experience')
  }

  // ---- Location -----------------------------------------------------------
  const jobLocation = String(job?.location ?? '').trim()
  const userLocation = String(profile.location ?? '').trim()
  const isRemote = /\bremote\b|\banywhere\b/i.test(`${jobLocation} ${job?.work_type ?? ''}`)

  if (isRemote) {
    locationMatch = 100
    reasons.push('Remote role')
    parts.push({ weight: WEIGHTS.location, value: locationMatch })
    appliedSignals.push('location')
  } else if (jobLocation && userLocation) {
    const jl = jobLocation.toLowerCase()
    const ul = userLocation.toLowerCase()
    // Compare on comma-separated components (city / region / country) rather
    // than raw substring, so "York" does not match "New York".
    const jParts = jl.split(',').map((x) => x.trim()).filter(Boolean)
    const uParts = ul.split(',').map((x) => x.trim()).filter(Boolean)
    const shared = jParts.filter((x) => uParts.includes(x))

    if (jl === ul || (shared.length > 0 && shared[0] === jParts[0])) {
      locationMatch = 100
      reasons.push('Same location')
    } else if (shared.length > 0) {
      locationMatch = 70
      reasons.push('Same region')
    } else {
      locationMatch = 20
      reasons.push('Different location -- may require relocation')
    }
    parts.push({ weight: WEIGHTS.location, value: locationMatch })
    appliedSignals.push('location')
  }

  // ---- Salary -------------------------------------------------------------
  const jobSalary = parseSalary(job?.salary)
  const wanted = Number(profile.salary)
  if (jobSalary && Number.isFinite(wanted) && wanted > 0) {
    if (jobSalary.min >= wanted) {
      salaryMatch = 100
      reasons.push('Salary meets expectations')
    } else if (jobSalary.max >= wanted) {
      // Partial credit scaled by where the expectation falls in the band.
      const span = Math.max(1, jobSalary.max - jobSalary.min)
      salaryMatch = 60 + 40 * ((jobSalary.max - wanted) / span)
      reasons.push('Salary range reaches expectations')
    } else {
      // Proportional shortfall rather than the old "/1000" which produced a
      // near-zero score for any gap over 100k and negative values beyond that.
      const ratio = jobSalary.max / wanted
      salaryMatch = Math.max(0, ratio * 100 - 40)
      reasons.push('Salary below expectations')
    }
    salaryMatch = Math.min(100, Math.max(0, salaryMatch))
    parts.push({ weight: WEIGHTS.salary, value: salaryMatch })
    appliedSignals.push('salary')
  }

  // ---- Combine ------------------------------------------------------------
  // Renormalise over the signals we could actually evaluate.
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0)
  const score = totalWeight > 0
    ? parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight
    : 0

  return {
    jobId: job?.id,
    score: Math.round(Math.min(100, Math.max(0, score))),
    reasons,
    skillMatch: Math.round(skillMatch),
    experienceMatch: Math.round(experienceMatch),
    locationMatch: Math.round(locationMatch),
    salaryMatch: Math.round(salaryMatch),
    appliedSignals,
  }
}
