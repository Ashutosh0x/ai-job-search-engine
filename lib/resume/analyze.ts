import { extractRequirements, type TermStats } from './requirements'
import { mapEvidence, gaps } from './evidence'
import { scoreCoverage } from './score-models'
import type { AnalysisResult, Recommendation, RequirementMatch, Score } from './types'

/**
 * The analysis entry point.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * Without a target job, this returns requirements: [] and scores: [] rather
 * than an "overall resume score". That is not a limitation, it is the finding
 * from the audit: match is a two-argument relation, and the current product
 * supplies one argument and invents the other. A resume is not good or bad in
 * the abstract; it is well or poorly matched to something.
 *
 * Callers that want a number without a job must be told no, because the
 * alternative -- what the existing UI does -- is to show 78% to everybody.
 */

export interface AnalyzeInput {
  resumeText: string
  /** The target job. Without it, no match or score is produced. */
  job?: { text: string; title?: string } | null
  stats?: TermStats | null
  /** Terms the user has confirmed they have, which outrank textual inference. */
  confirmed?: string[]
}

export function analyze(input: AnalyzeInput): AnalysisResult {
  const { resumeText, job = null, stats = null, confirmed = [] } = input
  const generatedAt = new Date().toISOString()
  const unknowns: string[] = []

  if (!resumeText?.trim()) {
    return {
      targetJob: null, requirements: [], matches: [], coverage: null,
      scores: [], recommendations: [], questions: [],
      unknowns: ['No resume text was supplied, so nothing could be analysed.'],
      generatedAt,
    }
  }

  if (!job?.text?.trim()) {
    return {
      targetJob: null, requirements: [], matches: [], coverage: null, scores: [],
      recommendations: [],
      questions: ['Which role are you targeting? Paste a job description to see how this resume matches it.'],
      unknowns: [
        'No target job was supplied. Requirement coverage, match score and gap analysis all ' +
        'compare a resume against a specific job, so none of them can be computed here.',
      ],
      generatedAt,
    }
  }

  if (!stats) {
    unknowns.push(
      'Corpus term statistics were unavailable, so requirement importance falls back to the ' +
      "posting's own wording only. Requirements the posting does not mark explicitly are unscored."
    )
  }

  const requirements = extractRequirements(job.text, { stats, title: job.title ?? '' })
  if (requirements.length === 0) {
    unknowns.push(
      'No requirements could be extracted from the job description. It may be very short, or ' +
      'formatted in a way this parser does not recognise.'
    )
  }

  const matches = mapEvidence(resumeText, requirements, { confirmed: new Set(confirmed) })

  const covered = matches.filter((m) => m.support === 'DIRECT' || m.support === 'STRONG').length
  const totalImportance = matches.reduce((s, m) => s + (m.requirement.importance || 0.1), 0)
  const coveredImportance = matches
    .filter((m) => m.support === 'DIRECT' || m.support === 'STRONG')
    .reduce((s, m) => s + (m.requirement.importance || 0.1), 0)

  const scores: Score[] = []
  const overall = scoreCoverage(matches, 'requirement-coverage')
  if (overall) scores.push(overall)
  const mandatory = scoreCoverage(matches, 'mandatory-coverage')
  if (mandatory) scores.push(mandatory)
  else if (requirements.some((r) => r.mandatory === true) === false) {
    unknowns.push(
      'The posting does not explicitly mark any requirement as required, so mandatory coverage ' +
      'cannot be reported separately.'
    )
  }

  const { recommendations, questions } = buildRecommendations(matches)

  return {
    targetJob: { title: job.title ?? null, source: 'user-supplied' },
    requirements,
    matches,
    coverage: {
      covered,
      total: matches.length,
      weightedCoverage: totalImportance > 0
        ? Number((coveredImportance / totalImportance).toFixed(3))
        : 0,
    },
    scores,
    recommendations,
    questions,
    unknowns,
    generatedAt,
  }
}

/**
 * Recommendations, ranked and cut dynamically.
 *
 * The brief forbids "always show five". The number returned here is whatever
 * survives a benefit threshold, so a resume that covers the job well returns
 * few or none -- which is the correct answer, and one a fixed-count UI can
 * never give.
 *
 * Where an improvement needs a fact the resume does not contain, this emits a
 * QUESTION rather than a suggestion. That is the anti-fabrication mechanism:
 * the system never tells someone to "add metrics", because it cannot know their
 * metrics. It asks.
 */
