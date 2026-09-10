/**
 * Sponsor-register matching tests.
 *
 * The failure that matters here is the FALSE POSITIVE. Telling somebody that
 * an employer holds a Skilled Worker licence when it does not could cost them
 * an application, and in a 143,000-row register a loose matcher finds a
 * plausible hit for almost any word. So most of these tests assert refusal.
 */
const {
  parseCsv, normalizeOrgName, buildSponsorIndex, matchSponsor,
} = await import('../lib/visa/sponsor-registers.ts')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/* ---------------------------------- CSV ----------------------------------- */

t('parses a plain row',
  JSON.stringify(parseCsv('a,b,c\n1,2,3')) === JSON.stringify([['a','b','c'],['1','2','3']]))

t('parses quoted commas',
  parseCsv('name,town\n"Smith, Jones Ltd",London')[1][0] === 'Smith, Jones Ltd',
  parseCsv('name,town\n"Smith, Jones Ltd",London')[1])

t('parses doubled quotes',
  parseCsv('name\n"""Aa-Dee"" Machinefabriek"')[1][0] === '"Aa-Dee" Machinefabriek',
  parseCsv('name\n"""Aa-Dee"" Machinefabriek"')[1])

t('skips blank lines', parseCsv('a,b\n\n1,2\n').length === 2)

/* ------------------------------ normalisation ----------------------------- */

t('normalises punctuation and case',
  normalizeOrgName('Smith & Jones, Ltd.') === 'smith and jones ltd',
  normalizeOrgName('Smith & Jones, Ltd.'))

/* -------------------------------- matching -------------------------------- */

const register = {
  country: 'UK',
  sourceUrl: 'https://example.gov.uk/register.csv',
  publishedAt: '2026-09-10T08:54:31+01:00',
  fetchedAt: new Date().toISOString(),
  rows: [
    { name: 'Barclays Bank PLC', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Amazon UK Services Ltd', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Oracle Corporation UK Limited', town: 'Reading', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Circle Health Group Limited', town: 'Bath', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Apple Tree Day Nursery Ltd', town: 'Leeds', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Remote Handling Systems Ltd', town: 'Oxford', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Jane Street Europe Limited', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Monzo Bank Limited', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    { name: 'Stripe Payments UK Ltd', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
  ],
}
const idx = buildSponsorIndex(register)

// --- accepted: the register name is the company plus qualifiers only.
t('Amazon matches "Amazon UK Services Ltd"',
  matchSponsor('Amazon', idx)?.matchedName === 'Amazon UK Services Ltd',
  matchSponsor('Amazon', idx))

t('Oracle matches "Oracle Corporation UK Limited"',
  matchSponsor('Oracle', idx)?.matchedName === 'Oracle Corporation UK Limited',
  matchSponsor('Oracle', idx))

t('match carries the route as evidence',
  matchSponsor('Amazon', idx)?.routes.includes('Skilled Worker'))

t('match carries the source url and publish date',
  matchSponsor('Amazon', idx)?.sourceUrl === register.sourceUrl &&
  matchSponsor('Amazon', idx)?.publishedAt === register.publishedAt)

// --- REFUSED: a different company that merely starts with the same word.
t('Circle does NOT match "Circle Health Group Limited"',
  matchSponsor('Circle', idx) === null, matchSponsor('Circle', idx))

t('Apple does NOT match "Apple Tree Day Nursery Ltd"',
  matchSponsor('Apple', idx) === null, matchSponsor('Apple', idx))

t('Remote does NOT match "Remote Handling Systems Ltd"',
  matchSponsor('Remote', idx) === null, matchSponsor('Remote', idx))

// --- REFUSED: a company simply absent from the register.
t('an absent company returns null', matchSponsor('Zzyzx Industries', idx) === null)

t('a very short name is refused outright', matchSponsor('BP', idx) === null)

// --- "Bank" is not a qualifier, so these must be refused rather than assumed.
t('Barclays does not match on a non-qualifier remainder',
  matchSponsor('Barclays', idx) === null, matchSponsor('Barclays', idx))

// --- but the full legal name still matches exactly.
t('the full legal name matches',
  matchSponsor('Barclays Bank PLC', idx)?.matchKind === 'exact',
  matchSponsor('Barclays Bank PLC', idx))

t('Monzo Bank Limited matches exactly',
  matchSponsor('Monzo Bank', idx)?.matchedName === 'Monzo Bank Limited',
  matchSponsor('Monzo Bank', idx))

t('Jane Street matches through the Europe entity',
  matchSponsor('Jane Street', idx)?.matchedName === 'Jane Street Europe Limited',
  matchSponsor('Jane Street', idx))

t('Stripe matches "Stripe Payments UK Ltd" only via qualifiers',
  matchSponsor('Stripe Payments', idx)?.matchedName === 'Stripe Payments UK Ltd',
  matchSponsor('Stripe Payments', idx))

/* --------------------- the wrong-entity-same-name trap -------------------- */
{
  // The real register contains an organisation named "WISE" holding only
  // religious routes. It is an exact string match for Wise the payments
  // company and must not be presented as one.
  const reg2 = {
    country: 'UK', sourceUrl: 'https://example.gov.uk/r.csv', publishedAt: '2026-09-10',
    fetchedAt: new Date().toISOString(),
    rows: [
      { name: 'WISE', town: 'Leeds', rating: 'Worker (A rating)', route: 'Religious Worker' },
      { name: 'WISE', town: 'Leeds', rating: 'Worker (A rating)', route: 'Tier 2 Minister of Religion' },
      { name: 'Deliveroo Ltd', town: 'London', rating: 'Worker (A rating)', route: 'Skilled Worker' },
    ],
  }
  const i2 = buildSponsorIndex(reg2)
  const wise = matchSponsor('Wise', i2)
  t('religious-only licence is flagged as not covering skilled work',
    wise !== null && wise.coversSkilledWork === false, wise)
  t('religious-only licence carries a lowConfidence reason',
    Boolean(wise?.lowConfidence), wise?.lowConfidence)

  const del = matchSponsor('Deliveroo', i2)
  t('a genuine skilled-worker licence covers skilled work',
    del?.coversSkilledWork === true, del)
  t('a genuine licence is not flagged low confidence',
    del !== null && del.lowConfidence === undefined, del?.lowConfidence)
}

{
  // When several entities share a name, show the one with the skilled route.
  const reg3 = {
    country: 'UK', sourceUrl: 'u', publishedAt: null, fetchedAt: '',
    rows: [
      { name: 'Acme', town: 'Hull', rating: 'A', route: 'Charity Worker' },
      { name: 'Acme', town: 'London', rating: 'A', route: 'Skilled Worker' },
    ],
  }
  const m = matchSponsor('Acme', buildSponsorIndex(reg3))
  t('prefers the entry holding a skilled route', m?.coversSkilledWork === true, m)
  t('evidence names the skilled entity', m?.matchedName === 'Acme', m?.matchedName)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
