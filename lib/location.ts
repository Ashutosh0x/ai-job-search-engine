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

/** Strings that are a work arrangement, not a place. */
const NON_PLACE = /^(in[- ]?office|on[- ]?site|onsite|hybrid|various|multiple locations|flexible|tbd|n\/a|-)$/i

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ')
}

function canonCountry(token: string): string | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t]
  // Already a full country name?
  if (t.length > 3 && /^[a-z .'-]+$/.test(t)) return titleCase(t)
  return null
}

function canonCity(token: string): string {
  const t = token.trim().toLowerCase()
  return CITY_ALIASES[t] ?? titleCase(t)
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
      // A single token that is a known country is a country, otherwise a city.
      if (asCountry && (only.length <= 3 || COUNTRY_ALIASES[only.toLowerCase()])) {
        country = asCountry
      } else {
        city = canonCity(only)
      }
    } else if (parts.length >= 2) {
      city = canonCity(parts[0])
      const second = parts[1].trim()
      const secondUpper = second.toUpperCase()
      if (US_STATES[secondUpper]) {
        region = US_STATES[secondUpper]
        country = parts[2] ? canonCountry(parts[2]) ?? 'United States' : 'United States'
      } else {
        const asCountry = canonCountry(second)
        if (parts.length === 2) {
          country = asCountry
        } else {
          region = titleCase(second)
          country = canonCountry(parts[2]) ?? titleCase(parts[2])
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

  return { raw: original, city, region, country, isRemote, display, searchKeys: [...keys] }
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
