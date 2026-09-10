import { readFileSync } from 'fs'
const d = JSON.parse(readFileSync('public/data/jobs-v2.json','utf8'))
const J = d.jobs, R = d.report
const p = (n) => `${n.toLocaleString()} (${((n/J.length)*100).toFixed(1)}%)`
const count = (f) => J.filter(f).length

console.log('=== JOBSPARK SEPTEMBER 2026 REPORT ===\n')
console.log(`Companies:                  ${R.totalCompanies}`)
console.log(`Jobs (raw ingested):        ${R.totalJobsRaw.toLocaleString()}`)
console.log(`Unique jobs (canonical):    ${R.totalJobsCanonical.toLocaleString()}`)
console.log(`Duplicates removed:         ${R.duplicatesRemoved.toLocaleString()} (${((R.duplicatesRemoved/R.totalJobsRaw)*100).toFixed(1)}%)`)

const now = Date.now()
const age = (j) => j.postedAt ? (now - new Date(j.postedAt))/864e5 : null
console.log(`\nNew jobs <24h:              ${p(count(j=>{const a=age(j);return a!==null&&a<1}))}`)
console.log(`New jobs <3d:               ${p(count(j=>{const a=age(j);return a!==null&&a<3}))}`)
console.log(`New jobs <7d:               ${p(count(j=>{const a=age(j);return a!==null&&a<7}))}`)

console.log(`\nWORKPLACE (evidence-based)`)
for (const t of ['REMOTE','HYBRID','ONSITE','FLEXIBLE','UNKNOWN'])
  console.log(`  ${t.padEnd(10)} ${p(count(j=>j.workplaceType===t))}`)

console.log(`\nREMOTE SCOPE`)
const scopes = {}
for (const j of J) if (j.workplaceType==='REMOTE') scopes[j.remoteScope||'null']=(scopes[j.remoteScope||'null']||0)+1
for (const [k,v] of Object.entries(scopes).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(12)} ${v.toLocaleString()}`)

console.log(`\nVISA SPONSORSHIP`)
for (const s of ['SPONSORSHIP_EXPLICIT','SPONSORSHIP_LIKELY','SPONSORSHIP_POSSIBLE','SPONSORSHIP_NOT_MENTIONED','SPONSORSHIP_NOT_AVAILABLE'])
  console.log(`  ${s.replace('SPONSORSHIP_','').padEnd(14)} ${p(count(j=>j.visaStatus===s))}`)
const vt={}; for(const j of J) for(const t of j.visaTypes||[]) vt[t]=(vt[t]||0)+1
console.log(`  visa types seen: ${Object.entries(vt).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>k+'('+v+')').join(', ')||'none'}`)
console.log(`  workAuthRequired: ${p(count(j=>j.workAuthorizationRequired))}`)

console.log(`\nDATA QUALITY`)
console.log(`  salary disclosed          ${p(count(j=>j.salaryMin||j.salaryMax))}`)
console.log(`  description >200 chars    ${p(count(j=>(j.description||'').length>200))}`)
console.log(`  normalized city           ${p(count(j=>j.city))}`)
console.log(`  normalized country        ${p(count(j=>j.country))}`)
console.log(`  skills extracted          ${p(count(j=>j.skills.length))}`)
console.log(`  seniority inferred        ${p(count(j=>j.seniority))}`)
console.log(`  direct application URL    ${p(count(j=>j.isDirectApplication))}`)

console.log(`\nCountries:                  ${new Set(J.map(j=>j.country).filter(Boolean)).size}`)
console.log(`Cities:                     ${new Set(J.map(j=>j.city).filter(Boolean)).size}`)
console.log(`ATS sources:                ${Object.keys(R.bySource).length} (${Object.keys(R.bySource).join(', ')})`)
console.log(`Failed sources:             ${R.sourcesFailed}`)
console.log(`Average ingestion time:     ${(R.durationMs/1000).toFixed(1)}s  (avg source ${R.avgSourceResponseMs}ms)`)
console.log(`Top source by jobs:         ${R.topSources[0].source} (${R.topSources[0].jobs.toLocaleString()})`)
