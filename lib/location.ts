/**
 * Location normalisation.
 *
 * Every ATS writes location differently, and the raw strings are unusable as a
 * filter facet. Real examples from the ingest:
 *
 *   "In-Office"                              (Cloudflare - no place at all)
 *   "San Francisco, CA"                      (Greenhouse)
 *   "SFO"                                    (airport code)
 *   "US-CA-San Francisco"                    (Workday)
 *   "Remote - US"  /  "Remote, United States" /  "Anywhere"
 *   "London, United Kingdom; Dublin, Ireland" (two places, one field)
 *
 * Filtering on the raw text means "San Francisco" misses "US-CA-San Francisco"
 * and matches nothing for "SFO". This parses each string into
 * { city, region, country, remote } so the facet groups the way a person
 * expects, and so a search for a city finds every spelling of it.
 *
 * Deliberately rule-based rather than an API call: it runs over ~10k rows at
 * ingest time, must be deterministic, and must not fail when a geocoder is
 * rate-limited. Unrecognised input is preserved verbatim rather than guessed.
 */

export interface ParsedLocation {
  /** Original string, always preserved. */
  raw: string
  city: string | null
  region: string | null
  country: string | null
  isRemote: boolean
  /** Canonical display form used by the facet. */
  display: string
  /** Lowercase tokens for matching, includes aliases. */
  searchKeys: string[]
  /**
   * Set when the second component was a code meaning both a US state and a
   * country (IN, CA, DE...). Resolved later from corpus evidence.
   */
  ambiguousCode?: string | null
}

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'United States', usa: 'United States', 'u.s.': 'United States',
  'u.s.a.': 'United States', 'united states of america': 'United States',
  uk: 'United Kingdom', gb: 'United Kingdom', 'great britain': 'United Kingdom',
  england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  de: 'Germany', deutschland: 'Germany', fr: 'France', es: 'Spain', it: 'Italy',
  nl: 'Netherlands', holland: 'Netherlands', ie: 'Ireland', pl: 'Poland',
  ca: 'Canada', au: 'Australia', nz: 'New Zealand', in: 'India', sg: 'Singapore',
  jp: 'Japan', kr: 'South Korea', cn: 'China', br: 'Brazil', mx: 'Mexico',
  ch: 'Switzerland', se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland',
  pt: 'Portugal', at: 'Austria', be: 'Belgium', cz: 'Czechia', il: 'Israel',
  ae: 'United Arab Emirates', za: 'South Africa', ar: 'Argentina',
}

/** Well-known city aliases and airport codes seen in real postings. */
const CITY_ALIASES: Record<string, string> = {
  sf: 'San Francisco', sfo: 'San Francisco', 'san fran': 'San Francisco',
  nyc: 'New York', ny: 'New York', 'new york city': 'New York',
  la: 'Los Angeles', lax: 'Los Angeles',
  bengaluru: 'Bangalore', blr: 'Bangalore',
  ldn: 'London', lon: 'London',
  ber: 'Berlin', ams: 'Amsterdam', tor: 'Toronto', yyz: 'Toronto',
  sea: 'Seattle', bos: 'Boston', chi: 'Chicago', atx: 'Austin',
}

const REMOTE_RE = /\b(remote|anywhere|work from home|wfh|distributed|virtual)\b/i
const HYBRID_RE = /\bhybrid\b/i

/**
 * The full country names we recognise. Built from the alias table's values plus
 * the common names that have no abbreviation in it.
 *
 * Without this, a bare "United States" fell through to the city branch (the
 * alias table keys on "us"/"usa", not the full name) and 259 postings were
 * filed under a CITY called "United States".
 */
/**
 * Every ISO 3166-1 region name, derived at runtime from the ICU data that
 * ships with the JS engine. This is a real global country database rather than
 * a hand-maintained list, so it stays correct without maintenance and covers
 * territories a curated list would miss.
 */
