/**
 * False-positive and false-negative suite for skill evidence.
 *
 * WHY THIS IS A SEPARATE SUITE
 * ----------------------------
 * A false positive here is the product's worst failure mode. Telling a
 * candidate they match a requirement they do not match sends them into an
 * interview unprepared, or worse, encourages them to put a skill on a resume
 * they cannot defend. That is a strictly worse outcome than saying nothing, so
 * it gets its own suite and its own budget of attention.
 *
 * Each case is a sentence that CONTAINS the skill token but does not assert the
 * candidate's experience with it. A naive `includes()` matcher passes zero of
 * these. Cases are drawn from the false-positive inventory in the brief (§25).
 *
 * The second half guards the opposite error: over-correcting until real
 * experience stops counting. Both directions are tested because a suite that
 * only tests one is an invitation to fix it by breaking the other.
 */

import { mapEvidence } from '../lib/resume/evidence.ts'
import { classifyAssertion } from '../lib/resume/assertion.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const req = (term) => ({
  term, normalized: term.toLowerCase(), importance: 0.8, mandatory: true, sourceQuote: 'x',
  importanceBasis: { basis: 'explicit-language', provenance: { kind: 'job-posting', location: 'l1' }, detail: 'd' },
})

/** Support level for `term` given a one-line resume. */
const supportOf = (line, term) => mapEvidence(line, [req(term)])[0].support
/** The evidence reasoning, for checking the explanation is usable. */
const reasonOf = (line, term) => mapEvidence(line, [req(term)])[0].evidence?.[0]?.reasoning ?? ''

console.log('\n--- FALSE POSITIVES: must NOT count as the candidate\'s experience ---\n')

/* ------------------------------- negation --------------------------------- */
const NEGATED = [
  ['No hands-on experience with Kubernetes', 'Kubernetes'],
  ['Not experienced with AWS', 'AWS'],
  ['Never worked with Terraform', 'Terraform'],
  ['Lacks exposure to Kubernetes', 'Kubernetes'],
  ['Built services without Docker', 'Docker'],
  ['Comfortable with everything other than Rust', 'Rust'],
]
for (const [line, term] of NEGATED) {
  const s = supportOf(line, term)
  t(`negated: "${line}"`, s === 'CONTRADICTED', { got: s })
}

/* ------------------------------ aspirational ------------------------------ */
const ASPIRATIONAL = [
  ['Interested in learning Rust', 'Rust'],
  ['Currently learning Kubernetes', 'Kubernetes'],
  ['Looking to move into Go development', 'Go'],
  ['Seeking opportunities involving Scala', 'Scala'],
]
for (const [line, term] of ASPIRATIONAL) {
  const s = supportOf(line, term)
  t(`aspirational: "${line}"`, s === 'INSUFFICIENT', { got: s })
}

/* ---------------------------- somebody else's ----------------------------- */
const THIRD_PARTY = [
  ['Managed a team of Python developers', 'Python'],
  ['Worked with engineers who used Kubernetes', 'Kubernetes'],
  ['Led a team that built the Terraform platform', 'Terraform'],
  ['Coordinated with vendors using Salesforce', 'Salesforce'],
]
for (const [line, term] of THIRD_PARTY) {
  const s = supportOf(line, term)
  t(`third-party: "${line}"`, s === 'INSUFFICIENT', { got: s })
}

/* -------------------------------- not prose ------------------------------- */
const NOT_PROSE = [
  ['Contact: kubernetes-admin@example.com', 'Kubernetes'],
  ['Portfolio: https://github.com/me/react-utils', 'React'],
  ['Email: python.dev@mail.com', 'Python'],
]
for (const [line, term] of NOT_PROSE) {
  const s = supportOf(line, term)
  t(`not prose: "${line}"`, s === 'INSUFFICIENT', { got: s })
}

/* -------------------------------- historical ------------------------------ */
const HISTORICAL = [
  ['Previously used Java, no longer working with it', 'Java'],
  ['Migrated away from Jenkins to GitHub Actions', 'Jenkins'],
]
for (const [line, term] of HISTORICAL) {
  const s = supportOf(line, term)
  t(`historical: "${line}"`, s === 'WEAK', { got: s })
}

