import type { StoredEvent } from './events'

/**
 * Where analytics events go.
 *
 * WHY THERE IS A DRIVER INTERFACE AT ALL
 * --------------------------------------
 * Not speculative generality -- it is forced by what this deployment actually
 * is. Three facts, all verified rather than assumed:
 *
 *   1. The job corpus is a static JSON file, not a database. Nothing about job
 *      search needs Postgres, so analytics cannot assume a database is present.
 *   2. Supabase is configured in .env.local and the project host does NOT
 *      resolve (ENOTFOUND, 2026-09-15, while github.com and supabase.com both
 *      answered 200). Every authenticated feature in this app is already broken
 *      because of it. Writing analytics directly against that client would ship
 *      a feature that cannot run.
 *   3. Vercel functions are ephemeral and horizontally scaled. An in-process
 *      counter is per-instance and lost on cold start -- lib/rate-limit.ts
 *      already documents measuring exactly that.
 *
 * So the store is an interface with drivers, and -- this is the part that
 * matters -- it reports its OWN health. A dashboard reading from a store that
 * cannot persist must say so, not render zeros that look like "nobody visited".
 *
 * THE ONE RULE
 * ------------
 * Nothing in here may ever throw into a request path. An analytics outage must
 * degrade to "no data", never to a failed search or a broken Apply redirect.
 */

export type DriverName = 'supabase' | 'memory' | 'none'

export interface StoreHealth {
  driver: DriverName
  /** Can this store persist an event right now? */
  writable: boolean
  /** Does it retain data beyond this process? */
  durable: boolean
  /** Plain-language reason, shown in the admin UI when not healthy. */
  detail: string
  /** Events dropped because the store could not accept them. */
  dropped: number
}

/** A time window for every read. Half-open: [from, to). */
export interface Window {
  from: Date
  to: Date
}

export interface AnalyticsStore {
  readonly name: DriverName
  health(): Promise<StoreHealth>
  /** Append events. Must resolve -- never reject -- whatever happens. */
  write(events: StoredEvent[]): Promise<void>
  /** Read raw events in a window. Aggregation happens above this layer. */
  read(window: Window): Promise<StoredEvent[]>
  /** Remove events older than the cutoff. Returns how many went. */
  prune(olderThan: Date): Promise<number>
}

/* ============================ memory driver ============================== */

/**
 * A bounded ring buffer in process memory.
 *
 * Honest about what it is: this is the DEVELOPMENT and single-instance driver.
 * It is real storage -- the dashboard reads genuine events from it and the
 * whole funnel can be exercised end to end -- but it does not survive a restart
 * and does not span instances, and `health()` says both.
 *
 * The cap is what makes it safe to leave enabled: a serverless instance under
 * sustained traffic cannot grow this without bound, it recycles.
 */
const MEMORY_CAP = 50_000

class MemoryStore implements AnalyticsStore {
  readonly name = 'memory' as const
  private events: StoredEvent[] = []
  private dropped = 0

  async health(): Promise<StoreHealth> {
    return {
      driver: 'memory',
      writable: true,
      durable: false,
      detail:
        `In-process buffer holding ${this.events.length.toLocaleString('en-US')} of ${MEMORY_CAP.toLocaleString('en-US')} events. ` +
        'Not shared between server instances and cleared on restart, so totals are per-instance and reset on deploy. ' +
        'Configure a durable driver for production reporting.',
      dropped: this.dropped,
    }
  }

  async write(events: StoredEvent[]): Promise<void> {
    for (const e of events) {
      this.events.push(e)
      if (this.events.length > MEMORY_CAP) {
        // Oldest out. Counted, so the dashboard can say the window is partial
        // rather than presenting a truncated history as complete.
        this.events.shift()
        this.dropped++
      }
    }
  }

