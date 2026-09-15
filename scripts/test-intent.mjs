import { parseIntent, describeIntent } from '../lib/search/intent.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}
const vocab = {
  cities: new Set(['Bangalore','San Francisco','London','New York','Berlin','York']),
  countries: new Set(['India','United States','United Kingdom','Germany']),
  companies: new Map([['Anthropic','anthropic'],['Stripe','stripe'],['NVIDIA','nvidia']]),
}

console.log('\nThe headline query from the brief')
{
  const i = parseIntent('senior AI engineer jobs in Bangalore with visa sponsorship', vocab)
  t('seniority', i.seniority==='senior', i.seniority)
  t('city', i.locations.includes('Bangalore'), i.locations)
  t('visa', i.visa==='required', i.visa)
  t('topic drops noise words', !i.topic.includes('jobs') && i.topic.includes('engineer'), i.topic)
}
{
  const i = parseIntent('remote backend jobs paying over $150k', vocab)
  t('workplace remote', i.workplace==='REMOTE' && i.remoteOnly, i.workplace)
  t('salary 150000 USD', i.salaryMin===150000 && i.salaryCurrency==='USD', [i.salaryMin,i.salaryCurrency])
  t('topic is backend', i.topic.includes('backend'), i.topic)
}
{
  const i = parseIntent('ML engineer jobs in Europe that sponsor visas', vocab)
  t('visa from "sponsor visas"', i.visa==='required', i.visa)
  t('skill machine learning', i.skills.includes('machine learning'), i.skills)
}
{
  const i = parseIntent('hybrid software engineering jobs in London', vocab)
  t('hybrid', i.workplace==='HYBRID', i.workplace)
  t('London', i.locations.includes('London'), i.locations)
}
{
  const i = parseIntent('fresh AI jobs posted today at startups', vocab)
  t('recency today = 1 day', i.postedWithinDays===1, i.postedWithinDays)
}
{
  const i = parseIntent('NVIDIA jobs related to inference', vocab)
  t('company resolved', i.companies.includes('nvidia'), i.companies)
  t('topic keeps inference', i.topic.includes('inference'), i.topic)
}

console.log('\nPrecision traps')
{
  const i = parseIntent('jobs in New York', vocab)
  t('"New York" beats "York"', i.locations.includes('New York') && !i.locations.includes('York'), i.locations)
}
{
  const i = parseIntent('senior rust engineer remote India ₹40L+', vocab)
  t('lakh notation -> 4000000 INR', i.salaryMin===4000000 && i.salaryCurrency==='INR', [i.salaryMin,i.salaryCurrency])
  t('rust skill', i.skills.includes('rust'), i.skills)
  t('India country', i.countries.includes('India'), i.countries)
}
{
  const i = parseIntent('Tokyo platform engineer 年収1000万円以上', vocab)
  t('Japanese annual salary -> 10000000 JPY', i.salaryMin===10000000 && i.salaryCurrency==='JPY', [i.salaryMin,i.salaryCurrency])
  t('Japanese salary is shown with the yen sign', describeIntent(i).some((part) => part.includes('¥10,000,000')), describeIntent(i))
}
{
  const i = parseIntent('インフラエンジニア', vocab)
  t('Japanese role produces a retrieval topic', i.topic.includes('infrastructure') && i.topic.includes('engineer'), i)
}
{
  const i = parseIntent('kubernetes', vocab)
  t('bare skill query still has a topic', i.topic.length>0, i.topic)
}
{
  const i = parseIntent('', vocab)
  t('empty query is safe', i.topic==='' && i.facets.length===0, i)
}

console.log('\nExplainability')
{
  const i = parseIntent('senior ML engineer in Bangalore with visa sponsorship posted this week', vocab)
  const d = describeIntent(i)
  t('describes every constraint', d.length>=5, d)
  console.log('        →', d.join(' · '))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
