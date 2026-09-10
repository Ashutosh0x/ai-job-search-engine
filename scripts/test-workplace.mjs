import { classifyWorkplace, workplaceDisplay } from '../lib/pipeline/workplace.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}

console.log('\nTHE 84% BUG: a bare city is NOT a statement about onsite')
{
  const r = classifyWorkplace({title:'Software Engineer', locationRaw:'San Francisco, CA', description:'Build great products with a talented team.'})
  t('bare city -> UNKNOWN, not ONSITE', r.type==='UNKNOWN', r.type)
  t('no fabricated evidence', r.evidence.length===0, r.evidence)
}
{
  const r = classifyWorkplace({title:'Software Engineer', locationRaw:'San Francisco, CA', description:'This is an on-site role based in our SF office.'})
  t('explicit on-site -> ONSITE', r.type==='ONSITE', r.type)
}

console.log('\nREMOTE SCOPE (remote != worldwide)')
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Remote - US', description:''})
  t('"Remote - US" -> COUNTRY scope', r.type==='REMOTE'&&r.remoteScope==='COUNTRY', r)
  t('country captured', r.remoteCountries.includes('United States'), r.remoteCountries)
  t('display shows scope', workplaceDisplay(r)==='Remote — United States', workplaceDisplay(r))
}
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Remote', description:'A remote position.'})
  t('bare Remote -> UNSPECIFIED not WORLDWIDE', r.remoteScope==='UNSPECIFIED', r.remoteScope)
}
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Remote - Worldwide', description:'Work from anywhere in the world.'})
  t('worldwide detected', r.remoteScope==='WORLDWIDE', r.remoteScope)
}
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Remote (India)', description:''})
  t('Remote India', r.remoteCountries.includes('India'), r.remoteCountries)
}
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Remote - EMEA', description:''})
  t('region scope', r.remoteScope==='REGION'&&r.remoteRegions.includes('EMEA'), r)
}

console.log('\nHYBRID')
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'London, UK', description:'This is a hybrid role, 3 days per week in the office.'})
  t('hybrid detected', r.type==='HYBRID', r.type)
  t('office days extracted', r.officeDaysPerWeek===3, r.officeDaysPerWeek)
  t('display includes days', workplaceDisplay(r).includes('3 days/week'), workplaceDisplay(r))
}
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Hybrid - Berlin', description:'Some remote flexibility.'})
  t('"hybrid remote" is hybrid not remote', r.type==='HYBRID', r.type)
}

console.log('\nPROVIDER FLAG')
{
  const r = classifyWorkplace({title:'Engineer', locationRaw:'Austin, TX', description:'Great team.', providerRemoteFlag:true})
  t('provider flag alone -> REMOTE', r.type==='REMOTE', r.type)
  t('flag evidence is labelled honestly', r.evidence[0].includes('Employer marked'), r.evidence)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
