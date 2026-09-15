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
/* ----------------------- country-first feeds ------------------------------ */
/**
 * Several boards emit "COUNTRY, REGION, City" -- the reverse of the usual
 * order. The parser assumed city-first everywhere, so the country code landed
 * in the CITY slot: 5,322 rows of the 113,416-posting served index carried a
 * bare code as their city, 3,539 of them saying the city was "US".
 *
 * The damaging case was not cosmetic. "IT, RI, Passo Corese" -- a town in Italy
 * -- parsed as city "IT", region "Rhode Island", country "United States",
 * because component two read as a US state abbreviation. The posting was filed
 * on the wrong continent: invisible to an Italy filter, returned by a US one.
 */
{
  const usa = parseLocation('US, TX, Austin')
  t('country-first: city is the LAST component', usa.city === 'Austin', usa)
  t('country-first: region expands from the US state code', usa.region === 'Texas', usa)
  t('country-first: country comes from the leading code', usa.country === 'United States', usa)

  const italy = parseLocation('IT, RI, Passo Corese')
  t('the Italy/Rhode-Island case lands in Italy', italy.country === 'Italy', italy)
  t('the Italy/Rhode-Island case keeps its real city', italy.city === 'Passo Corese', italy)
  t('and claims no US region', italy.region !== 'Rhode Island', italy)

  const india = parseLocation('IN, KA, Bengaluru')
  t('"IN, KA, Bengaluru" is India, not Indiana', india.country === 'India', india)
  t('and its city is Bangalore', india.city === 'Bangalore', india)

  const au = parseLocation('AU, NSW, Sydney')
  t('"AU, NSW, Sydney" is Australia', au.country === 'Australia', au)
  t('and its city is Sydney', au.city === 'Sydney', au)

  const ca = parseLocation('CA, ON, Toronto')
  t('"CA, ON, Toronto" is Canada, not California', ca.country === 'Canada', ca)
  t('and its city is Toronto', ca.city === 'Toronto', ca)

  const nz = parseLocation('NZ, Auckland')
  t('two-component country-first works', nz.country === 'New Zealand' && nz.city === 'Auckland', nz)

  const gr = parseLocation('GR, Athens')
  t('ISO codes outside the alias table resolve too',
    gr.country === 'Greece' && gr.city === 'Athens', gr)

  const cn = parseLocation('CN, 13, Beijing')
  t('a numeric province code is dropped rather than shown', cn.region === null, cn)
  t('and the city and country still resolve',
    cn.city === 'Beijing' && cn.country === 'China', cn)
}

/* -------------- city-first strings must NOT be reversed ------------------- */
// Detection has to be narrow: guessing wrong here moves a job to another
// continent.
{
  const paris = parseLocation('Paris, France')
  t('"Paris, France" is untouched', paris.city === 'Paris' && paris.country === 'France', paris)

  const la = parseLocation('LA, California, United States')
  t('a trailing country proves the string is city-first',
    la.city === 'Los Angeles' && la.country === 'United States', la)

  const sf = parseLocation('San Francisco, CA, US')
  t('"San Francisco, CA, US" is untouched',
    sf.city === 'San Francisco' && sf.region === 'California' && sf.country === 'United States', sf)

  const munich = parseLocation('Munich, Bavaria, Germany')
  t('"Munich, Bavaria, Germany" is untouched',
    munich.city === 'Munich' && munich.country === 'Germany', munich)

  const georgia = parseLocation('Georgia, Atlanta')
  t('a leading full country NAME does not trigger reversal (Georgia is a state too)',
    georgia.country !== 'Georgia', georgia)

  const addr = parseLocation('No.16 Hongfeng Road, Nanjing, China')
  t('street addresses still resolve city-first',
    addr.city === 'Nanjing' && addr.country === 'China', addr)

  const austin = parseLocation('Austin, TX')
  t('"Austin, TX" is untouched',
    austin.city === 'Austin' && austin.region === 'Texas', austin)
}

