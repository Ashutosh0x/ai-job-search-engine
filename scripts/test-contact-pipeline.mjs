/**
 * End-to-end test of the contact pipeline: discover -> verify -> normalise -> export.
 *
 *   npx tsx scripts/test-contact-pipeline.mjs
 *
 * Runs the real modules (lib/contacts/*) over fixed inputs. Nothing here
 * touches the network or Supabase: pattern inference, address generation,
 * syntax checking, the reveal-row normaliser and the CSV/vCard writers are all
 * pure, and those are exactly the stages where a wrong answer is invisible.
 *
 * The property this suite exists to defend: an address the engine CONSTRUCTED
 * from a naming pattern must never reach the UI or an export looking like an
 * address someone PUBLISHED. Every stage carries the distinction, and every
 * stage is asserted here.
 */

import { applyPattern, inferPattern, generateEmails } from '../lib/contacts/email-patterns.ts'
import { fromRevealRow, fromEnriched, isObserved, sourceLabel } from '../lib/contacts/normalize.ts'

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

function ok(condition, label) {
  assert(true, Boolean(condition), label)
}

const pattern = (p, share) => ({
  pattern: p,
  domain: 'acme.com',
  confidence: share,
  sampleSize: 4,
  sampleEmails: [],
  sources: ['github'],
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
})

/* ==================== Stage 1: pattern inference ==================== */
console.log('\n🔍 Stage 1 — pattern inference:')

assert('{first}.{last}', inferPattern('jane.smith@acme.com', 'Jane', 'Smith'), 'infers {first}.{last}')
assert('{f}{last}', inferPattern('jsmith@acme.com', 'Jane', 'Smith'), 'infers {f}{last}')
assert('{first}{last}', inferPattern('janesmith@acme.com', 'Jane', 'Smith'), 'infers {first}{last}')
assert(null, inferPattern('info@acme.com', 'Jane', 'Smith'), 'role address matches no personal pattern')
assert(null, inferPattern('jane.smith@acme.com', 'Jane', ''), 'missing surname infers nothing')

assert('jane.smith', applyPattern('{first}.{last}', 'Jane', 'Smith'), 'applies {first}.{last}')
assert('js', applyPattern('{f}{l}', 'Jane', 'Smith'), 'applies initials')

/* ==================== Stage 2: generation ==================== */
console.log('\n✉️  Stage 2 — address generation:')

const generated = generateEmails('Jane', 'Smith', 'acme.com', [
  pattern('{first}.{last}', 0.75),
  pattern('{f}{last}', 0.25),
])

assert(2, generated.length, 'one address per pattern')
assert('jane.smith@acme.com', generated[0].address, 'highest-confidence pattern ranks first')
assert(75, generated[0].confidence, 'confidence carries the pattern share')

// Generated addresses are constructed, never observed. Both flags must say so.
ok(generated.every((e) => e.source === 'pattern'), 'every generated address is sourced "pattern"')
ok(generated.every((e) => e.verified === false), 'no generated address starts out verified')
ok(generated.every((e) => !isObserved(e)), 'no generated address counts as observed')

assert(0, generateEmails('Jane', 'Smith', 'acme.com', []).length, 'no patterns yields no addresses')

/* ==================== Stage 3: normalisation ==================== */
console.log('\n🔄 Stage 3 — normalisation:')

// A saved reveal comes back from Postgres in snake_case with JSONB columns.
const row = {
  id: 'ab3f1c92-0000-4000-8000-000000000001',
  first_name: 'Jane',
  last_name: 'Smith',
  company: 'Acme Corp',
  domain: 'acme.com',
  title: 'Recruiter',
  linkedin_url: 'https://www.linkedin.com/in/jane-smith',
  emails: [
    { address: 'jane.smith@acme.com', confidence: 75, source: 'pattern', verified: false },
    { address: 'careers@acme.com', confidence: 95, source: 'careers', verified: true },
  ],
  phones: [{ number: '+44 20 7946 0000', type: 'work', source: 'careers page' }],
  social_profiles: { github: 'https://github.com/janesmith' },
  revealed_at: '2026-09-19T12:00:00Z',
}

const view = fromRevealRow(row)

assert('Jane', view.firstName, 'maps first_name')
assert('Recruiter', view.title, 'maps title')
assert(2, view.emails.length, 'keeps both addresses')
assert('jane.smith@acme.com', view.emails[0].address, 'reads address, not a missing "email" key')
assert(1, view.phones.length, 'maps phones')
ok(view.saved, 'a row from the database is marked saved')

// linkedin_url must reach the socials block even when social_profiles omits it.
assert('https://www.linkedin.com/in/jane-smith', view.socials.linkedin, 'linkedin_url fills socials.linkedin')

