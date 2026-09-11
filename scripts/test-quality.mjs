import { assessJob, validateJob, assessGhostRisk, requestsPayment } from '../lib/pipeline/quality.ts'
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

/* ------------------- requests_payment false positives ------------------ */
//
// Regression. `requests_payment` is CRITICAL, so a false positive deletes the
// posting. The old bare regex fired on the employers most careful about fraud,
// because warning candidates about advance-fee scams means naming the thing.
// Measured against live boards before the fix: Airbnb 167/167 postings
// rejected, Fireblocks 75/75. Both employers vanished from the index while
// their boards returned 200 OK and the crawl report showed zero failures.
console.log('\nrequests_payment -- disclaimers are not demands')

// Verbatim from a live Airbnb posting.
const AIRBNB = 'Our recruiters will never ask for your Social Security number, bank account details, ' +
  'passport, or payment app information while you are interviewing. We will also never ask you to pay a fee, ' +
  'send money, deposit or cash a check, or purchase work-related equipment during the interview process.'
t('Airbnb anti-fraud warning is not a payment demand', requestsPayment(AIRBNB).hit === false, requestsPayment(AIRBNB))

// Verbatim from a live Fireblocks posting: Western Union named as a CUSTOMER.
// Note "payment providers" earlier in the same sentence -- a first attempt at
// this guard accepted the NOUN "payment" as proof of a demand and still
// rejected all 75 postings. The sentence must contain an act of paying.
const FIREBLOCKS = 'Backed by over $1 billion in capital, we are the premier digital asset infrastructure ' +
  'provider trusted by thousands of industry-defining financial institutions, including banks, payment ' +
  'providers, fintechs, and global corporates such as BNY Mellon, BNP Paribas, ANZ Bank, Western Union, ' +
  'Stripe, and Revolut.'
t('a money-transfer brand in a customer list is not a demand', requestsPayment(FIREBLOCKS).hit === false, requestsPayment(FIREBLOCKS))
t('the noun "payment" alone does not make a demand',
  requestsPayment('We work with payment providers such as Western Union.').hit === false, null)

t('"we do not charge an application fee" is not a demand',
  requestsPayment('We do not charge an application fee at any stage.').hit === false, null)
t('a payments role describing its own product is not a demand',
  requestsPayment('You will build remittance rails competing with Western Union across 40 corridors.').hit === false, null)

console.log('\nrequests_payment -- real demands are still caught')
t('an outright demand is caught',
  requestsPayment('To be considered you must pay a fee of $250 before your interview.').hit === true, null)
t('a registration fee is caught',
  requestsPayment('Applicants are required to submit a registration fee to secure a slot.').hit === true, null)
t('an equipment deposit is caught',
  requestsPayment('You will send an equipment deposit of $400 for your company laptop.').hit === true, null)
t('a brand named WITH a payment instruction is caught',
  requestsPayment('Send the onboarding payment via Western Union to the address below.').hit === true, null)
t('a real demand carries its evidence',
  (requestsPayment('You must pay a fee of $250 to apply.').evidence || '').includes('pay a fee'),
  requestsPayment('You must pay a fee of $250 to apply.').evidence)

// Both regexes are /g, so a lastIndex shared between calls would make the
// result depend on how many times the function had been called before.
t('repeated calls are stable (lastIndex is reset)',
  requestsPayment(AIRBNB).hit === false && requestsPayment(AIRBNB).hit === false, null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
