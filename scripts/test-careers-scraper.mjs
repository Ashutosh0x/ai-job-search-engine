/**
 * Pin the careers-page address filters.
 *
 *   npx tsx scripts/test-careers-scraper.mjs
 *
 * Every case here is a real string the crawler pulled off a real careers page
 * across the 273-company registry, and every one of them was published as a
 * recruiting contact before the filter that rejects it existed. They are
 * regression tests in the strict sense: the bug shipped, the measurement found
 * it, this is what stops it coming back.
 *
 * The filters are not exported — they are internals of scrapeCareersPage — so
 * this suite reimplements the predicate under test and pins it against the
 * shipped source, asserting the two stay in step. That is weaker than calling
 * the real function, and it is the reason the shipped-source check at the
 * bottom exists.
 */

import { readFileSync } from 'fs'

let pass = 0, fail = 0

function assert(expected, actual, label) {
  if (expected === actual) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const source = readFileSync('lib/contacts/scraper.ts', 'utf8')

/* Mirrors of the shipped predicates. Pinned against the source below. */
const RECRUITING_LOCAL =
  /^(careers?|recruit(ing|ment)?|hiring|talent|jobs?|campus|apply|applications?|university|graduate|grad|internships?|hr|employment|employee[._-]?verification)/i
const ENCODING_ARTEFACT = /^(%[0-9a-f]{2}|u00[0-9a-f]{2}|x[0-9a-f]{2}|amp|quot|lt|gt|nbsp)/i
const ASSET_EXTENSION =
  /\.(webp|jpe?g|png|gif|svg|avif|ico|bmp|tiff?|css|js|mjs|json|html?|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz)$/i
const DENSITY_SUFFIX = /^\d+(\.\d+)?x$/i

const looksLikeAsset = (host) =>
  ASSET_EXTENSION.test(host) || DENSITY_SUFFIX.test(host.split('.')[0])

/* ---- Asset file names ---- */
console.log('\n🖼️  File names that look like addresses:')

// Observed on browserstack.com and nvidia.com. Both begin with "career", so
// the recruiting filter accepted them and both were published as contacts.
assert(true, looksLikeAsset('2x.webp'), 'career-hero@2x.webp is an asset')
assert(true, looksLikeAsset('1x.webp'), 'career-hero@1x.webp is an asset')
assert(true, looksLikeAsset('2x.jpg'), 'career-home-…-v4@2x.jpg is an asset')
assert(true, looksLikeAsset('3x.png'), '@3x.png is an asset')
assert(true, looksLikeAsset('2x'), 'a bare @2x density suffix is an asset')
assert(true, looksLikeAsset('example.svg'), '.svg is an asset')
assert(true, looksLikeAsset('sprite.css'), '.css is an asset')
assert(true, looksLikeAsset('bundle.min.js'), '.js is an asset')

// Real hosts must survive.
assert(false, looksLikeAsset('stripe.com'), 'stripe.com is not an asset')
assert(false, looksLikeAsset('wdc.com'), 'wdc.com is not an asset')
assert(false, looksLikeAsset('expel.io'), 'expel.io is not an asset')
assert(false, looksLikeAsset('hudson-trading.com'), 'hudson-trading.com is not an asset')
assert(false, looksLikeAsset('npci.org.in'), 'a multi-label host is not an asset')

/* ---- Greenhouse workplace-type vs real location ---- */
console.log('\n📍 Greenhouse location resolution:')
{
  const atsSource = readFileSync('lib/sources/adapters/ats.ts', 'utf8')

  // Cloudflare's board puts "Hybrid"/"Remote"/"In-Office" in location.name and
  // the real place in offices[]. Taking location.name at face value left 274 of
  // their 283 indexed roles with no city and no country, so they matched no
  // location filter at all. 487 postings across 53 employers were in that state.
  assert(true, atsSource.includes('WORKPLACE_TYPE'), 'the adapter defines a workplace-type guard')
  assert(true, atsSource.includes('greenhouseLocation'), 'the adapter defines greenhouseLocation()')
  assert(true, /locationRaw:\s*greenhouseLocation\(j\)/.test(atsSource),
    'locationRaw routes through it rather than reading location.name directly')

  const WORKPLACE_TYPE = /^(hybrid|remote|in[\s-]?office|distributed|on[\s-]?site|flexible|anywhere)$/i
  for (const v of ['Hybrid', 'Remote', 'In-Office', 'In Office', 'Distributed', 'On-site', 'Flexible', 'Anywhere']) {
    assert(true, WORKPLACE_TYPE.test(v), `"${v}" is a workplace type, not a place`)
  }
  // Real places must never be mistaken for a workplace type and discarded.
  for (const v of ['Austin, TX, United States', 'Singapore', 'London, United Kingdom', 'Remote India', 'Lisboa, Lisboa, Portugal']) {
    assert(false, WORKPLACE_TYPE.test(v), `"${v}" is a real location`)
  }
}

/* ---- Own-domain vs subdomain vs lookalike ---- */
console.log('\n🌐 Own-domain matching:')

const registrable = (h) => h.toLowerCase().replace(/^www\./, '')
const isOwnDomain = (host, domain) => {
  const h = registrable(host), d = registrable(domain)
  return h === d || h.endsWith(`.${d}`)
}

// Duolingo's careers page states its recruiters write from @duolingo.com OR
// @recruiting.duolingo.com. An exact-match test discarded the second kind —
// exactly the addresses a candidate most needs to be able to recognise.
assert(true, isOwnDomain('recruiting.duolingo.com', 'duolingo.com'), 'a recruiting subdomain is the company')
assert(true, isOwnDomain('careers.example.com', 'example.com'), 'any subdomain is the company')
assert(true, isOwnDomain('example.com', 'example.com'), 'the domain itself')
assert(true, isOwnDomain('www.example.com', 'example.com'), 'www is the same host')

// A lookalike domain must never be treated as the company's own — that is the
// exact shape of a recruitment-fraud domain.
assert(false, isOwnDomain('notduolingo.com', 'duolingo.com'), 'a suffix lookalike is NOT the company')
assert(false, isOwnDomain('evil-duolingo.com', 'duolingo.com'), 'a hyphen lookalike is NOT the company')
assert(false, isOwnDomain('duolingo.com.attacker.net', 'duolingo.com'), 'a prefix lookalike is NOT the company')
assert(false, isOwnDomain('greenhouse.io', 'duolingo.com'), 'an unrelated host is NOT the company')

assert(true, source.includes('h.endsWith(`.${d}`)'), 'shipped scraper uses the subdomain rule')

/* ---- Encoding artefacts ---- */
console.log('\n🔣 Encoding artefacts:')

// %20accommodations@adobe.com came from a URL-encoded mailto; the u003e ones
// from a JSON-escaped ">" immediately before the address.
assert(true, ENCODING_ARTEFACT.test('%20accommodations'), '%20-prefixed local part')
assert(true, ENCODING_ARTEFACT.test('u003einfo'), 'u003e-prefixed local part')
assert(true, ENCODING_ARTEFACT.test('u003eouvidoria'), 'another u003e local part')
assert(true, ENCODING_ARTEFACT.test('amp'), 'a bare &amp; fragment')

assert(false, ENCODING_ARTEFACT.test('careers'), 'careers is not an artefact')
assert(false, ENCODING_ARTEFACT.test('talent.acquisition'), 'talent.acquisition is not an artefact')
assert(false, ENCODING_ARTEFACT.test('hr'), 'hr is not an artefact')

/* ---- Recruiting classification ---- */
console.log('\n🎯 Recruiting local parts:')

// All observed in the crawl and all genuinely recruiting.
for (const local of [
  'careers', 'jobs', 'recruiting', 'recruitment', 'hiring', 'hr',
  'talentacquisition', 'talent.acquisition', 'talent-acquisition',
  'campusrecruiting', 'recruitingsecurity', 'employmentverification',
  'employee-verifications', 'university-relations', 'graduate',
]) {
  assert(true, RECRUITING_LOCAL.test(local), `${local}@ is recruiting`)
}

// Also observed, and none of them is a recruiting contact. These made up
// roughly 85% of what the scraper returned before they were separated out.
for (const local of [
  'press', 'media', 'info', 'support', 'sales', 'hello', 'privacy',
  'webmaster', 'partners', 'sales-uki', 'ventas-mx', 'info-dach', 'import',
]) {
  assert(false, RECRUITING_LOCAL.test(local), `${local}@ is not recruiting`)
}

/* ---- The mirrors match the shipped source ---- */
console.log('\n🔗 Mirrors are in step with lib/contacts/scraper.ts:')

for (const [name, re] of [
  ['RECRUITING_LOCAL', RECRUITING_LOCAL],
  ['ENCODING_ARTEFACT', ENCODING_ARTEFACT],
  ['ASSET_EXTENSION', ASSET_EXTENSION],
  ['DENSITY_SUFFIX', DENSITY_SUFFIX],
]) {
  // If a predicate is edited in the scraper without updating this file, the
  // cases above would keep passing against a stale copy. This catches that.
  assert(true, source.includes(re.source), `${name} matches the shipped pattern`)
}

// The vendor denylist is what stops an ATS address on a careers page being
// attributed to the employer whose page it sits on.
for (const vendor of ['greenhouse.io', 'lever.co', 'myworkday.com', 'icims.com']) {
  assert(true, source.includes(vendor), `vendor denylist still contains ${vendor}`)
}

/* ---- Summary ---- */
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`)
if (fail > 0) {
  console.log('❌ SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('✅ ALL TESTS PASSED')
}
