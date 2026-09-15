import { detectReversal, isMacroRegion } from './location-order'
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
    .map((w) => {
      if (!w) return w
      /**
       * A short word is upper-cased only when it was ALREADY written as a code.
       *
       * The rule used to be "two characters or fewer -> upper-case", which is
       * right for a bare state code and wrong inside a place name: "st louis"
       * became "ST Louis", and the same hit St Paul, Da Nang and Le Havre.
       * Respecting the input's own casing separates a code from a word without
       * needing to know which places exist.
       */
      if (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w
      return w[0].toUpperCase() + w.slice(1)
    })
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
  // Thoroughfare words spelled out. Unambiguous wherever they appear.
  if (/\b(road|street|avenue|lane|drive|boulevard|highway|suite|floor|building|block|plot|jalan|calle|rua|strasse|straße|via)\b/i.test(t)) {
    return true
  }
  /**
   * The ABBREVIATIONS only mean a thoroughfare when they are not the first word.
   *
   * "st" was matched anywhere, so "St Louis" read as a street and was dropped:
   * "St Louis, MO, United States" parsed to a city of "MO". The same collision
   * hits St Paul, St Petersburg and every other Saint- city, and "dr" for Drive
   * against a leading title.
   *
   * A real address ENDS with the thoroughfare type ("Main St", "Park Ave"), so
   * position is what separates the two readings. Requiring it to be the last
   * word rather than merely not-the-first also keeps "Port St Lucie" -- a real
   * city with the abbreviation in the middle -- out of the street bucket.
   */
  if (/\S+\s+(rd|st|ave|ln|dr|blvd|hwy|ste|bldg)\.?$/i.test(t)) {
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
 * ISO 3166-1 alpha-2 code -> canonical country name, built from ICU.
 *
 * Deliberately SEPARATE from COUNTRY_LOOKUP. Two-letter codes cannot be folded
 * into the general name lookup, because half of them collide with US state
 * abbreviations -- MA is both Morocco and Massachusetts, IN both India and
 * Indiana, CA both Canada and California, DE both Germany and Delaware.
 * Resolving those blindly is the bug that once put 210 Bangalore jobs in
 * Indiana, so this map is only consulted from positions where a US state
 * abbreviation cannot appear (see parseLocation).
 *
 * Generated from ICU rather than hand-written, so it covers every region the
 * runtime knows and needs no maintenance when a code changes.
 */
const ISO_ALPHA2: Map<string, string> = (() => {
  const map = new Map<string, string>()
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b)
        try {
          const name = dn.of(code)
          if (name && name !== code) map.set(code.toLowerCase(), name)
        } catch { /* not a valid region code */ }
      }
    }
  } catch { /* Intl unavailable */ }
  return map
})()

/** Country name for a bare alpha-2 code, or null. Case-insensitive. */
export function countryFromCode(code: string | null | undefined): string | null {
  if (!code) return null
  const k = code.trim().toLowerCase()
  return k.length === 2 ? ISO_ALPHA2.get(k) ?? null : null
}

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
 * Read a "<country> - <city>" string, or null when the head is not a country.
 *
 * Split on the FIRST dash only, so "Vietnam - Ho Chi Minh City" keeps the city
 * whole and a hyphenated city ("Netherlands - 's-Hertogenbosch") survives.
 */
function dashCountry(s: string): { country: string; rest: string } | null {
  const m = s.match(/^([^-–—]+?)\s*[-–—]\s*(.+)$/)
  if (!m) return null
  const country = canonicalCountryName(m[1])
  if (!country) return null
  // A bare country code ("US - Chicago") is handled well enough here too, but
  // a one-letter head is noise rather than a country.
  if (m[1].trim().length < 2) return null
  return { country, rest: m[2].trim() }
}

/**
 * Parse one location string. Handles the Workday "US-CA-San Francisco" form,
 * the "<country> - <city>" form, comma-separated forms, and bare remote markers.
 */
/**
 * Is this comma list written country-first ("US, TX, Austin")?
 *
 * Narrow on purpose, because guessing wrong here relocates a job to another
 * continent. All three conditions must hold:
 *
 *   1. The first component is a BARE two or three letter code. Requiring a code
 *      rather than any country name is what keeps "Georgia, Atlanta" out: the
 *      full name is far more often a US state in that position, and nothing in
 *      the string settles it.
 *   2. That code resolves to a real country.
 *   3. The LAST component is not itself a country. "Paris, France" and
 *      "Berlin, DE" are already city-first and must be left alone; so is
 *      "LA, California, United States", where the trailing country is the
 *      evidence that "LA" is Los Angeles and not Laos.
 */
