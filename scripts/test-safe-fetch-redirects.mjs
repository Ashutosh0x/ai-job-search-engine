// fetchPublicFollowingRedirects (lib/safe-fetch.ts): contact discovery fetches
// caller-influenced company sites, so every redirect hop must be re-validated.
// fetch is stubbed (no network); public IP literals avoid DNS in the checks.
import { fetchPublicFollowingRedirects, UnsafeUrlError } from '../lib/safe-fetch.ts'

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

const PUBLIC_A = 'https://93.184.216.34/careers'
const PUBLIC_B = 'https://1.1.1.1/careers'
const realFetch = globalThis.fetch
let calls = []
function stub(routes) {
  calls = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, redirect: init?.redirect })
    const r = routes[url]
    if (!r) return new Response('not found', { status: 404 })
    return new Response(r.body ?? '', { status: r.status, headers: r.location ? { location: r.location } : {} })
  }
}
async function rejects(fn) {
  try {
    await fn()
    return null
  } catch (e) {
    return e
  }
}

try {
  // 1. A private target is refused before any request is made.
  stub({})
  let err = await rejects(() => fetchPublicFollowingRedirects('https://10.0.0.5/careers'))
  check('private IP literal rejected up front', err instanceof UnsafeUrlError, err?.message)
  check('...and no request was sent', calls.length === 0, calls)

  // 2. A public page that redirects to private space is stopped at the hop.
  stub({ [PUBLIC_A]: { status: 302, location: 'http://169.254.169.254/latest/meta-data/' } })
  err = await rejects(() => fetchPublicFollowingRedirects(PUBLIC_A))
  check('redirect to metadata address rejected', err instanceof UnsafeUrlError, err?.message)
  check('...only the public hop was fetched', calls.length === 1 && calls[0].url === PUBLIC_A, calls)
  check('...with redirect: manual (fetch never follows on its own)', calls[0]?.redirect === 'manual', calls)

  // 3. Relative and protocol-relative Locations resolve against the hop, then get checked.
  stub({ [PUBLIC_A]: { status: 301, location: '//127.0.0.1/x' } })
  err = await rejects(() => fetchPublicFollowingRedirects(PUBLIC_A))
  check('protocol-relative redirect to loopback rejected', err instanceof UnsafeUrlError, err?.message)

  stub({ [PUBLIC_A]: { status: 302, location: 'https://user:pw@1.1.1.1/' } })
  err = await rejects(() => fetchPublicFollowingRedirects(PUBLIC_A))
  check('redirect carrying credentials rejected', err instanceof UnsafeUrlError, err?.message)

  // 4. Public -> public redirects are followed (careers pages need this).
  stub({ [PUBLIC_A]: { status: 301, location: PUBLIC_B }, [PUBLIC_B]: { status: 200, body: 'jobs@example.com' } })
  const res = await fetchPublicFollowingRedirects(PUBLIC_A)
  check('public redirect followed to a 200', res.status === 200, res.status)
  check('...body from the final hop', (await res.text()) === 'jobs@example.com')
  check('...two hops fetched', calls.length === 2, calls)

  // 5. Redirect loops end.
  stub({ [PUBLIC_A]: { status: 302, location: PUBLIC_B }, [PUBLIC_B]: { status: 302, location: PUBLIC_A } })
  err = await rejects(() => fetchPublicFollowingRedirects(PUBLIC_A, {}, { maxRedirects: 3 }))
  check('redirect loop stops with an error', err instanceof UnsafeUrlError && /Too many redirects/.test(err.message), err?.message)
  check('...after maxRedirects + 1 requests', calls.length === 4, calls.length)

  // 6. Non-http schemes are refused.
  stub({ [PUBLIC_A]: { status: 302, location: 'file:///etc/passwd' } })
  err = await rejects(() => fetchPublicFollowingRedirects(PUBLIC_A))
  check('redirect to file: rejected', err instanceof UnsafeUrlError, err?.message)
} finally {
  globalThis.fetch = realFetch
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