function buildRecommendations(
  matches: RequirementMatch[]
): { recommendations: Recommendation[]; questions: string[] } {
  const recommendations: Recommendation[] = []
  const questions: string[] = []
  const missing = gaps(matches)

  for (const m of missing) {
    const imp = m.requirement.importance
    const r = m.requirement

    // CONTRADICTED is a distinct and more actionable finding than a gap: the
    // resume actively says the candidate does not have this.
    if (m.support === 'CONTRADICTED') {
      recommendations.push({
        id: `contradicted-${r.normalized}`,
        title: `Your resume states you do not have "${r.term}", which the posting asks for`,
        detail:
          'This is not a gap in the writing -- the resume explicitly says so. Either this role ' +
          'is a poor fit, or the statement is out of date and worth revisiting.',
        relatesTo: r.term,
        expectedBenefit: 0.9 + imp,
        confidence: 'high',
        basis: m.evidence[0] ? `Resume says: "${m.evidence[0].quote.slice(0, 160)}"` : '',
      })
      continue
    }

    if (m.support === 'ABSENT') {
      if (r.mandatory === true) {
        recommendations.push({
          id: `missing-mandatory-${r.normalized}`,
          // Phrasing matters. We cannot know the candidate lacks a skill, only
          // that we did not find it in the document we were given. "You don't
          // have Kubernetes" is a claim about a person; "not found in the
          // supplied resume" is a claim about the evidence, and only the second
          // one is true.
          title: `"${r.term}" was not found in the supplied resume, and the posting requires it`,
          detail:
            'This is stated as a requirement rather than a preference. If you have this ' +
            'experience, it needs to appear explicitly. If you do not, this role may be a stretch.',
          relatesTo: r.term,
          // Mandatory gaps dominate: a hard miss is not comparable to a soft one.
          expectedBenefit: 1 + imp,
          confidence: 'high',
          basis: `Posting says: "${r.sourceQuote.slice(0, 160)}"`,
          question: `Do you have experience with ${r.term}? If so, where?`,
        })
        questions.push(`"${r.term}" was not found in your resume and the posting lists it as required. Do you have this experience?`)
      } else if (imp >= 0.4) {
        recommendations.push({
          id: `missing-${r.normalized}`,
          title: `"${r.term}" was not found in the supplied resume`,
          detail: r.importanceBasis.detail,
          relatesTo: r.term,
          expectedBenefit: imp,
          confidence: r.importanceBasis.basis === 'corpus-lift' ? 'medium' : 'high',
          basis: `Posting says: "${r.sourceQuote.slice(0, 160)}"`,
          question: `Have you worked with ${r.term}?`,
        })
      }
    }

    if (m.support === 'INSUFFICIENT' && m.evidence[0]) {
      questions.push(
        `The posting asks for "${r.term}". Your resume says "${m.evidence[0].quote.slice(0, 120)}" ` +
        '- does that cover it?'
      )
    }

    if (m.support === 'WEAK' && imp >= 0.4) {
      recommendations.push({
        id: `weak-${r.normalized}`,
        title: `"${r.term}" appears, but the wording understates it`,
        detail:
          m.evidence[0]?.reasoning ??
          'The mention is present but hedged, so a reader cannot tell how deep the experience goes.',
        relatesTo: r.term,
        expectedBenefit: imp * 0.6,
        confidence: 'medium',
        basis: m.evidence[0] ? `Resume says: "${m.evidence[0].quote.slice(0, 160)}"` : '',
        question: `What did you actually build or do with ${r.term}?`,
      })
    }
  }

  // Rank by expected benefit, then cut where the marginal item stops being
  // worth the user's attention. The cut is relative to the best item, so a
  // strong resume yields a short list and a weak one a longer one.
  recommendations.sort((a, b) => b.expectedBenefit - a.expectedBenefit)
  const best = recommendations[0]?.expectedBenefit ?? 0
  const kept = recommendations.filter((r) => r.expectedBenefit >= Math.max(0.25, best * 0.2))

  return { recommendations: kept, questions: [...new Set(questions)].slice(0, 8) }
}
