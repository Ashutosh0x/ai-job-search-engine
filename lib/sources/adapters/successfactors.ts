import { BaseAdapter } from './base'
import type { FetchOptions, FetchResult, SourceId, SourceTarget } from '../types'
import { toIso } from '../types'

/**
 * SAP SuccessFactors "Career Site Builder" boards.
 *
 * WHY THIS ADAPTER EXISTS
 * =======================
 * `successfactors` was already a valid SourceId carrying a 0.95 confidence in
 * DEFAULT_SOURCE_CONFIDENCE — but no adapter was ever registered for it. A
 * provider with a SourceId and no adapter does not error: the registry simply
 * has nothing to dispatch to, so a company registered under it ingests zero
 * jobs and reports success. EY (8,519 live roles) and SAP were both absent
 * from the corpus for exactly that reason.
 *
 * WHY HTML AND NOT AN API
 * =======================
 * Career Site Builder renders its results table server-side — `jobTitle-link`
 * anchors to `/job/...`, paginated with `startrow` — so it is readable without
 * a browser. The older career*.successfactors.com RCM portal is JavaScript-only
 * and is NOT supported here; pointing this adapter at one yields nothing, which
 * `healthCheck` will surface rather than hide.
 *
 * TENANT PATHS
 * ============
 * Some tenants serve search at `/search/`, others under a prefix
 * (`careers.ey.com/ey/search/`). `target.site` carries that prefix when needed.
 */
export class SuccessFactorsAdapter extends BaseAdapter {
  readonly id: SourceId = 'successfactors'
  readonly displayName = 'SAP SuccessFactors'
  readonly hostPatterns = [
    /(^|\.)jobs\.sap\.com$/i,
    /(^|\.)successfactors\.(com|eu)$/i,
    /(^|\.)jobs\.hr\.cloud\.sap$/i,
  ]
  protected discoveryPattern = null   // no public tenant index to enumerate

  protected healthUrl() {
    return 'https://jobs.sap.com/search/?q=&startrow=0'
  }

  /** SuccessFactors serves 25 rows per page and pages with `startrow`. */
  private static readonly PAGE_SIZE = 25

  /** Bounded so one enormous board cannot consume an entire crawl budget. */
  private static readonly MAX_PAGES = 400

  private searchUrl(target: SourceTarget, startrow: number): string {
    const host = target.host ?? `${target.token}.jobs.sap.com`
    // `site` is a path prefix here, not a Workday-style site id.
    const prefix = target.site ? `/${String(target.site).replace(/^\/|\/$/g, '')}` : ''
    return `https://${host}${prefix}/search/?q=&startrow=${startrow}`
  }

  /**
   * The board's own result count.
   *
   * Read from the results table's aria-label, which reads
   * "Page 1 of 343, Results 1 to 25 of 8556". The total must be taken from the
   * "Results N to M of TOTAL" clause: a looser `of ([\d,]+)` matches the PAGE
   * count first and reported 343 roles for EY's 8,556-role board — a wrong
   * small total truncates the crawl silently and looks complete.
   */
  private statedTotal(html: string): number | null {
    for (const re of [
      /Results?\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i,
      /Results?\s+\d+\s*[–-]\s*\d+\s+of\s+([\d,]+)/i,
    ]) {
      const m = html.match(re)
      if (m) {
        const n = Number(m[1].replace(/,/g, ''))
        if (Number.isFinite(n) && n > 0) return n
      }
    }
    return null
  }

  private strip(html: string): string {
    return String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&hellip;/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Parse one results page.
   *
   * Reads each `/job/` anchor then takes the nearest following location and
   * date cells, rather than assuming a fixed column order — tenants reorder
   * and rename the columns.
   */
  private parsePage(html: string, host: string): {
    href: string; title: string; location: string | null; postedAt: string | null
  }[] {
    const rows: { href: string; title: string; location: string | null; postedAt: string | null }[] = []
    const seen = new Set<string>()

    const anchorRe = /<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    for (const m of html.matchAll(anchorRe)) {
      const href = m[1]
      const title = this.strip(m[2])
      if (!title || seen.has(href)) continue
      seen.add(href)

      const after = html.slice(m.index ?? 0, (m.index ?? 0) + 2500)
      const loc =
        after.match(/class="[^"]*colLocation[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i) ||
        after.match(/class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i)
      const date = after.match(/class="[^"]*jobDate[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i)

      rows.push({
        href: href.startsWith('http') ? href : `https://${host}${href}`,
        title,
        location: loc ? this.strip(loc[1]) || null : null,
        postedAt: date ? this.strip(date[1]) || null : null,
      })
    }
    return rows
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const host = target.host ?? `${target.token}.jobs.sap.com`

    const collected: ReturnType<SuccessFactorsAdapter['parsePage']> = []
    const seenHrefs = new Set<string>()
    let total: number | null = null

    for (let page = 0; page < SuccessFactorsAdapter.MAX_PAGES; page++) {
      const url = this.searchUrl(target, page * SuccessFactorsAdapter.PAGE_SIZE)

      let body: string
      try {
        const res = await this.get(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })
        if (!res.ok) {
          warnings.push(`successfactors:${target.token} page ${page + 1} HTTP ${res.status}`)
          break
        }
        body = res.body
      } catch (err) {
        warnings.push(`successfactors:${target.token} page ${page + 1}: ${err instanceof Error ? err.message : 'fetch failed'}`)
        break
      }

      if (total === null) total = this.statedTotal(body)

      const rows = this.parsePage(body, host)
      const fresh = rows.filter((r) => !seenHrefs.has(r.href))
      for (const r of fresh) seenHrefs.add(r.href)
      collected.push(...fresh)

      // Past the last page SuccessFactors repeats the final page rather than
      // returning an empty one, so "no new rows" is the real end signal.
      if (fresh.length === 0) break
      if (total !== null && collected.length >= total) break
    }

    if (collected.length === 0) {
      return {
        jobs: [],
        incremental: false,
        warnings: [
          ...warnings,
          `successfactors:${target.token} returned no rows — the tenant may be the ` +
          `JavaScript-only RCM portal, which this adapter cannot read`,
        ],
      }
    }

    const jobs = this.mapRows(collected, target, (r) => {
      // The requisition id is the last path segment of /job/<id>/<slug>.
      const idMatch = r.href.match(/\/job\/([^/?#]+)/i)
      const sourceId = idMatch ? idMatch[1] : r.href

      return {
        source: this.id,
        target,
        sourceId,
        requisitionId: sourceId,
        title: r.title,
        company: target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        // Carried verbatim. SuccessFactors states a postal code here
        // ("Bangalore, IN, 560066"), which is the only place in this pipeline
        // a sub-city locality appears at all — normalising it away loses that.
        locationRaw: r.location,
        description: null,       // list view has none; detail fetch supplies it
        department: null,
        employmentType: null,
        remoteFlag: null,
        postedAt: toIso(r.postedAt),
        applicationUrl: r.href,
        canonicalUrl: r.href,
      }
    }, warnings)

    if (total !== null && jobs.length < total) {
      warnings.push(`successfactors:${target.token} collected ${jobs.length} of ${total} stated roles`)
    }

    return { jobs, incremental: false, warnings }
  }
}
