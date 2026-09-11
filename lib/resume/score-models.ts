import type { ScoreModel, Score, ScoreComponent, RequirementMatch } from './types'

/**
 * Score model registry.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The brief asks for a scoring framework rather than a formula, and warns that
 * moving a constant into a database is not enough. The distinction this file
 * draws is:
 *
 *   - a WEIGHT is data, owned by a named, versioned model;
 *   - a SCORE always names the model that produced it;
 *   - a model with no calibration record produces scores marked
 *     `confidence: 'uncalibrated'` and `precision: 'integer'`.
 *
 * That last point is the mechanical guard against fake precision. Today no
 * model here is calibrated, because we have no labelled outcome data -- so
 * every score this system emits is currently an integer with a caveat. That is
 * the honest state, and the type system makes it the DEFAULT rather than
 * something a careful engineer has to remember.
 *
 * WHY THERE IS NO "OVERALL RESUME SCORE"
 * --------------------------------------
 * There is deliberately no model that scores a resume in the abstract. A resume
 * is not good or bad on its own -- it is well or poorly matched to a target.
 * The single-number "78/100 resume score" in the current UI is not merely
 * uncalibrated, it scores a question with no answer. Every model below requires
 * a target job.
 */

export const SCORE_MODELS: Record<string, ScoreModel> = {
  /**
   * Evidence coverage: what share of the job's requirements does the resume
   * actually demonstrate, weighted by how much each requirement matters.
   *
   * This is the most defensible number in the system because both inputs are
   * observable: the requirement came from the posting, the evidence came from
   * the resume, and a human can check both.
   */
  'requirement-coverage': {
    id: 'requirement-coverage',
    version: '1.0.0',
    status: 'active',
    dimensions: [
      // Weights encode how much a support level counts as coverage. They are
      // heuristic priors, labelled as such, and are the thing calibration
      // would replace first.
      { key: 'direct', weight: 1.0, source: 'heuristic' },
      { key: 'strong', weight: 0.7, source: 'heuristic' },
      { key: 'weak', weight: 0.3, source: 'heuristic' },
      { key: 'insufficient', weight: 0.0, source: 'heuristic' },
      { key: 'absent', weight: 0.0, source: 'heuristic' },
    ],
    calibration: null,
    methodology:
      'Importance-weighted share of target-job requirements with supporting evidence in the ' +
      'resume. Requirement importance is read from the posting\'s own language where it is ' +
      'explicit, and from corpus term statistics otherwise.',
    createdAt: '2026-09-11',
  },

  /**
   * Mandatory coverage, reported separately and on purpose.
   *
   * Averaging a missing hard requirement into a broad score hides the one thing
   * that actually disqualifies an application. A candidate at 85% overall who
   * is missing a stated must-have is not an 85% candidate.
   */
  'mandatory-coverage': {
    id: 'mandatory-coverage',
    version: '1.0.0',
    status: 'active',
    dimensions: [
      { key: 'direct', weight: 1.0, source: 'heuristic' },
      { key: 'strong', weight: 0.7, source: 'heuristic' },
      { key: 'weak', weight: 0.2, source: 'heuristic' },
      { key: 'insufficient', weight: 0.0, source: 'heuristic' },
      { key: 'absent', weight: 0.0, source: 'heuristic' },
    ],
    calibration: null,
    methodology:
      'Coverage restricted to requirements the posting explicitly marks as required. Reported ' +
      'separately so a missing hard requirement is never averaged away.',
    createdAt: '2026-09-11',
  },

  /**
   * Preferred ("nice to have") coverage, reported as its own axis.
   *
   * This is the other half of the dual-axis rule, and it exists to stop a
   * specific deception: a candidate who matches eight nice-to-haves and misses
   * two must-haves looks strong on any blended score, and is in fact a weak
   * applicant. Optional strengths must never be able to disguise a missing core
   * requirement, so they are never summed into the same number.
   *
   * Reading the two axes together is the point:
   *   mandatory 100 / preferred  20  -> qualified, could be positioned better
   *   mandatory  40 / preferred 100  -> enthusiastic, probably not qualified
   * A single blended score renders both as "60" and tells the user nothing.
   */
  'preferred-coverage': {
    id: 'preferred-coverage',
    version: '1.0.0',
    status: 'active',
    dimensions: [
      { key: 'direct', weight: 1.0, source: 'heuristic' },
      { key: 'strong', weight: 0.7, source: 'heuristic' },
      { key: 'weak', weight: 0.3, source: 'heuristic' },
      { key: 'insufficient', weight: 0.0, source: 'heuristic' },
      { key: 'contradicted', weight: 0.0, source: 'heuristic' },
      { key: 'absent', weight: 0.0, source: 'heuristic' },
    ],
    calibration: null,
    methodology:
      'Coverage restricted to requirements the posting marks as preferred, desirable or a bonus. ' +
      'Reported on its own axis so optional strengths cannot mask missing mandatory requirements.',
    createdAt: '2026-09-11',
  },
}

