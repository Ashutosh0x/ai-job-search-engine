/**
 * Tests for the missing-country backfill and city cleanup.
 *
 * The important cases here are the ones where the obvious implementation is
 * WRONG: a plain majority vote puts Hong Kong in Singapore, and an eager string
 * cleaner turns a real city into rubble.
 */
const { resolveAmbiguousLocations } = await import('../lib/pipeline/resolve-locations.ts')
const { stripFacilityDecoration, isCountryName } = await import('../lib/location.ts')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

const job = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  title: 'Engineer', company: 'Acme', companySlug: 'acme',
  city: null, state: null, country: null, locationRaw: null, locationDisplay: null,
  locations: [{ city: null, state: null, country: null, display: null }],
  skills: [], description: '', ...over,
})

const withLoc = (city, country) =>
  job({ city, country, locations: [{ city, state: null, country, display: city }] })

/* ------------------------------ city cleanup ------------------------------ */

t('strips legal entity + site code',
  stripFacilityDecoration('Mufg Global Service Private Ltd. - Bengaluru (bcit)') === 'Bengaluru',
  stripFacilityDecoration('Mufg Global Service Private Ltd. - Bengaluru (bcit)'))

t('strips business-bay suffix',
  stripFacilityDecoration('Pune - Business Bay') === 'Pune',
  stripFacilityDecoration('Pune - Business Bay'))

t('strips CBD area', stripFacilityDecoration('Sydney Cbd Area') === 'Sydney',
  stripFacilityDecoration('Sydney Cbd Area'))

t('strips campus', stripFacilityDecoration('Glasgow Campus') === 'Glasgow',
  stripFacilityDecoration('Glasgow Campus'))

t('leaves a clean city alone', stripFacilityDecoration('Bengaluru') === 'Bengaluru')
t('leaves a two-word city alone', stripFacilityDecoration('New York') === 'New York')
t('leaves hyphenated real cities alone',
  stripFacilityDecoration('Stratford-upon-Avon') === 'Stratford-upon-Avon',
  stripFacilityDecoration('Stratford-upon-Avon'))
t('never returns empty', stripFacilityDecoration('(bcit)').length > 0,
  stripFacilityDecoration('(bcit)'))

/* ------------------------------ country names ----------------------------- */

t('Singapore is a country name', isCountryName('Singapore'))
t('Hong Kong is a region name', isCountryName('Hong Kong'))
t('Bangalore is not a country', !isCountryName('Bangalore'))
t('empty is not a country', !isCountryName(''))

/* ---------------------------- city-state backfill ------------------------- */
{
  const jobs = [withLoc('Singapore', null), withLoc('Hong Kong', null)]
  const { jobs: out, report } = resolveAmbiguousLocations(jobs)
  t('Singapore fills its own country', out[0].country === 'Singapore', out[0].country)
  t('Hong Kong fills its own country, NOT Singapore',
    out[1].country !== 'Singapore' && out[1].country !== null, out[1].country)
  t('both counted as city-state fills', report.filledAsCityState === 2, report)
}

/* --------------------------- the Hong Kong trap --------------------------- */
{
  // Three mislabelled rows claim Hong Kong is in Singapore. A majority vote
  // would adopt that. Rule 1 must settle it before the vote is ever consulted.
  const jobs = [
    withLoc('Hong Kong', 'Singapore'), withLoc('Hong Kong', 'Singapore'),
    withLoc('Hong Kong', 'Singapore'), withLoc('Hong Kong', null),
  ]
  const { jobs: out } = resolveAmbiguousLocations(jobs)
  t('thin bad evidence does not move Hong Kong to Singapore',
    out[3].country !== 'Singapore', out[3].country)
}

/* --------------------------- evidence backfill ---------------------------- */
{
  // Five rows say Bangalore is in India; one orphan should adopt it.
  const jobs = [
    ...Array.from({ length: 5 }, () => withLoc('Bangalore', 'India')),
    withLoc('Bangalore', null),
  ]
  const { jobs: out, report } = resolveAmbiguousLocations(jobs)
  t('orphan Bangalore adopts India', out[5].country === 'India', out[5].country)
  t('counted as an evidence fill', report.filledFromEvidence === 1, report.filledFromEvidence)
  t('display string rebuilt', out[5].locationDisplay === 'Bangalore, India', out[5].locationDisplay)
}

/* ------------------------- thin evidence is refused ----------------------- */
{
  // Only two rows -- below MIN_EVIDENCE. Must stay null rather than guess.
  const jobs = [
    withLoc('Springfield', 'United States'), withLoc('Springfield', 'United States'),
    withLoc('Springfield', null),
  ]
  const { jobs: out, report } = resolveAmbiguousLocations(jobs)
  t('two rows are not enough to fill', out[2].country === null, out[2].country)
  t('the gap is reported, not hidden', report.orphansLeftUnfilled === 1, report)
}

/* ------------------------- split evidence is refused ---------------------- */
{
  // Six rows, evenly split -- genuinely ambiguous, so refuse.
  const jobs = [
    ...Array.from({ length: 3 }, () => withLoc('Cambridge', 'United States')),
    ...Array.from({ length: 3 }, () => withLoc('Cambridge', 'United Kingdom')),
    withLoc('Cambridge', null),
  ]
  const { jobs: out } = resolveAmbiguousLocations(jobs)
  t('split evidence leaves Cambridge unresolved', out[6].country === null, out[6].country)
}

/* --------------------------- no country invented -------------------------- */
{
  const jobs = [withLoc('Zzyzx', null)]
  const { jobs: out } = resolveAmbiguousLocations(jobs)
  t('unknown city gets no invented country', out[0].country === null, out[0].country)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