const KNOWN_COUNTRIES: Set<string> = (() => {
  const set = new Set<string>()
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b)
        try {
          const name = dn.of(code)
          if (name && name !== code) set.add(name.toLowerCase())
        } catch { /* not a valid region code */ }
      }
    }
  } catch { /* Intl unavailable: fall back to the alias table alone */ }
  // Common forms ICU spells differently.
  for (const extra of Object.values(COUNTRY_ALIASES)) set.add(extra.toLowerCase())
  set.add('united states').add('united kingdom').add('south korea').add('russia')
  set.add('vietnam').add('czechia').add('czech republic').add('turkey')
  return set
})()

/**
 * Strings that are a work arrangement or a placeholder, not a place.
 *
 * "2 Locations" / "Multiple Locations" are what Workday and Greenhouse emit
 * when a requisition spans sites; treating them as a city produced a bogus
 * facet entry with 315 postings under it.
 */
const NON_PLACE =
  /^(in[- ]?office|on[- ]?site|onsite|hybrid|various|flexible|tbd|n\/a|none|-|\d+\s*locations?|multiple\s+locations?|multiple|other|worldwide|global|international|emea|apac|amer|americas|nam|latam)$/i

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
}

/**
 * Resolve a token to a country, or null.
 *
 * This USED to title-case any alphabetic string longer than three characters
 * and call it a country. At scale that produced 669 distinct "countries" from
 * 195 real ones -- Kobe, Auckland, Iowa and Wyoming were all filed as
 * countries. Membership in the ISO list is now required: an unrecognised token
 * is not a country, and the caller treats it as a city instead.
 */
function canonCountry(token: string): string | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t]
  if (KNOWN_COUNTRIES.has(t)) return titleCase(t)
  return null
}

function canonCity(token: string): string {
  const t = token.trim().toLowerCase()
  return CITY_ALIASES[t] ?? titleCase(t)
}

/**
 * Does this component look like a street address rather than a city?
 *
 * Employers routinely put the full postal address in the location field
 * ("No.16 Hongfeng Road, Nanjing, China"). Taking the first component as the
 * city then files the posting under a city called "No.16 Hongfeng Road", which
 * fragments the city facet with one-off entries.
 */
function looksLikeStreetAddress(token: string): boolean {
  const t = token.trim()
  if (!t) return false
  // A leading building/house number, or a postcode-style alphanumeric block.
  if (/^\d+[\w-]*\s/.test(t)) return true
  if (/^[A-Z]?\d{3,}[A-Z]{0,2}\b/i.test(t)) return true
  // Thoroughfare words, in the languages that show up in ATS data.
  if (/\b(road|rd|street|st|avenue|ave|lane|ln|drive|dr|boulevard|blvd|highway|hwy|suite|ste|floor|building|bldg|block|plot|jalan|calle|rua|strasse|straße|via)\b/i.test(t)) {
    return true
  }
  // "Tech Park", "Business Park", "Industrial Estate" -- campus names, not cities.
  if (/\b(tech\s*park|business\s*park|industrial\s*(estate|park)|campus|tower|plaza)\b/i.test(t)) {
    return true
  }
  return false
}

/**
 * Everyday spellings of ISO regions -> the canonical ICU name.
 *
 * ICU decorates several region names in ways nobody writes in a job posting:
 * "Hong Kong SAR China", "Macao SAR China", "Congo - Kinshasa",
 * "Côte d'Ivoire" with a curly apostrophe. An employer writes "Hong Kong".
 * Matching only the decorated form meant Hong Kong was not recognised as a
 * region at all, so its postings fell through to a majority vote that put them
 * in Singapore.
 *
 * Rather than hand-maintain the exceptions, each ICU name is reduced to the
 * forms people actually type, and every variant points back at the canonical
 * name so one spelling is stored.
 */
