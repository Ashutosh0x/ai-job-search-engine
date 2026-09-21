import { BaseAdapter } from './base'
import type {
  FetchOptions, FetchResult, JobDetailContext, RawJob, SourceId, SourceTarget,
} from '../types'
import { toIso, htmlToText } from '../types'

/**
 * Microsoft careers -- sitemap + schema.org JobPosting.
 *
 * WHY THIS IS NOT THE EIGHTFOLD ADAPTER
 * =====================================
 * Microsoft runs Eightfold, so the obvious registration is
 * `{ provider: 'eightfold', token: 'microsoft' }`. That registration ingests
 * ZERO jobs and reports success, which is the failure mode this codebase has
 * already been bitten by twice (`successfactors` had a SourceId and no
 * adapter; Dell fell through to the generic custom adapter and returned 0).
 *
 * Measured 2026-09-21 against Microsoft's tenant:
 *
 *   GET /api/apply/v2/jobs?domain=microsoft.com   403 "Not authorized for PCSX"
 *   GET /api/career_hub/search                    405   (POST needs a session)
 *   GET /careerhub/explore/jobs                   302 -> candidate login
 *   GET gcsservices.careers.microsoft.com/...     host no longer resolves
 *   GET jobs.careers.microsoft.com/*              301 -> apply.careers.microsoft.com
 *
 * The same `/api/apply/v2/jobs` endpoint answers openly for HSBC, Netflix and
 * Bayer. Microsoft's instance has it switched off. That is an access control,
 * and it is respected here rather than worked around.
 *
 * WHAT IS PUBLIC
 * ==============
 * robots.txt allows `/careers`, Microsoft publishes
 * `/careers/sitemap.xml` for search engines, and every job page carries a
 * schema.org `JobPosting` block for the same reason. Reading those two is the
 * documented, intended-for-machines route.
 *
 * COST
 * ====
 * One request per posting -- ~2,400 for a full board, versus ~240 for a JSON
 * board of the same size. `maxRequests` therefore has a real default here
 * rather than being unbounded, because the orchestrator calls `fetchJobs`
 * with no options at all. Raising it is a deliberate act:
 *
 *   adapter.fetchJobs(target, { maxRequests: 3000 })
 *
 * FIELDS MICROSOFT DOES NOT PUBLISH
 * =================================
 * Measured over the full board: `department`, `industry`, `postalCode` and
 * `baseSalary` are absent from every posting. They are read when present and
 * left null otherwise -- never inferred from the title or the slug.
 */

/** Sentinel distinguishing "the posting is gone" from "we could not read it". */
const BLOCKED = Symbol('blocked')

export class MicrosoftCareersAdapter extends BaseAdapter {
  /**
   * Shares the `custom` SourceId, following the Amazon precedent: a bespoke
   * employer portal does not get a platform id of its own.
   */
  readonly id: SourceId = 'custom'
  readonly displayName = 'Microsoft Careers'
  readonly hostPatterns = [
    /(^|\.)apply\.careers\.microsoft\.com$/i,
    /(^|\.)jobs\.careers\.microsoft\.com$/i,
    /(^|\.)careers\.microsoft\.com$/i,
  ]
  protected discoveryPattern = null   // one employer; nothing to enumerate

  protected healthUrl() {
    return 'https://apply.careers.microsoft.com/careers/sitemap.xml'
  }

  static readonly DEFAULT_HOST = 'apply.careers.microsoft.com'

  /**
   * Requests one board may cost in a single run.
   *
   * The board is ~2,375 postings; 2,600 leaves headroom for growth and for the
   * sitemap fetch itself. A truncated crawl emits a warning rather than
   * quietly reporting a smaller board.
   */
  static readonly DEFAULT_REQUEST_BUDGET = 2_600

  private sitemapUrl(target: SourceTarget): string {
    const host = target.host ?? MicrosoftCareersAdapter.DEFAULT_HOST
    return `https://${host}/careers/sitemap.xml`
  }

  /* ------------------------------- parsing -------------------------------- */

  /** `<loc>` values, from a urlset or a sitemapindex. */
  static locsIn(xml: string): string[] {
    return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  }

  static isJobUrl(url: string): boolean {
    return /\/careers\/job\/\d+/.test(url)
  }

  /** The numeric id in `/careers/job/<id>-<slug>` -- the posting's identity. */
  static jobIdFrom(url: string): string | null {
    const m = String(url).match(/\/careers\/job\/(\d+)/)
    return m ? m[1] : null
  }