const SUPPORT_KEY: Record<string, string> = {
  DIRECT: 'direct', STRONG: 'strong', WEAK: 'weak',
  INSUFFICIENT: 'insufficient', CONTRADICTED: 'contradicted', ABSENT: 'absent',
}

/** Look up a model, or throw -- a score must never be produced anonymously. */
export function getModel(id: string): ScoreModel {
  const m = SCORE_MODELS[id]
  if (!m) throw new Error(`Unknown score model "${id}". Register it in score-models.ts.`)
  if (m.status === 'retired') throw new Error(`Score model "${id}" is retired.`)
  return m
}

/**
 * Compute a coverage score from evidence.
 *
 * Every component carries the explanation of what it contributed, so the
 * resulting number can be rendered as a breakdown rather than a verdict.
 */
export function scoreCoverage(
  matches: RequirementMatch[],
  modelId: 'requirement-coverage' | 'mandatory-coverage' | 'preferred-coverage' = 'requirement-coverage'
): Score | null {
  const model = getModel(modelId)

  const scope =
    modelId === 'mandatory-coverage' ? matches.filter((m) => m.requirement.mandatory === true)
    : modelId === 'preferred-coverage' ? matches.filter((m) => m.requirement.mandatory === false)
    : matches

  // No requirements in scope means the question does not apply. Returning null
  // is the honest answer; returning 0 would read as "you match nothing".
  if (scope.length === 0) return null

  const weightOf = (key: string) =>
    model.dimensions.find((d) => d.key === key)?.weight ?? 0

  let earned = 0
  let possible = 0
  const perLevel: Record<string, { count: number; earned: number }> = {}

  for (const m of scope) {
    // An unscored requirement (importance 0) still occupies the denominator at
    // a nominal weight -- dropping it entirely would let a posting full of
    // unrecognised terms score 100% on the two terms we happened to understand.
    const imp = m.requirement.importance > 0 ? m.requirement.importance : 0.1
    const key = SUPPORT_KEY[m.support]
    const w = weightOf(key)
    earned += imp * w
    possible += imp
    perLevel[key] ??= { count: 0, earned: 0 }
    perLevel[key].count++
    perLevel[key].earned += imp * w
  }

  const ratio = possible > 0 ? earned / possible : 0

  const components: ScoreComponent[] = model.dimensions
    .filter((d) => perLevel[d.key]?.count)
    .map((d) => ({
      key: d.key,
      value: possible > 0 ? perLevel[d.key].earned / possible : 0,
      weight: d.weight,
      contribution: possible > 0 ? (perLevel[d.key].earned / possible) * 100 : 0,
      explanation:
        `${perLevel[d.key].count} requirement${perLevel[d.key].count === 1 ? '' : 's'} with ` +
        `${d.key} evidence, counted at ${d.weight}x`,
    }))

  const caveats: string[] = []
  if (!model.calibration) {
    caveats.push(
      'This model has not been calibrated against hiring outcomes. Treat it as a measure of ' +
      'requirement coverage, not as a prediction of interview success.'
    )
  }
  const unscored = scope.filter((m) => m.requirement.importance === 0).length
  if (unscored > 0) {
    caveats.push(
      `${unscored} requirement${unscored === 1 ? ' has' : 's have'} no importance estimate, ` +
      'so their weight in this score is a placeholder.'
    )
  }

  return {
    // Integer, because an uncalibrated model cannot justify a decimal.
    value: Math.round(ratio * 100),
    model: { id: model.id, version: model.version },
    components,
    confidence: model.calibration ? 'medium' : 'uncalibrated',
    precision: model.calibration ? 'decimal' : 'integer',
    caveats,
  }
}