const COUNTRY_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>()

  const variants = (name: string): string[] => {
    const out = new Set<string>()
    const base = name.trim()
    out.add(base)
    // Strip diacritics and normalise curly apostrophes: "Côte d’Ivoire".
    const plain = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'")
    out.add(plain)
    for (const v of [...out]) {
      // "Hong Kong SAR China" -> "Hong Kong"; "Macao SAR China" -> "Macao".
      const noSar = v.replace(/\s+SAR\b.*$/i, '').trim()
      if (noSar) out.add(noSar)
      // "Congo - Kinshasa" -> "Congo".
      const noDash = v.split(' - ')[0].trim()
      if (noDash) out.add(noDash)
    }
    return [...out].filter(Boolean)
  }

  const add = (canonical: string) => {
    for (const v of variants(canonical)) {
      const key = v.toLowerCase()
      // First writer wins, so a decorated name never overwrites a plain one.
      if (!map.has(key)) map.set(key, canonical)
    }
  }

  // ICU first: it is the only source with correct casing, and "first writer
  // wins" means whatever runs first supplies the canonical spelling. Seeding
  // from the lowercased KNOWN_COUNTRIES set first made "Singapore" resolve to
  // "singapore", which then showed up lowercased in the country facet.
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b)
        try {
          const name = dn.of(code)
          if (name && name !== code) add(name)
        } catch { /* not a valid region code */ }
      }
    }
  } catch { /* Intl unavailable */ }
  // Then the alias set, title-cased, for anything ICU does not emit.
  for (const name of KNOWN_COUNTRIES) add(titleCase(name))

  // Spellings ICU does not emit at all.
  for (const [alias, canonical] of [
    ['macau', 'Macao SAR China'],
    ['hongkong', 'Hong Kong SAR China'],
    ['uae', 'United Arab Emirates'],
    ['holland', 'Netherlands'],
  ] as const) {
    if (!map.has(alias)) map.set(alias, canonical)
  }
  return map
})()

/**
 * The canonical ISO region name for a string, or null if it names no region.
 *
 * Returns the canonical spelling so that "Hong Kong", "hongkong" and
 * "Hong Kong SAR China" all store one value instead of three facet entries.
 */
export function canonicalCountryName(s: string | null | undefined): string | null {
  if (!s) return null
  const key = s.trim().toLowerCase().replace(/[’‘]/g, "'")
  return (
    COUNTRY_LOOKUP.get(key) ??
    COUNTRY_LOOKUP.get(key.normalize('NFD').replace(/[̀-ͯ]/g, '')) ??
    null
  )
}

/**
 * Is this string the name of an ISO 3166-1 region (country or territory)?
 *
 * Used to recognise city-states and territories. Employers write "Singapore"
 * or "Hong Kong" as the whole location, which parses as a city with no
 * country -- and then the posting is invisible to a country filter even though
 * the country is sitting right there in the string.
 */
export function isCountryName(s: string | null | undefined): boolean {
  return canonicalCountryName(s) !== null
}

/**
 * Strip the legal-entity and facility decoration employers wrap city names in.
 *
 * Real examples from bank ATS feeds:
 *   "Mufg Global Service Private Ltd. - Bengaluru (bcit)" -> "Bengaluru"
 *   "Pune - Business Bay"                                 -> "Pune"
 *   "Sydney Cbd Area"                                     -> "Sydney"
 *   "Glasgow Campus"                                      -> "Glasgow"
 *
 * Each of these otherwise becomes its own one-off entry in the city facet, so
 * the same office shows up as several different "cities".
 *
 * Only decoration is removed. If stripping would leave nothing, or leave
 * something that no longer looks like a place name, the original is kept --
 * mangling a city we simply do not recognise is worse than leaving it alone.
 */
