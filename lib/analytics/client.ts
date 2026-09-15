'use client'

import type { ClientEvent } from './events'

/**
 * Browser-side event queue.
 *
 * DESIGN CONSTRAINTS, IN PRIORITY ORDER
 * -------------------------------------
 *   1. Never block rendering or interaction. Every call returns immediately;
 *      nothing here is awaited by UI code.
 *   2. Never lose the last events of a visit. The queue is flushed on
 *      `visibilitychange` with `sendBeacon`, which the browser delivers even as
 *      the page is being torn down. A plain fetch at unload is cancelled.
 *   3. Cost almost nothing. No dependency, no polling, one timer.
 *
 * WHAT IS NOT HERE
 * ----------------
 * Apply clicks. Those are recorded server-side by /go/job, because a beacon
 * fired during a navigation away is exactly the event most likely to be lost --
 * and it is the most valuable one. See lib/analytics/links.ts.
 */

/** Batched so a burst of impressions is one request, not twenty. */
const FLUSH_INTERVAL_MS = 3_000
/** Kept under the server's batch cap (50) with room to spare. */
const MAX_QUEUE = 40
const ENDPOINT = '/api/analytics/events'

let queue: ClientEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let listenersAttached = false

/**
 * Has the visitor opted out?
 *
 * Checked in the browser as well as on the server. The server decides, but
 * checking here means an opted-out visitor makes no network request at all,
 * rather than sending data for the server to discard.
 */
function optedOut(): boolean {
  if (typeof navigator === 'undefined') return true
  // Global Privacy Control, legally recognised under CCPA.
  if ((navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return true
  if ((navigator as { doNotTrack?: string }).doNotTrack === '1') return true
  if (typeof document !== 'undefined' && document.cookie.includes('js_no_analytics=1')) return true
  return false
}

function send(events: ClientEvent[]): void {
  if (!events.length) return
  const body = JSON.stringify({ events })

  /**
   * `sendBeacon` first.
   *
   * It is queued by the browser and survives the page being unloaded, which is
   * the case that matters: a user who searches and immediately clicks a result
   * would otherwise lose the search event. It is also non-blocking by
   * definition, so it cannot delay a navigation.
   */
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      if (ok) return
      // A false return means the browser refused to queue it (usually a size
      // limit). Fall through rather than silently dropping.
    }
  } catch {
    // Some privacy extensions throw from sendBeacon. Fall through.
  }

  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // `keepalive` gives fetch beacon-like unload semantics.
      keepalive: true,
      // Analytics must never carry credentials: it is not a personalised call
      // and sending cookies would widen what the endpoint could be abused for.
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // Offline, blocked, or CSP. Losing analytics is always acceptable; throwing
    // into a component render never is.
  }
}

export function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!queue.length) return
  const batch = queue
  queue = []
  send(batch)
}

function scheduleFlush(): void {
  if (timer) return
  timer = setTimeout(flush, FLUSH_INTERVAL_MS)
}

function attachListeners(): void {
  if (listenersAttached || typeof document === 'undefined') return
  listenersAttached = true

  /**
   * `visibilitychange` rather than `unload`.
   *
   * `unload` and `beforeunload` do not fire reliably on mobile -- a user
   * switching apps or the OS reclaiming the tab skips them entirely, which is
   * most of a job board's traffic. `hidden` fires in all of those cases.
   */
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') flush()
    },
    { capture: true },
  )
  // Belt and braces for desktop browsers that still fire it.
  window.addEventListener('pagehide', flush, { capture: true })
}

/**
 * Queue one event.
 *
 * Returns nothing and never throws. Callers are UI components; an analytics
 * failure must be invisible to them.
 */
export function track(event: ClientEvent): void {
  try {
    if (typeof window === 'undefined' || optedOut()) return

    attachListeners()
    queue.push({
      ...event,
      // Always current, and never the query string -- that can carry the user's
      // search terms, which belong in `query` where they are length-capped.
      path: event.path ?? window.location.pathname,
    })

    // Flush immediately when full rather than growing without bound: a long
    // scroll through results can otherwise queue hundreds of impressions.
    if (queue.length >= MAX_QUEUE) flush()
    else scheduleFlush()
  } catch {
    /* analytics must never break the page */
  }
}

/** Let a visitor turn tracking off from the UI. Persisted for a year. */
export function optOut(): void {
  try {
    document.cookie = 'js_no_analytics=1; path=/; max-age=31536000; SameSite=Lax'
    queue = []
  } catch {
    /* ignore */
  }
}

export function optIn(): void {
  try {
    document.cookie = 'js_no_analytics=; path=/; max-age=0; SameSite=Lax'
  } catch {
    /* ignore */
  }
}

/** Is tracking currently off for this visitor? For the settings UI. */
export function isOptedOut(): boolean {
  return optedOut()
}
