import { extractSkills, inferSeniority, canonicalSkill } from '../lib/pipeline/skills.ts'
let pass=0,fail=0
const t=(n,c,g)=>{if(c){pass++;console.log('  PASS  '+n)}else{fail++;console.log('  FAIL  '+n+'  got: '+JSON.stringify(g))}}

const prose = 'We want you to go above and beyond. Experience with agile delivery. Plan C is a fallback.'
const s1 = extractSkills(prose).skills
t('"go to market" prose does not yield Go', !s1.includes('go'), s1)
t('"Plan C" prose does not yield C', !s1.includes('c'), s1)

const real = 'Strong programming skills in C, C++, Python and Go. Experience with Kubernetes.'
const s2 = extractSkills(real).skills
t('real language list yields go', s2.includes('go'), s2)
t('real language list yields c', s2.includes('c'), s2)
t('real language list yields c++', s2.includes('c++'), s2)
t('kubernetes detected', s2.includes('kubernetes'), s2)

const aliases = extractSkills('We use K8s, Postgres, GCP and PyTorch.').skills
t('K8s -> kubernetes', aliases.includes('kubernetes'), aliases)
t('Postgres -> postgresql', aliases.includes('postgresql'), aliases)
t('GCP -> google cloud', aliases.includes('google cloud'), aliases)
t('PyTorch normalised', aliases.includes('pytorch'), aliases)

t('canonicalSkill k8s', canonicalSkill('K8s')==='kubernetes', canonicalSkill('K8s'))
t('seniority from title', inferSeniority('Senior Software Engineer')==='senior', null)
t('intern beats senior mention', inferSeniority('Engineering Intern')==='internship', null)
t('years fallback', inferSeniority('Software Engineer','We need 6+ years of experience')==='senior', null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail===0?0:1)
