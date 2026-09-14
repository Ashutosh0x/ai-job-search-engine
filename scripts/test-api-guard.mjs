/**
 * The public-API rate guard.
 *
 * These routes had no limiting of any kind, because it is easy to assume the
 * middleware covers them -- it does not, the matcher excludes `api`. Now that
 * a limiter is in front of them, an off-by-one either blocks real users or
 * protects nothing, and neither failure is visible by reading the code.
 *
 * The client-IP rule is worth pinning too: `x-forwarded-for` is a chain and the
 * FIRST entry is the original client. Taking the last one yields the proxy
 * address and buckets every visitor in the world together, which turns a rate
 * limit into a global outage under load.
 */

import { guard, clientIp, PUBLIC_READ, EXPENSIVE_READ } from '../lib/api-guard.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 200)) }
}

/** Minimal stand-in for NextRequest: the guard only reads headers. */
const req = (headers = {}) => ({
  headers: {
    get: (k) => headers[k.toLowerCase()] ?? null,
  },
})

/* ------------------------------- client ip -------------------------------- */
{
  t('takes the FIRST x-forwarded-for entry, not the proxy',
    clientIp(req({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' })) === '203.0.113.9',
    clientIp(req({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' })))

  t('trims whitespace',
    clientIp(req({ 'x-forwarded-for': '  203.0.113.9 , 70.41.3.18' })) === '203.0.113.9')

  t('falls back to x-real-ip',
    clientIp(req({ 'x-real-ip': '198.51.100.4' })) === '198.51.100.4')

  t('prefers x-forwarded-for over x-real-ip',
    clientIp(req({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '198.51.100.4' })) === '203.0.113.9')

  t('buckets an unidentifiable caller under anon', clientIp(req({})) === 'anon')

  t('an empty forwarded chain still resolves',
    clientIp(req({ 'x-forwarded-for': '' })) === 'anon',
    clientIp(req({ 'x-forwarded-for': '' })))
}

/* ------------------------------- limiting --------------------------------- */
{
  const cfg = { windowMs: 60_000, max: 3 }
  const r = req({ 'x-forwarded-for': '10.0.0.1' })

  t('first request passes', guard(r, 'unit-a', cfg) === null)
  t('second passes', guard(r, 'unit-a', cfg) === null)
  t('third passes (max is 3)', guard(r, 'unit-a', cfg) === null)

  const blocked = guard(r, 'unit-a', cfg)
  t('fourth is blocked', blocked !== null)
  t('blocked with 429', blocked?.status === 429, blocked?.status)
  t('sets Retry-After', blocked?.headers?.get('Retry-After') === '60',
    blocked?.headers?.get('Retry-After'))
}

/* -------------------------- isolation between keys ------------------------- */
{
  const cfg = { windowMs: 60_000, max: 1 }
  const a = req({ 'x-forwarded-for': '10.0.0.2' })
  const b = req({ 'x-forwarded-for': '10.0.0.3' })

  t('client A first call passes', guard(a, 'unit-b', cfg) === null)
  t('client A is then blocked', guard(a, 'unit-b', cfg) !== null)
  t('a DIFFERENT client is unaffected', guard(b, 'unit-b', cfg) === null)

  // Route names must not share a bucket, or hammering search would lock a user
  // out of an unrelated endpoint.
  t('a different route name is a different bucket', guard(a, 'unit-c', cfg) === null)
}

/* ------------------------------- the tiers -------------------------------- */
{
  t('PUBLIC_READ is per-minute', PUBLIC_READ.windowMs === 60_000, PUBLIC_READ)
  t('EXPENSIVE_READ is stricter than PUBLIC_READ',
    EXPENSIVE_READ.max < PUBLIC_READ.max, { EXPENSIVE_READ, PUBLIC_READ })

  // A limit low enough to interrupt ordinary browsing is a bug, not safety.
  // Explore fires one request per filter change plus one per Load more.
  t('EXPENSIVE_READ still allows real browsing', EXPENSIVE_READ.max >= 30, EXPENSIVE_READ)
  t('PUBLIC_READ allows a burst of filtering', PUBLIC_READ.max >= 60, PUBLIC_READ)
}

/* ------------------------------ the payload -------------------------------- */
{
  const cfg = { windowMs: 30_000, max: 1 }
  const r = req({ 'x-forwarded-for': '10.0.0.9' })
  guard(r, 'unit-d', cfg)
  const blocked = guard(r, 'unit-d', cfg)
  const body = await blocked.json()

  t('reports failure rather than empty success', body.success === false, body)
  t('names the limit so a client can back off correctly',
    typeof body.detail === 'string' && body.detail.includes('1 requests per 30s'), body.detail)
  t('Retry-After matches the window', blocked.headers.get('Retry-After') === '30')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
