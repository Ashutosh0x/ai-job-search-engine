import { normalizeJob } from '../lib/pipeline/normalize.ts'
const j = normalizeJob({
  source:'greenhouse', target:{source:'greenhouse',token:'acme'}, sourceId:'1',
  title:'Senior ML Engineer',
  locationRaw:'Remote - India',
  description:'Build LLM inference systems. Visa sponsorship is available for qualified candidates. You will work with PyTorch and CUDA.',
  applicationUrl:'https://boards.greenhouse.io/acme/jobs/1',
})
console.log('workplace :', j.workplaceType, '|', j.workplaceDisplay, '| scope:', j.remoteScope, j.remoteCountries)
console.log('visa      :', j.visaStatus, '| conf:', j.visaConfidence)
console.log('evidence  :', j.visaEvidence[0]?.quote)
console.log('skills    :', j.skills.join(', '))
console.log('seniority :', j.seniority)

const j2 = normalizeJob({
  source:'greenhouse', target:{source:'greenhouse',token:'acme'}, sourceId:'2',
  title:'Software Engineer', locationRaw:'San Francisco, CA',
  description:'Join our team to build great products.',
  applicationUrl:'https://boards.greenhouse.io/acme/jobs/2',
})
console.log('\nno-signal job:')
console.log('workplace :', j2.workplaceType, '(was ONSITE by default before)')
console.log('visa      :', j2.visaStatus, '| evidence:', j2.visaEvidence.length)
