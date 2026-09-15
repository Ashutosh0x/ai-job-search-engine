/**
 * Location-filter regression tests.
 *
 * The filter was `key.includes(loc) || loc.includes(key)` over raw strings.
 * The second half is load-bearing -- a query of "London, United Kingdom" has to
 * match a row keyed only "london" -- but on raw substrings it also let every
 * SHORT key match inside any longer word.
 *
 * ATS feeds emit location fragments, so the served index carries 2,577 keys of
 * "us", 441 of "in", 84 of "ca", 43 of "it" and 30 of "il". Measured over the
 * 113,416-posting index before the fix:
 *
 *   Austin    5,349 matched, 3,969 wrong (74.2%) -- "au[stin]" matched Australia
 *   Berlin      710 matched,   448 wrong (63.1%) -- "berl[in]" matched India
 *   Dublin    1,289 matched,   442 wrong (34.3%) -- same "in"
 *   Milan       181 matched,    50 wrong (27.6%) -- "m[il]an" matched Tel Aviv
 *   Chicago   1,339 matched,    91 wrong  (6.8%) -- "chi[ca]go" matched Canada
 *
 * These tests pin whole-token comparison, the prefix rule that keeps "san fran"
 * working, accent folding, and the query-head rule that stops naming a country
 * from widening a city search.
 */
const { locationTokens, locationKeyMatches } = await import('../lib/job-index.ts')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/** Does a query match a stored location key? */
const m = (query, key) => locationKeyMatches(locationTokens(query), key)

/* ------------------- the short-fragment false positives -------------------- */
// Each of these is a real key shape from the corpus paired with the query that
// used to match it.
{
  t('"Austin" does not match key "AU"', !m('Austin', 'AU'))
  t('"Austin" does not match "AU, NSW, Sydney"', !m('Austin', 'AU, NSW, Sydney'))
  t('"Austin" does not match key "US"', !m('Austin', 'US'))
  t('"Berlin" does not match key "IN"', !m('Berlin', 'IN'))
  t('"Berlin" does not match "IN, KA, Bengaluru"', !m('Berlin', 'IN, KA, Bengaluru'))
  t('"Dublin" does not match key "IN"', !m('Dublin', 'IN'))
  t('"Milan" does not match key "IL"', !m('Milan', 'IL'))
  t('"Milan" does not match "IL, Tel Aviv"', !m('Milan', 'IL, Tel Aviv'))
  t('"Chicago" does not match key "CA"', !m('Chicago', 'CA'))
  t('"Chicago" does not match "CA, ON, Toronto"', !m('Chicago', 'CA, ON, Toronto'))
  t('"London" does not match key "ON"', !m('London', 'ON'))
  t('"London" does not match "Toronto, ON, CA"', !m('London', 'Toronto, ON, CA'))
  t('"Oslo" does not match "Homburg, SL, de"', !m('Oslo', 'Homburg, SL, de'))
}

/* ---------------------- what must still match ----------------------------- */
{
  t('exact city matches', m('London', 'London'))
  t('case insensitive', m('london', 'LONDON'))
  t('city inside a fuller key', m('London', 'London, England, United Kingdom'))
  t('key narrower than query', m('London, United Kingdom', 'London'))
  t('"Greater London" still finds London', m('Greater London', 'London'))
  t('"Munich" matches "Munich, Bavaria, Germany"', m('Munich', 'Munich, Bavaria, Germany'))
  t('country query matches country key', m('United Kingdom', 'United Kingdom'))
  t('country query matches a row in that country', m('Germany', 'Munich, Bavaria, Germany'))
  t('two-word city', m('New York', 'New York, NY, US'))
  t('"remote" matches the remote key', m('remote', 'remote'))
}

/* --------------------------- prefix matching ------------------------------ */
// Prefix is what makes a half-typed city usable. It is gated at three
// characters, which is exactly what stops "au" and "in" from doing it.
{
  t('"San Fran" finds San Francisco', m('San Fran', 'San Francisco, CA, US'))
  t('"Bangal" finds Bangalore', m('Bangal', 'Bangalore'))
  t('"Amsterd" finds Amsterdam', m('Amsterd', 'Amsterdam, NL'))
  t('two-char prefix does NOT match', !m('Austin', 'AU'))
  t('three chars is the threshold', m('Ber', 'Berlin'))
  t('a prefix must be a prefix, not a substring', !m('erlin', 'Berlin'))
}

/* ---------------------------- accent folding ------------------------------ */
// The corpus carries the accented form; almost nobody types it.
{
  t('"Asuncion" finds "Asunción"', m('Asuncion', 'Asunción'))
  t('"Dusseldorf" finds "Düsseldorf"', m('Dusseldorf', 'Düsseldorf'))
  t('"Malmo" finds "Malmö"', m('Malmo', 'Malmö'))
  t('"Sao Paulo" finds "São Paulo"', m('Sao Paulo', 'São Paulo'))
  t('accented query finds plain key', m('Zürich', 'Zurich'))
}

/* -------------------------- the query-head rule --------------------------- */
// Naming the country must NARROW a city search, never widen it.
{
  t('"London, United Kingdom" matches a London row', m('London, United Kingdom', 'London, England, United Kingdom'))
  t('"London, United Kingdom" does NOT match a country-only row',
    !m('London, United Kingdom', 'United Kingdom'))
  t('"Munich, Germany" does NOT match a country-only row', !m('Munich, Germany', 'Germany'))
  t('but a bare "Germany" query still does', m('Germany', 'Germany'))
  t('qualifiers are skipped when finding the head', m('Greater Manchester Area', 'Manchester'))
}

/* ------------------------------- edge cases ------------------------------- */
{
  t('empty query matches nothing', !m('', 'London'))
  t('empty key matches nothing', !m('London', ''))
  t('punctuation-only query matches nothing', !m('   ,,,  ', 'London'))
  t('punctuation-only key matches nothing', !m('London', '---'))
  t('tokeniser drops punctuation', JSON.stringify(locationTokens('London, U.K.')) === '["london","u","k"]',
    locationTokens('London, U.K.'))
  t('tokeniser folds accents', JSON.stringify(locationTokens('Asunción')) === '["asuncion"]',
    locationTokens('Asunción'))
  t('tokeniser keeps digits', JSON.stringify(locationTokens('Paris 75')) === '["paris","75"]',
    locationTokens('Paris 75'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