/* ================= region-first, and the ambiguous codes ================== */
/**
 * "OH, Columbus" and "TX, Austin" put the US STATE first. Only city-first and
 * country-first were understood, so the state code landed in the city field --
 * 199 rows of the served index had a bare state code as their city.
 *
 * The hard part is the codes that are both: CA is California and Canada, IN is
 * Indiana and India, DE is Delaware and Germany. The stacked-code shape settles
 * most of it -- "CA, ON, Toronto" puts a second code in position two, which only
 * happens in country/region/city order -- and what it cannot settle is DEFERRED
 * to the corpus resolver rather than guessed.
 */
{
  const oh = parseLocation('OH, Columbus')
  t('"OH, Columbus" is Columbus, Ohio', oh.city === 'Columbus' && oh.region === 'Ohio', oh)
  t('and it is in the United States', oh.country === 'United States', oh)

  const tx = parseLocation('TX, Austin')
  t('"TX, Austin" is Austin, Texas', tx.city === 'Austin' && tx.region === 'Texas', tx)

  const ny = parseLocation('NY, New York')
  t('"NY, New York" resolves both halves', ny.city === 'New York' && ny.region === 'New York', ny)

  // The regression this guards: CA is a country code (Canada) AND a state code.
  const ca = parseLocation('CA, San Francisco')
  t('"CA, San Francisco" is California, NOT Canada', ca.country === 'United States', ca)
  t('and its city is San Francisco', ca.city === 'San Francisco', ca)
  t('but the ambiguity is recorded for the corpus resolver', ca.ambiguousCode === 'CA', ca)

  // Three parts with a code in position two is country-first, not region-first.
  const toronto = parseLocation('CA, ON, Toronto')
  t('"CA, ON, Toronto" is still Canada', toronto.country === 'Canada', toronto)
  const blr = parseLocation('IN, KA, Bengaluru')
  t('"IN, KA, Bengaluru" is still India', blr.country === 'India', blr)
}

/* ------------------- a full country name in the head ---------------------- */
{
  const us = parseLocation('United States, New York')
  t('"United States, New York" is New York, US', us.city === 'New York' && us.country === 'United States', us)

  // Georgia is a US state as well as a country; in the head position a state is
  // far more likely and nothing in the string settles it.
  const ga = parseLocation('Georgia, Atlanta')
  t('"Georgia, Atlanta" is not claimed as the country Georgia', ga.country !== 'Georgia', ga)
}

/* ========================= remote forms =================================== */
/**
 * Only a LEADING arrangement word was stripped, so "US Remote" became a city
 * literally named "US Remote" and "Remote (US)" a city named "Remote (us)".
 * Providers write the arrangement on whichever side reads better to them.
 */
{
  for (const [input, country] of [
    ['Remote - United States', 'United States'],
    ['Remote, United States', 'United States'],
    ['Remote - US', 'United States'],
    ['US Remote', 'United States'],
    ['Remote (US)', 'United States'],
    ['United Kingdom Remote', 'United Kingdom'],
  ]) {
    const r = parseLocation(input)
    t(`"${input}" is remote`, r.isRemote === true, r)
    t(`"${input}" resolves the country`, r.country === country, r)
    t(`"${input}" invents no city`, r.city === null, r)
  }
}

/* ------------------ continents and "everywhere" tokens -------------------- */
// These name a hiring SCOPE, not a place. Putting one in `city` produces rows
// whose city is "Europe" -- unmatched by any city filter, and a visible defect
// on the card.
{
  for (const input of ['Remote - Europe', 'Worldwide', 'EMEA', 'APAC', 'Global', 'Anywhere']) {
    const r = parseLocation(input)
    t(`"${input}" does not become a city`, r.city === null, r)
    t(`"${input}" does not become a country`, r.country === null, r)
  }
  t('"Worldwide" is remote', parseLocation('Worldwide').isRemote === true)
  t('"Anywhere" is remote', parseLocation('Anywhere').isRemote === true)
  t('"Remote - Europe" is remote', parseLocation('Remote - Europe').isRemote === true)
}