export function stripFacilityDecoration(city: string): string {
  let t = city.trim()
  if (!t) return city

  // "<Legal entity> - <City> (code)" -- take the segment after the last dash,
  // which is where the place name sits in this pattern.
  if (/\b(ltd|limited|pvt|private|inc|llc|gmbh|plc|corp|corporation|services?|solutions)\b/i.test(t) && t.includes('-')) {
    const tail = t.split('-').pop()?.trim()
    if (tail && tail.length > 2) t = tail
  }

  // Trailing parenthetical site codes: "Bengaluru (bcit)".
  t = t.replace(/\s*\([^)]*\)\s*$/, '').trim()

  // Facility words appended to a real city name.
  t = t
    .replace(/\s*[-–,]\s*(business\s*bay|tech\s*park|business\s*park|campus|office|branch|site|hub|centre|center|tower|plaza|building)\b.*$/i, '')
    .replace(/\s+(cbd\s*area|cbd|metro\s*area|metropolitan\s*area|campus|office|branch|site|hub)$/i, '')
    .trim()

  t = t.replace(/[\s,\-–]+$/, '').trim()

  // Refuse to return something that is no longer a plausible place name.
  if (t.length < 2 || /^\d+$/.test(t)) return city
  return t
}

/**
 * Parse one location string. Handles the Workday "US-CA-San Francisco" form,
 * comma-separated forms, and bare remote markers.
 */
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  const original = (raw ?? '').trim()
  const empty: ParsedLocation = {
    raw: original,
    city: null,
    region: null,
    country: null,
    isRemote: false,
    display: original || 'Not specified',
    searchKeys: [],
  }

  if (!original) return empty

  const isRemote = REMOTE_RE.test(original) && !HYBRID_RE.test(original)

  // "In-Office", "Hybrid" etc. describe an arrangement, not a place. Keep them
  // visible rather than inventing a location for them.
  if (NON_PLACE.test(original)) {
    return { ...empty, isRemote, display: titleCase(original) }
  }

  // Strip a leading work-arrangement prefix so "Remote - US" yields US and
  // "Hybrid - New York, NY" yields New York rather than a city literally named
  // "Hybrid - New York". Providers put the arrangement in this field freely.
  let work = original
    .replace(/^\s*(?:fully\s+)?(?:remote|hybrid|on[- ]?site|onsite|in[- ]?office|virtual)\s*[-–—,:|]\s*/i, '')
    .trim()
  // Also handle a trailing arrangement: "New York, NY (Hybrid)".
  work = work.replace(/\s*[\(\[]\s*(?:remote|hybrid|on[- ]?site|onsite|in[- ]?office)\s*[\)\]]\s*$/i, '').trim()
  if (REMOTE_RE.test(work) && work.replace(REMOTE_RE, '').replace(/[^a-z]/gi, '') === '') {
    return {
      raw: original,
      city: null,
      region: null,
      country: null,
      isRemote: true,
      display: 'Remote',
      searchKeys: ['remote', 'anywhere'],
    }
  }

  let city: string | null = null
  let region: string | null = null
  let country: string | null = null
  let ambiguousCode: string | null = null

  // Workday: "US-CA-San Francisco" or "USA-NY-New York"
  const wd = work.match(/^([A-Z]{2,3})-([A-Z]{2})-(.+)$/)
  if (wd) {
    country = canonCountry(wd[1]) ?? wd[1]
    region = US_STATES[wd[2]] ?? wd[2]
    city = canonCity(wd[3])
  } else {
    const parts = work.split(/\s*,\s*/).filter(Boolean)
    if (parts.length === 1) {
      const only = parts[0]
      const asCountry = canonCountry(only)
      // A single token that names a known country IS a country. Checking only
      // the abbreviation table missed every full name ("United States",
      // "Germany"), which then became a phantom city.
      const isKnownCountry =
        asCountry !== null &&
        (only.length <= 3 ||
          COUNTRY_ALIASES[only.toLowerCase()] !== undefined ||
          KNOWN_COUNTRIES.has(asCountry.toLowerCase()))
      if (isKnownCountry) {
        country = asCountry
      } else {
        city = canonCity(only)
      }
    } else if (parts.length >= 2) {
      // Drop leading street-address components so the city slot holds a city.
      // "No.16 Hongfeng Road, Nanjing, China" -> Nanjing, China.
      while (parts.length > 2 && looksLikeStreetAddress(parts[0])) parts.shift()

      city = canonCity(parts[0])
      const second = parts[1].trim()
      const secondUpper = second.toUpperCase()

      // AMBIGUOUS TWO-LETTER CODES.
      //
      // "IN" is both Indiana and India; likewise CA (California/Canada),
      // DE (Delaware/Germany), ID, LA, MO, MT, NE, PA, SC. Resolving these
      // blindly as US states put 210 Bangalore jobs in Indiana, United States.
      //
      // There is no way to settle it from the string alone, so the ambiguity is
      // RECORDED rather than guessed: `ambiguousCode` is set, and a later pass
      // over the whole corpus resolves it from unambiguous sightings of the
      // same city (see resolveAmbiguousLocations). Guessing here would be a
      // fabrication; deferring is not.
      const isAmbiguous =
        US_STATES[secondUpper] !== undefined &&
        COUNTRY_ALIASES[second.toLowerCase()] !== undefined &&
        parts.length === 2

      if (isAmbiguous) {
        ambiguousCode = secondUpper
        // Default to the US-state reading only because the abbreviation style
        // ("City, ST") is a US convention; the resolver overrides it whenever
        // the corpus disagrees.
        region = US_STATES[secondUpper]
        country = 'United States'
      } else if (US_STATES[secondUpper]) {
        region = US_STATES[secondUpper]
        country = parts[2] ? canonCountry(parts[2]) ?? 'United States' : 'United States'
      } else {
        const asCountry = canonCountry(second)
        if (parts.length === 2) {
          country = asCountry
        } else {
          // Scan the remaining components for a real country rather than
          // assuming the third one is it. Multi-line addresses put the country
          // last ("Street, City, Region, Country"), and the old
          // `?? titleCase(parts[2])` fallback promoted whatever sat in slot 2
          // to a country -- which is how "Jalan Molek 3/20", "No.16 Hongfeng
          // Road" and "3500GS Utrecht" became countries.
          const tail = parts.slice(2)
          const found = tail.map(canonCountry).find((c): c is string => c !== null)
          country = found ?? null
          // Only claim a region when we actually resolved a country; otherwise
          // the components are address noise and guessing at them adds nothing.
          region = found ? titleCase(second) : null
          if (!found) {
            // The first component is still the most likely city; the rest is
            // an address we cannot interpret, and it is preserved in `raw`.
            city = canonCity(parts[0])
          }
        }
      }
    }
  }

  const display =
    [city, region && region !== city ? region : null, country].filter(Boolean).join(', ') ||
    (isRemote ? 'Remote' : original)

  const keys = new Set<string>()
  for (const v of [city, region, country]) if (v) keys.add(v.toLowerCase())
  if (isRemote) {
    keys.add('remote')
    keys.add('anywhere')
  }
  // Include the raw form so an exact-text search still matches.
  keys.add(original.toLowerCase())
  // Include the state abbreviation as well as the full name.
  for (const [abbr, full] of Object.entries(US_STATES)) {
    if (region === full) keys.add(abbr.toLowerCase())
  }
  // Reverse city aliases: searching "SFO" should find San Francisco and vice versa.
  for (const [alias, full] of Object.entries(CITY_ALIASES)) {
    if (city === full) keys.add(alias)
  }

  return { raw: original, city, region, country, isRemote, display, searchKeys: [...keys], ambiguousCode }
}

/**
 * Some providers pack several places into one field, separated by ";" or "|".
 * Splitting them means a London/Dublin posting appears under both cities
 * instead of under a bogus "London, United Kingdom; Dublin" pseudo-location.
 */
export function parseLocations(raw: string | null | undefined): ParsedLocation[] {
  if (!raw) return [parseLocation(raw)]
  const chunks = raw.split(/\s*[;|]\s*|\s+(?:and|or)\s+/i).filter(Boolean)
  if (chunks.length <= 1) return [parseLocation(raw)]
  return chunks.map(parseLocation)
}

/** Does a location match a user's free-text query? */
export function locationMatches(parsed: ParsedLocation, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (q === 'remote' || q === 'anywhere') return parsed.isRemote
  return parsed.searchKeys.some((k) => k.includes(q) || q.includes(k))
}
