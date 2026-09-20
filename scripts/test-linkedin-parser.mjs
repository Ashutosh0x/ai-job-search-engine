/**
 * Verify the Chrome extension's LinkedIn parsing logic.
 *
 *   node scripts/test-linkedin-parser.mjs
 *
 * Loads chrome-extension/content-scripts/parse-helpers.js — the actual shipped
 * file, not a copy — and exercises the decisions that are easy to get quietly
 * wrong: where a name splits, whether a headline really names an employer, and
 * what a profile URL reduces to.
 *
 * Those three feed contact discovery directly. A bad split produces an inferred
 * address for a person who does not exist; a bad employer produces one on the
 * wrong domain entirely. Neither failure is visible downstream — both look like
 * an ordinary low-confidence result — so they are pinned here.
 *
 * This deliberately does not walk the DOM. LinkedIn's class names churn, and a
 * fixture of today's markup would assert that we copied it correctly, not that
 * the parser works.
 */

import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, '..', 'chrome-extension')
const require = createRequire(import.meta.url)

const helpers = require(join(EXT, 'content-scripts', 'parse-helpers.js'))
const { splitName, companyFromHeadline, normaliseProfileUrl, parseConnectionCount, isDiscoverable } = helpers

let pass = 0, fail = 0

function assert(expected, actual, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}: expected ${e}, got ${a}`)
  }
}

/* ---- splitName ---- */
console.log('\n👤 splitName:')

assert({ firstName: 'Jane', lastName: 'Smith' }, splitName('Jane Smith'), 'plain two-word name')
assert({ firstName: 'Jane', lastName: 'Smith' }, splitName('Jane Smith · 2nd'), 'strips degree marker')
assert({ firstName: 'Jane', lastName: 'Smith' }, splitName('Jane Smith, PhD'), 'strips credential suffix')
assert({ firstName: 'Jane', lastName: 'Smith' }, splitName('Jane Smith (she/her)'), 'strips pronouns')
assert({ firstName: 'Aditi', lastName: 'Sharma' }, splitName('Dr. Aditi Rao Sharma, PhD'), 'strips honorific, keeps last token as surname')
assert({ firstName: 'Jean', lastName: 'Dupont' }, splitName('  Jean   Dupont  '), 'collapses whitespace')

// The important negative case: no surname invented from a single token.
assert({ firstName: 'Madonna', lastName: '' }, splitName('Madonna'), 'single token yields no surname')
assert({ firstName: '', lastName: '' }, splitName(''), 'empty string yields nothing')
assert({ firstName: '', lastName: '' }, splitName(null), 'null yields nothing')

/* ---- companyFromHeadline ---- */
console.log('\n🏢 companyFromHeadline:')

assert('Acme Corp', companyFromHeadline('Senior Recruiter at Acme Corp'), 'simple "at" clause')
assert('Acme Corp', companyFromHeadline('Senior Recruiter at Acme Corp | Hiring now'), 'stops at pipe')
assert('Acme Corp', companyFromHeadline('Recruiter at Acme Corp · Remote'), 'stops at bullet')
assert('Acme Corp', companyFromHeadline('Talent Partner AT Acme Corp'), 'case insensitive')

// A headline with no employer must not produce one.
assert('', companyFromHeadline('Software Engineer'), 'no "at" clause yields nothing')
assert('', companyFromHeadline('Open to work'), 'status headline yields nothing')
assert('', companyFromHeadline(''), 'empty headline yields nothing')
assert('', companyFromHeadline(undefined), 'undefined headline yields nothing')

/* ---- normaliseProfileUrl ---- */
console.log('\n🔗 normaliseProfileUrl:')

assert('https://www.linkedin.com/in/jane-smith',
  normaliseProfileUrl('https://www.linkedin.com/in/jane-smith'), 'absolute URL')
assert('https://www.linkedin.com/in/jane-smith-123',
  normaliseProfileUrl('/in/jane-smith-123/?trk=search_srp', 'https://www.linkedin.com'), 'relative URL, query dropped')
assert('https://www.linkedin.com/in/jane-smith',
  normaliseProfileUrl('https://uk.linkedin.com/in/jane-smith'), 'locale subdomain normalised')
assert('', normaliseProfileUrl('/company/acme'), 'company URL is not a profile')
assert('', normaliseProfileUrl(''), 'empty href yields nothing')
assert('', normaliseProfileUrl(null), 'null href yields nothing')

/* ---- parseConnectionCount ---- */
console.log('\n🔢 parseConnectionCount:')

assert({ count: 500, isMinimum: true }, parseConnectionCount('500+ connections'), '500+ is a minimum')
assert({ count: 342, isMinimum: false }, parseConnectionCount('342 connections'), 'exact count')
assert({ count: 1234, isMinimum: false }, parseConnectionCount('1,234 followers'), 'comma-separated')

// Absent data must read as absent, never as zero.
assert(null, parseConnectionCount('connections'), 'no digits yields null, not 0')
assert(null, parseConnectionCount(''), 'empty yields null')
assert(null, parseConnectionCount(undefined), 'undefined yields null')

/* ---- isDiscoverable ---- */
console.log('\n🎯 isDiscoverable:')

assert(true, isDiscoverable({ firstName: 'Jane', lastName: 'Smith', company: 'Acme' }), 'complete profile')
assert(false, isDiscoverable({ firstName: 'Jane', lastName: '', company: 'Acme' }), 'missing surname')
assert(false, isDiscoverable({ firstName: 'Jane', lastName: 'Smith', company: '' }), 'missing company')
assert(false, isDiscoverable(null), 'null profile')

/* ---- Shipped files stay honest ---- */
console.log('\n🔍 Extension source checks:')

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))
const linkedInEntry = manifest.content_scripts.find((c) =>
  c.matches.some((m) => m.includes('linkedin.com'))
)

assert(true, Boolean(linkedInEntry), 'manifest registers a LinkedIn content script')
assert(true, linkedInEntry.js.includes('content-scripts/search-parser.js'), 'search-parser is registered')
assert(true, linkedInEntry.js.includes('content-scripts/parse-helpers.js'), 'parse-helpers is registered')

// parse-helpers defines the shared global, so it must load first.
assert(0, linkedInEntry.js.indexOf('content-scripts/parse-helpers.js'), 'parse-helpers loads before its consumers')

const EXT_SCRIPTS = [
  'background.js',
  'popup.js',
  'content-scripts/parse-helpers.js',
  'content-scripts/linkedin-parser.js',
  'content-scripts/search-parser.js',
  'content-scripts/webapp-bridge.js',
]

for (const file of EXT_SCRIPTS) {
  const path = join(EXT, file)
  assert(true, existsSync(path), `${file} exists`)

  const source = readFileSync(path, 'utf8')

  // popup.js once shipped with 148 literal \` sequences — written through a
  // shell heredoc that kept its own escaping. The file parsed as nothing, so
  // the popup threw on load and did nothing at all, silently.
  assert(false, source.includes('\\`'), `${file} has no escaped backticks`)

  // background.js used to answer a failed localhost request with invented
  // placeholder addresses at 95% confidence, indistinguishable in the popup
  // from a real discovery.
  assert(false, /@example\.com/.test(source), `${file} ships no placeholder addresses`)
  assert(false, /getMockData|mock data/i.test(source), `${file} has no mock-data fallback`)
}

