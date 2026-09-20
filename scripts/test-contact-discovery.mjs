/**
 * Integration test for the contact discovery API.
 *
 *   node scripts/test-contact-discovery.mjs
 *   node scripts/test-contact-discovery.mjs --api http://localhost:3000
 *
 * Tests all contact discovery API endpoints against a running server.
 * Start the dev server first: npm run dev
 */

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const API = val('api', 'http://localhost:3000')

let pass = 0, fail = 0, skip = 0

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ✅ ${name}`)
  } catch (err) {
    fail++
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

async function tryFetch(url, opts) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) })
  } catch (err) {
    throw new Error(`Fetch failed for ${url}: ${err.message}`)
  }
}

/* ==================================================================== */
console.log('\n🔍 Contact Discovery API Tests')
console.log(`   Server: ${API}\n`)

// Check server is running
try {
  await fetch(`${API}`, { signal: AbortSignal.timeout(5000) })
} catch {
  console.log('⚠️  Server not running. Start with `npm run dev` first.')
  console.log('   Skipping API tests, running offline tests only.\n')
  skip++
}

/* ---- POST /api/contacts/discover ---- */
console.log('📧 POST /api/contacts/discover')

await test('Valid discovery request', async () => {
  const r = await tryFetch(`${API}/api/contacts/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Sundar',
      lastName: 'Pichai',
      company: 'Google',
      domain: 'google.com',
    }),
  })
  assert(r.status === 200, `Expected 200, got ${r.status}`)
  const data = await r.json()
  // Every route in this feature answers `{ data: ... }`, and lib/contacts/client.ts
  // reads body.data. This suite asserted a bare `contact` field, so it failed
  // against a correct API rather than catching anything.
  assert(data.data?.contact, 'Response should have data.contact')
  const { contact, discoveryTimeMs } = data.data
  assert(Array.isArray(contact.emails), 'Contact should have an emails array')
  assert(contact.firstName === 'Sundar', 'firstName should be Sundar')
  assert(contact.company === 'Google', 'company should be Google')
  // Discovery legitimately returns zero addresses when nothing is observed and
  // no pattern is known. That is a valid answer, not a failure.
  for (const e of contact.emails) {
    assert(typeof e.address === 'string' && e.address.includes('@'), 'each email needs an address')
    assert(['pattern','github','careers','public','sec'].includes(e.source), `unexpected source "${e.source}"`)
  }
  console.log(`    Found ${contact.emails.length} emails, discovery took ${discoveryTimeMs}ms`)
})

await test('Missing required fields returns 400', async () => {
  const r = await tryFetch(`${API}/api/contacts/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'John' }), // missing lastName, company
  })
  assert(r.status === 400, `Expected 400, got ${r.status}`)
})

await test('Empty body returns 400', async () => {
  const r = await tryFetch(`${API}/api/contacts/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert(r.status === 400, `Expected 400, got ${r.status}`)
})

/* ---- POST /api/contacts/bulk-discover ---- */
console.log('\n📦 POST /api/contacts/bulk-discover')

await test('Bulk discovery with 3 profiles', async () => {
  const r = await tryFetch(`${API}/api/contacts/bulk-discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profiles: [
        { firstName: 'Satya', lastName: 'Nadella', company: 'Microsoft', domain: 'microsoft.com' },
        { firstName: 'Tim', lastName: 'Cook', company: 'Apple', domain: 'apple.com' },
        { firstName: 'Andy', lastName: 'Jassy', company: 'Amazon', domain: 'amazon.com' },
      ],
    }),
  })
  assert(r.status === 200, `Expected 200, got ${r.status}`)
  const data = await r.json()
  assert(Array.isArray(data.data), 'Response should have a data array')
  assert(data.data.length === 3, `Expected 3 results, got ${data.data.length}`)
  console.log(`    Processed ${data.data.length} profiles`)
})

await test('Bulk: empty profiles array returns 400', async () => {
  const r = await tryFetch(`${API}/api/contacts/bulk-discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [] }),
  })
  assert(r.status === 400, `Expected 400, got ${r.status}`)
})

await test('Bulk: over 50 profiles returns 400', async () => {
  const profiles = Array.from({ length: 51 }, (_, i) => ({
    firstName: `User${i}`, lastName: `Test`, company: 'TestCo',
  }))
  const r = await tryFetch(`${API}/api/contacts/bulk-discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles }),
  })
  assert(r.status === 400, `Expected 400, got ${r.status}`)
})

/* ---- POST /api/contacts/export ---- */
console.log('\n📤 POST /api/contacts/export')

await test('Export without auth returns 401', async () => {
  const r = await tryFetch(`${API}/api/contacts/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactIds: ['test-id'], format: 'csv' }),
  })
  // Should be 401 since no auth cookie
  assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`)
})

/* ---- GET /api/contacts/lists ---- */
console.log('\n📋 GET /api/contacts/lists')

await test('Lists without auth returns 401', async () => {
  const r = await tryFetch(`${API}/api/contacts/lists`)
  assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`)
})

/* ---- POST /api/contacts/reveal ---- */
console.log('\n🔑 POST /api/contacts/reveal')

await test('Reveal without auth returns 401', async () => {
  const r = await tryFetch(`${API}/api/contacts/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Test', lastName: 'User', company: 'TestCo',
    }),
  })
  assert(r.status === 401 || r.status === 403, `Expected 401/403, got ${r.status}`)
})

/* ==================================================================== */
console.log(`\n${'='.repeat(50)}`)
console.log(`Results: ${pass} passed, ${fail} failed, ${skip} skipped`)
if (fail > 0) {
  console.log('❌ SOME TESTS FAILED')
  process.exit(1)
} else {
  console.log('✅ ALL TESTS PASSED')
}
