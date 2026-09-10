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
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
