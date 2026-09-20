import { BaseAdapter, absoluteUrl } from './base'
import type { FetchOptions, FetchResult, RawJob, SourceId, SourceTarget } from '../types'
import { toIso, htmlToText } from '../types'
import { parseRobots, robotsDecision, type RobotsPolicy } from '../robots'

const CRAWLER_AGENT = 'JobSparkAI/1.0'

interface SiteRobots {
  /** Origin whose policy was read. Rules never apply to another host. */
  origin: string
  policy: RobotsPolicy | null
  /** The publisher refused or could not serve its policy, so do not crawl. */
  refused: boolean
  reason: string | null
}

/**
 * Entity decode for text pulled straight out of attributes and text nodes.
 * htmlToText() is for document bodies; this is for a title or a city, where
 * stripping tags is not wanted but `&amp;` must not survive into the index.
 */
function decodeEntities(s: string): string {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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
   * Read robots.txt before touching an unrecognised company site.
   *
   * A 404 is an explicit absence of restrictions. A refusal, timeout, or 5xx
   * is not permission to proceed: the generic adapter has no documented API
   * contract to fall back on, so the conservative result is to skip the site
   * and record why. Known ATS adapters are unaffected by this policy.
   */
  private async readRobots(pageUrl: string, opts: FetchOptions = {}): Promise<SiteRobots> {
    let origin: string
    try {
      origin = new URL(pageUrl).origin
    } catch {
      return { origin: '', policy: null, refused: true, reason: 'invalid site URL' }
    }

    const res = await this.get(`${origin}/robots.txt`, {
      cacheTtlMs: this.ttl.atsDetection,
      retries: 0,
      signal: opts.signal,
    }).catch(() => null)

    if (res?.status === 404 || res?.status === 410) {
      return { origin, policy: null, refused: false, reason: null }
    }
    if (!res?.ok || !res.body) {
      const status = res?.status || 'unreachable'
      return { origin, policy: null, refused: true, reason: `robots.txt ${status}` }
    }

    return {
      origin,
      policy: parseRobots(res.body, CRAWLER_AGENT),
      refused: false,
      reason: null,
    }
  }

  /** True only when a URL belongs to, and is allowed by, this site's policy. */
  private canFetch(robots: SiteRobots, url: string, warnings?: string[]): boolean {
    let candidate: URL
    try {
      candidate = new URL(url)
    } catch {
      warnings?.push(`custom:${url} skipped (invalid URL)`)
      return false
    }

    if (candidate.origin !== robots.origin) {
      warnings?.push(`custom:${url} skipped (outside the verified robots.txt origin)`)
      return false
    }

    const decision = robotsDecision(robots.policy, candidate.toString())
    if (!decision.allowed) {
      warnings?.push(
        `custom:${candidate.pathname} skipped (disallowed by robots.txt${decision.rule ? `: ${decision.rule.pattern}` : ''})`,
      )
    }
    return decision.allowed
  }

  /**
   * Locate a career page on a domain by trying conventional paths and the
   * sitemap. Returns a target whose `site` is the resolved careers URL.
   */
  async locateCareersPage(domain: string): Promise<string | null> {
    const base = domain.startsWith('http') ? domain : `https://${domain}`

    // robots.txt often points at the sitemap, which is the cheapest reliable
    // way to find job URLs without guessing paths.
    const robots = await this.readRobots(base)
    if (robots.refused) return null

    if (robots.policy?.sitemaps.length) {
      for (const sitemap of robots.policy.sitemaps) {
        const sitemapUrl = absoluteUrl(`${robots.origin}/`, sitemap)
        if (!this.canFetch(robots, sitemapUrl)) continue
        const found = await this.findCareersInSitemap(sitemapUrl, robots)
        if (found) return found
      }
    }

    for (const path of CAREER_PATHS) {
      const url = `${base}${path}`
      if (!this.canFetch(robots, url)) continue
      const res = await this.get(url, { cacheTtlMs: this.ttl.atsDetection, retries: 0 }).catch(() => null)
      if (res?.ok && res.body && /job|position|opening|vacanc|role/i.test(res.body)) {
        return url
      }
    }
    return null
  }

  private async findCareersInSitemap(sitemapUrl: string, robots: SiteRobots): Promise<string | null> {
    if (!this.canFetch(robots, sitemapUrl)) return null
    const res = await this.get(sitemapUrl, { cacheTtlMs: this.ttl.atsDetection, retries: 0 }).catch(() => null)
    if (!res?.ok || !res.body) return null
    const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
    return locs.find(
      (u) => /\/(careers?|jobs?|open-positions|vacancies)(\/|$)/i.test(u) && this.canFetch(robots, u),
    ) ?? null
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const pageUrl = target.site || (target.token.startsWith('http') ? target.token : `https://${target.token}`)

    const robots = await this.readRobots(pageUrl, opts)
    if (robots.refused) {
      return {
        jobs: [],
        incremental: false,
        warnings: [`custom:${pageUrl} not crawled (${robots.reason}; no permission could be established)`],
      }
    }
    if (!this.canFetch(robots, pageUrl, warnings)) {
      return { jobs: [], incremental: false, warnings }
    }

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
    jobs = await this.fromSitemap(pageUrl, target, warnings, opts, robots)
    if (jobs.length) return { jobs, incremental: false, warnings }

    // 4 -- paginated server-rendered listing
    //
    // Google's careers site publishes no JSON API (careers.google.com/api/v3
    // 404s), no JSON-LD on the listing, and no job sitemap -- but its result
    // pages are fully server-rendered and paginate with ?page=N, carrying the
    // title, organisation, every location and the canonical link in the HTML.
    // That is 1 request per 20 roles instead of 1 per role, so it is both
    // cheaper and politer than the sitemap fallback above.
    jobs = await this.fromPaginatedListing(pageUrl, target, warnings, opts, robots)
    if (jobs.length) return { jobs, incremental: false, warnings }

    warnings.push(`custom:${pageUrl} no structured job data found`)
    return { jobs: [], incremental: false, warnings }
  }

  /**
   * Walk ?page=N listing pages whose postings are plain anchors.
   *
   * The anchor is the stable part; the surrounding class names are
   * compiler-generated and can change without notice. So a link plus its
   * accessible label is the contract, and locations are best-effort from the
   * card. If the cosmetic classes change, roles keep their titles and URLs and
   * lose their locations, which a warning records rather than hides.
   */
  private async fromPaginatedListing(
    pageUrl: string,
    target: SourceTarget,
    warnings: string[],
    opts: FetchOptions,
    robots: SiteRobots,
  ): Promise<RawJob[]> {
    const LINK_RE =
      /href="((?:[^"]*\/)?jobs\/results\/(\d+)-([a-z0-9-]+))[^"]*"[^>]*aria-label="(?:Learn more about )?([^"]+)"/g

    const rows = new Map<string, any>()
    const maxPages = opts.maxPages ?? 400
    let expected: number | null = null
    let noNewPages = 0

    for (let page = 1; page <= maxPages; page++) {
      const url = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}page=${page}`
      if (!this.canFetch(robots, url, warnings)) break
      const res = await this.get(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }).catch(() => null)
      if (!res?.ok || !res.body) break
      const html = res.body

      if (expected === null) {
        const m = html.match(/of ([\d,]+) rows/)
        expected = m ? Number(m[1].replace(/,/g, '')) : null
      }

      // Resolve links against <base href> when the document declares one.
      //
      // Google's listing lives at /about/careers/applications/jobs/results and
      // sets <base href="https://www.google.com/about/careers/applications/">.
      // Resolving the relative "jobs/results/{id}-{slug}" against the page URL
      // instead produced .../applications/jobs/jobs/results/... -- a duplicated
      // segment and a 404 on every single link. The links are the entire point
      // of the record, so the base has to be the one the page declares.
      const baseM = html.match(/<base[^>]+href=["']([^"']+)["']/i)
      const linkBase = baseM ? absoluteUrl(pageUrl, baseM[1]) : pageUrl

      const marks: { index: number; path: string; id: string; title: string }[] = []
      let m: RegExpExecArray | null
      LINK_RE.lastIndex = 0
      while ((m = LINK_RE.exec(html)) !== null) {
        marks.push({ index: m.index, path: m[1], id: m[2], title: decodeEntities(m[4]) })
      }
      if (!marks.length) break

      let fresh = 0
      for (let i = 0; i < marks.length; i++) {
        if (rows.has(marks[i].id)) continue
        fresh++
        const card = html.slice(i === 0 ? 0 : marks[i - 1].index, marks[i].index)
        // "Atlanta, GA, USA; Austin, TX, USA" puts the separator inside the
        // next span, so each value needs its leading punctuation stripped or
        // one city becomes two locations.
        const locs = [...card.matchAll(/class="r0wTof[^"]*"[^>]*>([^<]+)</g)]
          .map((x) => decodeEntities(x[1]).replace(/^[;,\s]+/, '').trim())
          .filter(Boolean)
        const orgM = card.match(/class="l103df"[^>]*>([^<|]+)\|/)
        rows.set(marks[i].id, {
          id: marks[i].id,
          title: marks[i].title,
          org: orgM ? decodeEntities(orgM[1]) : target.companyName ?? null,
          locations: [...new Set(locs)],
          url: absoluteUrl(linkBase, marks[i].path),
        })
      }

      // Stop when the site stops yielding new ids, rather than at a guessed
      // page count -- a fixed count silently truncates when the board grows.
      if (fresh === 0 && ++noNewPages >= 2) break
      if (fresh > 0) noNewPages = 0
      if (expected !== null && rows.size >= expected) break
    }

    if (!rows.size) return []
    const missingLoc = [...rows.values()].filter((r) => !r.locations.length).length
    if (missingLoc) {
      warnings.push(`custom:${pageUrl} ${missingLoc}/${rows.size} rows had no location (listing markup may have changed)`)
    }
    if (expected !== null && rows.size < expected) {
      warnings.push(`custom:${pageUrl} collected ${rows.size} of ${expected} rows the site reports`)
    }

    return this.mapRows([...rows.values()], target, (p) => ({
      source: this.id,
      target,
      sourceId: String(p.id),
      requisitionId: String(p.id),
      title: String(p.title ?? '').trim(),
      company: p.org ?? target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: p.locations.join(' ; ') || null,
      description: null,
      descriptionHtml: null,
      employmentType: null,
      remoteFlag: p.locations.some((l: string) => /remote/i.test(l)) || null,
      postedAt: null,
      updatedAt: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      applicationUrl: p.url,
      canonicalUrl: p.url,
    }), warnings)
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
    opts: FetchOptions,
    robots: SiteRobots,
  ): Promise<RawJob[]> {
    // Prefer the sitemap robots.txt advertises; fall back to conventional paths.
    const candidates = [
      ...(robots.policy?.sitemaps ?? []).map((url) => absoluteUrl(`${robots.origin}/`, url)),
      `${pageUrl.replace(/\/$/, '')}/sitemap.xml`,
      `${robots.origin}/sitemap.xml`,
    ]

    let urls: string[] = []
    for (const sm of [...new Set(candidates)]) {
      if (!this.canFetch(robots, sm, warnings)) continue
      const r = await this.get(sm, { cacheTtlMs: this.ttl.discovery, retries: 0, signal: opts.signal })
        .catch(() => null)
      if (!r?.ok || !r.body) continue

      // A sitemap index points at further sitemaps rather than pages.
      const nested = [...r.body.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/gi)]
        .map((m) => absoluteUrl(sm, m[1]))
      const locs = [...r.body.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/gi)]
        .map((m) => absoluteUrl(sm, m[1]))

      const jobLocs = locs.filter((u) => /\/job[\/-]/i.test(u))
      const blockedLocs = jobLocs.filter((u) => !this.canFetch(robots, u))
      if (blockedLocs.length) {
        warnings.push(`custom:${pageUrl} skipped ${blockedLocs.length} sitemap job URLs disallowed by robots.txt`)
      }
      urls = jobLocs.filter((u) => this.canFetch(robots, u))
      if (urls.length) break

      for (const child of nested.slice(0, 5)) {
        if (!this.canFetch(robots, child, warnings)) continue
        const cr = await this.get(child, { cacheTtlMs: this.ttl.discovery, retries: 0, signal: opts.signal })
          .catch(() => null)
        if (!cr?.ok || !cr.body) continue
        const childLocs = [...cr.body.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>/gi)]
          .map((m) => absoluteUrl(child, m[1]))
        const childJobs = childLocs.filter((u) => /\/job[\/-]/i.test(u))
        const blockedChildJobs = childJobs.filter((u) => !this.canFetch(robots, u))
        if (blockedChildJobs.length) {
          warnings.push(`custom:${pageUrl} skipped ${blockedChildJobs.length} nested sitemap job URLs disallowed by robots.txt`)
        }
        urls.push(...childJobs.filter((u) => this.canFetch(robots, u)))
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
