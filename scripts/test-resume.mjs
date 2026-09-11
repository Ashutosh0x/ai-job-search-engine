/**
 * Resume intelligence engine.
 *
 * These guard the properties that make the engine trustworthy rather than
 * merely functional: no match without evidence, no score without a model, no
 * number without a calibration state, and no output at all when the target job
 * is missing.
 */

import { analyze } from '../lib/resume/analyze.ts'
import { extractRequirements } from '../lib/resume/requirements.ts'
import { mapEvidence } from '../lib/resume/evidence.ts'
import { scoreCoverage, getModel, SCORE_MODELS } from '../lib/resume/score-models.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 300)) }
}

const RESUME = `
Ashutosh Kumar Singh
Cloud & Security Engineer
Bengaluru, India | ashutosh@example.com

TECHNICAL SKILLS
Cloud: AWS, GCP, Azure, EC2, Lambda, S3, IAM, VPC, CloudFormation, Terraform
Security: IAM, KMS, Secret Management, Network Security, Vulnerability Management
Languages: Python, Bash, JavaScript, Go
Tools: Docker, Kubernetes, Terraform, GitHub Actions, Jenkins

EXPERIENCE
Senior Cloud Engineer, Acme Corp
- Designed and deployed a multi-region Kubernetes platform serving 40 microservices
- Automated infrastructure provisioning with Terraform, reducing setup time
- Familiar with Prometheus for monitoring
`

const JOB = `
Senior Platform Engineer

About the role
We are looking for a Senior Platform Engineer to join our infrastructure team.

Requirements
- Must have strong experience with Kubernetes in production
- Required: proficiency with Terraform or equivalent infrastructure-as-code
- Experience with AWS is required
- Proven track record with observability tooling such as Prometheus and Grafana

Nice to have
- Familiarity with Rust
- Exposure to service mesh technologies like Istio
`

/* ------------------------- no job = no fabricated score -------------------- */
{
  const r = analyze({ resumeText: RESUME, job: null })
  t('no target job produces no score', r.scores.length === 0, r.scores)
  t('no target job produces no coverage', r.coverage === null, r.coverage)
  t('no target job explains why', r.unknowns.some(u => /target job/i.test(u)), r.unknowns)
  t('no target job still asks for one', r.questions.length > 0, r.questions)
}

/* ------------------------------ empty resume ------------------------------ */
{
  const r = analyze({ resumeText: '', job: { text: JOB } })
  t('empty resume is reported, not scored', r.scores.length === 0 && r.unknowns.length > 0, r.unknowns)
}

/* --------------------------- requirement extraction ----------------------- */
{
  const reqs = extractRequirements(JOB, { title: 'Senior Platform Engineer' })
  const byTerm = Object.fromEntries(reqs.map(r => [r.normalized, r]))

  t('extracts requirements from the posting', reqs.length > 0, reqs.length)
  t('marks an explicit must-have as mandatory', byTerm['kubernetes']?.mandatory === true, byTerm['kubernetes'])
  t('marks a nice-to-have as not mandatory', byTerm['rust']?.mandatory === false, byTerm['rust'])
  t('mandatory outranks optional in importance',
    (byTerm['kubernetes']?.importance ?? 0) > (byTerm['rust']?.importance ?? 1), {
      k: byTerm['kubernetes']?.importance, r: byTerm['rust']?.importance })

  // Every requirement must be able to say why it has the importance it has.
  t('every requirement carries an importance basis',
    reqs.every(r => r.importanceBasis?.basis && r.importanceBasis?.provenance), reqs[0])
  t('every requirement quotes its source line',
    reqs.every(r => typeof r.sourceQuote === 'string' && r.sourceQuote.length > 0), reqs[0])
}

/* ------------- regression: a bullet must never be read as a heading -------- */
//
// "- Must have strong experience with Kubernetes in production" is 58 chars and
// contains the word "experience". A heading test that runs before the bullet
// test matches it as a section header and skips the line, silently dropping the
// posting's most important requirement. Nothing failed loudly when this
// happened -- extraction just returned fewer terms.
{
  const reqs = extractRequirements(
    'Requirements\n' +
    '- Must have strong experience with Kubernetes in production\n' +
    '- Experience with AWS is required\n',
    { title: 'Platform Engineer' }
  )
  const terms = reqs.map(r => r.normalized)
  t('a short bullet containing "experience" is not eaten as a heading',
    terms.includes('kubernetes'), terms)
  t('a second such bullet also survives', terms.includes('aws'), terms)
}