/**
 * Classify the component order of a comma list.
 *
 * The rules live in location-order.ts; this binds them to the lookup tables in
 * this module. `canonCountry` is the curated alias table and misses most ISO
 * codes, so `countryFromCode` backs it up -- that gap is why "GR, Athens" was
 * left with a city of "GR".
 */
/**
 * Is this "REGION_CODE, Country" with no city? ("OH, United States")
 *
 * Requires a bare two/three-letter head and a tail that genuinely resolves to a
 * country, so "Austin, TX" (tail is not a country) and "Paris, France" (head is
 * not a code) are both unaffected.
 */
function regionAndCountryOnly(parts: string[]): boolean {
  const head = parts[0].trim()
  if (!/^[A-Za-z]{2,3}$/.test(head)) return false
  const tail = parts[1].trim()
  /**
   * The tail must be a country SPELLED OUT, not another bare code.
   *
   * Without this, "US, CA, Remote" -- which the remote strip reduces to
   * "US, CA" -- matched with CA read as Canada, so a Californian job was filed
   * in Canada. A pair of codes is country-then-region, which detectReversal
   * already handles correctly; this rule is only for the spelled-out form.
   */
  if (/^[A-Za-z]{2,3}$/.test(tail)) return false

  return canonCountry(tail) !== null || countryFromCode(tail) !== null || isCountryName(tail)
}

function reversal(parts: string[]) {
  return detectReversal(parts, {
    usStates: US_STATES,
    headCountry,
    canonCountry: (v: string) => canonCountry(v),
    countryFromCode: (v: string) => countryFromCode(v),
    isCountryName: (v: string) => isCountryName(v),
  })
}

