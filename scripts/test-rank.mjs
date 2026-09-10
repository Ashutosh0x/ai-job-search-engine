import { parseIntent } from '../lib/search/intent.ts'
import { rankJob, explainRank, DEFAULT_WEIGHTS } from '../lib/search/rank.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}
const vocab={cities:new Set(['Bangalore','London']),countries:new Set(['India']),companies:new Map(),cityCountries:new Map([['bangalore','India'],['london','United Kingdom']])}
const job=(o={})=>({title:'Software Engineer',description:'x'.repeat(300),skills:[],city:'London',country:'United Kingdom',
  remote:false,workplaceType:'UNKNOWN',seniority:null,visaStatus:'SPONSORSHIP_NOT_MENTIONED',
  postedAt:new Date(Date.now()-2*864e5).toISOString(),freshnessScore:0.9,sourceConfidence:0.98,
  isDirectApplication:true,duplicateConfidence:0,companyValuationUsd:null,...o})

console.log('\nWeights are a real budget')
{
  const sum=Object.entries(DEFAULT_WEIGHTS).filter(([k])=>k!=='duplicatePenalty').reduce((s,[,v])=>s+v,0)
  t('positive weights sum to 100', sum===100, sum)
  t('company quality is capped at 3', DEFAULT_WEIGHTS.companyQuality===3, DEFAULT_WEIGHTS.companyQuality)
}

console.log('\nRelevance beats prestige (the core promise)')
{
  const i = parseIntent('machine learning engineer', vocab)
  const relevantSmall = rankJob(job({title:'Machine Learning Engineer',skills:['machine learning'],companyValuationUsd:null}), i)
  const irrelevantGiant = rankJob(job({title:'Warehouse Associate',skills:[],companyValuationUsd:500e9}), i)
  t('relevant small co outranks irrelevant giant', relevantSmall.score>irrelevantGiant.score, [relevantSmall.score,irrelevantGiant.score])
  console.log(`        relevant=${relevantSmall.score}  giant=${irrelevantGiant.score}`)
}

console.log('\nConstraints actually move the ranking')
{
  const i = parseIntent('engineer with visa sponsorship', vocab)
  const sponsors = rankJob(job({visaStatus:'SPONSORSHIP_EXPLICIT'}), i)
  const refuses  = rankJob(job({visaStatus:'SPONSORSHIP_NOT_AVAILABLE'}), i)
  const silent   = rankJob(job({visaStatus:'SPONSORSHIP_NOT_MENTIONED'}), i)
  t('explicit > not-mentioned > refused', sponsors.score>silent.score && silent.score>refuses.score, [sponsors.score,silent.score,refuses.score])
  t('sponsorship earns a badge', sponsors.matchReasons.includes('Visa sponsorship'), sponsors.matchReasons)
}
{
  const i = parseIntent('remote engineer', vocab)
  const rem = rankJob(job({workplaceType:'REMOTE',remote:true}), i)
  const onsite = rankJob(job({workplaceType:'ONSITE'}), i)
  const unknown = rankJob(job({workplaceType:'UNKNOWN'}), i)
  t('remote > unknown > onsite for a remote query', rem.score>unknown.score && unknown.score>onsite.score, [rem.score,unknown.score,onsite.score])
  t('UNKNOWN is not treated as a mismatch', unknown.score>onsite.score, [unknown.score,onsite.score])
}
{
  const i = parseIntent('senior engineer', vocab)
  const sen = rankJob(job({seniority:'senior'}), i)
  const jun = rankJob(job({seniority:'entry'}), i)
  t('seniority match ranks higher', sen.score>jun.score, [sen.score,jun.score])
}
{
  const i = parseIntent('engineer in Bangalore', vocab)
  const there = rankJob(job({city:'Bangalore',country:'India'}), i)
  const elsewhere = rankJob(job({city:'London',country:'United Kingdom'}), i)
  const remoteIndia = rankJob(job({city:null,remote:true,workplaceType:'REMOTE',remoteScope:'COUNTRY',remoteCountries:['India']}), i)
  t('in-location beats elsewhere', there.score>elsewhere.score, [there.score,elsewhere.score])
  t('remote-open-to-India ~ as good as being there', remoteIndia.score>elsewhere.score, [remoteIndia.score,elsewhere.score])
}
{
  const i = parseIntent('engineer', vocab)
  const fresh = rankJob(job({freshnessScore:1,postedAt:new Date().toISOString()}), i)
  const stale = rankJob(job({freshnessScore:0.05,postedAt:new Date(Date.now()-200*864e5).toISOString()}), i)
  t('fresh outranks stale', fresh.score>stale.score, [fresh.score,stale.score])
  t('fresh gets a badge', fresh.matchReasons.includes('Just posted'), fresh.matchReasons)
}
{
  const i = parseIntent('engineer', vocab)
  const direct = rankJob(job({isDirectApplication:true}), i)
  const agg = rankJob(job({isDirectApplication:false}), i)
  t('direct application outranks aggregator', direct.score>agg.score, [direct.score,agg.score])
}

console.log('\nExplainability')
{
  const i = parseIntent('senior machine learning engineer in Bangalore with visa sponsorship', vocab)
  const r = rankJob(job({title:'Senior Machine Learning Engineer',skills:['machine learning','python'],
    city:'Bangalore',country:'India',seniority:'senior',visaStatus:'SPONSORSHIP_EXPLICIT',
    description:'Build ML systems.'.repeat(30),salaryMin:4000000,department:'AI'}), i)
  t('every signal is accounted for', r.signals.length>=11, r.signals.length)
  t('score is bounded 0-100', r.score>=0 && r.score<=100, r.score)
  t('produces user-facing reasons', r.matchReasons.length>=3, r.matchReasons)
  console.log(`        score ${r.score}  badges: ${r.matchReasons.join(' · ')}`)
  console.log('        ' + explainRank(r).slice(0,150))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
