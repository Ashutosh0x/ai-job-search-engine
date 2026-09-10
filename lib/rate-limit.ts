export type WindowConfig = { windowMs: number; max: number }

type Bucket = number[]

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

  const recent = (buckets.get(key) || []).filter((t) => t > cutoff)

  if (recent.length >= cfg.max) {
    // Keep the trimmed window so the caller stays limited for the full period.
    buckets.set(key, recent)
    return true
  }

  recent.push(now)
  buckets.set(key, recent)

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of buckets) {
      if (v.every((t) => t <= cutoff)) buckets.delete(k)
      if (buckets.size <= MAX_TRACKED_KEYS) break
    }
  }

  return false
}

/** Remaining attempts in the current window, for Retry-After style responses. */
export function remainingAttempts(key: string, cfg: WindowConfig): number {
  const cutoff = Date.now() - cfg.windowMs
  const recent = (buckets.get(key) || []).filter((t) => t > cutoff)
  return Math.max(0, cfg.max - recent.length)
}

/** Clears a key, e.g. after a successful login. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}