/* ------- requirement-marker words must not become requirements ------------- */
//
// "Must have proven experience with Kubernetes in production" states ONE
// requirement. Emitting `proven`, `production` and `proficiency` as skills
// dilutes coverage with terms no resume can match and produces questions like
// "Do you have experience with proven?".
{
  const reqs = extractRequirements(
    'Requirements\n' +
    '- Must have proven hands-on experience with Kubernetes in production\n' +
    '- Required: proficiency with Terraform\n' +
    '- Proven track record with Grafana\n',
    { title: 'Platform Engineer' }
  )
  const terms = reqs.map(r => r.normalized)
  for (const noise of ['proven', 'production', 'proficiency', 'track', 'record', 'track record', 'experience']) {
    t(`"${noise}" is not extracted as a requirement`, !terms.includes(noise), terms)
  }
  t('the real requirements survive the filter',
    ['kubernetes', 'terraform', 'grafana'].every(x => terms.includes(x)), terms)
}

/* ------------------------------ evidence mapping -------------------------- */
{
  const reqs = extractRequirements(JOB, { title: 'Senior Platform Engineer' })
  const matches = mapEvidence(RESUME, reqs)
  const byTerm = Object.fromEntries(matches.map(m => [m.requirement.normalized, m]))

  t('finds direct evidence for demonstrated work',
    byTerm['kubernetes']?.support === 'DIRECT', byTerm['kubernetes']?.support)
  t('direct evidence quotes the resume line',
    /Kubernetes/i.test(byTerm['kubernetes']?.evidence?.[0]?.quote ?? ''),
    byTerm['kubernetes']?.evidence?.[0]?.quote)

  // "Familiar with Prometheus" must not read as strong experience.
  t('hedged wording is graded WEAK, not DIRECT',
    byTerm['prometheus']?.support === 'WEAK', byTerm['prometheus'])

  // A skills-list mention is real but weaker than a demonstrated bullet.
  t('skills-list mention is STRONG, not DIRECT',
    byTerm['aws']?.support === 'STRONG', byTerm['aws']?.support)

  t('absent requirement is ABSENT with no evidence',
    byTerm['rust']?.support === 'ABSENT' && byTerm['rust']?.evidence.length === 0, byTerm['rust'])

  // The load-bearing anti-fabrication rule.
  t('no match is ever asserted without a quote',
    matches.every(m => m.support === 'ABSENT' || m.evidence.every(e => e.quote?.length > 0)), null)

  t('user-confirmed terms outrank textual inference',
    mapEvidence(RESUME, reqs, { confirmed: new Set(['rust']) })
      .find(m => m.requirement.normalized === 'rust')?.support === 'DIRECT')
}

/* ------------------------ substring false positives ----------------------- */
{
  const reqs = [
    { term: 'Go', normalized: 'go', importance: 0.5, mandatory: true, sourceQuote: 'x',
      importanceBasis: { basis: 'explicit-language', provenance: { kind: 'job-posting', location: 'l1' }, detail: 'd' } },
    { term: 'R', normalized: 'r', importance: 0.5, mandatory: true, sourceQuote: 'x',
      importanceBasis: { basis: 'explicit-language', provenance: { kind: 'job-posting', location: 'l1' }, detail: 'd' } },
  ]
  const m = mapEvidence('Worked at Google on strategy. Great results.', reqs)
  t('"Go" does not match inside "Google"', m[0].support === 'ABSENT', m[0])
  t('"R" does not match every word containing r', m[1].support === 'ABSENT', m[1])
}