  async read(window: Window): Promise<StoredEvent[]> {
    const from = window.from.getTime()
    const to = window.to.getTime()
    return this.events.filter((e) => {
      const t = Date.parse(e.ts)
      return Number.isFinite(t) && t >= from && t < to
    })
  }

  async prune(olderThan: Date): Promise<number> {
    const cutoff = olderThan.getTime()
    const before = this.events.length
    this.events = this.events.filter((e) => {
      const t = Date.parse(e.ts)
      return Number.isFinite(t) && t >= cutoff
    })
    return before - this.events.length
  }
}

/* ============================= null driver =============================== */

/**
 * Accepts and discards.
 *
 * Used when analytics is switched off, or when a configured driver could not be
 * reached. It exists so callers never have to null-check a store, and so the
 * "off" state is a first-class, visible thing rather than an exception.
 */
class NullStore implements AnalyticsStore {
  readonly name = 'none' as const
  private dropped = 0
  constructor(private readonly reason: string) {}

  async health(): Promise<StoreHealth> {
    return { driver: 'none', writable: false, durable: false, detail: this.reason, dropped: this.dropped }
  }
  async write(events: StoredEvent[]): Promise<void> {
    this.dropped += events.length
  }
  async read(): Promise<StoredEvent[]> {
    return []
  }
  async prune(): Promise<number> {
    return 0
  }
}

/* ============================ supabase driver ============================ */

/**
 * Postgres via the project's existing Supabase client.
 *
 * Schema: supabase/migrations/20260915000000_create_analytics_events.sql.
 *
 * Reachability is probed ONCE and cached, because the failure mode being
 * guarded against is a host that does not resolve: without the cache every
 * event write would pay a DNS timeout on the request path.
 */
class SupabaseStore implements AnalyticsStore {
  readonly name = 'supabase' as const
  private dropped = 0
  private probe: Promise<{ ok: boolean; detail: string }> | null = null

  constructor(private readonly client: any) {}

  private async reachable(): Promise<{ ok: boolean; detail: string }> {
    if (!this.probe) {
      this.probe = (async () => {
        try {
          const { error } = await this.client
            .from('analytics_events')
            .select('id', { count: 'exact', head: true })
            .limit(1)
          if (error) return { ok: false, detail: `analytics_events is not readable: ${error.message}` }
          return { ok: true, detail: 'Connected.' }
        } catch (err) {
          return { ok: false, detail: `Database unreachable: ${(err as Error).message}` }
        }
      })()
    }
    return this.probe
  }

  async health(): Promise<StoreHealth> {
    const r = await this.reachable()
    return {
      driver: 'supabase',
      writable: r.ok,
      durable: r.ok,
      detail: r.ok
        ? 'Connected to Postgres. Events are durable and shared across instances.'
        : `${r.detail} Run the analytics migration, or unset ANALYTICS_DRIVER to fall back to the in-process store.`,
      dropped: this.dropped,
    }
  }

  async write(events: StoredEvent[]): Promise<void> {
    const r = await this.reachable()
    if (!r.ok) {
      this.dropped += events.length
      return
    }
    try {
      const { error } = await this.client.from('analytics_events').insert(events.map(toRow))
      if (error) {
        this.dropped += events.length
        console.error('[analytics] insert failed:', error.message)
      }
    } catch (err) {
      this.dropped += events.length
      console.error('[analytics] insert threw:', (err as Error).message)
    }
  }

  async read(window: Window): Promise<StoredEvent[]> {
    const r = await this.reachable()
    if (!r.ok) return []
    try {
      const { data, error } = await this.client
        .from('analytics_events')
        .select('*')
        .gte('ts', window.from.toISOString())
        .lt('ts', window.to.toISOString())
        // Bounded: the dashboard aggregates in the app, so an unbounded read is
        // a memory hazard on a busy day rather than a better report.
        .limit(200_000)
      if (error) {
        console.error('[analytics] read failed:', error.message)
        return []
      }
      return (data ?? []).map(fromRow)
    } catch (err) {
      console.error('[analytics] read threw:', (err as Error).message)
      return []
    }
  }

