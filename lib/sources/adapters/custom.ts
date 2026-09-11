import { BaseAdapter, absoluteUrl } from './base'
import type { FetchOptions, FetchResult, RawJob, SourceId, SourceTarget } from '../types'
import { toIso, htmlToText } from '../types'

/**
 * Company-owned career sites with no recognisable ATS (§10).
 *
 * Extraction order is deliberate, strongest structure first:
 *
 *   1. JSON-LD  `@type: JobPosting`  - a W3C/schema.org standard the employer
 *                                      published for exactly this purpose.
 *   2. Embedded JSON (__NEXT_DATA__, __NUXT__, window.__STATE__)
 *   3. sitemap.xml job URLs           - enumerates postings without guessing.
 *   4. HTML heuristics                - last resort, brittle by nature.
 *
 * Anything above HTML survives a redesign; HTML selectors do not. That is why
 * the fallback order matters more than the selectors themselves.
 */

const CAREER_PATHS = [
  '/careers', '/jobs', '/careers/jobs', '/open-positions', '/join-us',
  '/work-with-us', '/opportunities', '/about/careers', '/company/careers',
  '/en/careers', '/careers/open-roles',
]

export class CustomSiteAdapter extends BaseAdapter {
  readonly id: SourceId = 'custom'
  readonly displayName = 'Company career site'
  readonly hostPatterns = []
  protected discoveryPattern = null
  protected healthUrl() {
    return 'https://example.com'
  }

  /**
   * Locate a career page on a domain by trying conventional paths and the
   * sitemap. Returns a target whose `site` is the resolved careers URL.
   */
  async locateCareersPage(domain: string): Promise<string | null> {
    const base = domain.startsWith('http') ? domain : `https://${domain}`

    // robots.txt often points at the sitemap, which is the cheapest reliable
    // way to find job URLs without guessing paths.
    const robots = await this.get(`${base}/robots.txt`, {
      cacheTtlMs: this.ttl.atsDetection,
      retries: 0,
    }).catch(() => null)
    if (robots?.ok && robots.body) {
      const sitemapLine = robots.body.match(/^\s*sitemap:\s*(\S+)/im)
      if (sitemapLine) {
        const found = await this.findCareersInSitemap(sitemapLine[1])
        if (found) return found
      }
    }

    for (const path of CAREER_PATHS) {
      const url = `${base}${path}`
      const res = await this.get(url, { cacheTtlMs: this.ttl.atsDetection, retries: 0 }).catch(() => null)
      if (res?.ok && res.body && /job|position|opening|vacanc|role/i.test(res.body)) {
        return url
      }
    }
    return null
  }

  private async findCareersInSitemap(sitemapUrl: string): Promise<string | null> {
    const res = await this.get(sitemapUrl, { cacheTtlMs: this.ttl.atsDetection, retries: 0 }).catch(() => null)
    if (!res?.ok || !res.body) return null
    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
    return locs.find((u) => /\/(careers?|jobs?|open-positions|vacancies)(\/|$)/i.test(u)) ?? null
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const pageUrl = target.site || (target.token.startsWith('http') ? target.token : `https://${target.token}`)

    const res = await this.get(pageUrl, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }).catch(() => null)
    if (!res?.ok || !res.body) {
      return { jobs: [], incremental: false, warnings: [`custom:${pageUrl} unreachable`] }
    }

    // 1 -- JSON-LD
    let jobs = this.fromJsonLd(res.body, pageUrl, target, warnings)
    if (jobs.length) return { jobs, incremental: false, warnings }

    // 2 -- embedded framework state
    jobs = this.fromEmbeddedJson(res.body, pageUrl, target, warnings)
    if (jobs.length) return { jobs, incremental: false, warnings }

    // 3 -- sitemap, then JSON-LD on each job page
    //
    // Large employers on Phenom, SuccessFactors and similar render a landing
    // page with NO JobPosting markup at all -- the structured data lives on the
    // individual job pages, and the sitemap is what enumerates them. eBay is
    // exactly this shape: jobs.ebayinc.com/us/en has no JSON-LD, its sitemap
    // lists 302 job URLs, and every one of those carries a complete JobPosting.
    //
    // Checking only the landing page therefore reported "no structured job data
    // found" for employers who publish it perfectly well, one level down.
    jobs = await this.fromSitemap(pageUrl, target, warnings, opts)
    if (jobs.length) return { jobs, incremental: false, warnings }

