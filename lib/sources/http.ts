/**
 * Shared HTTP layer: throttling, retries, circuit breaking, caching.
 *
 * Every adapter goes through this rather than calling fetch directly, so the
 * politeness guarantees hold uniformly and one misbehaving platform cannot
 * stall the run (§27, §29). A source that starts failing is tripped out
 * quickly instead of consuming the whole retry budget on every target.
 */

export interface HttpOptions extends RequestInit {
  /** Per-request timeout. */
  timeoutMs?: number
  /** Retry attempts for transient failures. */
  retries?: number
  /** Cache TTL. 0 disables caching for this call. */
  cacheTtlMs?: number
  /** Override the per-host concurrency slot key. */
  hostKey?: string
}

const DEFAULT_UA =
  process.env.CRAWLER_USER_AGENT ||
  'JobSparkAI/1.0 (+https://jobspark.ai; job discovery; contact: support@jobspark.ai)'

const DEFAULTS = {
  timeoutMs: 20_000,
  retries: 2,
  cacheTtlMs: 0,
  perHostConcurrency: Number(process.env.CRAWLER_HOST_CONCURRENCY || 4),
  globalConcurrency: Number(process.env.CRAWLER_GLOBAL_CONCURRENCY || 24),
  minHostIntervalMs: Number(process.env.CRAWLER_HOST_INTERVAL_MS || 120),
}

/* ------------------------------ concurrency ------------------------------- */

class Semaphore {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active++
    return () => this.release()
  }

  private release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

const globalSem = new Semaphore(DEFAULTS.globalConcurrency)
const hostSems = new Map<string, Semaphore>()
const lastHostRequest = new Map<string, number>()

function hostSemaphore(host: string): Semaphore {
  let s = hostSems.get(host)
  if (!s) {
    s = new Semaphore(DEFAULTS.perHostConcurrency)
    hostSems.set(host, s)
  }
  return s
}

/* ----------------------------- circuit breaker ---------------------------- */

interface Breaker {
  failures: number
  openedAt: number | null
}
const breakers = new Map<string, Breaker>()
const BREAKER_THRESHOLD = 8
const BREAKER_COOLDOWN_MS = 60_000

export class CircuitOpenError extends Error {
  constructor(host: string) {
    super(`Circuit open for ${host}`)
  }
}

function breakerFor(host: string): Breaker {
  let b = breakers.get(host)
  if (!b) {
    b = { failures: 0, openedAt: null }
    breakers.set(host, b)
  }
  return b
}

function recordSuccess(host: string) {
  const b = breakerFor(host)
  b.failures = 0
  b.openedAt = null
}

function recordFailure(host: string) {
  const b = breakerFor(host)
  b.failures++
  if (b.failures >= BREAKER_THRESHOLD && b.openedAt === null) {
    b.openedAt = Date.now()
  }
}

function circuitIsOpen(host: string): boolean {
  const b = breakerFor(host)
  if (b.openedAt === null) return false
  if (Date.now() - b.openedAt > BREAKER_COOLDOWN_MS) {
    // Half-open: let one request through to test recovery.
    b.openedAt = null
    b.failures = BREAKER_THRESHOLD - 1
    return false
  }
  return true
}

/* --------------------------------- cache ---------------------------------- */

interface CacheEntry {
  body: string
  status: number
  etag: string | null
  lastModified: string | null
  storedAt: number
  ttl: number
}

const cache = new Map<string, CacheEntry>()
const MAX_CACHE_ENTRIES = 5_000

/** Named TTLs from §28. Callers pass one of these rather than a magic number. */
export const CACHE_TTL = {
  jobListing: Number(process.env.CACHE_TTL_JOB_LISTING_MS || 15 * 60_000),
  jobDetail: Number(process.env.CACHE_TTL_JOB_DETAIL_MS || 45 * 60_000),
  companyMeta: Number(process.env.CACHE_TTL_COMPANY_MS || 24 * 3600_000),
  atsDetection: Number(process.env.CACHE_TTL_ATS_MS || 7 * 24 * 3600_000),
  discovery: Number(process.env.CACHE_TTL_DISCOVERY_MS || 6 * 3600_000),
  searchResult: Number(process.env.CACHE_TTL_SEARCH_MS || 5 * 60_000),
} as const

function cacheKey(url: string, init?: RequestInit): string {
  const body = typeof init?.body === 'string' ? init.body : ''
  return `${init?.method ?? 'GET'} ${url} ${body}`
}

