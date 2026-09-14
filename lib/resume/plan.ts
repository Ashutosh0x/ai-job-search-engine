/**
 * The layout-independent resume document model.
 *
 * WHY THIS EXISTS
 * ---------------
 * There are two renderers -- LaTeX for export, PDF for the live preview -- and
 * they must never disagree. If each did its own selection and ordering, the
 * preview would eventually show a different document from the one the user
 * downloads, and that bug would be nearly invisible until someone sent the
 * wrong resume to an employer.
 *
 * So selection happens exactly once, here, producing an ordered model. Both
 * renderers are then dumb: they draw what the plan says, in the order the plan
 * says, and make no decisions of their own.
 *
 * The plan also carries the reasoning -- which requirement each kept bullet
 * evidences, and why each dropped bullet was dropped -- so the UI can explain
 * itself from the same source the document was built from.
 */

import type { ParsedResume } from './parse'
import type { AnalysisResult } from './types'

export interface PlannedBullet {
  text: string
  score: number
  /** Requirement terms this bullet evidences. Empty is normal, not a failure. */
  matched: string[]
}

export interface PlannedRole {
  title: string | null
  organization: string | null
  dates: string | null
  location: string | null
  bullets: PlannedBullet[]
  dropped: { text: string; reason: string }[]
}

export interface PlannedEducation {
  institution: string | null
  credential: string | null
  dates: string | null
}

export interface ResumePlan {
  contact: {
    name: string | null
    email: string | null
    phone: string | null
    location: string | null
    links: string[]
  }
  /** Ordered so posting-relevant skills lead. Never invented. */
  skills: string[]
  roles: PlannedRole[]
  education: PlannedEducation[]
  /** Requirements the posting states that nothing in the resume evidences. */
  unevidencedRequirements: string[]
  warnings: string[]
}

export interface PlanOptions {
  maxBulletsPerRole?: number
  dropIrrelevantRoles?: boolean
  includeSkills?: boolean
}

/* ------------------------------- ranking ---------------------------------- */

