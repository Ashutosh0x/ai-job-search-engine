/**
 * Test the email pattern discovery engine.
 *
 *   npx tsx scripts/test-email-patterns.mjs
 *
 * Tests pattern inference, email generation, and verification logic.
 *
 * These import the shipped modules rather than re-implementing them. An
 * earlier version of this file carried its own copy of applyPattern and
 * inferPattern, so it went on passing no matter what lib/contacts did — the
 * suite proved only that the copy still agreed with itself.
 */

import { applyPattern, inferPattern } from '../lib/contacts/email-patterns.ts'
import { isValidEmailSyntax, isDisposableDomain } from '../lib/contacts/verify.ts'
import { EMAIL_PATTERN_TEMPLATES } from '../lib/contacts/types.ts'

const TEMPLATES = EMAIL_PATTERN_TEMPLATES

let pass = 0, fail = 0

function assert(test, expected, actual, label) {
  if (expected === actual) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}: expected "${expected}", got "${actual}"`)
  }
}

/* ---- Test: applyPattern ---- */
console.log('\n📧 applyPattern tests:')

assert('apply', 'john.doe', applyPattern('{first}.{last}', 'John', 'Doe'), '{first}.{last} with John Doe')
assert('apply', 'johndoe', applyPattern('{first}{last}', 'John', 'Doe'), '{first}{last} with John Doe')
assert('apply', 'jdoe', applyPattern('{f}{last}', 'John', 'Doe'), '{f}{last} with John Doe')
assert('apply', 'john', applyPattern('{first}', 'John', 'Doe'), '{first} with John Doe')
assert('apply', 'john_doe', applyPattern('{first}_{last}', 'John', 'Doe'), '{first}_{last} with John Doe')
assert('apply', 'doe.john', applyPattern('{last}.{first}', 'John', 'Doe'), '{last}.{first} with John Doe')
assert('apply', 'j.doe', applyPattern('{f}.{last}', 'John', 'Doe'), '{f}.{last} with John Doe')
assert('apply', 'john.d', applyPattern('{first}.{l}', 'John', 'Doe'), '{first}.{l} with John Doe')
assert('apply', 'jd', applyPattern('{f}{l}', 'John', 'Doe'), '{f}{l} with John Doe')

/* ---- Test: inferPattern ---- */
console.log('\n🔍 inferPattern tests:')

assert('infer', '{first}.{last}', inferPattern('john.doe@google.com', 'John', 'Doe'), 'john.doe@ → {first}.{last}')
assert('infer', '{first}{last}', inferPattern('johndoe@google.com', 'John', 'Doe'), 'johndoe@ → {first}{last}')
assert('infer', '{f}{last}', inferPattern('jdoe@google.com', 'John', 'Doe'), 'jdoe@ → {f}{last}')
assert('infer', '{first}', inferPattern('john@google.com', 'John', 'Doe'), 'john@ → {first}')
assert('infer', '{first}_{last}', inferPattern('john_doe@google.com', 'John', 'Doe'), 'john_doe@ → {first}_{last}')
assert('infer', '{last}.{first}', inferPattern('doe.john@google.com', 'John', 'Doe'), 'doe.john@ → {last}.{first}')
assert('infer', null, inferPattern('randomuser@google.com', 'John', 'Doe'), 'randomuser@ → null (no match)')
assert('infer', '{f}.{last}', inferPattern('j.doe@google.com', 'John', 'Doe'), 'j.doe@ → {f}.{last}')

/* ---- Test: multi-name inference ---- */
console.log('\n👤 Multi-word name handling:')

assert('infer', '{first}.{last}', inferPattern('sarah.connor@company.com', 'Sarah', 'Connor'), 'Sarah Connor → {first}.{last}')
assert('infer', '{f}{last}', inferPattern('sconnor@company.com', 'Sarah', 'Connor'), 'Sarah Connor → {f}{last}')
assert('infer', '{first}.{l}', inferPattern('sarah.c@company.com', 'Sarah', 'Connor'), 'Sarah Connor → {first}.{l}')

/* ---- Test: email generation from patterns ---- */
console.log('\n📬 Email generation:')

const patterns = [
  { pattern: '{first}.{last}', confidence: 0.9 },
  { pattern: '{f}{last}', confidence: 0.6 },
  { pattern: '{first}', confidence: 0.3 },
]

for (const p of patterns) {
  const generated = applyPattern(p.pattern, 'Alice', 'Smith') + '@example.com'
  const expected = {
    '{first}.{last}': 'alice.smith@example.com',
    '{f}{last}': 'asmith@example.com',
    '{first}': 'alice@example.com',
  }[p.pattern]
  assert('gen', expected, generated, `${p.pattern} → ${expected}`)
}

/* ---- Test: email syntax validation ---- */
console.log('\n✔️ Email syntax validation:')

const validEmails = ['test@example.com', 'john.doe@google.com', 'a@b.co', 'first_last@company.org']
const invalidEmails = ['', '@', 'noat.com', 'has spaces@mail.com', 'double@@at.com', 'nodomain@']

for (const e of validEmails) {
  assert('syntax', true, isValidEmailSyntax(e), `Valid: ${e}`)
}
for (const e of invalidEmails) {
  assert('syntax', false, isValidEmailSyntax(e), `Invalid: ${e || '(empty)'}`)
}

/* ---- Test: disposable domain detection ---- */
console.log('\n🗑️ Disposable domain detection:')

assert('disp', true, isDisposableDomain('mailinator.com'), 'mailinator.com is disposable')
assert('disp', true, isDisposableDomain('guerrillamail.com'), 'guerrillamail.com is disposable')
assert('disp', true, isDisposableDomain('yopmail.com'), 'yopmail.com is disposable')
assert('disp', true, isDisposableDomain('MAILINATOR.COM'), 'detection is case insensitive')
assert('disp', false, isDisposableDomain('gmail.com'), 'gmail.com is NOT disposable')
assert('disp', false, isDisposableDomain('google.com'), 'google.com is NOT disposable')
assert('disp', false, isDisposableDomain('acme.com'), 'a corporate domain is NOT disposable')

/* ---- Summary ---- */
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} tests`)
if (fail > 0) {
  console.log('❌ SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('✅ ALL TESTS PASSED')
}