function pruneCache() {
  if (cache.size <= MAX_CACHE_ENTRIES) return
  const now = Date.now()
  for (const [k, v] of cache) {
    if (now - v.storedAt > v.ttl) cache.delete(k)
    if (cache.size <= MAX_CACHE_ENTRIES) break
  }
  // Still oversized: drop oldest.
  if (cache.size > MAX_CACHE_ENTRIES) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)
    for (let i = 0; i < sorted.length / 4; i++) cache.delete(sorted[i][0])
  }
}

/* --------------------------------- fetch ---------------------------------- */

export interface HttpResponse {
  ok: boolean
  status: number
  body: string
  fromCache: boolean
  etag: string | null
  url: string
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504])

/**
 * Polite, resilient fetch.
 *
 * - Per-host and global concurrency caps.
 * - Minimum interval between requests to the same host.
 * - Exponential backoff with jitter; honours Retry-After on 429.
 * - Circuit breaker per host so a dead platform fails fast.
 * - Conditional requests via ETag/Last-Modified for cheap change detection.
 */
/**
 * HTTP outcome telemetry.
 *
 * WHY THIS EXISTS
 * ---------------
 * `httpJson` returns null on any non-OK response, and adapters turn null into
 * an empty job list. The orchestrator then records the board as
 * `ok: true, jobCount: 0` -- so a board answering 403 was indistinguishable
 * from a board that genuinely has no openings, and the ingest report could
 * truthfully print "0 failures" while a WAF had blocked two dozen employers.
 *
 * That is a reporting defect rather than a crawling one: the crawl behaved
 * correctly, but the summary could not tell the difference between "nothing
 * there" and "we were refused". Recording outcomes here, at the one place every
 * request passes through, makes a blocked board visible without changing how
 * failure is handled downstream.
 */
const outcomes = {
  ok: 0,
  notFound: 0,       // 404/410 -- board genuinely gone
  blocked: 0,        // 401/403/429 and challenge codes -- refused, not empty
  serverError: 0,    // 5xx
  otherHttp: 0,
  networkError: 0,   // DNS, TLS, timeout, abort
  fromCache: 0,
}
/** host -> { status -> count }, so a blocked employer can be named. */
const byHost = new Map<string, Map<number, number>>()

function record(host: string, status: number, kind: keyof typeof outcomes) {
  outcomes[kind]++
  let m = byHost.get(host)
  if (!m) { m = new Map(); byHost.set(host, m) }
  m.set(status, (m.get(status) ?? 0) + 1)
}

/** Classify a status into the bucket a human would act on. */
function classify(status: number): keyof typeof outcomes {
  if (status === 0) return 'networkError'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 404 || status === 410) return 'notFound'
  // 202 belongs here, not in `ok`: Akamai and friends answer a bot challenge
  // with 202 and a stub body, which is a refusal wearing a success code.
  if (status === 401 || status === 403 || status === 429 || status === 202) return 'blocked'
  if (status >= 500) return 'serverError'
  return 'otherHttp'
}