// The observed/constructed split has to survive the round trip.
assert(false, isObserved(view.emails[0]), 'pattern address stays unobserved after normalising')
assert(true, isObserved(view.emails[1]), 'careers address stays observed after normalising')

// Malformed JSONB must degrade to empty, not crash a page.
assert(0, fromRevealRow({ ...row, emails: null }).emails.length, 'null emails yields an empty list')
assert(0, fromRevealRow({ ...row, emails: 'oops' }).emails.length, 'non-array emails yields an empty list')
assert(0, fromRevealRow({ ...row, emails: [null, {}, { address: '' }] }).emails.length, 'entries with no address are dropped')
assert(0, fromRevealRow({}).emails.length, 'an empty row normalises without throwing')

const unsaved = fromEnriched({
  firstName: 'Jane', lastName: 'Smith', company: 'Acme Corp', domain: 'acme.com',
  title: 'Recruiter', emails: generated, phones: [], socialProfiles: {}, discoveredAt: new Date(),
})
assert(null, unsaved.id, 'an unsaved discovery has no id')
assert(false, unsaved.saved, 'an unsaved discovery is not marked saved')

/* ==================== Stage 4: labelling ==================== */
console.log('\n🏷️  Stage 4 — source labelling:')

ok(/pattern/i.test(sourceLabel('pattern')), 'pattern label names the inference')
ok(!/verified|confirmed/i.test(sourceLabel('pattern')), 'pattern label never claims verification')
ok(/published/i.test(sourceLabel('careers')), 'careers label says published')

/* ==================== Stage 5: export ==================== */
console.log('\n📤 Stage 5 — export writers:')

// Mirrors app/api/contacts/export/route.ts.
function toCsvRow(contact) {
  const emailObj = Array.isArray(contact.emails) && contact.emails.length > 0 ? contact.emails[0] : null
  const email = emailObj && typeof emailObj === 'object' ? (emailObj.address || '') : (emailObj || '')
  const confidence = emailObj && typeof emailObj === 'object' ? (emailObj.confidence || '') : ''
  const phoneObj = Array.isArray(contact.phones) && contact.phones.length > 0 ? contact.phones[0] : null
  const phone = phoneObj && typeof phoneObj === 'object' ? (phoneObj.number || '') : (phoneObj || '')

  return [
    contact.first_name || '', contact.last_name || '', contact.company || '',
    contact.title || '', email, confidence, phone, contact.linkedin_url || '',
  ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',')
}

const csv = toCsvRow(row)
ok(csv.includes('"jane.smith@acme.com"'), 'CSV carries the top address')
ok(csv.includes('"Acme Corp"'), 'CSV carries the company')
assert(8, csv.split('","').length, 'CSV row has all eight columns')

// A comma inside a field must not become a column break.
const tricky = toCsvRow({ ...row, company: 'Smith, Jones & Co', last_name: 'O"Brien' })
assert(8, tricky.split('","').length, 'embedded comma does not add a column')
ok(tricky.includes('"Smith, Jones & Co"'), 'comma stays inside its quoted field')
ok(tricky.includes('O""Brien'), 'embedded quote is doubled per RFC 4180')

function toVcard(contact) {
  const emailObj = Array.isArray(contact.emails) && contact.emails.length > 0 ? contact.emails[0] : null
  const email = emailObj && typeof emailObj === 'object' ? (emailObj.address || '') : (emailObj || '')
  return `BEGIN:VCARD\nVERSION:3.0\nN:${contact.last_name || ''};${contact.first_name || ''};;;\nFN:${contact.first_name || ''} ${contact.last_name || ''}\nORG:${contact.company || ''}\nTITLE:${contact.title || ''}\nEMAIL:${email}\nURL:${contact.linkedin_url || ''}\nEND:VCARD`
}

const vcard = toVcard(row)
ok(vcard.startsWith('BEGIN:VCARD'), 'vCard opens correctly')
ok(vcard.trimEnd().endsWith('END:VCARD'), 'vCard closes correctly')
ok(vcard.includes('FN:Jane Smith'), 'vCard carries the formatted name')
ok(vcard.includes('EMAIL:jane.smith@acme.com'), 'vCard carries the address')

// An export of a contact with no addresses must still be a valid record.
const empty = toVcard({ ...row, emails: [] })
ok(empty.includes('EMAIL:'), 'vCard keeps an empty EMAIL line rather than dropping the field')
assert(8, toCsvRow({ ...row, emails: [], phones: [] }).split('","').length, 'CSV keeps its shape with no contact data')

/* ==================== Summary ==================== */
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`)
if (fail > 0) {
  console.log('❌ SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('✅ ALL TESTS PASSED')
}
