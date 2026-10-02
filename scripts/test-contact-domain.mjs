// Regression suite for lib/contacts/domain.ts: the caller-supplied `domain` of
// /api/contacts/discover must be a plain public hostname before any URL, DNS
// query or address is built from it (SSRF via `evil.com@10.0.0.5` etc.).
import { normalizePublicHostname } from '../lib/contacts/domain.ts'

let passed = 0
let failed = 0
const check = (name, condition, actual = '') => {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${actual ? `: ${JSON.stringify(actual)}` : ''}`)
  }
}

const accepted = [
  ['example.com', 'example.com'],
  ['Stripe.COM', 'stripe.com'],
  ['careers.open.gov.sg', 'careers.open.gov.sg'],
  ['my-company.co.uk', 'my-company.co.uk'],
  ['  openai.com  ', 'openai.com'],
  ['example.com.', 'example.com'],
  ['xn--bcher-kva.example', null], // .example is reserved -> rejected below
  ['xn--bcher-kva.de', 'xn--bcher-kva.de'],
]
for (const [input, want] of accepted) {
  const got = normalizePublicHostname(input)
  check(`${JSON.stringify(input)} -> ${JSON.stringify(want)}`, got === want, got)
}

// Every one of these reached a server-side fetch before the fix.
const rejected = [
  'evil.com@10.0.0.5',
  'www.evil.com@169.254.169.254',
  'example.com:8443',
  'example.com/admin?',
  'example.com#',
  '10.0.0.5',
  '127.0.0.1',
  '[::1]',
  'localhost',
  'db.internal',
  'printer.local',
  'host.localhost',
  'intranet',
  'exa mple.com',
  '-bad.com',
  'bad-.com',
  'a..com',
  '',
  '   ',
  `${'a'.repeat(64)}.com`,
  `${'a.'.repeat(130)}com`,
  'example.123',
  'http://example.com',
  null,
  undefined,
  42,
]
for (const input of rejected) {
  const got = normalizePublicHostname(input)
  check(`rejects ${JSON.stringify(input)}`, got === null, got)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
