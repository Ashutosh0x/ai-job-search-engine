import { NextResponse, type NextRequest } from 'next/server'
import { ClientEventBatchSchema, LIMITS } from '@/lib/analytics/events'
import { buildEvent, record, shouldSkip } from '@/lib/analytics/record'
import { guard } from '@/lib/api-guard'
import type { WindowConfig } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Client event ingestion.
 *
 *   POST /api/analytics/events   { "events": [ { "type": "search", ... } ] }
 *
 * WHAT A CLIENT MAY AND MAY NOT ASSERT
 * ------------------------------------
 * The browser sends only what it observed: which event, which job, what was
 * typed, which filters, which position. Everything identifying or
 * classifying -- session, country, device, browser, OS, referrer class,
 * timestamp -- is derived server-side in lib/analytics/identity.ts and
 * overwritten if supplied. A forged payload therefore cannot claim to be a
 * different country or a fresh visitor.
 *
 * `apply_click` and `external_redirect` are refused here entirely. They are the
 * two events that matter commercially, so they are the two worth forging, and
 * both are written by the server inside the /go/job redirect where the job id
 * has been resolved against the real index and the redirect actually happened.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * This endpoint answers 202 for anything it accepted, including when the store
 * is disabled or the visitor has opted out. `stored` in the response says what
 * actually happened, so a client can tell the difference without the endpoint
 * having to fail. Nothing here is on a user-visible path: a 500 from analytics
 * must never surface as a broken search.
 */

/**
 * Generous, because a single page legitimately emits several events (a search,
 * then impressions for what became visible), and a burst is normal behaviour
 * rather than abuse. Far tighter than the payload cap, which is what actually
 * bounds cost.
 *
 * NOTE, as elsewhere in this codebase: the limiter is per-process, and on a
 * serverless host that means it barely binds. It raises the cost of hammering
 * one instance; it is not protection against a distributed flood. See
 * lib/api-guard.ts for the measurement.
 */
const INGEST_LIMIT: WindowConfig = { windowMs: 60_000, max: 240 }

export async function POST(req: NextRequest): Promise<Response> {
  const limited = guard(req, 'analytics-ingest', INGEST_LIMIT)
  if (limited) return limited

  /**
   * Opt-out is honoured before the body is even read.
   *
   * Global Privacy Control is legally recognised under CCPA, so "we saw the
   * signal and recorded a little anyway" is not an acceptable reading of it.
   * Nothing is parsed, nothing is counted.
   */
  if (shouldSkip(req)) {
    return NextResponse.json({ ok: true, stored: 0, reason: 'opted_out' }, { status: 202 })
  }

  /**
   * Size-cap before parsing.
   *
   * `req.json()` on an unbounded body is a memory hazard: a single large POST
   * can cost far more than the request is worth. Content-Length is advisory, so
   * the text is measured as well.
   */
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > LIMITS.body) {
    return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
  }

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ ok: false, error: 'Unreadable body' }, { status: 400 })
  }
  if (raw.length > LIMITS.body) {
    return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = ClientEventBatchSchema.safeParse(json)
  if (!parsed.success) {
    /**
     * The validation detail is returned deliberately: this endpoint is called by
     * our own front-end, and a silent 400 during development is how a whole
     * category of events ends up never being recorded without anyone noticing.
     * It reveals only the shape of our own schema, which is in the client bundle
     * anyway.
     */
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid event payload',
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const events = parsed.data.events.map((e) => buildEvent(req, e))
  const stored = await record(events)

  return NextResponse.json(
    { ok: true, received: events.length, stored },
    {
      status: 202,
      // Never cached, never shared: this is a write endpoint.
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

/**
 * Everything else is refused explicitly.
 *
 * Without this, Next answers 405 with no Allow header, and a misconfigured
 * client retries forever against a route it will never reach.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    { ok: false, error: 'This endpoint accepts POST only.' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
