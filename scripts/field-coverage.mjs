/**
 * How much of each field is actually populated in the served index.
 *
 *   node scripts/field-coverage.mjs
 *
 * WHY THIS RUNS BEFORE ANY UI WORK
 * --------------------------------
 * A redesign brief naturally assumes the data exists: salary bands, applicant
 * counts, company size, verification badges, match scores. Building a card that
 * shows "$80k-$110k · 12 applicants · Verified" against a corpus where those
 * fields are mostly null produces a UI that is empty in the common case and
 * misleading in the rest.
 *
 * So this measures first. Anything under ~20% coverage should be rendered
 * conditionally or not at all, and anything at 0% cannot be designed around no
 * matter how good the idea is.
 */

import { readFileSync, readdirSync } from 'fs'

const jobs = []
for (const f of readdirSync('public/data')) {
  if (!/^jobs-deploy.*\.json$/.test(f)) continue
  const j = JSON.parse(readFileSync(`public/data/${f}`, 'utf8'))
  jobs.push(...(Array.isArray(j) ? j : j.jobs || []))
}
if (!jobs.length) { console.error('no shards'); process.exit(1) }

const n = jobs.length
const has = (f) => {
  const c = jobs.filter(f).length
  return { c, pct: (100 * c / n).toFixed(1) }
}

const FIELDS = {
  'title':               (j) => j.title,
  'company':             (j) => j.company,
  'companyDomain':       (j) => j.companyDomain,
  'description (>200)':  (j) => (j.description || '').length > 200,
  'locationDisplay':     (j) => j.locationDisplay || j.locationRaw,
  'city':                (j) => j.city,
  'state':               (j) => j.state,
  'country':             (j) => j.country,
  'remote (true)':       (j) => j.remote === true || j.isRemote === true,
  'workplaceType known': (j) => j.workplaceType && j.workplaceType !== 'UNKNOWN',
  'employmentType':      (j) => j.employmentType,
  'department':          (j) => j.department,
  'seniority':           (j) => j.seniority,
  'earlyCareer':         (j) => j.earlyCareer,
  'skills (any)':        (j) => (j.skills || []).length > 0,
  'salaryMin':           (j) => typeof j.salaryMin === 'number',
  'salaryMax':           (j) => typeof j.salaryMax === 'number',
  'salaryCurrency':      (j) => j.salaryCurrency,
  'postedAt':            (j) => j.postedAt,
  'applicationUrl':      (j) => j.applicationUrl || j.applyUrl,
  'isDirectApplication': (j) => j.isDirectApplication === true,
  'visaStatus known':    (j) => j.visaStatus && j.visaStatus !== 'SPONSORSHIP_NOT_MENTIONED',
  'qualityScore':        (j) => typeof j.qualityScore === 'number',
  'freshnessScore':      (j) => typeof j.freshnessScore === 'number',
  'ghostRisk':           (j) => typeof j.ghostRisk === 'number',
  'companyValuationUsd': (j) => typeof j.companyValuationUsd === 'number',
  'sourceCount > 1':     (j) => (j.sourceCount ?? 1) > 1,
}

console.log(`index: ${n.toLocaleString('en-US')} postings\n`)
console.log('field                    populated      %')
for (const [name, fn] of Object.entries(FIELDS)) {
  const { c, pct } = has(fn)
  const bar = '#'.repeat(Math.round(Number(pct) / 5)).padEnd(20, '.')
  console.log(`  ${name.padEnd(22)} ${String(c).padStart(7)}  ${pct.padStart(5)}%  ${bar}`)
}

/* --------------------- what the brief asks for but is absent -------------- */
const ABSENT = {
  'applicant count':     (j) => j.applicantCount ?? j.applicants,
  'company size':        (j) => j.companySize ?? j.employeeCount,
  'equity':              (j) => j.equity,
  'employer verified':   (j) => j.employerVerified ?? j.verified,
  'geo coords':          (j) => j.lat ?? j.latitude,
  'closing date':        (j) => j.closingDate ?? j.expiresAt,
  'education required':  (j) => j.education ?? j.degreeRequired,
}
console.log('\nfields the brief assumes, checked against the data:')
for (const [name, fn] of Object.entries(ABSENT)) {
  const { c } = has(fn)
  console.log(`  ${name.padEnd(22)} ${String(c).padStart(7)}  ${c === 0 ? 'NOT PRESENT -- cannot be built' : 'present'}`)
}

/* ------------------------------ salary detail ----------------------------- */
const withSalary = jobs.filter((j) => typeof j.salaryMin === 'number' || typeof j.salaryMax === 'number')
console.log(`\nsalary: ${withSalary.length.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} (${(100 * withSalary.length / n).toFixed(1)}%)`)
if (withSalary.length) {
  const cur = {}
  for (const j of withSalary) cur[j.salaryCurrency || '(none)'] = (cur[j.salaryCurrency || '(none)'] || 0) + 1
  console.log('  by currency:', JSON.stringify(cur))
}