// Every script actually parses. A content script that throws at load time
// fails invisibly: the page simply behaves as if the extension is absent.
for (const file of EXT_SCRIPTS) {
  const source = readFileSync(join(EXT, file), 'utf8')
  let parsed = true
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)
  } catch (err) {
    parsed = false
    console.log(`     ↳ ${file}: ${err.message}`)
  }
  assert(true, parsed, `${file} parses as valid JavaScript`)
}

/* ---- The console validator is in step with the parser ---- */
console.log('\n🧪 Generated console validator:')

const validatorPath = join(EXT, 'dev', 'console-validator.js')
assert(true, existsSync(validatorPath), 'console-validator.js has been generated')

if (existsSync(validatorPath)) {
  const validator = readFileSync(validatorPath, 'utf8')
  // It is a concatenation of the shipped sources. If either drifts, the file
  // pasted into a browser console stops matching the code that actually ships,
  // and a validation run would be testing something no user runs.
  for (const file of ['content-scripts/parse-helpers.js', 'content-scripts/linkedin-parser.js']) {
    const src = readFileSync(join(EXT, file), 'utf8').trim()
    assert(true, validator.includes(src), `validator embeds current ${file}`)
  }
  assert(true, validator.includes('chrome.runtime.sendMessage'), 'validator stubs chrome.runtime')
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