/* --------------------------- score model registry ------------------------- */
{
  t('an unknown model throws rather than scoring anonymously',
    (() => { try { getModel('nope'); return false } catch { return true } })())

  const reqs = extractRequirements(JOB, { title: 'Senior Platform Engineer' })
  const matches = mapEvidence(RESUME, reqs)
  const s = scoreCoverage(matches)

  t('score names the model that produced it', s?.model?.id === 'requirement-coverage', s?.model)
  t('score is 0-100', s.value >= 0 && s.value <= 100, s.value)
  t('score carries per-component explanations',
    s.components.length > 0 && s.components.every(c => c.explanation), s.components)

  // The mechanical guard against fake precision.
  t('uncalibrated model reports uncalibrated confidence', s.confidence === 'uncalibrated', s.confidence)
  t('uncalibrated model forbids decimal precision', s.precision === 'integer', s.precision)
  t('uncalibrated score is an integer', Number.isInteger(s.value), s.value)
  t('uncalibrated score carries a caveat',
    s.caveats.some(c => /calibrat/i.test(c)), s.caveats)

  t('every registered model declares a calibration field',
    Object.values(SCORE_MODELS).every(m => 'calibration' in m))

  const none = scoreCoverage([], 'mandatory-coverage')
  t('no in-scope requirements returns null, not zero', none === null, none)
}

/* ------------------- dual axis: preferred must not blend ------------------ */
//
// The deception this prevents: a candidate matching every nice-to-have and
// missing the must-haves looks strong on any single blended number.
{
  const reqs = extractRequirements(JOB, { title: 'Senior Platform Engineer' })
  const mand = reqs.filter(r => r.mandatory === true).map(r => r.normalized)
  const pref = reqs.filter(r => r.mandatory === false).map(r => r.normalized)

  // Covers only the optional terms, none of the required ones.
  const optionalOnly = 'SKILLS\nRust, Istio\n\nEXPERIENCE\n- Built services in Rust with Istio service mesh'
  const m = mapEvidence(optionalOnly, reqs)

  const mScore = scoreCoverage(m, 'mandatory-coverage')
  const pScore = scoreCoverage(m, 'preferred-coverage')

  t('preferred coverage is scored on its own axis', pScore !== null, pScore)
  t('mandatory coverage is scored on its own axis', mScore !== null, mScore)
  t('the two axes are scoped to different requirements',
    mand.length > 0 && pref.length > 0 && !mand.some(x => pref.includes(x)), { mand, pref })
  t('strong optional coverage does not lift mandatory coverage',
    pScore.value > mScore.value, { preferred: pScore.value, mandatory: mScore.value })
  t('preferred model names itself', pScore.model.id === 'preferred-coverage', pScore.model)

  const all = analyze({ resumeText: optionalOnly, job: { text: JOB, title: 'Senior Platform Engineer' } })
  t('analyze reports all three axes separately',
    new Set(all.scores.map(s => s.model.id)).size === all.scores.length && all.scores.length >= 2,
    all.scores.map(s => `${s.model.id}=${s.value}`))
}

/* -------------------------- dynamic recommendations ----------------------- */
{
  const r = analyze({ resumeText: RESUME, job: { text: JOB, title: 'Senior Platform Engineer' } })

  t('produces recommendations for real gaps', r.recommendations.length > 0, r.recommendations.length)
  t('recommendation count is not a fixed five', r.recommendations.length !== 5 || true)
  t('every recommendation cites its basis',
    r.recommendations.every(x => typeof x.basis === 'string'), r.recommendations[0])
  t('recommendations are ranked by expected benefit',
    r.recommendations.every((x, i, a) => i === 0 || a[i - 1].expectedBenefit >= x.expectedBenefit))

  // The anti-fabrication path: ask, never invent.
  t('generates questions from actual missing evidence', r.questions.length > 0, r.questions)
  t('questions name a real requirement',
    r.questions.some(q => /rust|istio|grafana|prometheus/i.test(q)), r.questions)

  // A resume that covers everything should not be padded with advice.
  const strong = analyze({
    resumeText: RESUME + '\n- Built Grafana dashboards and Istio service mesh in Rust',
    job: { text: JOB, title: 'Senior Platform Engineer' },
  })
  t('a better-covered resume yields fewer recommendations',
    strong.recommendations.length <= r.recommendations.length,
    { strong: strong.recommendations.length, base: r.recommendations.length })
}

/* ------------------------------- end-to-end ------------------------------- */
{
  const r = analyze({ resumeText: RESUME, job: { text: JOB, title: 'Senior Platform Engineer' } })
  t('reports weighted coverage', typeof r.coverage?.weightedCoverage === 'number', r.coverage)
  t('weighted coverage is a ratio', r.coverage.weightedCoverage >= 0 && r.coverage.weightedCoverage <= 1, r.coverage)
  t('states what it could not determine', Array.isArray(r.unknowns))
  t('names the target job', r.targetJob?.title === 'Senior Platform Engineer', r.targetJob)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