  /**
   * Dedupe key.
   *
   * Keyed on the numeric id, not the URL: the slug encodes the title and the
   * location, so Microsoft editing either produces a second URL for one
   * posting. Keying on the URL would ingest it twice.
   */
  static dedupeKey(url: string): string {
    const id = MicrosoftCareersAdapter.jobIdFrom(url)
    if (id) return `microsoft:${id}`
    try {
      const u = new URL(url)
      return `microsoft:${u.pathname.replace(/\/+$/, '').toLowerCase()}`
    } catch {
      return `microsoft:${url}`
    }
  }

  /** Title and location from the slug. Only a fallback -- JSON-LD wins. */
  static slugTitle(url: string): string {
    const m = String(url).match(/\/careers\/job\/\d+-([^?#]+)/)
    return m ? m[1].replace(/-/g, ' ').trim() : ''
  }

  /**
   * Find the JobPosting across every ld+json block on the page.
   *
   * A malformed block is skipped, not fatal: pages carry one block today, but
   * a vendor template change that adds a BreadcrumbList -- or ships one block
   * with a trailing comma -- must not cost us the posting.
   */
  static extractJobPosting(html: string): { posting: any | null; errors: string[] } {
    const errors: string[] = []
    let blocks = 0
    let posting: any = null

    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    for (const m of String(html).matchAll(re)) {
      blocks++
      let parsed: any
      try {
        parsed = JSON.parse(m[1].trim())
      } catch {
        errors.push(`ld+json block ${blocks} is not valid JSON`)
        continue
      }
      const nodes: any[] = []
      const push = (n: any) => {
        if (!n || typeof n !== 'object') return
        nodes.push(n)
        if (Array.isArray(n['@graph'])) n['@graph'].forEach(push)
      }
      if (Array.isArray(parsed)) parsed.forEach(push)
      else push(parsed)

      const found = nodes.find((n) => {
        const t = n['@type']
        return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
      })
      if (found && !posting) posting = found
    }

    if (blocks === 0) errors.push('no ld+json block on the page')
    else if (!posting) errors.push(`${blocks} ld+json block(s) but no JobPosting among them`)

    return { posting, errors }
  }

  /**
   * schema.org text fields are "Text or Thing": a value may arrive as a
   * string, as `{name}` or as `{@type, value}`. `String()` on those rendered
   * 19 Microsoft locations as "[object Object]" -- a value that looks like
   * data and is not.
   */
  static asText(v: unknown): string {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v.trim()
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (Array.isArray(v)) return v.map((x) => MicrosoftCareersAdapter.asText(x)).filter(Boolean).join(', ')
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      return MicrosoftCareersAdapter.asText(o.name ?? o.value ?? o['@value'] ?? o.alternateName ?? o.title ?? '')
    }
    return ''
  }

  /**
   * One `Place` -> a display string.
   *
   * Microsoft writes the country into `addressRegion` as well as
   * `addressCountry` ("Redmond" / "WA,US" / "US"), so a naive join yields
   * "Redmond, WA,US, US". Split on commas and dedupe rather than assuming a
   * shape.
   */
  static placeText(place: any): string {
    const a = place?.address ?? {}
    const A = MicrosoftCareersAdapter.asText
    const bits = [A(a.addressLocality), A(a.addressRegion), A(a.addressCountry)]
      .filter(Boolean)
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set(bits)].join(', ')
  }

  /** Every location the posting names, deduped, first one first. */
  static locationsOf(posting: any): string[] {
    const raw: any[] = Array.isArray(posting?.jobLocation)
      ? posting.jobLocation
      : [posting?.jobLocation].filter(Boolean)
    const texts = raw
      .map((p) => MicrosoftCareersAdapter.placeText(p))
      .filter((s): s is string => Boolean(s))
    return [...new Set(texts)]
  }

  /**
   * Remote flag from DECLARED fields only.
   *
   * schema.org states this as `jobLocationType: TELECOMMUTE`. Microsoft does
   * not set it, so this returns null rather than guessing from prose --
   * lib/pipeline/workplace.ts classifies the description and records its
   * evidence, and a guess here would overwrite a verdict that can explain
   * itself with one that cannot.
   */
  static remoteFlag(posting: any): boolean | null {
    const t = MicrosoftCareersAdapter.asText(posting?.jobLocationType).toUpperCase()
    if (t.includes('TELECOMMUTE')) return true
    return null
  }

  /**
   * Is the posting still live, by its own declaration?
   *
   * `validThrough` in the past is the publisher saying the posting expired.
   * Absent `validThrough` is not evidence of anything, so it counts as live.
   */
  static isExpired(posting: any, now: Date = new Date()): boolean {
    const vt = MicrosoftCareersAdapter.asText(posting?.validThrough)
    if (!vt) return false
    const d = new Date(vt)
    return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime()
  }

  /** One posting -> one RawJob. Exported shape is the pipeline's contract. */
  static toRawJob(url: string, posting: any, target: SourceTarget, source: SourceId): RawJob {
    const A = MicrosoftCareersAdapter.asText
    const locations = MicrosoftCareersAdapter.locationsOf(posting)
    const id = A(posting?.identifier) || MicrosoftCareersAdapter.jobIdFrom(url) || url
    const description = A(posting?.description)

    return {
      source,
      target,
      sourceId: id,
      requisitionId: id,
      title: A(posting?.title) || MicrosoftCareersAdapter.slugTitle(url),
      company: A(posting?.hiringOrganization) || target.companyName || 'Microsoft',
      companyDomain: target.companyDomain ?? 'microsoft.com',
      locationRaw: locations[0] ?? null,
      additionalLocations: locations.slice(1),
      // Microsoft ships plain text here, but htmlToText is idempotent on text
      // and a vendor template change that starts emitting markup must not put
      // tags into the description the visa and skills passes read.
      description: description ? htmlToText(description) : null,
      department: A(posting?.department) || A(posting?.occupationalCategory) || null,
      employmentType: Array.isArray(posting?.employmentType)
        ? posting.employmentType.map(A).filter(Boolean).join(', ')
        : (A(posting?.employmentType) || null),
      remoteFlag: MicrosoftCareersAdapter.remoteFlag(posting),
      postedAt: toIso(A(posting?.datePosted)),
      /**
       * The url we actually fetched, NOT the one the page declares.
       *
       * They differ on 75 of 2,333 postings, and always in the same direction:
       * the sitemap serves a percent-encoded path ("san-jos%C3%A9") while the
       * JSON-LD declares the decoded one ("san-josé"). On a handful the
       * declared form contains a raw space or a U+202F narrow no-break space,
       * which is not a valid url at all.
       *
       * The crawled url came from Microsoft's own sitemap and returned 200 a
       * moment ago. That is the one a candidate should be sent to; the
       * declared form is kept in `extra` rather than discarded.
       */
      applicationUrl: url,
      canonicalUrl: url,
      extra: {
        declaredUrl: A(posting?.url) || null,
        validThrough: A(posting?.validThrough) || null,
        industry: A(posting?.industry) || null,
        inLanguage: A(posting?.inLanguage) || null,
        allLocations: locations,
        sourceUrl: url,
        crawledAt: new Date().toISOString(),
        extractionRoute: 'sitemap+jsonld',
      },
    }
  }

  /* -------------------------------- fetching ------------------------------ */

  /**
   * Fetch one page, distinguishing "gone" from "refused".
   *
   * TELLING THOSE APART IS THE POINT. Microsoft answers 403 once it decides
   * you are asking too fast. An earlier crawler counted 403 as "gone" and
   * reported 887 then 1,125 roles closed in two runs five minutes apart --
   * nothing had closed, and live roles were being marked expired.
   */
  private async getPage(url: string, signal?: AbortSignal): Promise<string | null | typeof BLOCKED> {
    try {
      const res = await this.get(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal,
        timeoutMs: 40_000,
        // The shared layer already does exponential backoff with jitter and
        // honours Retry-After on 429.
        retries: 3,
      })
      if (res.status === 404 || res.status === 410) return null
      if (res.status === 403 || res.status === 429) return BLOCKED
      if (!res.ok) return BLOCKED
      return res.body
    } catch {
      return BLOCKED
    }
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    // The orchestrator calls fetchJobs with `{ signal }` only, so the env var
    // is how an operator bounds a verification run without editing code.
    const envBudget = Number(process.env.MICROSOFT_MAX_REQUESTS)
    const budget = opts.maxRequests
      ?? (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : MicrosoftCareersAdapter.DEFAULT_REQUEST_BUDGET)
    let spent = 0

    /* ---- sitemap ---- */
    const sitemapUrl = this.sitemapUrl(target)
    spent++
    const xml = await this.getPage(sitemapUrl, opts.signal)
    if (typeof xml !== 'string') {
      return {
        jobs: [],
        incremental: false,
        warnings: [
          `microsoft: sitemap ${sitemapUrl} unreadable (${xml === null ? '404' : 'blocked/failed'}) -- ` +
          `no jobs ingested. This is a fetch failure, not an empty board.`,
        ],
      }
    }

    let urls = MicrosoftCareersAdapter.locsIn(xml)
    if (/<sitemapindex/i.test(xml)) {
      const children = urls
      urls = []
      for (const child of children) {
        if (spent >= budget) break
        spent++
        const sub = await this.getPage(child, opts.signal)
        if (typeof sub === 'string') urls.push(...MicrosoftCareersAdapter.locsIn(sub))
        else warnings.push(`microsoft: child sitemap ${child} unreadable`)
      }
    }

    const jobUrls = urls.filter(MicrosoftCareersAdapter.isJobUrl)
    if (jobUrls.length === 0) {
      return {
        jobs: [],
        incremental: false,
        warnings: [...warnings, `microsoft: sitemap read but held no job urls -- the url shape may have changed`],
      }
    }

    /* ---- dedupe before spending a request on the same posting twice ---- */
    const unique = new Map<string, string>()
    for (const u of jobUrls) {
      const k = MicrosoftCareersAdapter.dedupeKey(u)
      if (!unique.has(k)) unique.set(k, u)
    }
    const duplicates = jobUrls.length - unique.size
    if (duplicates > 0) warnings.push(`microsoft: ${duplicates} duplicate sitemap entries collapsed by job id`)

    /* ---- one request per posting ---- */
    const jobs: RawJob[] = []
    let gone = 0
    let blocked = 0
    let noPosting = 0
    let expired = 0
    let truncated = false

    for (const url of unique.values()) {
      if (opts.signal?.aborted) break
      if (spent >= budget) { truncated = true; break }
      spent++

      const html = await this.getPage(url, opts.signal)
      if (html === null) { gone++; continue }
      if (html === BLOCKED) { blocked++; continue }

      const { posting, errors } = MicrosoftCareersAdapter.extractJobPosting(html)
      if (!posting) { noPosting++; continue }
      if (MicrosoftCareersAdapter.isExpired(posting)) { expired++; continue }
      if (errors.length) warnings.push(`microsoft: ${url} -- ${errors.join('; ')}`)

      const job = MicrosoftCareersAdapter.toRawJob(url, posting, target, this.id)
      if (job.title && job.applicationUrl) jobs.push(job)
    }

    /* ---- say what is missing and WHY ---- */
    if (truncated) {
      warnings.push(
        `microsoft: request budget ${budget} exhausted after ${jobs.length} of ${unique.size} postings -- ` +
        `the remainder was NOT crawled and must not be read as a smaller board. ` +
        `Raise maxRequests to cover it.`
      )
    }
    if (gone) warnings.push(`microsoft: ${gone} postings returned 404/410 (closed since the sitemap was built)`)
    if (expired) warnings.push(`microsoft: ${expired} postings excluded -- their own validThrough has passed`)
    if (noPosting) {
      warnings.push(
        `microsoft: ${noPosting} pages answered 200 but carried no JobPosting block -- ` +
        `status UNKNOWN, not closed`
      )
    }
    if (blocked) {
      warnings.push(
        `microsoft: ${blocked} pages could not be read (403/429/5xx). Those roles are MISSING ` +
        `from this run and are NOT known to be closed. Re-run with a lower crawl rate.`
      )
    }

    return { jobs, incremental: false, warnings }
  }

  /**
   * Hydrate one posting.
   *
   * `ctx.url` carries the posting's public URL. The id alone is not enough:
   * the path contains a slug Microsoft generates from the title and location,
   * which cannot be derived from the id -- so a bare id is reconstructed
   * against the id-only path, which Microsoft redirects to the slugged one.
   */
  async fetchJob(target: SourceTarget, id: string, ctx: JobDetailContext = {}): Promise<RawJob | null> {
    const host = target.host ?? MicrosoftCareersAdapter.DEFAULT_HOST
    const url = ctx.url ?? `https://${host}/careers/job/${id}?domain=${target.companyDomain ?? 'microsoft.com'}`

    const html = await this.getPage(url, ctx.signal)
    if (typeof html !== 'string') return null

    const { posting } = MicrosoftCareersAdapter.extractJobPosting(html)
    if (!posting) return null
    if (MicrosoftCareersAdapter.isExpired(posting)) return null

    return MicrosoftCareersAdapter.toRawJob(url, posting, target, this.id)
  }
}