export async function httpGet(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  const {
    timeoutMs = DEFAULTS.timeoutMs,
    retries = DEFAULTS.retries,
    cacheTtlMs = DEFAULTS.cacheTtlMs,
    hostKey,
    ...init
  } = options

  let host: string
  try {
    host = hostKey || new URL(url).host
  } catch {
    return { ok: false, status: 0, body: '', fromCache: false, etag: null, url }
  }

  const key = cacheKey(url, init)
  const cached = cache.get(key)
  if (cached && cacheTtlMs > 0 && Date.now() - cached.storedAt < cached.ttl) {
    return { ok: cached.status < 400, status: cached.status, body: cached.body, fromCache: true, etag: cached.etag, url }
  }

  if (circuitIsOpen(host)) throw new CircuitOpenError(host)

  const releaseGlobal = await globalSem.acquire()
  const releaseHost = await hostSemaphore(host).acquire()

  try {
    // Space out requests to the same host.
    const last = lastHostRequest.get(host) ?? 0
    const wait = DEFAULTS.minHostIntervalMs - (Date.now() - last)
    if (wait > 0) await sleep(wait)

    let lastError: string | null = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      // Respect a caller-supplied signal alongside our timeout.
      const external = (init as RequestInit).signal as AbortSignal | undefined
      if (external) external.addEventListener('abort', () => controller.abort(), { once: true })

      try {
        lastHostRequest.set(host, Date.now())

        const headers: Record<string, string> = {
          'User-Agent': DEFAULT_UA,
          Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          // Pin the content codings we can actually decode.
          //
          // Node's fetch advertises zstd but only decodes the first frame of a
          // multi-frame zstd stream, so a chunked zstd response is silently
          // truncated -- amazon.jobs returned a 200 with exactly 1024 bytes of
          // a ~500KB document, which then failed to parse as JSON. Truncated
          // data arriving under a success status is the worst failure mode
          // there is, because nothing downstream can tell it happened.
          'Accept-Encoding': 'gzip, deflate, br',
          ...(init.headers as Record<string, string> | undefined),
        }
        // Conditional request: lets the server say "unchanged" cheaply.
        if (cached?.etag) headers['If-None-Match'] = cached.etag
        else if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified

        const res = await fetch(url, { ...init, headers, signal: controller.signal })

        if (res.status === 304 && cached) {
          cached.storedAt = Date.now()
          recordSuccess(host)
          return { ok: true, status: 200, body: cached.body, fromCache: true, etag: cached.etag, url }
        }

        if (RETRYABLE.has(res.status) && attempt < retries) {
          const retryAfter = Number(res.headers.get('retry-after'))
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : backoff(attempt)
          lastError = `HTTP ${res.status}`
          await sleep(delay)
          continue
        }

        const body = await res.text()

        if (res.ok) {
          recordSuccess(host)
          if (cacheTtlMs > 0) {
            cache.set(key, {
              body,
              status: res.status,
              etag: res.headers.get('etag'),
              lastModified: res.headers.get('last-modified'),
              storedAt: Date.now(),
              ttl: cacheTtlMs,
            })
            pruneCache()
          }
        } else {
          // 4xx (other than the retryable ones) is a definitive answer, not a
          // transport failure: do not count it against the breaker.
          if (res.status >= 500) recordFailure(host)
        }

        record(host, res.status, classify(res.status))
        return { ok: res.ok, status: res.status, body, fromCache: false, etag: res.headers.get('etag'), url }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (attempt < retries) {
          await sleep(backoff(attempt))
          continue
        }
        recordFailure(host)
        return { ok: false, status: 0, body: '', fromCache: false, etag: null, url }
      } finally {
        clearTimeout(timer)
      }
    }

    recordFailure(host)
    record(host, 0, 'networkError')
    return { ok: false, status: 0, body: lastError ?? '', fromCache: false, etag: null, url }
  } finally {
    releaseHost()
    releaseGlobal()
  }
}

/** JSON convenience wrapper. Returns null rather than throwing on bad JSON. */
export async function httpJson<T = any>(url: string, options: HttpOptions = {}): Promise<T | null> {
  const res = await httpGet(url, options)
  if (!res.ok || !res.body) return null
  try {
    return JSON.parse(res.body) as T
  } catch {
    return null
  }
}

export async function httpPostJson<T = any>(
  url: string,
  payload: unknown,
  options: HttpOptions = {}
): Promise<T | null> {
  const res = await httpGet(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', ...(options.headers as any) },
  })
  if (!res.ok || !res.body) return null
  try {
    return JSON.parse(res.body) as T
  } catch {
    return null
  }
}

function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 15_000)
  return base / 2 + Math.random() * (base / 2) // full jitter
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Snapshot for the observability dashboard. */
export function httpStats() {
  const open: string[] = []
  for (const [host, b] of breakers) if (b.openedAt !== null) open.push(host)

  // Name the hosts that refused us. "23 boards blocked" is actionable only if
  // you can say which, so the worst offenders travel with the counts.
  const blockedHosts: { host: string; status: number; count: number }[] = []
  for (const [host, statuses] of byHost) {
    for (const [status, count] of statuses) {
      if (classify(status) === 'blocked') blockedHosts.push({ host, status, count })
    }
  }
  blockedHosts.sort((a, b) => b.count - a.count)

  const attempted = outcomes.ok + outcomes.notFound + outcomes.blocked +
    outcomes.serverError + outcomes.otherHttp + outcomes.networkError

  return {
    cacheEntries: cache.size,
    openCircuits: open,
    trackedHosts: breakers.size,
    requests: { ...outcomes, attempted },
    successRate: attempted > 0 ? Number((outcomes.ok / attempted).toFixed(4)) : null,
    blockedHosts: blockedHosts.slice(0, 25),
  }
}

export function resetHttpState() {
  cache.clear()
  breakers.clear()
  lastHostRequest.clear()
  byHost.clear()
  for (const k of Object.keys(outcomes)) (outcomes as any)[k] = 0
}
