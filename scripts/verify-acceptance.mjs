/** §37 acceptance evidence, computed from the real ingest output. */
import { readFileSync } from 'fs'
const d = JSON.parse(readFileSync('public/data/jobs-v2.json','utf8'))
const jobs = d.jobs, R = d.report

// sourceUrls lives in the full archive, not the slim search index -- this is an
// analysis script, so it can afford the bigger parse. Fall back gracefully so
// the rest of the report still prints when only the index has been built.
let fullJobs = jobs
try { fullJobs = JSON.parse(readFileSync('public/data/jobs-v2-full.json','utf8')).jobs } catch {}

console.log('MULTI-PLATFORM DISCOVERY')
const bySrc = {}
for (const j of jobs) bySrc[j.source] = (bySrc[j.source]||0)+1
for (const [s,n] of Object.entries(bySrc).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${s.padEnd(18)} ${String(n).padStart(7)} canonical jobs`)
console.log(`  ${Object.keys(bySrc).length} distinct ATS platforms in one index\n`)

console.log('DEDUPLICATION')
console.log(`  raw ingested            ${R.totalJobsRaw.toLocaleString()}`)
console.log(`  canonical after dedupe  ${R.totalJobsCanonical.toLocaleString()}`)
console.log(`  duplicates collapsed    ${R.duplicatesRemoved.toLocaleString()} (${(R.duplicatesRemoved/R.totalJobsRaw*100).toFixed(1)}%)`)
for (const [tier,n] of Object.entries(R.dedupeTiers)) console.log(`    ${tier.padEnd(16)} ${n}`)

const merged = fullJobs.filter(j => (j.sourceUrls ?? []).length > 1)
console.log(`\n  jobs holding >1 source URL: ${merged.length}`)
for (const j of merged.slice(0,3)) {
  console.log(`\n  "${j.title}" @ ${j.company}`)
  console.log(`    canonical apply : ${j.applicationUrl}`)
  console.log(`    direct?         : ${j.isDirectApplication}`)
  console.log(`    dup confidence  : ${j.duplicateConfidence}`)
  console.log(`    all source urls :`)
  for (const u of j.sourceUrls.slice(0,4)) console.log(`        - ${u}`)
}

console.log('\n\nQUALITY METRICS')
const m = (n,dn)=>`${n.toLocaleString()} (${(n/dn*100).toFixed(1)}%)`
console.log(`  direct application rate  ${m(R.directApplicationUrls, R.totalJobsCanonical)}`)
console.log(`  location (city) coverage ${m(R.jobsWithCity, R.totalJobsCanonical)}`)
console.log(`  country coverage         ${m(R.jobsWithCountry, R.totalJobsCanonical)}`)
console.log(`  posted-date coverage     ${m(R.jobsWithPostedDate, R.totalJobsCanonical)}`)
console.log(`  salary coverage          ${m(R.jobsWithSalary, R.totalJobsCanonical)}`)
console.log(`  source success rate      ${(R.sourcesSucceeded/(R.sourcesSucceeded+R.sourcesFailed)*100).toFixed(1)}%`)

const withSkills = jobs.filter(j=>j.skills.length>0).length
const withSeniority = jobs.filter(j=>j.seniority).length
const remote = jobs.filter(j=>j.remote).length
console.log(`  skills extracted         ${m(withSkills, jobs.length)}`)
console.log(`  seniority inferred       ${m(withSeniority, jobs.length)}`)
console.log(`  remote roles             ${m(remote, jobs.length)}`)

console.log('\nFRESHNESS DISTRIBUTION')
const bands = {}
for (const j of jobs) {
  const s=j.freshnessScore
  const b = s>=1?'<24h':s>=0.9?'1-3d':s>=0.75?'4-7d':s>=0.45?'8-30d':s>0.3?'30d+':'unknown'
  bands[b]=(bands[b]||0)+1
}
for (const [b,n] of Object.entries(bands).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${b.padEnd(10)} ${m(n, jobs.length)}`)

console.log('\nTOP SKILLS EXTRACTED')
const sk={}
for (const j of jobs) for (const s of j.skills) sk[s]=(sk[s]||0)+1
for (const [s,n] of Object.entries(sk).sort((a,b)=>b[1]-a[1]).slice(0,12))
  console.log(`  ${s.padEnd(20)} ${n}`)
