/**
 * Assertion detection: does this mention actually assert the candidate's own
 * experience?
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Finding the token "Kubernetes" in a resume is not evidence that the candidate
 * has used Kubernetes. All of these contain the token and none of them assert
 * the candidate's experience:
 *
 *   "No hands-on experience with Kubernetes"          negated
 *   "Interested in learning Kubernetes"               aspirational
 *   "Worked with engineers who used Kubernetes"       somebody else's skill
 *   "Managed a team of Kubernetes developers"         somebody else's skill
 *   "Previously used Kubernetes, no longer do"        historical
 *   "kubernetes-admin@example.com"                    not prose at all
 *
 * A matcher that counts any of these as a skill produces a confident false
 * positive -- it tells the user they match a requirement they do not, which is
 * worse than telling them nothing, because they act on it.
 *
 * WHY CLAUSE-BOUNDED SCOPE RATHER THAN A FIXED WINDOW
 * ---------------------------------------------------
 * The standard algorithm here is NegEx, which scans a fixed window of N words
 * after a trigger. Its documented failure mode is exactly that fixed window:
 * with several entities in range it over-negates, and the follow-up work
 * (DEEPEN) fixed this by consulting a dependency parse.
 *
 * We have no dependency parser and will not ship one for this, so we use the
 * cheap structural approximation that captures most of the benefit: a trigger's
 * scope ends at a CLAUSE boundary -- comma, semicolon, conjunction, dash,
 * sentence end. That gets the case a fixed window gets wrong:
 *
 *   "No production experience with Rust, though I built services in Go"
 *    └────── negation scope ends at the comma ──────┘
 *
 * Go is correctly left affirmed. A 6-word window would have swallowed it.
 *
 * EVERY CLASSIFICATION IS REPORTED, NEVER SILENTLY DROPPED
 * -------------------------------------------------------
 * A negated mention is not discarded -- it becomes CONTRADICTED, which is a
 * distinct and more useful answer than "not found". "Your resume explicitly
 * says you have not used Kubernetes" is worth showing.
 */

export type Assertion =
  /** The candidate asserts this as their own experience. */
  | 'AFFIRMED'
  /** Explicitly denied: "no experience with X". */
  | 'NEGATED'
  /** Real but qualified: "familiar with", "basic", "exposure to". */
  | 'HEDGED'
  /** Wants it, does not have it: "interested in learning X". */
  | 'ASPIRATIONAL'
  /** Somebody else's skill: "a team of X developers". */
  | 'THIRD_PARTY'
  /** Held previously, disclaimed now: "no longer working with X". */
  | 'HISTORICAL'
  /** Not prose: inside an email, URL, or company name. */
  | 'NOT_PROSE'

export interface AssertionResult {
  assertion: Assertion
  /** The trigger phrase that decided it -- the evidence for the evidence. */
  trigger: string | null
  /** Why, in language that can be shown to a user. */
  reasoning: string
}

/* ------------------------------- triggers --------------------------------- */
//
// These are statements about ENGLISH, not about recruiting. "no", "without" and
// "rather than" negate regardless of industry, and that does not change when
// the job market does. The line this codebase draws is: grammar may be
// enumerated, domain importance may not.

const NEGATION_PRE = [
  /\bno\b(?!\s+longer)/i, /\bnot\b/i, /\bnever\b/i, /\bwithout\b/i,
  /\black(?:s|ing|ed)?\b/i, /\bminimal\b/i, /\bzero\b/i,
  /\bdo(?:es)?n'?t\b/i, /\bhaven'?t\b/i, /\bhasn'?t\b/i, /\bunfamiliar\b/i,
  /\bother than\b/i, /\brather than\b/i, /\bapart from\b/i, /\bexcept\b/i,
]

const HEDGE_PRE = [
  /\bfamiliar(?:ity)?\s+with\b/i, /\bexposure\s+to\b/i, /\bbasic\b/i,
  /\bbeginner\b/i, /\bsome\b/i, /\blimited\b/i, /\bworking knowledge\b/i,
  /\bawareness of\b/i, /\bintroductory\b/i, /\bcoursework\b/i, /\bacademic\b/i,
  /\bself-?taught\b/i, /\btutorial\b/i, /\bbootcamp\b/i,
]

const ASPIRATIONAL_PRE = [
  /\b(?:interested|keen|eager|excited)\s+(?:in|to)\b/i,
  /\b(?:want|wish|hope|plan|aim|looking)\s+to\b/i,
  /\b(?:learning|studying|exploring|currently learning)\b/i,
  /\bwould like to\b/i, /\bseeking\b/i, /\baspir\w+\b/i,
  /\bgoal\b/i, /\bnext step\b/i,
]

const HISTORICAL_PRE = [
  /\bno longer\b/i, /\bformerly\b/i, /\bpreviously used\b/i, /\bin the past\b/i,
  /\bused to\b/i, /\bearlier in my career\b/i, /\blegacy\b/i, /\bdeprecated\b/i,
  /\bmigrat\w+\s+(?:away\s+)?from\b/i, /\bmoved away from\b/i, /\breplaced\b/i,
]

