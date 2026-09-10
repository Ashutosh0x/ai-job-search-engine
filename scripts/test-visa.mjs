import { classifyVisa } from '../lib/pipeline/visa.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}
const pad = 'We are hiring a software engineer to build distributed systems. You will work with a great team on interesting problems at scale. '

console.log('\nEXPLICIT sponsorship')
{
  const r = classifyVisa(pad+'Visa sponsorship is available for qualified candidates.')
  t('offer -> EXPLICIT', r.status==='SPONSORSHIP_EXPLICIT', r.status)
  t('quotes real evidence', r.evidence[0].quote.includes('sponsorship is available'), r.evidence)
}
{
  const r = classifyVisa(pad+'We will sponsor work visas for exceptional candidates.')
  t('"we will sponsor" -> EXPLICIT', r.status==='SPONSORSHIP_EXPLICIT', r.status)
}

console.log('\nNOT AVAILABLE')
{
  const r = classifyVisa(pad+'We are unable to sponsor or take over sponsorship of an employment visa at this time.')
  t('"unable to sponsor" -> NOT_AVAILABLE', r.status==='SPONSORSHIP_NOT_AVAILABLE', r.status)
}
{
  const r = classifyVisa(pad+'This role does not offer visa sponsorship.')
  t('"does not offer" -> NOT_AVAILABLE', r.status==='SPONSORSHIP_NOT_AVAILABLE', r.status)
}
{
  // The critical negation trap: the phrase contains "visa sponsorship".
  const r = classifyVisa(pad+'No visa sponsorship is available for this position.')
  t('negation not misread as positive', r.status==='SPONSORSHIP_NOT_AVAILABLE', r.status)
}

console.log('\nLIKELY (named programme)')
{
  const r = classifyVisa(pad+'We support H-1B transfers and STEM OPT candidates.')
  t('named programme -> LIKELY', r.status==='SPONSORSHIP_LIKELY', r.status)
  t('captures visa types', r.visaTypes.includes('H-1B')&&r.visaTypes.includes('STEM OPT'), r.visaTypes)
}

console.log('\nSILENCE IS NOT CONSENT (the core rule)')
{
  const r = classifyVisa(pad+'You will collaborate across teams and ship quickly.')
  t('no mention -> NOT_MENTIONED', r.status==='SPONSORSHIP_NOT_MENTIONED', r.status)
  t('no invented evidence', r.evidence.length===0, r.evidence)
}
{
  const r = classifyVisa('')
  t('empty text -> NOT_MENTIONED', r.status==='SPONSORSHIP_NOT_MENTIONED', r.status)
}
{
  const r = classifyVisa(pad+'Short.')
  t('no description -> never claims availability', r.status!=='SPONSORSHIP_EXPLICIT', r.status)
}

console.log('\nAUTH BOILERPLATE IS NOT A REFUSAL')
{
  const r = classifyVisa(pad+'Candidates must be authorized to work in the United States.')
  t('auth requirement alone -> NOT_MENTIONED (not NOT_AVAILABLE)', r.status==='SPONSORSHIP_NOT_MENTIONED', r.status)
  t('records workAuthorizationRequired', r.workAuthorizationRequired===true, r)
}
{
  // Employers who sponsor still write this. Must not cancel an explicit offer.
  const r = classifyVisa(pad+'You must be authorized to work in the US. Visa sponsorship is available for this role.')
  t('auth text does not cancel explicit offer', r.status==='SPONSORSHIP_EXPLICIT', r.status)
}

console.log('\nUK / EU / CANADA')
{
  const r = classifyVisa(pad+'We are a licensed UK visa sponsor and can sponsor Skilled Worker visas.')
  t('UK skilled worker -> EXPLICIT', r.status==='SPONSORSHIP_EXPLICIT', r.status)
  t('UK visa type captured', r.visaTypes.includes('UK Skilled Worker'), r.visaTypes)
}
{
  const r = classifyVisa(pad+'We can support an EU Blue Card application for the right candidate.')
  t('EU Blue Card detected', r.visaTypes.includes('EU Blue Card'), r.visaTypes)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