export interface RankedBullet {
  text: string
  score: number
  matched: string[]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Score one bullet against the job's requirements.
 *
 * Deliberately transparent arithmetic rather than embedding similarity: the
 * user is about to send this document to an employer and is entitled to know
 * exactly why a bullet was promoted or dropped. `matched` carries the terms
 * that fired, so the UI can show the reason beside the bullet.
 *
 * Importance comes from the requirement extractor, which reads it from the
 * posting's own language or from corpus lift -- never a constant.
 */
export function scoreBullet(
  bullet: string,
  requirements: { normalized: string; term: string; importance: number }[],
): RankedBullet {
  const hay = ` ${bullet.toLowerCase()} `
  let score = 0
  const matched: string[] = []

  for (const r of requirements) {
    const needle = r.normalized.toLowerCase().trim()
    if (!needle) continue
    // Word-boundary containment. Substring matching makes "R" match "Rust" and
    // "Go" match "Google", which is how keyword scorers end up nonsense.
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(needle)}([^a-z0-9+#.]|$)`, 'i')
    if (re.test(hay)) {
      // An unscored requirement still counts for ordering, weakly -- it is in
      // the posting, so a bullet evidencing it beats one evidencing nothing.
      // It must not outrank a requirement carrying real measured weight.
      score += r.importance > 0 ? r.importance : 0.05
      matched.push(r.term)
    }
  }

  // A mild preference for bullets carrying a measured outcome. Quantified
  // bullets are not automatically better, so this is a tiebreak, not a factor.
  if (/\b\d+(\.\d+)?\s*(%|x\b|k\b|m\b|bn\b|ms\b|s\b|hours?|days?|users?|requests?)/i.test(bullet)) {
    score += 0.08
  }

  return { text: bullet, score, matched }
}

/**
 * Collapse overlapping n-grams into the longest phrase that covers them.
 *
 * The requirement extractor emits overlapping windows, so one posting line
 * about Kafka yields "kafka", "event", "streaming", "kafka event" and
 * "event streaming" as five separate requirements. That is right for matching
 * -- more windows means more chances to find evidence -- but showing all five
 * to a user as five distinct gaps is noise.
 *
 * A term is dropped when its words appear consecutively inside another term
 * that survived. Word-level rather than substring, so "go" is not swallowed by
 * "golang" and "scale" is not swallowed by "scaled".
 */
export function collapseSubPhrases(terms: string[]): string[] {
  const uniq = [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
  // Longest first, so a covering phrase is always considered before the
  // fragments it would absorb.
  const sorted = [...uniq].sort(
    (a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length,
  )

  const kept: string[] = []
  for (const term of sorted) {
    const words = term.toLowerCase().split(/\s+/)
    const covered = kept.some((k) => {
      const kw = k.toLowerCase().split(/\s+/)
      if (words.length > kw.length) return false
      for (let i = 0; i + words.length <= kw.length; i++) {
        if (words.every((w, j) => kw[i + j] === w)) return true
      }
      return false
    })
    if (!covered) kept.push(term)
  }
  // Restore the caller's ordering, which follows the posting.
  return uniq.filter((t) => kept.includes(t))
}

/* -------------------------------- planning -------------------------------- */

export function planResume(
  parsed: ParsedResume,
  analysis: AnalysisResult | null,
  opts: PlanOptions = {},
): ResumePlan {
  const {
    maxBulletsPerRole = 4,
    dropIrrelevantRoles = false,
    includeSkills = true,
  } = opts

  const warnings: string[] = [...parsed.warnings]
  const reqs = (analysis?.requirements ?? []).map((r) => ({
    normalized: r.normalized,
    term: r.term,
    importance: r.importance,
  }))

  if (!reqs.length) {
    warnings.push(
      'No job requirements were available, so bullets are kept in their original ' +
      'order and nothing was prioritised. Paste a job description to target the resume.',
    )
  }

  /* --- skills: posting-relevant first, none invented --- */
  let skills: string[] = []
  if (includeSkills && parsed.skills.length) {
    const wanted = new Set(reqs.map((r) => r.normalized.toLowerCase()))
    const hit = parsed.skills.filter((s) => wanted.has(s.toLowerCase()))
    const rest = parsed.skills.filter((s) => !wanted.has(s.toLowerCase()))
    skills = [...hit, ...rest]
  }

  /* --- roles in document order, bullets by relevance --- */
  const roles: PlannedRole[] = []
  for (const role of parsed.experience) {
    const ranked = role.bullets
      .map((b) => scoreBullet(b, reqs))
      .sort((a, b) => b.score - a.score)

    const take = ranked.slice(0, maxBulletsPerRole)
    const over = ranked.slice(maxBulletsPerRole)
    const relevant = take.some((b) => b.score > 0)

    if (dropIrrelevantRoles && reqs.length && !relevant) {
      roles.push({
        title: role.title,
        organization: role.organization,
        dates: role.dates?.raw ?? null,
        location: role.location,
        bullets: [],
        dropped: role.bullets.map((t) => ({
          text: t,
          reason: 'No bullet in this role matched any requirement in the posting.',
        })),
      })
      continue
    }

    roles.push({
      title: role.title,
      organization: role.organization,
      dates: role.dates?.raw ?? null,
      location: role.location,
      bullets: take.map((b) => ({
        text: b.text,
        score: Number(b.score.toFixed(3)),
        matched: b.matched,
      })),
      dropped: over.map((b) => ({
        text: b.text,
        reason: b.score > 0
          ? `Matched ${b.matched.join(', ')} but ranked below the top ${maxBulletsPerRole}.`
          : 'Matched no requirement in the posting.',
      })),
    })
  }

  /* --- what the posting asked for that this resume cannot evidence --- */
  const hay = `${parsed.bullets.map((b) => b.text).join(' ')} ${parsed.skills.join(' ')}`.toLowerCase()
  const unevidenced = reqs
    .filter((r) => {
      const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(r.normalized.toLowerCase())}([^a-z0-9+#.]|$)`, 'i')
      return !re.test(hay)
    })
    .map((r) => r.term)

  return {
    contact: {
      name: parsed.contact.name,
      email: parsed.contact.email,
      phone: parsed.contact.phone,
      location: parsed.contact.location,
      links: parsed.contact.links.map((l) => l.url),
    },
    skills,
    roles,
    education: parsed.education.map((e) => ({
      institution: e.institution,
      credential: e.credential,
      dates: e.dates?.raw ?? null,
    })),
    unevidencedRequirements: collapseSubPhrases(unevidenced),
    warnings,
  }
}
