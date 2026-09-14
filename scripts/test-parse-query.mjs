/**
 * Natural-language query parsing.
 *
 * Every token this produces becomes a chip shown back to the user as a claim
 * about what we understood, so a wrong chip is worse than no chip: the user
 * sees "Remote" and trusts the results are remote. Most of these assertions are
 * therefore about not over-reading the query.
 */

import { parseQuery, intentToParams, REGIONS } from '../lib/search/parse-query.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 260)) }
}

const KNOWN = {
  countries: ['United Kingdom', 'Germany', 'United States', 'India', 'Singapore', 'France'],
  cities: ['London', 'Berlin', 'Bangalore', 'San Francisco', 'Manchester'],
}
const P = (s) => parseQuery(s, KNOWN)

/* ------------------------- the examples from the brief --------------------- */
{
  const a = P('Remote software engineering internships in Europe')
  t('remote detected', a.remote === true && a.workMode === 'remote', a)
  t('internship detected', a.earlyCareer === 'internship', a)
  t('Europe detected as a region', a.region === 'Europe', a)
  t('role text survives', /software engineering/i.test(a.q), a.q)
  t('stop words stripped from role', !/\bin\b/.test(a.q), a.q)

  const b = P('Entry-level product jobs in London paying above £50k')
  t('entry-level detected', b.earlyCareer === 'entry-level', b)
  t('London detected', b.city === 'London', b)
  t('£50k parsed to 50000', b.minSalary === 50000, b)
  t('GBP currency inferred', b.salaryCurrency === 'GBP', b)
  t('role is product', /product/i.test(b.q), b.q)

  const c = P('AI/ML jobs in the US that accept new graduates')
  t('graduate detected', c.earlyCareer === 'graduate', c)

  const d = P('Backend engineering roles using Python posted this week')
  t('python detected as a skill', (d.skills ?? []).includes('python'), d.skills)
  t('this week -> 7 days', d.postedWithinDays === 7, d)
  t('role is backend engineering', /backend/i.test(d.q), d.q)

  const e = P('Jobs in India that sponsor visas')
  t('visa sponsorship detected', e.visaSponsorship === true, e)
  t('India detected', e.country === 'India', e)
}

/* --------------------------- level precedence ------------------------------ */
{
  // "graduate engineer" is an early-career role, not a seniority.
  const g = P('graduate software engineer')
  t('graduate wins over seniority', g.earlyCareer === 'graduate' && !g.seniority, g)

  const s = P('senior backend engineer')
  t('senior maps to seniority', s.seniority === 'senior' && !s.earlyCareer, s)

  // Only one level chip -- two contradictory chips would be incoherent.
  const both = P('senior graduate scheme')
  t('never emits both a level and a seniority',
    !(both.earlyCareer && both.seniority), both)
}

/* ------------------------------- work mode --------------------------------- */
{
  t('hybrid detected', P('hybrid data analyst').workMode === 'hybrid')
  t('onsite detected', P('on-site warehouse role').workMode === 'onsite')
  t('hybrid is NOT remote', P('hybrid data analyst').remote !== true, P('hybrid data analyst'))
  t('wfh maps to remote', P('wfh developer').remote === true)
}

/* -------------------------------- salary ----------------------------------- */
{
  t('$100k+', P('solidity jobs paying $100k+').minSalary === 100000)
  t('USD inferred', P('jobs paying $100k+').salaryCurrency === 'USD')
  t('bare "over 80k"', P('jobs over 80k').minSalary === 80000)
  t('€ inferred', P('roles above €60k').salaryCurrency === 'EUR')

  // A year is not a salary.
  const y = P('graduate scheme 2026')
  t('a year is not read as salary', y.minSalary === undefined, y)
}

/* ------------------------------- locations --------------------------------- */
{
  t('country beats city when both could match', P('jobs in Germany').country === 'Germany')
  t('region expands to countries', REGIONS.Europe.includes('Germany'))
  t('unknown places are not invented',
    P('jobs in Wakanda').country === undefined && P('jobs in Wakanda').city === undefined,
    P('jobs in Wakanda'))

  // Short city names are skipped: a three-letter token matches far too much.
  const short = P('jobs in Ely')
  t('very short city names are not matched', short.city === undefined, short)
}

/* ------------------------------ honest warnings ---------------------------- */
{
  // The corpus cannot answer these for most postings, and the UI must say so.
  t('salary filter warns about 3.6% coverage',
    P('jobs paying $100k+').warnings.some((w) => /3\.6%/.test(w)), P('jobs paying $100k+').warnings)
  t('visa filter warns about 2.5% coverage',
    P('jobs that sponsor visas').warnings.some((w) => /2\.5%/.test(w)))
  t('remote filter warns about the flag',
    P('remote jobs').warnings.some((w) => /7%/.test(w)))
  t('date filter warns about 42% coverage',
    P('jobs posted this week').warnings.some((w) => /42%/.test(w)))
  t('a plain query warns about nothing', P('software engineer').warnings.length === 0)
}

/* --------------------------------- tokens ---------------------------------- */
{
  const a = P('Remote Python internships in Germany posted this week')
  const kinds = a.tokens.map((x) => x.kind)
  t('emits a chip per recognised constraint',
    ['workMode', 'level', 'date', 'location', 'skill', 'role'].every((k) => kinds.includes(k)), kinds)
  t('every chip records the text it came from',
    a.tokens.every((x) => typeof x.matched === 'string' && x.matched.length > 0), a.tokens)
  t('every chip names the field it controls',
    a.tokens.every((x) => typeof x.field === 'string'), a.tokens)
}

/* ------------------------------ params mapping ----------------------------- */
{
  const p = intentToParams(P('Remote graduate jobs in Germany posted this week'))
  t('maps remote', p.get('remote') === 'true', p.toString())
  t('maps earlyCareer', p.get('earlyCareer') === 'graduate', p.toString())
  t('maps country', p.get('country') === 'Germany', p.toString())
  t('maps date', p.get('postedWithinDays') === '7', p.toString())

  const r = intentToParams(P('internships in Europe'))
  t('region becomes a country list', (r.get('country') ?? '').split(',').length > 5, r.get('country'))
}

/* -------------------------------- degraded --------------------------------- */
{
  t('empty query does not throw', P('').q === '')
  t('whitespace only', P('    ').tokens.length === 0)
  t('punctuation only', P('???').q === '')
  t('undefined input', parseQuery(undefined, KNOWN).q === '')
  t('a query of pure stop words yields no role chip',
    P('jobs for the').tokens.filter((x) => x.kind === 'role').length === 0, P('jobs for the'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