  async prune(olderThan: Date): Promise<number> {
    const r = await this.reachable()
    if (!r.ok) return 0
    try {
      const { data, error } = await this.client
        .from('analytics_events')
        .delete()
        .lt('ts', olderThan.toISOString())
        .select('id')
      if (error) {
        console.error('[analytics] prune failed:', error.message)
        return 0
      }
      return (data ?? []).length
    } catch {
      return 0
    }
  }
}

/** snake_case at the database boundary, camelCase in the app. */
function toRow(e: StoredEvent): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    ts: e.ts,
    session_id: e.sessionId,
    job_id: e.jobId ?? null,
    company_slug: e.companySlug ?? null,
    source: e.source ?? null,
    query: e.query ?? null,
    location: e.location ?? null,
    filters: e.filters ?? null,
    sort: e.sort ?? null,
    result_count: e.resultCount ?? null,
    page: e.page ?? null,
    position: e.position ?? null,
    path: e.path ?? null,
    device: e.device,
    browser: e.browser,
    os: e.os,
    referrer: e.referrer,
    country: e.country,
    is_bot: e.isBot,
    metadata: e.metadata ?? null,
  }
}

function fromRow(r: any): StoredEvent {
  return {
    id: r.id,
    type: r.type,
    ts: typeof r.ts === 'string' ? r.ts : new Date(r.ts).toISOString(),
    sessionId: r.session_id,
    jobId: r.job_id ?? undefined,
    companySlug: r.company_slug ?? undefined,
    source: r.source ?? undefined,
    query: r.query ?? undefined,
    location: r.location ?? undefined,
    filters: r.filters ?? undefined,
    sort: r.sort ?? undefined,
    resultCount: r.result_count ?? undefined,
    page: r.page ?? undefined,
    position: r.position ?? undefined,
    path: r.path ?? undefined,
    device: r.device,
    browser: r.browser,
    os: r.os,
    referrer: r.referrer,
    country: r.country ?? null,
    isBot: Boolean(r.is_bot),
    metadata: r.metadata ?? undefined,
  }
}

/* ============================== resolution =============================== */

let cached: AnalyticsStore | null = null

/**
 * The configured store.
 *
 * ANALYTICS_DRIVER selects explicitly; otherwise Supabase is used when its
 * credentials are present and the in-process buffer when they are not.
 * ANALYTICS_DISABLED=1 turns the whole system off.
 *
 * Resolution never throws: a misconfiguration yields the null store with the
 * reason attached, which the admin dashboard displays.
 */
export function getAnalyticsStore(): AnalyticsStore {
  if (cached) return cached

  if (process.env.ANALYTICS_DISABLED === '1') {
    cached = new NullStore('Analytics is disabled by ANALYTICS_DISABLED=1.')
    return cached
  }

  const requested = (process.env.ANALYTICS_DRIVER ?? '').trim().toLowerCase()

  if (requested === 'none') {
    cached = new NullStore('Analytics driver is set to "none".')
    return cached
  }

  if (requested === 'memory') {
    cached = new MemoryStore()
    return cached
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (requested === 'supabase' || (!requested && url && key)) {
    if (!url || !key) {
      cached = new NullStore(
        'ANALYTICS_DRIVER=supabase but NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not both set.',
      )
      return cached
    }
    try {
      // Required lazily so a missing dependency or bad config cannot break
      // module evaluation, which on Next would break the whole build.
      const { createClient } = require('@supabase/supabase-js')
      cached = new SupabaseStore(
        createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
      )
      return cached
    } catch (err) {
      cached = new NullStore(`Could not construct the Supabase client: ${(err as Error).message}`)
      return cached
    }
  }

  cached = new MemoryStore()
  return cached
}

/** Test-only: drop the memoised store so a new environment takes effect. */
export function __resetAnalyticsStore(): void {
  cached = null
}
