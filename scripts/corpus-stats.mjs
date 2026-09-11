/**
 * Coverage report over the built index (§39, §47).
 *
 *   node --max-old-space-size=8192 scripts/corpus-stats.mjs [path]
 *
 * This is the observability tool the brief asks for, and it is deliberately
 * measurement-only: it reads the index and reports what is actually in it.
 * Every number below is a count over real records, so "coverage" claims in the
 * docs can be checked rather than believed.
 *
 * Prints a machine-readable JSON block at the end so the before/after
 * comparison in docs/job-data-quality-report.md is generated, not typed.
 */

import { readFileSync, writeFileSync } from 'fs'

const path = process.argv[2] ?? 'public/data/jobs-v2.json'
const jsonOut = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : null

const raw = readFileSync(path, 'utf8')
const data = JSON.parse(raw)
const jobs = data.jobs ?? []

const pct = (n) => `${((n / jobs.length) * 100).toFixed(1)}%`
const has = (f) => jobs.filter(f).length

/* ------------------------------- field coverage --------------------------- */

const cov = {
  total: jobs.length,
  description200: has((j) => (j.description ?? '').length >= 200),
  description20: has((j) => (j.description ?? '').length >= 20),
  postedAt: has((j) => j.postedAt),
  city: has((j) => j.city),
  country: has((j) => j.country),
  salary: has((j) => j.salaryMin != null || j.salaryMax != null),
  skills: has((j) => (j.skills ?? []).length > 0),
  seniority: has((j) => j.seniority),
  department: has((j) => j.department),
  directApply: has((j) => j.isDirectApplication),
  employmentType: has((j) => j.employmentType),
}

/* ------------------------------- distributions ---------------------------- */

const tally = (fn) => {
  const m = {}
  for (const j of jobs) {
    const k = fn(j) ?? 'UNKNOWN'
    m[k] = (m[k] || 0) + 1
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]))
}

const visa = tally((j) => j.visaStatus)
const workplace = tally((j) => j.workplaceType)
const bySource = tally((j) => j.source)
const byCountry = tally((j) => j.country)
const byStatus = tally((j) => j.status)

/* --- description coverage per source: this is where the ceiling shows up --- */

const perSource = {}
for (const j of jobs) {
  const s = j.source ?? 'unknown'
  perSource[s] ??= { jobs: 0, desc: 0, posted: 0, country: 0, skills: 0 }
  perSource[s].jobs++
  if ((j.description ?? '').length >= 200) perSource[s].desc++
  if (j.postedAt) perSource[s].posted++
  if (j.country) perSource[s].country++
  if ((j.skills ?? []).length > 0) perSource[s].skills++
}

/* ---------------------------------- output -------------------------------- */

console.log(`\nINDEX  ${path}`)
console.log(`generated ${data.generatedAt}`)
console.log(`${jobs.length.toLocaleString()} jobs\n`)

console.log('FIELD COVERAGE')
for (const [k, v] of Object.entries(cov)) {
  if (k === 'total') continue
  console.log(`  ${k.padEnd(18)} ${String(v).padStart(8)}  ${pct(v).padStart(7)}`)
}

console.log('\nPER SOURCE  (jobs / description>=200 / postedAt / country / skills)')
for (const [s, v] of Object.entries(perSource).sort((a, b) => b[1].jobs - a[1].jobs)) {
  const p = (n) => `${((n / v.jobs) * 100).toFixed(0)}%`.padStart(5)
  console.log(
    `  ${s.padEnd(16)} ${String(v.jobs).padStart(7)} ` +
      `${p(v.desc)} ${p(v.posted)} ${p(v.country)} ${p(v.skills)}`
  )
}

const show = (title, obj, n = 10) => {
  console.log(`\n${title}`)
  for (const [k, v] of Object.entries(obj).slice(0, n)) {
    console.log(`  ${String(k).padEnd(30)} ${String(v).padStart(8)}  ${pct(v)}`)
  }
}

show('VISA STATUS', visa)
show('WORKPLACE TYPE', workplace)
show('JOB STATUS', byStatus)
show('TOP COUNTRIES', byCountry, 15)
show('BY SOURCE', bySource)

const out = { path, generatedAt: data.generatedAt, coverage: cov, perSource, visa, workplace, byStatus, bySource, byCountry }
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
