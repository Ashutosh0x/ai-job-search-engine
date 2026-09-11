/**
 * Domain model for resume intelligence.
 *
 * THE SHAPE ENFORCES THE RULES
 * ----------------------------
 * The brief's hardest requirements are behavioural -- no fabrication, no fake
 * precision, no hardcoded importance -- and behavioural rules decay unless
 * something mechanical holds them up. So they are encoded here as types:
 *
 *   - `Evidence` has no constructor that omits `quote`. A claim about the
 *     candidate cannot be represented without the text it came from.
 *   - `Score` cannot exist without a `ScoreModelRef`, and a model whose
 *     `calibration` is null reports `confidence: 'uncalibrated'`. The UI reads
 *     that field to decide whether a decimal point is honest.
 *   - `Requirement.importance` always travels with `basis`, so "how do you know
 *     this matters?" has an answer at the point of use rather than in a doc.
 *
 * None of this prevents a determined caller from lying. It does prevent the
 * much more common failure: someone adding a field in six months and quietly
 * dropping the provenance because nothing forced them to carry it.
 */

/* ------------------------------- provenance ------------------------------- */

/**
 * How confident we are, expressed in bands rather than a float.
 *
 * Deliberately not a number. A 0-1 confidence invites `0.87` in the UI, which
 * implies a precision no part of this system can justify -- the brief calls
 * this out directly. Bands can be rendered honestly.
 */
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'

/** Where a fact came from. Every derived value carries one. */
export type Provenance =
  /** Read verbatim from the document. */
  | { kind: 'document'; location: string }
  /** Measured over the job corpus. Carries the sample it was measured on. */
  | { kind: 'corpus'; sampleSize: number; generatedAt: string }
  /** Stated explicitly in the target job description. */
  | { kind: 'job-posting'; location: string }
  /** Produced by a model. Names it, so a bad model is traceable. */
  | { kind: 'model'; model: string }
  /** Supplied or corrected by the user. Outranks everything else. */
  | { kind: 'user' }

/* -------------------------------- evidence -------------------------------- */

/**
 * How well a requirement is supported by the resume.
 *
 * `INSUFFICIENT` is not the same as `ABSENT`: the first means we looked and the
 * resume does not settle it, the second means the resume clearly lacks it. The
 * distinction drives whether we ask the user a question or report a gap.
 */
export type SupportLevel =
  | 'DIRECT'        // the resume states it as the candidate's own work
  | 'STRONG'        // asserted, but not demonstrated in an accomplishment
  | 'WEAK'          // present and hedged: "familiar with", "basic"
  | 'INSUFFICIENT'  // mentioned, but not as the candidate's own experience
  | 'CONTRADICTED'  // the resume explicitly denies it
  | 'ABSENT'        // nothing in the document bears on it

/**
 * Why a mention did not count.
 *
 * Kept separate from SupportLevel so the UI can say WHICH failure occurred --
 * "your resume says you have not used this" and "we could not find this" are
 * very different messages and only one of them is worth acting on.
 */
export type ExclusionReason =
  | 'negated' | 'aspirational' | 'third-party' | 'historical' | 'not-prose'

export interface Evidence {
  /** Verbatim span from the resume. Never a paraphrase -- this IS the proof. */
  quote: string
  /** Where in the document, so the user can find and check it. */
  location: string
  support: SupportLevel
  confidence: Confidence
  /** Plain-language reason this span was taken as evidence. */
  reasoning: string
}

/* ------------------------------ requirements ------------------------------ */

/**
 * Something the target job asks for.
 *
 * `importance` is an ESTIMATE and says so. It is never a constant: it comes
 * either from how the posting itself phrases the requirement, or from measured
 * corpus statistics, and `basis` records which.
 */
export interface Requirement {
  /** The term as the posting writes it. */
  term: string
  /** Normalised form used for matching. */
  normalized: string
  /** 0-1. An estimate, with its basis attached -- never a hardcoded weight. */
  importance: number
  importanceBasis: {
    /** Why this importance, in terms a reader can check. */
    basis: 'explicit-language' | 'repetition' | 'corpus-lift' | 'placement' | 'unscored'
    provenance: Provenance
    detail: string
  }
  /** Did the posting mark it required vs preferred? Null when it did not say. */
  mandatory: boolean | null
  /** The posting text this was read from. */
  sourceQuote: string
}

/* --------------------------------- match ---------------------------------- */

export interface RequirementMatch {
  requirement: Requirement
  evidence: Evidence[]
  /** Best support level across the evidence. */
  support: SupportLevel
}

/* -------------------------- score model registry -------------------------- */

/**
 * A named, versioned way of combining signals into a number.
 *
 * The registry exists so weights are DATA rather than constants in a function,
 * and so a score can always name the model that produced it. Adding a model
 * does not change product logic; switching models is a config change.
 */
export interface ScoreModel {
  id: string
  version: string
  status: 'active' | 'candidate' | 'retired'
  /** What it combines, and how much each contributes. */
  dimensions: {
    key: string
    weight: number
    /** Where the weight came from. `uniform` is honest about being a prior. */
    source: 'calibrated' | 'heuristic' | 'uniform'
  }[]
  /**
   * Null until the model has been evaluated against labelled outcomes. A null
   * here forces `confidence: 'uncalibrated'` on every score it produces, which
   * is what stops an uncalibrated number being printed as `78.4%`.
   */
  calibration: {
    dataset: string
    n: number
    metric: string
    value: number
  } | null
  methodology: string
  createdAt: string
}

export interface ScoreComponent {
  key: string
  /** Raw 0-1 signal before weighting. */
  value: number
  weight: number
  /** value * weight, i.e. what it actually contributed. */
  contribution: number
  /** Why this component has this value, generated from the analysis. */
  explanation: string
}

export interface Score {
  /** 0-100. Rounded to an integer when uncalibrated -- see `precision`. */
  value: number
  model: { id: string; version: string }
  components: ScoreComponent[]
  /**
   * 'uncalibrated' whenever the model has no calibration record. The UI must
   * not render decimals or a predictive interpretation in that state.
   */
  confidence: Confidence | 'uncalibrated'
  /** How many significant figures the model can justify. */
  precision: 'integer' | 'decimal'
  /** What would have to be true for this number to mean more. */
  caveats: string[]
}

/* ------------------------------ recommendations --------------------------- */

export interface Recommendation {
  id: string
  title: string
  detail: string
  /** The requirement or gap this addresses, so it is never generic advice. */
  relatesTo: string | null
  /** Estimated benefit, used for ranking. Not shown as a percentage. */
  expectedBenefit: number
  confidence: Confidence
  /** Evidence from the resume or posting that motivated this. */
  basis: string
  /**
   * A question to the user, when the improvement needs a fact we do not have.
   * This is how the system avoids inventing a metric: it asks instead.
   */
  question?: string
}

/* --------------------------------- result --------------------------------- */

export interface AnalysisResult {
  /** Null when no target job was supplied -- and then match is NOT computed. */
  targetJob: { title: string | null; source: string } | null
  requirements: Requirement[]
  matches: RequirementMatch[]
  coverage: {
    /** Requirements with DIRECT or STRONG support. */
    covered: number
    total: number
    /** Importance-weighted, which is the number that actually matters. */
    weightedCoverage: number
  } | null
  scores: Score[]
  recommendations: Recommendation[]
  /** Questions generated from real missing evidence, not a fixed questionnaire. */
  questions: string[]
  /** Everything the analysis could not determine, stated rather than hidden. */
  unknowns: string[]
  generatedAt: string
}
