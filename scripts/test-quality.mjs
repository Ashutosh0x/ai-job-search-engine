import { assessJob, validateJob, assessGhostRisk } from '../lib/pipeline/quality.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}
const now = Date.now()
const job=(o={})=>({title:'Senior Backend Engineer',company:'Acme',companySlug:'acme',
  description:'Build distributed systems. '.repeat(40), applicationUrl:'https://boards.greenhouse.io/acme/jobs/1',
  city:'London',country:'United Kingdom',remote:false,workplaceType:'ONSITE',
  seniority:'senior',department:'Engineering',skills:['go','kubernetes'],
  salaryMin:120000,salaryMax:160000,employmentType:'full-time',
  postedAt:new Date(now-5*864e5).toISOString(), firstSeenAt:new Date(now-5*864e5).toISOString(),
  visaStatus:'SPONSORSHIP_EXPLICIT', isDirectApplication:true, isRepost:false, ...o})

console.log('\nValidation gates')
{
  const a = assessJob(job())
  t('a complete posting indexes', a.shouldIndex===true, a.issues)
  t('high quality score', a.qualityScore>0.85, a.qualityScore)
}
{
  const a = assessJob(job({applicationUrl:'not-a-url'}))
  t('bad apply URL is CRITICAL', !a.shouldIndex, a.issues)
}
{
  const a = assessJob(job({description:'Send a $250 application fee via wire transfer to apply.'}))
  t('payment request blocks indexing', !a.shouldIndex, a.issues.map(i=>i.rule))
}
{
  const a = assessJob(job({title:'Apply Now'}))
  t('generic title is WARNING not CRITICAL', a.shouldIndex===true, a.issues)
  t('generic title lowers quality', a.qualityScore<0.8, a.qualityScore)
}
{
  const a = assessJob(job({description:'Email your CV to recruiter@gmail.com to apply.'}))
  t('off-platform contact flagged', a.issues.some(i=>i.rule==='off_platform_contact'), a.issues.map(i=>i.rule))
  t('but still indexed', a.shouldIndex===true, null)
}
{
  const a = assessJob(job({salaryMin:200000,salaryMax:100000}))
  t('inverted salary flagged', a.issues.some(i=>i.rule==='salary_inverted'), a.issues.map(i=>i.rule))
}

console.log('\nGhost-job signals are evidence, never verdicts')
{
  const a = assessJob(job())
  t('a fresh normal job has no ghost label', a.ghostLabel===null && a.ghostRisk<0.3, [a.ghostRisk,a.ghostLabel])
}
{
  const a = assessJob(job({description:'Join our talent community for future opportunities.'}))
  t('explicit talent pipeline detected', a.ghostSignals.some(s=>s.signal==='talent_pipeline'), a.ghostSignals)
  t('labelled honestly', (a.ghostLabel||'').includes('Talent pipeline'), a.ghostLabel)
  t('evidence quotes the posting', a.ghostSignals[0].evidence.includes('talent community'), a.ghostSignals[0])
}
{
  const old = new Date(now-200*864e5).toISOString()
  const a = assessJob(job({postedAt:old, firstSeenAt:old}), {repostCount:3})
  t('long-open + reposted raises risk', a.ghostRisk>=0.5, a.ghostRisk)
  t('never claims certainty', a.ghostRisk<=0.85, a.ghostRisk)
}
{
  const old = new Date(now-200*864e5).toISOString()
  const a = assessJob(job({postedAt:old,firstSeenAt:old,description:'',department:null,seniority:null,skills:[]}), {repostCount:5})
  t('risk is capped below certainty even at worst', a.ghostRisk<=0.85, a.ghostRisk)
  t('suspected ghost is still indexed, not hidden', a.shouldIndex===true, a.issues.map(i=>i.rule))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
