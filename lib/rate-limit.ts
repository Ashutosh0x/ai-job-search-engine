export type WindowConfig = { windowMs: number; max: number }

/**
 * Attempts recorded against one key, plus the window they were recorded under.
 *
 * The window has to be stored per key. Eviction used to test every bucket
 * against the CURRENT caller's cutoff, but keys do not share a window:
 * verify-otp limits by email over 15 minutes and by IP over 60. A 15-minute
 * call triggering eviction would delete IP buckets whose hits were older than
 * 15 minutes but still inside their own hour, silently resetting the longer
 * limit early.
 */
type Bucket = { hits: number[]; windowMs: number; lastSeen: number }

/**
 * Best-effort fixed-window rate limiter.
 *
 * IMPORTANT: this is per-process. On serverless each cold start gets a fresh
 * map and concurrent instances do not share state, so treat it as a speed bump
 * rather than a guarantee. Anything that truly must hold (OTP verification,
 * billing) should move to Upstash Redis or Supabase before this ships to
 * production -- see `checkRateLimitDistributed` below for the intended shape.
 */
const buckets = new Map<string, Bucket>()

/** Stop the map growing without bound in a long-lived process. */
const MAX_TRACKED_KEYS = 10_000

/**
 * Records an attempt against `key`. Returns true when the caller is over the
 * limit and should be rejected.
 */
export function checkRateLimit(key: string, cfg: WindowConfig): boolean {
  const now = Date.now()
  const cutoff = now - cfg.windowMs

  const recent = (buckets.get(key)?.hits || []).filter((t) => t > cutoff)

  if (recent.length >= cfg.max) {
    // Keep the trimmed window so the caller stays limited for the full period.
    buckets.set(key, { hits: recent, windowMs: cfg.windowMs, lastSeen: now })
    return true
  }

  recent.push(now)
  buckets.set(key, { hits: recent, windowMs: cfg.windowMs, lastSeen: now })
  evict(now)

  return false
}

/**
 * Keep the map bounded.
 *
 * Two passes, because the first is not guaranteed to free anything. The old
 * implementation only did the first, so a flood of distinct keys -- one per
 * attempted email address, say -- left every bucket "fresh", freed nothing, and
 * the map grew without limit despite the guard that existed to prevent it.
 */
function evict(now: number): void {
  if (buckets.size <= MAX_TRACKED_KEYS) return

  // 1. Drop buckets whose OWN window has fully elapsed. Judged per key, using
  //    the window that key was recorded under.
  for (const [k, b] of buckets) {
    const newest = b.hits.length ? b.hits[b.hits.length - 1] : 0
    if (newest <= now - b.windowMs) buckets.delete(k)
  }
  if (buckets.size <= MAX_TRACKED_KEYS) return

  // 2. Still over: drop least-recently-seen first. This pass always frees
  //    enough, which is what makes the bound real rather than aspirational.
  //    Evicting an active bucket resets that caller's limit, so it is the
  //    fallback and not the primary strategy.
  const byAge = [...buckets.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)
  const excess = buckets.size - MAX_TRACKED_KEYS
  for (let i = 0; i < excess; i++) buckets.delete(byAge[i][0])
}

/** Remaining attempts in the current window, for Retry-After style responses. */
export function remainingAttempts(key: string, cfg: WindowConfig): number {
  const cutoff = Date.now() - cfg.windowMs
  const recent = (buckets.get(key)?.hits || []).filter((t) => t > cutoff)
  return Math.max(0, cfg.max - recent.length)
}

/** Clears a key, e.g. after a successful login. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

/** Number of keys currently tracked. Exposed so the bound can be asserted. */
export function trackedKeyCount(): number {
  return buckets.size
}

/** Drops all state. Test-only. */
export function __resetAllRateLimits(): void {
  buckets.clear()
}