/* ------------------------- degenerate inputs ------------------------------ */
// Nothing here may invent a place.
{
  for (const input of ['', '   ', 'TBD', 'N/A', 'Multiple Locations', 'Various', '-', ',,,']) {
    const r = parseLocation(input)
    t(`${JSON.stringify(input)} yields no city`, r.city === null, r)
    t(`${JSON.stringify(input)} yields no country`, r.country === null, r)
  }
  t('raw is always preserved', parseLocation('TBD').raw === 'TBD')
}

/* -------------------- bare country forms still resolve -------------------- */
{
  for (const [input, expected] of [
    ['UK', 'United Kingdom'], ['GB', 'United Kingdom'], ['USA', 'United States'],
    ['U.S.', 'United States'], ['US', 'United States'],
  ]) {
    t(`"${input}" -> ${expected}`, parseLocation(input).country === expected, parseLocation(input))
  }
}

/* ============ region + country with no city, and code pairs ============== */
/**
 * "OH, United States" is a REGION and a country with no city in it. The
 * trailing country made detectReversal correctly refuse the string, and the
 * city-first path then put the bare code in the city field -- 51 rows said
 * their city was "OH".
 */
{
  const oh = parseLocation('OH, United States')
  t('"OH, United States" has no city', oh.city === null, oh)
  t('"OH, United States" expands the region', oh.region === 'Ohio', oh)
  t('"OH, United States" keeps the country', oh.country === 'United States', oh)

  const sg = parseLocation('SG, Singapore')
  t('"SG, Singapore" resolves the country', sg.country === 'Singapore', sg)
  t('and invents no city', sg.city === null, sg)

  const mh = parseLocation('MH, India')
  t('"MH, India" is India, not the Marshall Islands', mh.country === 'India', mh)

  // A pair of CODES is country-then-region, not region-then-country. Without
  // this "US, CA, Remote" filed a Californian job in Canada.
  const usca = parseLocation('US, CA, Remote')
  t('"US, CA, Remote" is the United States', usca.country === 'United States', usca)
  t('"US, CA, Remote" reads CA as California', usca.region === 'California', usca)
  t('"US, CA, Remote" invents no city', usca.city === null, usca)
  t('"US, CA, Remote" is remote', usca.isRemote === true, usca)
}

/* ================= Saint- cities vs street abbreviations ================== */
/**
 * The street heuristic matched "st" anywhere, so "St Louis" read as a street
 * and was dropped: "St Louis, MO, United States" parsed to a city of "MO".
 * A real address ENDS with the thoroughfare type, which is what separates them.
 */
{
  const stl = parseLocation('St Louis, MO, United States')
  t('"St Louis" survives as a city', stl.city === 'St Louis', stl)
  t('and keeps its state', stl.region === 'Missouri', stl)

  t('"St Paul, MN" survives', parseLocation('St Paul, MN').city === 'St Paul',
    parseLocation('St Paul, MN'))
  t('"Saint Petersburg, FL" survives',
    parseLocation('Saint Petersburg, FL').city === 'Saint Petersburg')
  // The abbreviation in the MIDDLE of a real city name.
  t('"Port St Lucie" survives',
    parseLocation('Port St Lucie, FL, United States').city === 'Port St Lucie')

  // ...while a genuine street is still dropped.
  t('a real street is still dropped',
    parseLocation('123 Main Street, Austin, TX').city === 'Austin')
}

/* --------------------------- casing of place names ------------------------ */
// titleCase upper-cased every word of two characters or fewer, which is right
// for a bare state code and wrong inside a name.
{
  t('"St" is not upper-cased inside a name',
    parseLocation('St Louis, MO, United States').city === 'St Louis')
  t('a bare state code keeps its case', parseLocation('Austin, TX').region === 'Texas')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
