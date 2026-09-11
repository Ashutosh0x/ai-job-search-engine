import type { Requirement, RequirementMatch, Evidence, SupportLevel, Confidence } from './types'
import { classifyAssertion, type AssertionResult } from './assertion'

/**
 * Evidence mapping: requirement -> the resume text that supports it.
 *
 * THE CORE RULE
 * -------------
 * A match is never asserted without the span that proves it. `Evidence` cannot
 * be constructed without a `quote`, so "you match Kubernetes" always comes with
 * the line from the resume that says so, and the user can disagree with the
 * evidence rather than with an opaque verdict.
 *
 * WHY SUBSTRING MATCHING IS NOT ENOUGH, AND WHAT WE DO INSTEAD
 * -----------------------------------------------------------
 * Naive `includes()` is how resume tools embarrass themselves: "R" matches
 * every word containing the letter, "Go" matches "Google", "Java" satisfies
 * "JavaScript". This module matches on word boundaries and treats a
 * requirement as satisfied by an exact token run only.
 *
 * Semantic equivalence is deliberately NOT inferred here. The brief is explicit
 * that similarity must not automatically mean equivalence, and a resume is
 * exactly where a false equivalence does damage -- telling someone they cover a
 * requirement they do not is worse than telling them nothing. Related-but-not-
 * equal terms surface as INSUFFICIENT with the near-miss quoted, which is an
 * invitation to the user to confirm rather than a claim on their behalf.
 */

/** Locate whole-token occurrences of `term` in `text`. */
function findSpans(text: string, term: string): { start: number; end: number }[] {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Word-boundary at both ends, but \b fails around "c++" and "c#", so use
  // explicit lookarounds on characters that can legitimately sit in a term.
  const re = new RegExp(`(?<![a-z0-9+#.])${escaped}(?![a-z0-9+#])`, 'gi')
  const out: { start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length })
    if (out.length >= 5) break
  }
  return out
}

/** The line containing an offset, plus where the line starts, for scoping. */
function lineAt(
  text: string,
  offset: number
): { quote: string; line: number; lineStart: number; raw: string } {
  const before = text.lastIndexOf('\n', offset) + 1
  const afterIdx = text.indexOf('\n', offset)
  const after = afterIdx === -1 ? text.length : afterIdx
  const line = text.slice(0, before).split('\n').length
  const raw = text.slice(before, after)
  return { quote: raw.trim().slice(0, 300), line, lineStart: before, raw }
}

/**
 * Does the surrounding sentence assert the candidate DID this, or merely
 * mention it? "Familiar with Kubernetes" and "Migrated 40 services to
 * Kubernetes" are both matches, but they are not equally strong, and a resume
 * tool that cannot tell them apart is not reading the resume.
 */
const OWNERSHIP = /\b(built|designed|led|architected|implemented|migrated|shipped|owned|developed|created|delivered|scaled|automated|deployed|maintained|operated|reduced|improved|increased|launched)\b/i

/**
 * Grade one mention, given how it is asserted.
 *
 * Assertion is checked FIRST and dominates. A line can contain a strong
 * ownership verb and still not be evidence -- "Managed a team that built the
 * Kubernetes platform" has `built` in it, and the candidate still did not do
 * the Kubernetes work. Letting the ownership verb win there is precisely the
 * false positive this module exists to prevent.
 */
function supportFor(
  sentence: string,
  inSkillsList: boolean,
  assertion: AssertionResult
): { support: SupportLevel; why: string } {
  switch (assertion.assertion) {
    case 'NEGATED':
      // Not "absent" -- the resume actively says no. That is worth surfacing.
      return { support: 'CONTRADICTED', why: assertion.reasoning }
    case 'ASPIRATIONAL':
    case 'THIRD_PARTY':
    case 'NOT_PROSE':
      return { support: 'INSUFFICIENT', why: assertion.reasoning }
    case 'HISTORICAL':
    case 'HEDGED':
      return { support: 'WEAK', why: assertion.reasoning }
  }

  if (OWNERSHIP.test(sentence)) {
    return { support: 'DIRECT', why: 'Used in a bullet describing work the candidate performed' }
  }
  if (inSkillsList) {
    // A skills list is a claim without a demonstration. Real, but weaker than
    // the same term appearing inside an accomplishment.
    return { support: 'STRONG', why: 'Listed in a skills section, but not demonstrated in an experience bullet' }
  }
  return { support: 'STRONG', why: 'Appears in the resume body' }
}