    warnings.push(`custom:${pageUrl} no structured job data found`)
    return { jobs: [], incremental: false, warnings }
  }

  /**
   * Enumerate job pages from the site's sitemap and read JSON-LD from each.
   *
   * Deliberately bounded and polite: this makes one request per posting, which
   * is the most expensive shape in the whole pipeline, so it is capped and runs
   * through the shared HTTP layer's per-host throttle. It is a fallback, used
   * only when the cheaper paths found nothing.
   */
  private async fromSitemap(
    pageUrl: string,
    target: SourceTarget,
    warnings: string[],
    opts: FetchOptions
  ): Promise<RawJob[]> {
    const origin = new URL(pageUrl).origin

    // Prefer the sitemap robots.txt advertises; fall back to conventional paths.
    const candidates: string[] = []
    const robots = await this.get(`${origin}/robots.txt`, {
      cacheTtlMs: this.ttl.atsDetection, retries: 0, signal: opts.signal,
    }).catch(() => null)
    if (robots?.ok && robots.body) {
      for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.push(m[1])
    }
    candidates.push(`${pageUrl.replace(/\/$/, '')}/sitemap.xml`, `${origin}/sitemap.xml`)

    let urls: string[] = []
    for (const sm of candidates) {
      const r = await this.get(sm, { cacheTtlMs: this.ttl.discovery, retries: 0, signal: opts.signal })
        .catch(() => null)
      if (!r?.ok || !r.body) continue

      // A sitemap index points at further sitemaps rather than pages.
      const nested = [...r.body.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/gi)].map((m) => m[1])
      const locs = [...r.body.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/gi)].map((m) => m[1])

      urls = locs.filter((u) => /\/job[\/-]/i.test(u))
      if (urls.length) break

      for (const child of nested.slice(0, 5)) {
        const cr = await this.get(child, { cacheTtlMs: this.ttl.discovery, retries: 0, signal: opts.signal })
          .catch(() => null)
        if (!cr?.ok || !cr.body) continue
        const childLocs = [...cr.body.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/gi)].map((m) => m[1])
        urls.push(...childLocs.filter((u) => /\/job[\/-]/i.test(u)))
      }
      if (urls.length) break
    }

    if (!urls.length) return []

    const cap = opts.maxPages ? opts.maxPages * 100 : 1000
    const wanted = [...new Set(urls)].slice(0, cap)
    if (urls.length > cap) {
      warnings.push(`custom:${pageUrl} sitemap had ${urls.length} job URLs, read ${cap}`)
    }

    const jobs: RawJob[] = []
    const queue = [...wanted]
    // Modest concurrency: the HTTP layer already throttles per host, and this
    // is one request per posting.
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const u = queue.shift()!
          const page = await this.get(u, { cacheTtlMs: this.ttl.jobDetail, retries: 0, signal: opts.signal })
            .catch(() => null)
          if (!page?.ok || !page.body) continue
          jobs.push(...this.fromJsonLd(page.body, u, target, warnings))
        }
      })
    )
    return jobs
  }

  /** schema.org JobPosting, the most reliable non-ATS source. */
  private fromJsonLd(html: string, pageUrl: string, target: SourceTarget, warnings: string[]): RawJob[] {
    const blocks = [...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )].map((m) => m[1])

    const postings: any[] = []
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block.trim())
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          // JobPostings can be nested inside @graph or ItemList.
          const candidates = [
            item,
            ...(Array.isArray(item?.['@graph']) ? item['@graph'] : []),
            ...(Array.isArray(item?.itemListElement)
              ? item.itemListElement.map((e: any) => e?.item ?? e)
              : []),
          ]
          for (const c of candidates) {
            const type = c?.['@type']
            const isJob = Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting'
            if (isJob) postings.push(c)
          }
        }
      } catch {
        // A malformed block is common; skip it rather than abandon the page.
      }
    }

    return this.mapRows(postings, target, (p) => {
      const loc = p.jobLocation
      const addr = Array.isArray(loc) ? loc[0]?.address : loc?.address
      const locationRaw = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
        .filter((v) => typeof v === 'string')
        .join(', ') || (typeof loc === 'string' ? loc : null)

      const salary = p.baseSalary?.value
      const url = typeof p.url === 'string' ? absoluteUrl(pageUrl, p.url) : pageUrl
      const identifier =
        typeof p.identifier === 'string'
          ? p.identifier
          : p.identifier?.value ?? p.identifier?.name ?? null

      return {
        source: this.id,
        target,
        sourceId: String(identifier ?? url),
        requisitionId: identifier ? String(identifier) : null,
        title: String(p.title ?? '').trim(),
        company: p.hiringOrganization?.name ?? target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        locationRaw,
        description: htmlToText(p.description),
        descriptionHtml: typeof p.description === 'string' ? p.description : null,
        employmentType: Array.isArray(p.employmentType) ? p.employmentType[0] : p.employmentType ?? null,
        remoteFlag:
          p.jobLocationType === 'TELECOMMUTE' ||
          /remote/i.test(String(p.jobLocationType ?? '')) ||
          null,
        postedAt: toIso(p.datePosted),
        updatedAt: toIso(p.dateModified),
        salaryMin: typeof salary?.minValue === 'number' ? salary.minValue : null,
        salaryMax: typeof salary?.maxValue === 'number' ? salary.maxValue : null,
        salaryCurrency: p.baseSalary?.currency ?? null,
        applicationUrl: url,
        canonicalUrl: url,
      }
    }, warnings)
  }

  /** Next.js / Nuxt / generic embedded state. */
  private fromEmbeddedJson(html: string, pageUrl: string, target: SourceTarget, warnings: string[]): RawJob[] {
    const patterns = [
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      /window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
      /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
    ]

    for (const re of patterns) {
      const m = html.match(re)
      if (!m) continue
      try {
        const state = JSON.parse(m[1].trim())
        const found = this.harvestJobArrays(state)
        if (found.length) {
          return this.mapRows(found, target, (j) => {
            const url = j.url || j.applyUrl || j.absolute_url || j.link
            const title = j.title || j.name || j.jobTitle
            if (!title) return null
            return {
              source: this.id,
              target,
              sourceId: String(j.id ?? j.jobId ?? url ?? title),
              requisitionId: j.requisitionId ? String(j.requisitionId) : null,
              title: String(title).trim(),
              company: target.companyName ?? null,
              companyDomain: target.companyDomain ?? null,
              locationRaw: typeof j.location === 'string' ? j.location : j.location?.name ?? j.city ?? null,
              description: typeof j.description === 'string' ? htmlToText(j.description) : null,
              department: typeof j.department === 'string' ? j.department : j.department?.name ?? null,
              employmentType: j.employmentType ?? j.type ?? null,
              remoteFlag: typeof j.remote === 'boolean' ? j.remote : null,
              postedAt: toIso(j.postedAt ?? j.publishedAt ?? j.createdAt ?? j.datePosted),
              applicationUrl: url ? absoluteUrl(pageUrl, url) : pageUrl,
              canonicalUrl: url ? absoluteUrl(pageUrl, url) : pageUrl,
            }
          }, warnings)
        }
      } catch {
        // Nuxt state is often a function expression rather than JSON.
      }
    }
    return []
  }

  /**
   * Walk an arbitrary object graph for arrays that look like job listings.
   * Framework state shapes vary far too much to hard-code a path.
   */
  private harvestJobArrays(root: unknown, depth = 0): any[] {
    if (depth > 6 || root === null || typeof root !== 'object') return []

    if (Array.isArray(root)) {
      const looksLikeJobs =
        root.length > 0 &&
        root.every(
          (r) =>
            r && typeof r === 'object' &&
            ('title' in r || 'name' in r || 'jobTitle' in r) &&
            ('url' in r || 'id' in r || 'applyUrl' in r || 'absolute_url' in r)
        )
      if (looksLikeJobs) return root as any[]
      return root.flatMap((r) => this.harvestJobArrays(r, depth + 1))
    }

    const out: any[] = []
    for (const value of Object.values(root as Record<string, unknown>)) {
      out.push(...this.harvestJobArrays(value, depth + 1))
      if (out.length > 0) break // first plausible array wins
    }
    return out
  }
}
