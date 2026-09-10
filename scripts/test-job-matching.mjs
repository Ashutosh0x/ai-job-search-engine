/**
 * Regression checks for the job matching scorer.
 *
 * Each case documents a concrete defect in the previous implementation. Run:
 *   node scripts/test-job-matching.mjs
 *
 * Written against the compiled logic via tsx/esbuild-free re-implementation is
 * not possible here, so this imports the TS source through Node's type
 * stripping (Node 22+) or can be run with `npx tsx scripts/test-job-matching.mjs`.
 */
import { scoreJob, parseSalary, parseExperience } from '../lib/job-scoring.ts'

let passed = 0
let failed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
  }
}

function checkThat(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name} ${detail}`)
  }
}

console.log('\nparseSalary')
// OLD BUG: "$50,000 - $80,000" produced min 50,000,000 because the code
// multiplied by 1000 unconditionally after stripping the "k".
check('absolute figures are not multiplied', parseSalary('$50,000 - $80,000'), { min: 50000, max: 80000 })
check('k suffix expands', parseSalary('$50k - $80k'), { min: 50000, max: 80000 })
check('bare small numbers read as thousands', parseSalary('50 - 80'), { min: 50000, max: 80000 })
check('unparseable returns null', parseSalary('Competitive'), null)
check('missing returns null', parseSalary(null), null)

console.log('\nparseExperience')
check('range', parseExperience('3-5 years'), { min: 3, max: 5 })
check('open ended', parseExperience('5+ years'), { min: 5, max: 50 })
check('seniority word', parseExperience('Senior'), { min: 5, max: 10 })
check('unparseable returns null', parseExperience('n/a'), null)

console.log('\nscoreJob: weight renormalisation')
// OLD BUG: weights were only added when a field existed but the total was
// never rescaled, so a job missing salary could not score above 85 even on a
// perfect match, and one missing salary AND location capped at 65.
{
  const perfectButSparse = {
    id: 'a',
    requirements: { skills: ['React', 'TypeScript'] },
    // no experience, no location, no salary
  }
  const profile = { skills: ['React', 'TypeScript'], experience: '', location: '', salary: 0 }
  const m = scoreJob(perfectButSparse, profile)
  checkThat('perfect match on the only available signal scores 100', m.score === 100, `got ${m.score}`)
  check('only the skills signal applied', m.appliedSignals, ['skills'])
}

console.log('\nscoreJob: skill ratio cannot exceed 100')
// OLD BUG: matches were counted from the user's skill list but divided by the
// job's requirement count, so overlapping user skills produced >100%.
{
  const job = { id: 'b', requirements: { skills: ['React'] } }
  const profile = { skills: ['React', 'React Native', 'react'], experience: '', location: '', salary: 0 }
  const m = scoreJob(job, profile)
  checkThat('skillMatch clamped to 100', m.skillMatch <= 100, `got ${m.skillMatch}`)
}

console.log('\nscoreJob: no NaN from empty requirements')
// OLD BUG: an empty skills array divided by zero, producing NaN that
// propagated into the final score.
{
  const job = { id: 'c', requirements: { skills: [] }, experience: '3-5 years' }
  const profile = { skills: ['React'], experience: '4 years', location: '', salary: 0 }
  const m = scoreJob(job, profile)
  checkThat('score is a real number', Number.isFinite(m.score), `got ${m.score}`)
}

console.log('\nscoreJob: substring false positives')
// OLD BUG: bidirectional includes() meant "Java" matched "JavaScript".
{
  const job = { id: 'd', requirements: { skills: ['JavaScript'] } }
  const javaOnly = scoreJob(job, { skills: ['Java'], experience: '', location: '', salary: 0 })
  checkThat('Java does not satisfy a JavaScript requirement', javaOnly.skillMatch === 0, `got ${javaOnly.skillMatch}`)

  const jsAlias = scoreJob(job, { skills: ['JS'], experience: '', location: '', salary: 0 })
  checkThat('JS does satisfy a JavaScript requirement', jsAlias.skillMatch === 100, `got ${jsAlias.skillMatch}`)
}

console.log('\nscoreJob: location is categorical, not a fake distance')
// OLD BUG: calculateLocationDistance returned a constant 50 for anything that
// was not a substring match, which landed in the "< 100" branch and awarded a
// flat 75/100 "within reasonable distance" to every unrelated location.
{
  const job = { id: 'e', location: 'Berlin, Germany' }
  const far = scoreJob(job, { skills: [], experience: '', location: 'Austin, TX, USA', salary: 0 })
  checkThat('unrelated location scores low', far.locationMatch <= 25, `got ${far.locationMatch}`)

  const same = scoreJob(job, { skills: [], experience: '', location: 'Berlin, Germany', salary: 0 })
  checkThat('same location scores 100', same.locationMatch === 100, `got ${same.locationMatch}`)

  const remote = scoreJob({ id: 'f', location: 'Remote' }, { skills: [], experience: '', location: 'Anywhere', salary: 0 })
  checkThat('remote scores 100', remote.locationMatch === 100, `got ${remote.locationMatch}`)

  // "York" must not match "New York".
  const york = scoreJob({ id: 'g', location: 'York, UK' }, { skills: [], experience: '', location: 'New York, USA', salary: 0 })
  checkThat('York does not match New York', york.locationMatch <= 25, `got ${york.locationMatch}`)
}

console.log('\nscoreJob: salary shortfall stays in range')
// OLD BUG: (wanted - max)/1000 drove the score negative for large gaps.
{
  const job = { id: 'h', salary: '$40,000 - $50,000' }
  const m = scoreJob(job, { skills: [], experience: '', location: '', salary: 500000 })
  checkThat('big shortfall does not go negative', m.salaryMatch >= 0 && m.salaryMatch <= 100, `got ${m.salaryMatch}`)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
