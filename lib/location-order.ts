/**
 * US state NAMES that are also country names.
 *
 * Exactly one matters: Georgia. It is why a bare leading country name cannot be
 * trusted on its own -- "Georgia, Atlanta" is a US state written region-first,
 * not the country Georgia written country-first.
 */
const STATE_NAMES_THAT_ARE_COUNTRIES = new Set(['GEORGIA'])

/**
 * Continents, super-regions and "everywhere" tokens.
 *
 * These describe a hiring SCOPE, not a place a job is at, and putting one in
 * `city` produces rows whose city is "Europe" or "EMEA". They are recognised so
 * they can be excluded from city/country rather than guessed into one.
 */
const MACRO_REGIONS = new Set([
  'europe', 'emea', 'apac', 'apj', 'americas', 'amer', 'latam', 'anz', 'asia',
  'asia pacific', 'africa', 'middle east', 'north america', 'south america',
  'latin america', 'worldwide', 'global', 'international', 'anywhere', 'nationwide',
])

export function isMacroRegion(s: string | null | undefined): boolean {
  if (!s) return false
  return MACRO_REGIONS.has(s.trim().toLowerCase().replace(/[-_]+/g, ' '))
}

/**
 * How a comma-separated location string is ordered.
 *
 * Most feeds write "City, Region, Country". Several write it backwards, and a
 * few write "Region, City". Getting this wrong does not produce a slightly-off
 * label -- it files the job on the wrong continent, where a country filter will
 * never find it and the wrong one will return it.
 *
 * MEASURED over the 113,416-posting served index: 5,712 rows had a bare code
 * sitting in the city field because only city-first was understood.
 *
 * The classification is deliberately conservative and, where the string genuinely
 * cannot settle it, DEFERS rather than guessing -- see `ambiguous` below.
 */
export type Reversal =
  | { kind: 'country-first' }
  /** "TX, Austin" / "CA, San Francisco". `ambiguous` when the code is also a
   *  country code, so the corpus resolver can overrule the US reading. */
  | { kind: 'region-first'; ambiguous: string | null }
  | null

export function detectReversal(
  parts: string[],
  helpers: {
    usStates: Record<string, string>
    headCountry: (code: string) => string | null
    canonCountry: (s: string) => string | null
    countryFromCode: (s: string) => string | null
    isCountryName: (s: string) => boolean
  },
): Reversal {
  if (parts.length < 2) return null
  const { usStates, headCountry, canonCountry, countryFromCode, isCountryName } = helpers

  const head = parts[0].trim()
  const headUpper = head.toUpperCase()
  const tail = parts[parts.length - 1].trim()

  const isShortCode = /^[A-Za-z]{2,3}$/.test(head)
  const tailIsShortCode = /^[A-Za-z]{2,3}$/.test(tail)

  /**
   * COUNTRY CODE + REGION CODE: "US, CA", "US, TX".
   *
   * Checked before the trailing-country bail below, because CA resolves to
   * Canada and would trip it -- which it did: "US, CA, Remote" reduced to
   * "US, CA" and filed a Californian job in Canada. Two stacked codes are never
   * city-first, and a US state code in the tail settles which reading is meant.
   */
  if (parts.length === 2 && isShortCode && tailIsShortCode) {
    const headAsCountry = headCountry(head)
    if (headAsCountry === 'United States' && usStates[tail.toUpperCase()]) {
      return { kind: 'country-first' }
    }
  }

  // A trailing country means the string is ALREADY city-first, whatever the
  // head looks like. This is what keeps "LA, California, United States" as Los
  // Angeles rather than Laos, and "Paris, France" untouched.
  if (canonCountry(tail) || countryFromCode(tail) || isCountryName(tail)) return null
  const stateName = isShortCode ? usStates[headUpper] : null
  const countryName = isShortCode ? headCountry(head) : null

  /**
   * Codes that are BOTH a US state and a country: IN (Indiana/India),
   * CA (California/Canada), DE (Delaware/Germany), and the rest.
   *
   * The stacked-code shape settles it. "IN, KA, Bengaluru" and "CA, ON, Toronto"
   * put a SECOND short code in position two, which only happens in
   * country/region/city order -- the US convention is "City, ST", never
   * "ST, XX, City". So three-plus parts with a code in position two reads as
   * country-first; two parts reads as region-first.
   */
  const ambiguous = Boolean(stateName && countryName)
  const secondIsCode = parts.length >= 3 && /^[A-Za-z0-9]{2,3}$/.test(parts[1].trim())

  if (countryName && (!ambiguous || secondIsCode)) return { kind: 'country-first' }

  if (stateName) {
    // "OH, Columbus", "TX, Austin", "CA, San Francisco".
    // When the code is ambiguous the US reading is only the DEFAULT: the code
    // is recorded so resolveAmbiguousLocations can overrule it from unambiguous
    // sightings of the same city elsewhere in the corpus. "DE, Berlin" is the
    // case that needs it -- nothing in that string says Delaware or Germany.
    return { kind: 'region-first', ambiguous: ambiguous ? headUpper : null }
  }

  // A full country NAME in the head, e.g. "United States, New York".
  // Excluded when the name is also a US state, because in that position a state
  // is far more likely and nothing in the string settles it.
  if (!isShortCode && !STATE_NAMES_THAT_ARE_COUNTRIES.has(headUpper)) {
    const named = canonCountry(head) ?? (isCountryName(head) ? head : null)
    if (named) return { kind: 'country-first' }
  }

  return null
}
