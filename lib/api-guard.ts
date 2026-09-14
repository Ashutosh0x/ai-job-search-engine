import { type NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, type WindowConfig } from './rate-limit'

/**
 * One place to rate-limit a read-only public API route.
 *
 * WHY THIS IS NEEDED AT ALL
 * -------------------------
 * It is easy to assume the middleware covers this. It does not: the matcher in
 * middleware.ts explicitly excludes `api`, so nothing global ever runs on an
 * API route. Eight read routes -- jobs, search, smart-search, companies,
 * company-intelligence, jobs/delta, docs -- had no limit of any kind, and the
 * heavier ones load and scan a ~113k-row index per request.
 *
 * Each route wiring this up itself meant each route inventing a key format and
 * a client-IP rule, which is how two routes end up limiting different things
 * under the same name.
 *
 * THIS DOES NOT ACTUALLY BOUND PRODUCTION TRAFFIC
 * -----------------------------------------------
 * Worth stating plainly, because wiring a guard in front of a route creates a
 * strong impression that the route is now protected.
 *
 * MEASURED, 2026-09-14: 46 rapid requests to /api/jobs in production returned
 * 46 x 200 and zero 429s, against the 40/min configured here. The identical
 * burst against one local process produced six 429s. The limiter is
 * per-process; Vercel spreads requests across instances and each cold start
 * starts with an empty map.
 *
 * What this IS good for: a single misbehaving client or scraper that happens to
 * keep hitting one warm instance, and making the intent explicit and testable
 * in one place. What it is NOT: protection against a distributed flood, or a
 * reason to treat these endpoints as safe to expose without a shared-store
 * limiter (Upstash Redis; no UPSTASH_* vars are configured in this project).
 */

/** Generous by default: these are public reads, and a real user browsing
 *  results with filters can legitimately fire several requests a second. */
export const PUBLIC_READ: WindowConfig = { windowMs: 60_000, max: 120 }

/** For routes that scan the index or fan out to other services. */
export const EXPENSIVE_READ: WindowConfig = { windowMs: 60_000, max: 40 }

/**
 * The caller's address.
 *
 * `x-forwarded-for` is a comma-separated chain and the FIRST entry is the
 * original client; taking the last gives the proxy and collapses every visitor
 * into one bucket. Vercel also sets `x-real-ip`, which is used as a fallback.
 * A request with neither is bucketed under 'anon' -- shared, deliberately, so
 * an unidentifiable flood is still bounded.
 */
export function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'anon'
}

/**
 * Returns a 429 response when the caller is over the limit, or null to proceed.
 *
 *   const limited = guard(request, 'jobs', EXPENSIVE_READ)
 *   if (limited) return limited
 *
 * `Retry-After` is set because a client that respects it backs off correctly
 * without guessing, and a 429 with no hint invites an immediate retry loop.
 */
export function guard(
  request: NextRequest,
  name: string,
  cfg: WindowConfig = PUBLIC_READ,
): NextResponse | null {
  if (!checkRateLimit(`${name}:${clientIp(request)}`, cfg)) return null

  const retryAfter = Math.ceil(cfg.windowMs / 1000)
  return NextResponse.json(
    {
      success: false,
      error: 'Too many requests',
      detail: `This endpoint allows ${cfg.max} requests per ${retryAfter}s per client.`,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