/* --------------------------- token false positives ------------------------ */
const TOKEN_TRAPS = [
  ['Worked at Google on search infrastructure', 'Go', 'ABSENT'],
  ['Studied at Javeriana University', 'Java', 'ABSENT'],
  ['Strong track record in research', 'R', 'ABSENT'],
  ['Reacted quickly to production incidents', 'React', 'ABSENT'],
  ['Worked on a Rustic Furniture e-commerce site', 'Rust', 'ABSENT'],
]
for (const [line, term, want] of TOKEN_TRAPS) {
  const s = supportOf(line, term)
  t(`token trap: "${term}" in "${line}"`, s === want, { got: s })
}

console.log('\n--- FALSE NEGATIVES: real experience must still count ---\n')

const REAL = [
  ['Designed and deployed a Kubernetes platform for 40 services', 'Kubernetes', 'DIRECT'],
  ['Built payment infrastructure in Python', 'Python', 'DIRECT'],
  ['Automated provisioning with Terraform', 'Terraform', 'DIRECT'],
  ['Migrated 40 services to Go', 'Go', 'DIRECT'],
]
for (const [line, term, want] of REAL) {
  const s = supportOf(line, term)
  t(`real experience: "${line}"`, s === want, { got: s })
}

/* ------------------- clause scope: the NegEx failure mode ------------------ */
//
// A fixed-window negation scanner over-negates across clause boundaries. These
// are the cases that distinguish clause-bounded scope from a word window.
{
  const line = 'No production experience with Rust, though I built services in Go'
  t('negation does not leak past a comma (Go stays affirmed)',
    supportOf(line, 'Go') === 'DIRECT', { got: supportOf(line, 'Go') })
  t('negation still applies within its own clause (Rust contradicted)',
    supportOf(line, 'Rust') === 'CONTRADICTED', { got: supportOf(line, 'Rust') })
}
{
  const line = 'No experience with Rust and Scala'
  // `and` is deliberately NOT a clause boundary: the negation distributes.
  t('negation distributes across "and"',
    supportOf(line, 'Scala') === 'CONTRADICTED', { got: supportOf(line, 'Scala') })
}
{
  const line = 'Limited exposure to Kubernetes but deep experience with Docker'
  // The property under test is that the hedge does not REACH Docker, i.e. it is
  // not downgraded to WEAK. It lands on STRONG rather than DIRECT because the
  // clause states experience without naming work performed -- DIRECT is
  // reserved for an ownership verb ("built", "migrated"). That distinction is
  // deliberate, so assert the boundary rather than a specific positive grade.
  t('hedge does not leak past "but"',
    ['DIRECT', 'STRONG'].includes(supportOf(line, 'Docker')), { got: supportOf(line, 'Docker') })
  t('hedge applies within its clause',
    supportOf(line, 'Kubernetes') === 'WEAK', { got: supportOf(line, 'Kubernetes') })
}

/* --------------------- ownership verb must not override -------------------- */
{
  // The line contains "built", a strong ownership verb, but the team did it.
  const line = 'Led a team that built the Kubernetes platform'
  t('attribution beats an ownership verb in the same line',
    supportOf(line, 'Kubernetes') === 'INSUFFICIENT', { got: supportOf(line, 'Kubernetes') })
}

/* ------------------------- explanations are usable ------------------------ */
{
  const why = reasonOf('No hands-on experience with Kubernetes', 'Kubernetes')
  t('a rejection explains itself in plain language', /denies/i.test(why), why)
  t('the explanation quotes the trigger that decided it', /"/.test(why), why)
}

/* --------------------------- assertion unit checks ------------------------ */
{
  const line = 'Interested in learning Rust'
  const idx = line.indexOf('Rust')
  const a = classifyAssertion(line, idx, idx + 4)
  t('classifyAssertion reports the class', a.assertion === 'ASPIRATIONAL', a)
  t('classifyAssertion names its trigger', typeof a.trigger === 'string' && a.trigger.length > 0, a)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