/**
 * Attribution to someone else.
 *
 * "Managed a team of Python developers" says the TEAM wrote Python. The
 * candidate managed. Both are true; only one is a Python skill, and conflating
 * them is how a manager's resume acquires every technology their reports used.
 */
const THIRD_PARTY_PRE = [
  /\b(?:team|engineers?|developers?|colleagues?|contractors?|vendors?|partners?|client'?s?|customer'?s?|they|others?)\s+(?:who\s+)?(?:used?|using|work\w*\s+(?:with|on)|built|wrote|maintain\w*)\b/i,
  /\bmanag\w+\s+(?:a\s+)?(?:team|group|squad|org\w*)\s+of\b/i,
  /\b(?:led|managed|supervised|coordinated)\s+(?:a\s+)?(?:team|group|squad)\b/i,
  /\bworked\s+(?:alongside|with)\s+(?:a\s+)?(?:team|engineers?|developers?)\b/i,
  /\bhired?\b/i, /\brecruit\w+\b/i, /\binterview\w*\s+candidates?\b/i,
  /\bstakeholders?\b/i,
]

/**
 * Clause boundary. A trigger's influence stops here.
 *
 * Includes coordinating conjunctions because "no Rust experience but strong Go"
 * must not negate Go. `and` is deliberately EXCLUDED: "no experience with Rust
 * and Go" negates both, and treating `and` as a boundary would wrongly affirm
 * Go.
 */
const CLAUSE_BOUNDARY = /[,;:.!?()\[\]]|\s+(?:but|however|though|although|while|whereas|yet|despite|besides)\s+|\s+[-–—]\s+/i

/** Does a trigger in `before` still reach the mention? */
function scopeReaches(before: string, triggerIndex: number): boolean {
  // Text between the end of the trigger and the mention.
  const between = before.slice(triggerIndex)
  return !CLAUSE_BOUNDARY.test(between)
}

function findTrigger(before: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    // Scan for the LAST occurrence, since the nearest trigger governs.
    let match: RegExpExecArray | null = null
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    let m: RegExpExecArray | null
    while ((m = global.exec(before))) match = m
    if (match && scopeReaches(before, match.index + match[0].length)) {
      return match[0].trim()
    }
  }
  return null
}

/* --------------------------- non-prose contexts --------------------------- */

/**
 * Is the mention inside something that is not a sentence?
 *
 * "kubernetes-admin@acme.com" and "github.com/user/react-utils" both contain
 * skill tokens that assert nothing about experience.
 */
function nonProseContext(line: string, start: number, end: number): string | null {
  // Email or URL spanning the mention.
  const patterns: [RegExp, string][] = [
    [/[\w.+-]+@[\w.-]+\.\w+/g, 'an email address'],
    [/(?:https?:\/\/|www\.)[^\s)]+/g, 'a URL'],
    [/\b[\w-]+\.(?:com|io|dev|net|org|ai|co)\b/g, 'a domain name'],
  ]
  for (const [re, label] of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m.index <= start && m.index + m[0].length >= end) return label
    }
  }
  return null
}

/**
 * Classify one mention of a term at a known offset within its line.
 *
 * `before` is everything on the line preceding the mention, which is where
 * English puts almost all of these triggers.
 */
export function classifyAssertion(
  line: string,
  start: number,
  end: number
): AssertionResult {
  const nonProse = nonProseContext(line, start, end)
  if (nonProse) {
    return {
      assertion: 'NOT_PROSE',
      trigger: nonProse,
      reasoning: `The term appears inside ${nonProse}, which says nothing about experience`,
    }
  }

  const before = line.slice(0, start)

  // Order matters: an explicit denial outranks a hedge, and an attribution to
  // someone else outranks an affirmation, because "managed a team of Go
  // developers" reads as affirmative until you notice who did the work.
  const checks: [RegExp[], Assertion, string][] = [
    [NEGATION_PRE, 'NEGATED', 'The resume explicitly denies this experience'],
    [ASPIRATIONAL_PRE, 'ASPIRATIONAL', 'Described as something the candidate wants to learn, not something they have done'],
    [HISTORICAL_PRE, 'HISTORICAL', 'Described as past or discontinued experience'],
    [THIRD_PARTY_PRE, 'THIRD_PARTY', 'Attributed to a team or other people rather than the candidate'],
    [HEDGE_PRE, 'HEDGED', 'Mentioned, but the wording qualifies the depth of experience'],
  ]

  for (const [patterns, assertion, reasoning] of checks) {
    const trigger = findTrigger(before, patterns)
    if (trigger) return { assertion, trigger, reasoning: `${reasoning} ("${trigger}")` }
  }

  return { assertion: 'AFFIRMED', trigger: null, reasoning: 'Stated as the candidate\'s own experience' }
}
