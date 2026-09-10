import type {
  FetchOptions, FetchResult, HealthStatus, JobSource, RawJob, SourceId, SourceTarget,
} from '../types'
import { httpGet, httpJson, httpPostJson, CACHE_TTL } from '../http'
import { detectFromUrl } from '../detector'
import { discoverProvider, latestCrawl } from '../../discovery/common-crawl'

/**
 * Shared adapter scaffolding.
 *
 * Concrete adapters supply an endpoint and a row mapper. Discovery, health
 * checks, URL parsing and error containment are inherited, which is what keeps
 * "add an ATS" down to one small file.
 */
export abstract class BaseAdapter implements JobSource {
  abstract readonly id: SourceId
  abstract readonly displayName: string
  abstract readonly hostPatterns: RegExp[]

  /** Common Crawl URL pattern used for discovery, when the platform has one. */
  protected discoveryPattern: string | null = null

  /** A URL known to be up, used for the health check. */
  protected abstract healthUrl(): string

  abstract fetchJobs(target: SourceTarget, opts?: FetchOptions): Promise<FetchResult>

  async discover({ limit = 500 }: { limit?: number } = {}): Promise<SourceTarget[]> {
    if (!this.discoveryPattern) return []
    try {
      const crawl = await latestCrawl()
      const candidates = await discoverProvider(crawl, this.id as string, { maxPages: 3 })
      return candidates.slice(0, limit).map((c) => ({
        source: this.id,
        token: c.token,
        site: c.site,
        host: c.host,
        discoveredVia: 'common-crawl',
        confidence: 0.7, // unverified until fetchJobs succeeds
      }))
    } catch {
      return []
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now()
    try {
      const res = await httpGet(this.healthUrl(), { timeoutMs: 12_000, retries: 0 })
      return {
        source: this.id,
        healthy: res.ok || res.status === 404, // 404 means the platform answered
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        error: res.ok ? undefined : `HTTP ${res.status}`,
      }
    } catch (err) {
      return {
        source: this.id,
        healthy: false,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  parseUrl(url: string): SourceTarget | null {
    const d = detectFromUrl(url)
    return d.source === this.id && d.target ? d.target : null
  }

  /** Helpers for subclasses. */
  protected json = httpJson
  protected postJson = httpPostJson
  protected get = httpGet
  protected ttl = CACHE_TTL

  /** Wrap a mapper so one malformed row cannot lose the whole board. */
  protected mapRows<T>(
    rows: T[],
    target: SourceTarget,
    map: (row: T) => RawJob | null,
    warnings: string[]
  ): RawJob[] {
    const out: RawJob[] = []
    let skipped = 0
    for (const row of rows) {
      try {
        const job = map(row)
        if (job && job.title && job.applicationUrl) out.push(job)
        else skipped++
      } catch {
        skipped++
      }
    }
    if (skipped > 0) {
      warnings.push(`${this.id}:${target.token} skipped ${skipped} unmappable rows`)
    }
    return out
  }
}

/** Absolute URL from a possibly-relative href. */
export function absoluteUrl(base: string, href: string | null | undefined): string {
  if (!href) return base
  try {
    return new URL(href, base).toString()
  } catch {
    return base
  }
}