/** Lines that look like a skills inventory rather than an accomplishment. */
function skillsListLines(text: string): Set<number> {
  const out = new Set<number>()
  const lines = text.split('\n')
  let inSkills = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l) continue
    if (/^(technical\s+)?(skills?|technologies|tech\s+stack|competencies|tools)\b/i.test(l) && l.length < 60) {
      inSkills = true
      out.add(i + 1)
      continue
    }
    // A new heading ends the skills block.
    if (inSkills && /^[A-Z][A-Z\s&/'-]{3,}$/.test(l)) { inSkills = false; continue }
    if (inSkills) out.add(i + 1)
    // A comma-dense line is a skills list wherever it appears.
    else if ((l.match(/,/g)?.length ?? 0) >= 4 && l.length < 300) out.add(i + 1)
  }
  return out
}

export interface MapOptions {
  /** Terms the user has explicitly confirmed. Outranks textual inference. */
  confirmed?: Set<string>
}

export function mapEvidence(
  resumeText: string,
  requirements: Requirement[],
  opts: MapOptions = {}
): RequirementMatch[] {
  const skillLines = skillsListLines(resumeText)
  const confirmed = opts.confirmed ?? new Set<string>()

  return requirements.map((requirement) => {
    if (confirmed.has(requirement.normalized)) {
      return {
        requirement,
        support: 'DIRECT' as SupportLevel,
        evidence: [{
          quote: requirement.term,
          location: 'user-confirmed',
          support: 'DIRECT' as SupportLevel,
          confidence: 'high' as Confidence,
          reasoning: 'The candidate confirmed this directly',
        }],
      }
    }

    const spans = findSpans(resumeText, requirement.normalized)

    if (spans.length === 0) {
      // Before declaring absence, check for a near miss so the result can say
      // "you have X, the job asks for Y" instead of a bare gap. This is the
      // one place we look at similarity, and it explicitly does NOT count as
      // coverage -- it becomes a question for the user.
      const near = nearMiss(resumeText, requirement.normalized)
      if (near) {
        return {
          requirement,
          support: 'INSUFFICIENT' as SupportLevel,
          evidence: [{
            quote: near.quote,
            location: `line ${near.line}`,
            support: 'INSUFFICIENT' as SupportLevel,
            confidence: 'low' as Confidence,
            reasoning:
              `The resume mentions "${near.found}", which is related to "${requirement.term}" ` +
              'but is not the same thing. Confirm whether this counts.',
          }],
        }
      }
      return { requirement, support: 'ABSENT' as SupportLevel, evidence: [] }
    }

    const evidence: Evidence[] = spans.map((s) => {
      const { quote, line, lineStart, raw } = lineAt(resumeText, s.start)
      // Classify against the RAW line with in-line offsets, so a trigger's
      // clause scope is measured against the text exactly as written.
      const assertion = classifyAssertion(raw, s.start - lineStart, s.end - lineStart)
      const { support, why } = supportFor(raw, skillLines.has(line), assertion)
      return {
        quote,
        location: `line ${line}`,
        support,
        confidence:
          support === 'DIRECT' || support === 'CONTRADICTED' ? 'high'
          : support === 'WEAK' || support === 'INSUFFICIENT' ? 'low'
          : 'medium',
        reasoning: why,
      }
    })

    // CONTRADICTED sits above ABSENT but below any positive evidence: if one
    // line denies a skill and another demonstrates it, the demonstration wins
    // and the contradiction stays visible in the evidence list.
    const order: SupportLevel[] = ['DIRECT', 'STRONG', 'WEAK', 'INSUFFICIENT', 'CONTRADICTED', 'ABSENT']
    const best = evidence.reduce(
      (acc, e) => (order.indexOf(e.support) < order.indexOf(acc) ? e.support : acc),
      'ABSENT' as SupportLevel
    )

    return { requirement, support: best, evidence: evidence.slice(0, 3) }
  })
}

/**
 * A term in the resume that shares a token with the requirement.
 *
 * Deliberately shallow: shared-token, not embedding similarity. It exists to
 * raise a question, not to award credit, so a cheap signal is the right one --
 * and a cheap signal cannot be mistaken for a semantic guarantee.
 */
function nearMiss(text: string, term: string): { quote: string; line: number; found: string } | null {
  const parts = term.split(' ').filter((p) => p.length > 3)
  if (!parts.length) return null
  for (const p of parts) {
    const spans = findSpans(text, p)
    if (spans.length) {
      const { quote, line } = lineAt(text, spans[0].start)
      return { quote, line, found: p }
    }
  }
  return null
}

/** Requirements the resume does not settle, ranked by what it costs to leave. */
export function gaps(matches: RequirementMatch[]): RequirementMatch[] {
  const weak: SupportLevel[] = ['WEAK', 'INSUFFICIENT', 'CONTRADICTED', 'ABSENT']
  return matches
    .filter((m) => weak.includes(m.support))
    .sort((a, b) => b.requirement.importance - a.requirement.importance)
}
