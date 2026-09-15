import { randomUUID } from 'crypto'
import type { NextRequest } from 'next/server'
import { deriveIdentity, hasOptedOut } from './identity'
import { getAnalyticsStore } from './store'
// Exposed here so end-to-end callers can observe the precise singleton used
// by record(), including in Node test loaders that resolve TS specifiers twice.
export { getAnalyticsStore, __resetAnalyticsStore } from './store'
import {
  normalizePath,
  normalizeQuery,
  type ClientEvent,
  type EventType,
  type StoredEvent,
} from './events'

/**
 * Turning a request into stored events.
 *
 * THE INVARIANT
 * -------------
 * Recording must never slow down or break the thing being recorded. Two
 * mechanisms enforce that, and both are load-bearing:
 *
 *   1. `record()` never rejects. Every path is wrapped; a store that throws is
 *      logged and swallowed.
 *   2. `recordAndForget()` does not await the write, and bounds it with a
 *      timeout, so a hung database cannot hold a redirect open.
 *
 * This matters most on the Apply redirect. A user clicking Apply must reach the
 * employer whether or not analytics is healthy -- an outage that stops people
 * applying for jobs would be a far worse failure than losing a day of metrics.
 */

/** How long a background write may run before it is abandoned. */
const WRITE_TIMEOUT_MS = 2_000

/* ------------------------------ de-duplication ---------------------------- */

/**
 * Suppress repeats of the same event from the same session.
 *
 * Real traffic is full of refreshes, double-clicks, back-navigation and
 * prefetching. Counting all of those inflates engagement, and inflated
 * engagement is worse than no engagement data: it produces confident wrong
 * decisions about which jobs to promote.
 *
 * So the system records BOTH. Every event is written (raw), and each carries
 * `metadata.repeat` when it is a repeat within the window, which the
 * aggregation uses to separate "clicks" from "unique clicks".
 *
 * The window is per event type, because the natural repeat rate differs: a page
 * view legitimately recurs within a session, an apply click essentially never
 * does.
 */
const DEDUPE_WINDOW_MS: Partial<Record<EventType, number>> = {
  apply_click: 30 * 60_000,
  external_redirect: 30 * 60_000,
  job_detail_view: 5 * 60_000,
  company_view: 5 * 60_000,
  search_result_impression: 30 * 60_000,
  search: 10_000,
  page_view: 10_000,
}

/** sessionId|type|subject -> last seen. Bounded; see sweep() below. */
const lastSeen = new Map<string, number>()
const DEDUPE_CAP = 20_000

function dedupeKey(e: StoredEvent): string {
  const subject = e.jobId ?? e.companySlug ?? normalizeQuery(e.query) ?? e.path ?? ''
  const pos = e.type === 'search_result_impression' ? '' : ''
  return `${e.sessionId}|${e.type}|${subject}${pos}`
}

function sweep(now: number): void {
  if (lastSeen.size <= DEDUPE_CAP) return
  // Drop anything older than the longest window, then, if still over, drop the
  // oldest. Two passes because the first is not guaranteed to free anything --
  // the same bound the rate limiter needed for the same reason.
  const longest = Math.max(...Object.values(DEDUPE_WINDOW_MS).map((v) => v ?? 0))
  for (const [k, t] of lastSeen) if (now - t > longest) lastSeen.delete(k)
  if (lastSeen.size <= DEDUPE_CAP) return
  const byAge = [...lastSeen.entries()].sort((a, b) => a[1] - b[1])
  for (let i = 0; i < byAge.length - DEDUPE_CAP; i++) lastSeen.delete(byAge[i][0])
}

/**
 * Is this a repeat? Marks the event either way and returns the verdict.
 *
 * Per-process, which on a serverless host means it under-detects across
 * instances. That is the safe direction: a missed de-duplication shows up as a
 * slightly high raw count, which the report labels as raw, whereas a false
 * positive would silently discard a real click.
 */
export function markRepeat(e: StoredEvent, now = Date.now()): boolean {
  const window = DEDUPE_WINDOW_MS[e.type]
  if (!window) return false
  const key = dedupeKey(e)
  const prev = lastSeen.get(key)
  const repeat = prev !== undefined && now - prev < window
  lastSeen.set(key, now)
  sweep(now)
  if (repeat) e.metadata = { ...(e.metadata ?? {}), repeat: true }
  return repeat
}

/** Test-only. */
export function __resetDedupe(): void {
  lastSeen.clear()
}

/* -------------------------------- building -------------------------------- */

export interface RecordContext {
  /** Denormalised so source reports do not need a join per row. */
  source?: string
  companySlug?: string
}

/**
 * Build a stored event from a client-reported one plus the request.
 *
 * The server owns id, timestamp, session, device, browser, os, referrer,
 * country and bot status. A client cannot assert any of them, so a forged
 * payload cannot make itself look like a different country or a fresh visitor.
 */
export function buildEvent(
  req: NextRequest,
  event: ClientEvent | (Omit<ClientEvent, 'type'> & { type: EventType }),
  ctx: RecordContext = {},
  now = new Date(),
): StoredEvent {
  const identity = deriveIdentity(req, now)
  return {
    id: randomUUID(),
    type: event.type,
    ts: now.toISOString(),
    sessionId: identity.sessionId,
    jobId: event.jobId,
    companySlug: event.companySlug ?? ctx.companySlug,
    source: ctx.source,
    query: normalizeQuery(event.query) ?? undefined,
    location: event.location?.trim() || undefined,
    filters: event.filters,
    sort: event.sort,
    resultCount: event.resultCount,
    page: event.page,
    position: event.position,
    path: normalizePath(event.path) ?? undefined,
    device: identity.device,
    browser: identity.browser,
    os: identity.os,
    referrer: identity.referrer,
    country: identity.country,
    isBot: identity.isBot,
    metadata: event.metadata,
  }
}

/* -------------------------------- writing --------------------------------- */

/**
 * Persist events. Resolves even when the store is broken.
 *
 * Returns how many were accepted for writing, which the ingestion endpoint
 * reports back so a client can tell "stored" from "discarded" -- without that,
 * an opted-out or disabled system is indistinguishable from a working one.
 */
export async function record(events: StoredEvent[]): Promise<number> {
  if (!events.length) return 0
  try {
    const now = Date.now()
    for (const e of events) markRepeat(e, now)
    await getAnalyticsStore().write(events)
    return events.length
  } catch (err) {
    // Reaching here means a driver broke its own contract. Log and continue:
    // there is no caller for whom failing is better than losing a metric.
    console.error('[analytics] record failed:', (err as Error).message)
    return 0
  }
}

/**
 * Write without waiting.
 *
 * For the Apply redirect, where the user is mid-navigation and every
 * millisecond is felt. The promise is bounded so a hung driver cannot keep the
 * serverless invocation alive past its useful life, and is deliberately
 * unawaited by the caller.
 */
export function recordAndForget(events: StoredEvent[]): void {
  if (!events.length) return
  const timed = Promise.race([
    record(events),
    new Promise<number>((resolve) => setTimeout(() => resolve(0), WRITE_TIMEOUT_MS)),
  ])
  // Attached so an unhandled rejection can never surface, even though record()
  // is already total.
  void timed.catch(() => 0)
}

/** True when this request must not be recorded at all. */
export function shouldSkip(req: NextRequest): boolean {
  return hasOptedOut(req)
}
