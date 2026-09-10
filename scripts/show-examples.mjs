/** §56: 20 real examples with verified canonical application URLs. */
import { readFileSync } from 'fs'
const J = JSON.parse(readFileSync('public/data/jobs-v2.json','utf8')).jobs
const picks=[], used=new Set()
const take=(label,f,n=2)=>{let c=0;for(const j of J){if(c>=n)break;if(used.has(j.id))continue;if(!f(j))continue;used.add(j.id);picks.push({label,j});c++}}

take('VISA EXPLICIT', j=>j.visaStatus==='SPONSORSHIP_EXPLICIT'&&j.visaEvidence.length,3)
take('VISA NOT AVAILABLE', j=>j.visaStatus==='SPONSORSHIP_NOT_AVAILABLE'&&j.visaEvidence.length,2)
take('REMOTE scoped', j=>j.workplaceType==='REMOTE'&&j.remoteScope==='COUNTRY',2)
take('REMOTE worldwide', j=>j.remoteScope==='WORLDWIDE',1)
take('HYBRID w/ days', j=>j.workplaceType==='HYBRID'&&j.officeDaysPerWeek,2)
take('AI/ML', j=>j.skills.some(s=>['llm','pytorch','machine learning'].includes(s)),2)
take('HARDWARE', j=>/hardware|silicon|asic|fpga|firmware|embedded/i.test(j.title),1)
take('DATA', j=>/data (engineer|scientist|analyst)/i.test(j.title),1)
take('SALARY', j=>j.salaryMin&&j.salaryMax,2)
for (const s of ['workday','ashby','lever','greenhouse','smartrecruiters']) take('ATS '+s, j=>j.source===s,1)
take('NON-US', j=>j.country&&j.country!=='United States',2)

console.log(`${picks.length} EXAMPLES\n${'='.repeat(78)}`)
for (const {label,j} of picks) {
  console.log(`\n[${label}]  ${j.title}`)
  console.log(`  ${j.company}  ·  ${j.workplaceDisplay}  ·  ${j.country||'—'}`)
  console.log(`  visa: ${j.visaStatus.replace('SPONSORSHIP_','')}${j.visaTypes.length?' ('+j.visaTypes.join(', ')+')':''}`)
  if (j.visaEvidence.length) console.log(`  evidence: "${j.visaEvidence[0].quote.slice(0,110)}"`)
  if (j.salaryMin) console.log(`  salary: ${j.salaryCurrency||'$'}${j.salaryMin}–${j.salaryMax}`)
  if (j.skills.length) console.log(`  skills: ${j.skills.slice(0,5).join(', ')}`)
  console.log(`  posted: ${j.postedAt?j.postedAt.slice(0,10):'unknown'}  ·  via ${j.source}  ·  direct: ${j.isDirectApplication}`)
  console.log(`  APPLY: ${j.applicationUrl}`)
}
console.log(`\n${'='.repeat(78)}`)
console.log('all URLs direct (non-aggregator):', picks.every(x=>x.j.isDirectApplication))
console.log('distinct ATS platforms:', new Set(picks.map(x=>x.j.source)).size)
console.log('distinct countries:', new Set(picks.map(x=>x.j.country).filter(Boolean)).size)