/** The country a leading code names, by alias table or ISO code. */
function headCountry(code: string): string | null {
  return canonCountry(code) ?? countryFromCode(code)
}

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

  // "Worldwide"/"Global" name a hiring scope of everywhere, which is remote by
  // definition; REMOTE_RE does not cover them because they are not the word.
  const isRemote =
    (REMOTE_RE.test(original) || isMacroRegion(original)) && !HYBRID_RE.test(original)

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

  /**
   * "Remote (US)" / "Remote [EMEA]" -- the place is inside the brackets.
   *
   * Handled before the trailing-word strip below, because that strip would
   * leave "(US)" behind and the bracket would end up in the city.
   */
  const bracketed = work.match(/^\s*(?:fully\s+)?(?:remote|virtual|distributed)\s*[\(\[]([^)\]]+)[\)\]]\s*$/i)
  if (bracketed) work = bracketed[1].trim()

  /**
   * A TRAILING arrangement word: "US Remote", "London - Remote", "India (Remote".
   *
   * Only the leading form was stripped, so "US Remote" became a city literally
   * named "US Remote" -- 0% of which resolve to anywhere. Providers write the
   * arrangement on whichever side reads better to them.
   */
  work = work
    .replace(/[\s,\-–—:|]*[\(\[]?\s*(?:fully\s+)?(?:remote|virtual|distributed|wfh|work from home)\s*[\)\]]?\s*$/i, '')
    .trim()
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
  } else if (dashCountry(work)) {
    // Workday: "India - Bengaluru", "Vietnam - Ho Chi Minh City".
    //
    // The country is sitting in plain sight at the head of the string, but the
    // comma split below never sees it -- the separator is a dash -- so the whole
    // thing became a phantom city ("India - Bengaluru") and the posting was
    // invisible to a country filter. NAB's board is 100% this shape.
    //
    // Only the LEADING segment is read as a country, deliberately. The reverse
    // ("Atlanta - Georgia") is a US state far more often than it is the country
    // Georgia, and there is nothing in the string to settle it -- so that form
    // is left to the existing paths rather than guessed at.
    const { country: c, rest } = dashCountry(work)!
    country = c
    city = rest ? canonCity(rest) : null
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
      } else if (isMacroRegion(only)) {
        // A continent or "worldwide" is a hiring SCOPE, not a place the job is
        // at. Leaving it in `city` produced rows whose city was "Europe" or
        // "EMEA", which no city filter can ever match and which reads as a
        // parse failure to anyone looking at the card. It stays visible in
        // `raw` and in the display string instead.
        city = null
      } else {
        city = canonCity(only)
      }
    } else if (parts.length >= 2 && reversal(parts)) {
      /**
       * COUNTRY-FIRST FEEDS: "US, TX, Austin", "AU, NSW, Sydney", "NZ, Auckland".
       *
       * Several boards emit location components in the reverse of the usual
       * order -- country code first, city last. The parser assumed city-first
       * everywhere, so the country code landed in the CITY slot.
       *
       * MEASURED over the 113,416-posting served index: 5,322 rows carry a bare
       * country code as their city. 3,539 of them say the city is "US".
       *
       * It was not only cosmetic. "IT, RI, Passo Corese" -- a town in Italy --
       * parsed as city "IT", region "Rhode Island", country "United States",
       * because the second component was read as a US state abbreviation. The
       * posting was filed in the wrong country, so a search for Italy missed it
       * and a search for the United States returned it.
       *
       * The detection is deliberately narrow: see countryFirstOrder().
       */
      const order = reversal(parts)!
      const last = parts[parts.length - 1].trim()

      if (order.kind === 'country-first') {
        country = headCountry(parts[0]) ?? canonCountry(parts[0]) ?? parts[0]

        /**
         * A bare code in the last slot is a REGION, not a city.
         *
         * "US, CA" has no city in it. Running it through canonCity produced a
         * city literally named "Ca", which is the class of value this whole
         * pass exists to remove. When the code expands to a US state and the
         * country agrees, it becomes the region; otherwise it is dropped rather
         * than promoted to a city name.
         */
        if (/^[A-Za-z]{2,3}$/.test(last)) {
          const up = last.toUpperCase()
          region = country === 'United States' ? (US_STATES[up] ?? null) : null
          city = null
        } else {
          city = isMacroRegion(last) ? null : canonCity(last)
        }
        // The middle component is a regional code in the country's own scheme
        // (TX, NSW, KA, and China's numeric provinces). Expand it when it is a
        // US state and the country agrees; otherwise keep it only if it reads
        // as a name rather than a code, because an unexpanded "13" tells nobody
        // anything.
        const middle = parts.length >= 3 ? parts[1].trim() : null
        if (middle) {
          const upper = middle.toUpperCase()
          if (country === 'United States' && US_STATES[upper]) region = US_STATES[upper]
          else if (/^[A-Za-z][A-Za-z\s'-]{2,}$/.test(middle)) region = titleCase(middle)
          else region = null
        }
      } else {
        // region-first: "OH, Columbus", "CA, San Francisco".
        region = US_STATES[parts[0].trim().toUpperCase()] ?? null
        country = 'United States'
        city = isMacroRegion(last) ? null : canonCity(last)
        // Recorded, not resolved. "DE, Berlin" is Delaware or Germany and the
        // string cannot say which; resolveAmbiguousLocations settles it from
        // unambiguous sightings of the same city elsewhere in the corpus.
        ambiguousCode = order.ambiguous
      }
    } else if (parts.length === 2 && regionAndCountryOnly(parts)) {
      /**
       * "OH, United States", "SG, Singapore", "MH, India" -- a REGION and a
       * country, with no city at all.
       *
       * detectReversal correctly refuses these (a trailing country means the
       * string is city-first), and the city-first path then put the bare code
       * in the city field. 51 rows said their city was "OH".
       *
       * There is no city here to find. Saying so is the accurate answer;
       * promoting the region code to a city is not.
       */
      country = canonCountry(parts[1]) ?? countryFromCode(parts[1]) ?? titleCase(parts[1])
      const code = parts[0].trim().toUpperCase()
      region = country === 'United States' ? (US_STATES[code] ?? null) : null
      city = null
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
          // Try full names first, then bare alpha-2 codes.
          //
          // Employers write "Beirut, Beirut Governorate, lb" and "Timișoara,
          // TM, ro" -- the country IS stated, as a lowercase ISO code, and the
          // name lookup alone never saw it. A code in the THIRD-or-later
          // position cannot be a US state abbreviation: the US convention is
          // "City, ST" (two parts) or "City, ST, USA", so nothing puts a bare
          // state code here. That is what makes reading it as a country safe
          // where doing the same in position two would not be.
          const found =
            tail.map(canonCountry).find((c): c is string => c !== null) ??
            tail.map((t) => countryFromCode(t)).find((c): c is string => c !== null)
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
