import { parseLocation, parseLocations, locationMatches } from '../lib/location.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => { if (cond) { pass++; console.log('  PASS  ' + name) } else { fail++; console.log('  FAIL  ' + name + '  got: ' + JSON.stringify(got)) } }

// Real strings observed in the ingested data
const sf = parseLocation('San Francisco, CA')
t('US city+state -> country inferred', sf.city==='San Francisco' && sf.region==='California' && sf.country==='United States', sf)

const wd = parseLocation('US-CA-San Francisco')
t('Workday US-CA-San Francisco parses', wd.city==='San Francisco' && wd.region==='California' && wd.country==='United States', wd)

t('Workday form matches a plain city search', locationMatches(wd, 'san francisco'), wd.searchKeys)

const sfo = parseLocation('SFO')
t('airport code SFO -> San Francisco', sfo.city==='San Francisco', sfo)

const inoffice = parseLocation('In-Office')
t('"In-Office" is not treated as a place', inoffice.city===null && inoffice.display==='In-Office', inoffice)

const rem = parseLocation('Remote')
t('Remote flagged', rem.isRemote && rem.display==='Remote', rem)

const remUS = parseLocation('Remote - US')
t('"Remote - US" keeps the country', remUS.isRemote && remUS.country==='United States', remUS)

const hyb = parseLocation('Hybrid')
t('Hybrid is not remote', hyb.isRemote===false, hyb)

const lon = parseLocation('London, United Kingdom')
t('non-US city+country', lon.city==='London' && lon.country==='United Kingdom', lon)

const multi = parseLocations('London, United Kingdom; Dublin, Ireland')
t('multi-location splits into two', multi.length===2 && multi[0].city==='London' && multi[1].city==='Dublin', multi.map(m=>m.display))

t('state abbreviation search finds full name', locationMatches(sf, 'ca'), sf.searchKeys)
t('country search matches', locationMatches(lon, 'united kingdom'), lon.searchKeys)
t('remote query only matches remote', locationMatches(rem,'remote') && !locationMatches(sf,'remote'), null)


// Regression: an arrangement prefix must not become part of the city name.
const hy = parseLocation('Hybrid - New York, NY')
t('"Hybrid - New York, NY" -> city New York', hy.city==='New York' && hy.region==='New York', hy)
const paren = parseLocation('Austin, TX (Hybrid)')
t('trailing "(Hybrid)" stripped', paren.city==='Austin' && paren.region==='Texas', paren)
const onsite = parseLocation('Onsite - London, United Kingdom')
t('"Onsite -" prefix stripped', onsite.city==='London' && onsite.country==='United Kingdom', onsite)

// Regression: a bare country must not become a city, and multi-site
// placeholders must not become a place at all.
const us = parseLocation('United States')
t('bare "United States" is a country not a city', us.country==='United States' && us.city===null, us)
const de = parseLocation('Germany')
t('bare "Germany" is a country', de.country==='Germany' && de.city===null, de)
const two = parseLocation('2 Locations')
t('"2 Locations" is not a city', two.city===null, two)
const multi2 = parseLocation('Multiple Locations')
t('"Multiple Locations" is not a city', multi2.city===null, multi2)
const emea = parseLocation('EMEA')
t('"EMEA" region marker is not a city', emea.city===null, emea)
const stillCity = parseLocation('Paris')
t('a real bare city is still a city', stillCity.city==='Paris', stillCity)

// Regression: cities and US states must never be classified as countries.
// At scale the old permissive rule produced 669 distinct "countries".
for (const notACountry of ['Kobe','Auckland','Nagoya-shi','Tours','Albi']) {
  const r = parseLocation(notACountry)
  t(`"${notACountry}" is a city, not a country`, r.country===null && r.city!==null, r)
}
for (const state of ['Iowa','Wyoming','Kansas']) {
  const r = parseLocation(state)
  t(`"${state}" is not a country`, r.country===null, r)
}
for (const real of ['Japan','New Zealand','Portugal','Israel']) {
  const r = parseLocation(real)
  t(`"${real}" is still recognised as a country`, r.country===real, r)
}

// Regression: postal addresses must not become cities or countries.
{
  const r = parseLocation('No.16 Hongfeng Road, Nanjing, China')
  t('street dropped, real city kept', r.city==='Nanjing' && r.country==='China', r)
}
{
  const r = parseLocation('Jalan Molek 3/20, Johor Bahru, Malaysia')
  t('non-English street form handled', r.city==='Johor Bahru' && r.country==='Malaysia', r)
}
{
  const r = parseLocation('Whitefield RD - Adm: Intl Tech Park, Bangalore, Gurugram')
  t('campus name dropped', r.city==='Bangalore', r)
  t('unresolvable trailing token is not a country', r.country===null, r)
}
{
  const r = parseLocation('San Francisco, CA, USA')
  t('ordinary US address unaffected', r.city==='San Francisco' && r.region==='California' && r.country==='United States', r)
}

// Regression: Workday's "<country> - <city>" form. NAB's whole board is this
// shape, and before the dash was read the country was lost entirely -- the
// string became a phantom city and the posting missed every country filter.
{
  const r = parseLocation('Vietnam - Ho Chi Minh City')
  t('leading country before a dash is read', r.country==='Vietnam', r)
}
{
  const r = parseLocation('India - Bengaluru')
  t('dash form resolves country and canonical city', r.country==='India' && r.city==='Bangalore', r)
}
{
  const r = parseLocation('Netherlands - Amsterdam')
  t('dash form works for a second country', r.country==='Netherlands' && r.city==='Amsterdam', r)
}
{
  // "Georgia" is a US state far more often than the country in this position,
  // and nothing in the string settles it -- so the trailing form must NOT match.
  const r = parseLocation('Atlanta - Georgia')
  t('trailing country name is not claimed as a country', r.country===null, r)
}
{
  const r = parseLocation('Embassy Park - Bengaluru')
  t('facility prefix is not mistaken for a country', r.country===null, r)
}

// Regression: a bare lowercase ISO alpha-2 code in the THIRD-or-later comma
// position. Employers write "Beirut, Beirut Governorate, lb"; the country is
// stated and the name lookup alone never saw it, because COUNTRY_LOOKUP is
// built from ICU display names and full-name aliases only.
//
// Safe only in position three or later: the US convention is "City, ST" or
// "City, ST, USA", so a bare state code never lands there. Position two must
// stay ambiguous, and the last two cases assert that it still does.
{
  const r = parseLocation('Beirut, Beirut Governorate, lb')
  t('lowercase ISO code in third position resolves', r.country==='Lebanon', r)
}
{
  const r = parseLocation('Timișoara, TM, ro')
  t('ISO code resolves even with a non-ASCII city', r.country==='Romania', r)
}
{
  const r = parseLocation('Boston, MA, US')
  t('a US address with a trailing code still reads as the US',
    r.country==='United States' && r.region==='Massachusetts', r)
}
{
  // MA is Morocco AND Massachusetts. In position two it must remain the state.
  const r = parseLocation('Springfield, MA')
  t('an ambiguous code in position two is still read as a US state',
    r.region==='Massachusetts' && r.country==='United States', r)
}
{
  // IN is India AND Indiana; this must keep deferring to the corpus resolver
  // rather than being settled here by the new code path.
  const r = parseLocation('Bangalore, IN')
  t('position-two ambiguity is still deferred, not resolved by ISO lookup',
    r.country==='United States' && r.region==='Indiana', r)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
