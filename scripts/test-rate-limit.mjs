/**
 * Rate limiter.
 *
 *   npx tsx scripts/test-rate-limit.mjs
 *
 * Two of these pin bugs that were present and are not the kind that show up in
 * normal use: both made the limiter QUIETER than intended, so nothing looked
 * broken while a limit was being reset early or a bound was not holding.
 */
import {
  checkRateLimit,
  remainingAttempts,
  resetRateLimit,
  trackedKeyCount,
  __resetAllRateLimits,
} from '../lib/rate-limit.ts'

let pass = 0, fail = 0
const t = (n, c, g) => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (g !== undefined ? '  got: ' + JSON.stringify(g) : '')) } }

const W = (windowMs, max) => ({ windowMs, max })

console.log('\nbasic windowing')
{
  __resetAllRateLimits()
  const cfg = W(60_000, 3)
  t('first attempt allowed', checkRateLimit('a', cfg) === false)
  t('second allowed', checkRateLimit('a', cfg) === false)
  t('third allowed', checkRateLimit('a', cfg) === false)
  t('fourth is limited', checkRateLimit('a', cfg) === true)
  t('stays limited', checkRateLimit('a', cfg) === true)
  t('a different key is unaffected', checkRateLimit('b', cfg) === false)
}

console.log('\nremaining / reset')
{
  __resetAllRateLimits()
  const cfg = W(60_000, 5)
  checkRateLimit('c', cfg)
  checkRateLimit('c', cfg)
  t('remaining counts down', remainingAttempts('c', cfg) === 3, remainingAttempts('c', cfg))
  resetRateLimit('c')
  t('reset restores the full budget', remainingAttempts('c', cfg) === 5)
  t('remaining never goes negative', remainingAttempts('nonexistent', W(1000, 0)) === 0)
}

console.log('\nkeys do not share a window')
{
  // The real pairing: verify-otp limits by email over 15 minutes and by IP over
  // an hour. Eviction used to judge every bucket against the CURRENT caller's
  // cutoff, so a 15-minute call could clear an IP bucket that was still inside
  // its own hour -- resetting the longer limit early and silently.
  __resetAllRateLimits()
  const short = W(1, 2)      // 1ms window: its own hits expire immediately
  const long = W(3_600_000, 2) // 1 hour

  checkRateLimit('ip:1.2.3.4', long)
  checkRateLimit('ip:1.2.3.4', long)
  t('long-window key is at its limit', checkRateLimit('ip:1.2.3.4', long) === true)

  // Eviction only runs once the map is over MAX_TRACKED_KEYS, so the flood has
  // to be big enough to actually trigger it -- a handful of keys would make
  // this test pass without exercising the code path at all.
  //
  // These carry a 1ms window, so pass 1 frees them on their OWN expiry and the
  // LRU fallback never runs. Under the old shared-cutoff logic the same pass
  // also judged the hour-long IP bucket against a 1ms cutoff and deleted it.
  for (let i = 0; i < 12_000; i++) checkRateLimit(`email:${i}@x.com`, short)

  t('eviction actually ran (map is bounded)', trackedKeyCount() <= 10_000, trackedKeyCount())
  t('the long-window key is STILL limited after short-window eviction',
    checkRateLimit('ip:1.2.3.4', long) === true)
}

console.log('\nthe key-flood bound actually holds')
{
  // Every bucket here is fresh, so an expiry-only eviction frees nothing. The
  // old implementation grew without limit in exactly this case -- one key per
  // attempted email address is not a hypothetical shape for an auth endpoint.
  __resetAllRateLimits()
  const cfg = W(3_600_000, 5)
  for (let i = 0; i < 12_000; i++) checkRateLimit(`flood:${i}`, cfg)

  const tracked = trackedKeyCount()
  t('tracked keys stay bounded under a flood of distinct fresh keys',
    tracked <= 10_000, tracked)
  t('and the map is not simply emptied', tracked > 1_000, tracked)
}

console.log('\nlimiting still works after eviction')
{
  __resetAllRateLimits()
  const cfg = W(3_600_000, 2)
  for (let i = 0; i < 12_000; i++) checkRateLimit(`noise:${i}`, cfg)

  // A key touched AFTER the flood is the most-recently-seen, so LRU eviction
  // must not be dropping it.
  checkRateLimit('victim', cfg)
  checkRateLimit('victim', cfg)
  t('a recently active key is still limited', checkRateLimit('victim', cfg) === true)
}

console.log('\nzero and boundary configs')
{
  __resetAllRateLimits()
  t('max 0 limits immediately', checkRateLimit('z', W(1000, 0)) === true)
  t('max 1 allows exactly one', checkRateLimit('z1', W(1000, 1)) === false)
  t('and then limits', checkRateLimit('z1', W(1000, 1)) === true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
