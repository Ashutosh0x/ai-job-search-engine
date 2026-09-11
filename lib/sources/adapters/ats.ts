import { BaseAdapter } from './base'
import type { FetchOptions, FetchResult, JobDetailContext, RawJob, SourceId, SourceTarget } from '../types'
import { toIso } from '../types'

/**
 * Adapters for ATS platforms that expose a public, unauthenticated job feed.
 *
 * Each is deliberately small: the contract, retry/throttle behaviour and error
 * containment live in BaseAdapter, so a new platform is an endpoint plus a
 * mapper. Every endpoint below is the one the employer's own careers page
 * calls, which is why no authentication is involved.
 */

/* ------------------------------- Greenhouse ------------------------------- */

export class GreenhouseAdapter extends BaseAdapter {
  readonly id: SourceId = 'greenhouse'
  readonly displayName = 'Greenhouse'
  readonly hostPatterns = [/(^|\.)greenhouse\.io$/i]
  protected discoveryPattern = 'boards.greenhouse.io/*'
  protected healthUrl() {
    return 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.token)}/jobs?content=true`
    const data = await this.json<{ jobs?: any[] }>(url, {
      cacheTtlMs: this.ttl.jobListing,
      signal: opts.signal,
    })
    if (!data?.jobs) return { jobs: [], incremental: false, warnings: [`greenhouse:${target.token} no data`] }

    const jobs = this.mapRows(data.jobs, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.id),
      requisitionId: j.requisition_id ? String(j.requisition_id) : String(j.id),
      title: String(j.title ?? '').trim(),
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      // `departments` and `offices` are arrays of objects; String()-ing them
      // yields "[object Object]", which is what the original code shipped.
      locationRaw: j.location?.name ?? null,
      additionalLocations: Array.isArray(j.offices)
        ? j.offices.map((o: any) => o?.name).filter(Boolean)
        : [],
      descriptionHtml: j.content ?? null,
      department: Array.isArray(j.departments) && j.departments.length
        ? String(j.departments[0]?.name ?? '') || null
        : null,
      employmentType: null,
      remoteFlag: null,
      postedAt: toIso(j.first_published ?? j.updated_at),
      updatedAt: toIso(j.updated_at),
      applicationUrl: String(j.absolute_url ?? ''),
      canonicalUrl: String(j.absolute_url ?? ''),
      extra: { internal_job_id: j.internal_job_id },
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* ---------------------------------- Lever --------------------------------- */

export class LeverAdapter extends BaseAdapter {
  readonly id: SourceId = 'lever'
  readonly displayName = 'Lever'
  readonly hostPatterns = [/(^|\.)lever\.co$/i]
  protected discoveryPattern = 'jobs.lever.co/*'
  protected healthUrl() {
    return 'https://api.lever.co/v0/postings/palantir?mode=json'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(target.token)}?mode=json`
    const data = await this.json<any[]>(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })
    if (!Array.isArray(data)) return { jobs: [], incremental: false, warnings: [`lever:${target.token} no data`] }

    const jobs = this.mapRows(data, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.id),
      requisitionId: String(j.id),
      title: String(j.text ?? '').trim(),
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: j.categories?.location ?? null,
      additionalLocations: Array.isArray(j.categories?.allLocations) ? j.categories.allLocations : [],
      description: j.descriptionPlain ?? null,
      descriptionHtml: j.description ?? null,
      department: j.categories?.department ?? null,
      team: j.categories?.team ?? null,
      employmentType: j.categories?.commitment ?? null,
      remoteFlag: /remote/i.test(String(j.workplaceType ?? '')),
      postedAt: toIso(j.createdAt), // epoch ms
      updatedAt: toIso(j.updatedAt),
      salaryMin: typeof j.salaryRange?.min === 'number' ? j.salaryRange.min : null,
      salaryMax: typeof j.salaryRange?.max === 'number' ? j.salaryRange.max : null,
      salaryCurrency: j.salaryRange?.currency ?? null,
      applicationUrl: String(j.applyUrl ?? j.hostedUrl ?? ''),
      canonicalUrl: String(j.hostedUrl ?? ''),
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* ---------------------------------- Ashby --------------------------------- */

export class AshbyAdapter extends BaseAdapter {
  readonly id: SourceId = 'ashby'
  readonly displayName = 'Ashby'
  readonly hostPatterns = [/(^|\.)ashbyhq\.com$/i]
  protected discoveryPattern = 'jobs.ashbyhq.com/*'
  protected healthUrl() {
    return 'https://api.ashbyhq.com/posting-api/job-board/openai'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target.token)}?includeCompensation=true`
    const data = await this.json<{ jobs?: any[] }>(url, {
      cacheTtlMs: this.ttl.jobListing,
      signal: opts.signal,
    })
    if (!data?.jobs) return { jobs: [], incremental: false, warnings: [`ashby:${target.token} no data`] }

    const jobs = this.mapRows(data.jobs, target, (j) => {
      const salary = j.compensation?.summaryComponents?.find((c: any) => c?.compensationType === 'Salary')
      return {
        source: this.id,
        target,
        sourceId: String(j.id),
        requisitionId: String(j.id),
        title: String(j.title ?? '').trim(),
        company: j.organizationName ?? target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        locationRaw: j.location ?? null,
        additionalLocations: Array.isArray(j.secondaryLocations)
          ? j.secondaryLocations.map((l: any) => l?.location).filter(Boolean)
          : [],
        descriptionHtml: j.descriptionHtml ?? null,
        description: j.descriptionPlain ?? null,
        department: j.department ?? null,
        team: j.team ?? null,
        employmentType: j.employmentType ?? null,
        remoteFlag: typeof j.isRemote === 'boolean' ? j.isRemote : null,
        postedAt: toIso(j.publishedAt),
        updatedAt: toIso(j.updatedAt),
        salaryMin: typeof salary?.minValue === 'number' ? salary.minValue : null,
        salaryMax: typeof salary?.maxValue === 'number' ? salary.maxValue : null,
        salaryCurrency: salary?.currencyCode ?? null,
        applicationUrl: String(j.applyUrl ?? j.jobUrl ?? ''),
        canonicalUrl: String(j.jobUrl ?? ''),
      }
    }, warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* ----------------------------- SmartRecruiters ---------------------------- */

export class SmartRecruitersAdapter extends BaseAdapter {
  readonly id: SourceId = 'smartrecruiters'
  readonly displayName = 'SmartRecruiters'
  readonly hostPatterns = [/(^|\.)smartrecruiters\.com$/i]
  protected discoveryPattern = 'jobs.smartrecruiters.com/*'
  protected healthUrl() {
    return 'https://api.smartrecruiters.com/v1/companies/Visa/postings?limit=1'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const all: RawJob[] = []
    const limit = 100
    let offset = 0
    const maxPages = opts.maxPages ?? 30

    for (let page = 0; page < maxPages; page++) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.token)}/postings?limit=${limit}&offset=${offset}`
      const data = await this.json<{ content?: any[]; totalFound?: number }>(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal: opts.signal,
      })
      const content = data?.content ?? []
      if (content.length === 0) break

      all.push(...this.mapRows(content, target, (j) => {
        const loc = [j.location?.city, j.location?.region, j.location?.country]
          .filter(Boolean).join(', ') || null
        return {
          source: this.id,
          target,
          sourceId: String(j.id),
          requisitionId: j.refNumber ? String(j.refNumber) : String(j.id),
          title: String(j.name ?? '').trim(),
          company: j.company?.name ?? target.companyName ?? null,
          companyDomain: target.companyDomain ?? null,
          locationRaw: loc,
          department: j.department?.label ?? j.function?.label ?? null,
          employmentType: j.typeOfEmployment?.label ?? null,
          remoteFlag: typeof j.location?.remote === 'boolean' ? j.location.remote : null,
          postedAt: toIso(j.releasedDate ?? j.createdOn),
          updatedAt: toIso(j.updatedOn),
          applicationUrl: String(j.applyUrl ?? `https://jobs.smartrecruiters.com/${target.token}/${j.id}`),
          canonicalUrl: String(j.ref ?? ''),
        }
      }, warnings))

      offset += limit
      if (content.length < limit || offset >= Number(data?.totalFound ?? 0)) break
    }

    return { jobs: all, incremental: false, warnings }
  }

  /**
   * Fetch one posting's full text.
   *
   * The listing endpoint returns no description at all, which matters far more
   * than it sounds: visa-sponsorship language lives almost entirely in the
   * description, so without this SmartRecruiters postings can only ever be
   * classified "not mentioned". Called from the optional hydration stage, which
   * is bounded and failure-isolated.
   */
  async fetchJob(target: SourceTarget, id: string): Promise<RawJob | null> {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.token)}/postings/${encodeURIComponent(id)}`
    const d = await this.json<any>(url, { cacheTtlMs: this.ttl.jobDetail, retries: 1 })
    if (!d) return null

    const sections = d.jobAd?.sections ?? {}
    // Order matters: the requirements section is where sponsorship statements
    // usually sit, so it must not be truncated away.
    const description = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription']
      .map((k) => sections[k]?.text ?? '')
      .filter(Boolean)
      .join('\n\n')

    if (!description) return null

    const loc = [d.location?.city, d.location?.region, d.location?.country].filter(Boolean).join(', ') || null
    return {
      source: this.id,
      target,
      sourceId: String(d.id),
      requisitionId: d.refNumber ? String(d.refNumber) : String(d.id),
      title: String(d.name ?? '').trim(),
      company: d.company?.name ?? target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: loc,
      descriptionHtml: description,
      department: d.department?.label ?? d.function?.label ?? null,
      employmentType: d.typeOfEmployment?.label ?? null,
      remoteFlag: typeof d.location?.remote === 'boolean' ? d.location.remote : null,
      postedAt: toIso(d.releasedDate ?? d.createdOn),
      updatedAt: toIso(d.updatedOn),
      applicationUrl: String(d.applyUrl ?? ''),
      canonicalUrl: String(d.postingUrl ?? d.ref ?? ''),
    }
  }
}

/* -------------------------------- Recruitee ------------------------------- */

export class RecruiteeAdapter extends BaseAdapter {
  readonly id: SourceId = 'recruitee'
  readonly displayName = 'Recruitee'
  readonly hostPatterns = [/(^|\.)recruitee\.com$/i]
  protected discoveryPattern = '*.recruitee.com/*'
  protected healthUrl() {
    return 'https://recruitee.recruitee.com/api/offers/'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://${encodeURIComponent(target.token)}.recruitee.com/api/offers/`
    const data = await this.json<{ offers?: any[] }>(url, {
      cacheTtlMs: this.ttl.jobListing,
      signal: opts.signal,
    })
    if (!data?.offers) return { jobs: [], incremental: false, warnings: [`recruitee:${target.token} no data`] }

    const jobs = this.mapRows(data.offers, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.id),
      requisitionId: String(j.id),
      title: String(j.title ?? '').trim(),
      company: j.company_name ?? target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: [j.city, j.state_name, j.country].filter(Boolean).join(', ') || j.location || null,
      descriptionHtml: j.description ?? null,
      department: j.department ?? null,
      employmentType: j.employment_type_code ?? j.employment_type ?? null,
      remoteFlag: typeof j.remote === 'boolean' ? j.remote : null,
      postedAt: toIso(j.published_at ?? j.created_at),
      updatedAt: toIso(j.updated_at),
      salaryMin: typeof j.min_hours === 'number' ? null : (typeof j.salary?.min === 'number' ? j.salary.min : null),
      salaryMax: typeof j.salary?.max === 'number' ? j.salary.max : null,
      salaryCurrency: j.salary?.currency ?? null,
      applicationUrl: String(j.careers_apply_url ?? j.careers_url ?? ''),
      canonicalUrl: String(j.careers_url ?? ''),
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* --------------------------------- Workday -------------------------------- */

export class WorkdayAdapter extends BaseAdapter {
  readonly id: SourceId = 'workday'
  readonly displayName = 'Workday'
  readonly hostPatterns = [/(^|\.)myworkdayjobs\.com$/i, /(^|\.)myworkdaysite\.com$/i]
  protected discoveryPattern = '*.myworkdayjobs.com/*'
  protected healthUrl() {
    return 'https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs'
  }

  /** Workday's jobs endpoint is POST-only; a GET returns 400. */
  async healthCheck() {
    const started = Date.now()
    const data = await this.postJson<{ total?: number }>(
      this.healthUrl(),
      { appliedFacets: {}, limit: 1, offset: 0, searchText: '' },
      { timeoutMs: 12_000, retries: 0 }
    ).catch(() => null)
    return {
      source: this.id,
      healthy: data !== null,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: data === null ? 'no response' : undefined,
    }
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const host = target.host || `${target.token}.wd1.myworkdayjobs.com`
    const site = target.site || 'External'
    const endpoint = `https://${host}/wday/cxs/${encodeURIComponent(target.token)}/${encodeURIComponent(site)}/jobs`

    const all: RawJob[] = []
    // Workday hard-caps the page size at 20; asking for more returns an empty
    // array rather than an error, which silently yields nothing.
    const PAGE = 20
    let offset = 0
    // `total` is reported only on the first response; later pages come back
    // with total: 0 while still returning postings, so it is a hint, not a
    // stop condition.
    let total = Infinity
    const maxPages = opts.maxPages ?? 200

    for (let page = 0; page < maxPages; page++) {
      const data = await this.postJson<{ jobPostings?: any[]; total?: number }>(
        endpoint,
        { appliedFacets: {}, limit: PAGE, offset, searchText: '' },
        { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }
      )
      const postings = data?.jobPostings ?? []
      if (postings.length === 0) break

      if (page === 0) {
        const reported = Number(data?.total ?? 0)
        if (reported > 0) total = reported
      }

      all.push(...this.mapRows(postings, target, (j) => {
        const path = String(j.externalPath ?? '')
        return {
          source: this.id,
          target,
          sourceId: String(j.bulletFields?.[0] ?? path),
          // bulletFields[0] is conventionally the requisition id.
          requisitionId: j.bulletFields?.[0] ? String(j.bulletFields[0]) : null,
          title: String(j.title ?? '').trim(),
          company: target.companyName ?? null,
          companyDomain: target.companyDomain ?? null,
          locationRaw: j.locationsText ?? null,
          employmentType: j.timeType ?? null,
          remoteFlag: /remote/i.test(String(j.locationsText ?? '')),
          // `postedOn` is relative prose ("Posted 5 Days Ago"), not a date.
          postedAt: toIso(j.startDate),
          applicationUrl: path ? `https://${host}/${site}${path}` : '',
          canonicalUrl: path ? `https://${host}/${site}${path}` : '',
          extra: { jobFamily: j.jobFamily ?? null },
        }
      }, warnings))

      offset += PAGE
      if (postings.length < PAGE || offset >= total) break
    }

    return { jobs: all, incremental: false, warnings }
  }

  /**
   * Fetch one posting's detail.
   *
   * THIS IS THE SINGLE HIGHEST-VALUE FETCH IN THE PIPELINE. Workday is ~48% of
   * the corpus and its LIST endpoint returns no description, no posted date and
   * no structured country -- so without this, half of everything we index is a
   * title and a location, and every downstream classifier (visa, workplace,
   * skills, seniority) is guessing from a title. Measured before this existed:
   * Workday postings had 0% descriptions and 0% posted dates.
   *
   * The detail endpoint mirrors the list endpoint:
   *   list   https://{host}/wday/cxs/{tenant}/{site}/jobs
   *   detail https://{host}/wday/cxs/{tenant}/{site}{externalPath}
   *
   * `externalPath` is NOT derivable from the requisition id we use as
   * `sourceId` -- it encodes the location and an older title slug. It is
   * recoverable from the posting's own URL, which is why `ctx.url` exists.
   */
  async fetchJob(
    target: SourceTarget,
    id: string,
    ctx: JobDetailContext = {}
  ): Promise<RawJob | null> {
    const source = ctx.url || id
    let host: string, site: string, path: string
    try {
      const u = new URL(source)
      host = u.host
      const seg = u.pathname.split('/').filter(Boolean)
      // /{site}/job/{location}/{slug} -- and sometimes a leading locale.
      const start = /^[a-z]{2}-[A-Z]{2}$/.test(seg[0] ?? '') ? 1 : 0
      site = seg[start]
      path = '/' + seg.slice(start + 1).join('/')
      if (!site || path === '/') return null
    } catch {
      return null
    }

    const tenant = target.token || host.split('.')[0]
    const url = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${path}`

    const d = await this.json<any>(url, { cacheTtlMs: this.ttl.jobDetail, retries: 1 })
    const info = d?.jobPostingInfo
    if (!info) return null

    return {
      source: this.id,
      target,
      sourceId: id,
      requisitionId: info.jobRequisitionId ? String(info.jobRequisitionId) : id,
      title: String(info.title ?? '').trim(),
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      // The detail payload carries a STRUCTURED country, which is how a bare
      // street address ("15 Tran Bach Dang An Khanh Ward") becomes searchable.
      locationRaw: [info.location, info.country?.descriptor].filter(Boolean).join(', ') || null,
      additionalLocations: Array.isArray(info.additionalLocations) ? info.additionalLocations : [],
      descriptionHtml: info.jobDescription ?? null,
      department: info.jobFamily ?? null,
      employmentType: info.timeType ?? null,
      remoteFlag: info.remoteType ? /remote/i.test(String(info.remoteType)) : null,
      // `startDate` is an absolute date. `postedOn` next to it is relative prose
      // ("Posted 2 Days Ago") and is deliberately ignored.
      postedAt: toIso(info.startDate),
      updatedAt: toIso(info.startDate),
      applicationUrl: source,
      canonicalUrl: source,
      extra: { country: info.country?.descriptor ?? null },
    }
  }
}

/* ------------------------- Smaller platforms -------------------------------- */

/** Teamtailor exposes a public JSON:API feed per subdomain. */
export class TeamtailorAdapter extends BaseAdapter {
  readonly id: SourceId = 'teamtailor'
  readonly displayName = 'Teamtailor'
  readonly hostPatterns = [/(^|\.)teamtailor\.com$/i]
  protected discoveryPattern = '*.teamtailor.com/*'
  protected healthUrl() {
    return 'https://teamtailor.teamtailor.com/jobs.json'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://${encodeURIComponent(target.token)}.teamtailor.com/jobs.json`
    const data = await this.json<any>(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })
    const rows: any[] = Array.isArray(data) ? data : data?.jobs ?? []
    if (!rows.length) return { jobs: [], incremental: false, warnings: [`teamtailor:${target.token} no data`] }

    const jobs = this.mapRows(rows, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.id),
      requisitionId: String(j.id),
      title: String(j.title ?? j.name ?? '').trim(),
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: j.location ?? j.city ?? null,
      descriptionHtml: j.body ?? j.description ?? null,
      department: j.department ?? null,
      employmentType: j.employment_type ?? null,
      remoteFlag: typeof j.remote_status === 'string' ? /remote/i.test(j.remote_status) : null,
      postedAt: toIso(j.created_at ?? j.published_at),
      updatedAt: toIso(j.updated_at),
      applicationUrl: String(j.apply_url ?? j.url ?? ''),
      canonicalUrl: String(j.url ?? ''),
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/** Personio publishes an XML feed; parsed without a DOM dependency. */
export class PersonioAdapter extends BaseAdapter {
  readonly id: SourceId = 'personio'
  readonly displayName = 'Personio'
  readonly hostPatterns = [/(^|\.)jobs\.personio\.(com|de)$/i]
  protected discoveryPattern = null
  protected healthUrl() {
    return 'https://personio.jobs.personio.com/xml'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://${encodeURIComponent(target.token)}.jobs.personio.com/xml`
    const res = await this.get(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })
    if (!res.ok || !res.body) return { jobs: [], incremental: false, warnings: [`personio:${target.token} no data`] }

    const positions = res.body.split(/<position>/i).slice(1)
    const pick = (xml: string, tag: string) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
      if (!m) return null
      return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() || null
    }

    const jobs = this.mapRows(positions, target, (xml) => {
      const id = pick(xml, 'id')
      if (!id) return null
      return {
        source: this.id,
        target,
        sourceId: id,
        requisitionId: id,
        title: pick(xml, 'name') ?? '',
        company: target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        locationRaw: pick(xml, 'office') ?? null,
        descriptionHtml: pick(xml, 'jobDescriptions'),
        department: pick(xml, 'department'),
        employmentType: pick(xml, 'employmentType'),
        remoteFlag: null,
        postedAt: toIso(pick(xml, 'createdAt')),
        applicationUrl: `https://${target.token}.jobs.personio.com/job/${id}`,
        canonicalUrl: `https://${target.token}.jobs.personio.com/job/${id}`,
      }
    }, warnings)

    return { jobs, incremental: false, warnings }
  }
}

/** Workable's public account feed. */
export class WorkableAdapter extends BaseAdapter {
  readonly id: SourceId = 'workable'
  readonly displayName = 'Workable'
  readonly hostPatterns = [/(^|\.)workable\.com$/i]
  protected discoveryPattern = 'apply.workable.com/*'
  protected healthUrl() {
    return 'https://apply.workable.com/api/v1/widget/accounts/workable'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(target.token)}`
    const data = await this.json<{ jobs?: any[]; name?: string }>(url, {
      cacheTtlMs: this.ttl.jobListing,
      signal: opts.signal,
    })
    if (!data?.jobs) return { jobs: [], incremental: false, warnings: [`workable:${target.token} no data`] }

    const jobs = this.mapRows(data.jobs, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.shortcode ?? j.id),
      requisitionId: String(j.shortcode ?? j.id),
      title: String(j.title ?? '').trim(),
      company: data.name ?? target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: [j.city, j.state, j.country].filter(Boolean).join(', ') || null,
      description: j.description ?? null,
      department: j.department ?? null,
      employmentType: j.employment_type ?? null,
      remoteFlag: typeof j.telecommuting === 'boolean' ? j.telecommuting : null,
      postedAt: toIso(j.published_on ?? j.created_at),
      applicationUrl: String(j.application_url ?? j.url ?? ''),
      canonicalUrl: String(j.url ?? ''),
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* ---------------------------------- MokaHR -------------------------------- */

/**
 * MokaHR -- the ATS behind Trip.com Group and much of the Chinese market.
 *
 * The target's `token` is the MokaHR org id and `site` is the numeric site id,
 * both visible in the careers URL the employer links to:
 *
 *   https://hire-r1.mokahr.com/apply/tripoverseas/100000877
 *                                    \_ token _/ \_ site _/
 *
 * `host` selects the pod (hire-r1, hire-r2, ...); it defaults to hire-r1.
 *
 * NO HANDSHAKE IS NEEDED
 * ----------------------
 * The apply page sets a CSRF cookie and the front-end sends it, so the obvious
 * assumption is that these endpoints require it. They do not -- a bare POST
 * with no cookies returns the same data. Doing the handshake anyway would add
 * a request and a failure mode for nothing.
 *
 * `needStat` IS NOT OPTIONAL
 * --------------------------
 * Without it the response still returns postings but reports
 * `jobStats.total: 0`. Paging until "total" is reached would therefore stop
 * immediately and yield nothing, while every individual request looked fine.
 * Pagination here stops on a short page and treats the total as a cross-check.
 *
 * LOCATION LIVES ONLY ON THE DETAIL ENDPOINT
 * ------------------------------------------
 * The list response carries the full `jobDescription` -- unusually generous --
 * but no location, department or publish date. Those three are only on
 * `website/job`. So the list is fetched once and details are filled in with
 * bounded concurrency, which is the same shape CustomSiteAdapter uses for
 * sitemap crawls. Without that pass every MokaHR posting would be indexed with
 * a null country, which is worse than useless on a job search.
 */
export class MokaHrAdapter extends BaseAdapter {
  readonly id: SourceId = 'mokahr'
  readonly displayName = 'MokaHR'
  readonly hostPatterns = [/(^|\.)mokahr\.com$/i]
  protected discoveryPattern = 'hire-r1.mokahr.com/apply/*'
  protected healthUrl() {
    return 'https://hire-r1.mokahr.com/api/outer/ats-apply/website/jobs/v2'
  }

  async healthCheck() {
    const started = Date.now()
    const data = await this.postJson<any>(
      this.healthUrl(),
      { orgId: 'tripoverseas', siteId: 100000877, limit: 1, offset: 0, needStat: true },
      { timeoutMs: 12_000, retries: 0 }
    ).catch(() => null)
    return {
      source: this.id,
      healthy: Array.isArray(data?.data?.jobs),
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: data ? undefined : 'no response',
    }
  }

  private base(target: SourceTarget) {
    return `https://${target.host || 'hire-r1.mokahr.com'}/api/outer/ats-apply/website`
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const siteId = Number(target.site)
    if (!Number.isFinite(siteId)) {
      return { jobs: [], incremental: false, warnings: [`mokahr:${target.token} needs a numeric site id`] }
    }

    const PAGE = 50
    const rows: any[] = []
    let reported: number | null = null
    let offset = 0

    for (let guard = 0; guard < 200; guard++) {
      const data = await this.postJson<any>(
        `${this.base(target)}/jobs/v2`,
        { orgId: target.token, siteId, limit: PAGE, offset, needStat: true, locale: 'en-US' },
        { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }
      )
      const page: any[] = data?.data?.jobs ?? []
      if (reported === null) reported = data?.data?.jobStats?.total ?? null
      rows.push(...page)
      // Stop on a short page, not on the reported total -- see above.
      if (page.length < PAGE) break
      offset += PAGE
    }

    if (reported != null && reported > 0 && rows.length < reported) {
      warnings.push(`mokahr:${target.token} board reports ${reported}, read ${rows.length}`)
    }

    // Fill in location/department/publishedAt, which the list omits entirely.
    const details = new Map<string, any>()
    const queue = rows.map((r) => String(r.id)).filter(Boolean)
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const id = queue.shift()!
          const d = await this.postJson<any>(
            `${this.base(target)}/job`,
            { orgId: target.token, siteId, jobId: id, locale: 'en-US' },
            { cacheTtlMs: this.ttl.jobDetail, retries: 0, signal: opts.signal }
          ).catch(() => null)
          const job = d?.data?.job ?? d?.data
          if (job?.id) details.set(String(job.id), job)
        }
      })
    )
    if (details.size < rows.length) {
      warnings.push(`mokahr:${target.token} ${rows.length - details.size} postings have no location detail`)
    }

    const applyBase = `https://${target.host || 'hire-r1.mokahr.com'}/apply/${target.token}/${siteId}/job/`

    const jobs = this.mapRows(rows, target, (j) => {
      const d = details.get(String(j.id)) ?? {}
      const locs: any[] = Array.isArray(d.locations) ? d.locations : []
      // `countryDescription` is the English name; `country` is often Chinese
      // ("马来西亚"). Prefer the English one and fall back rather than emitting
      // a name the location normaliser cannot resolve.
      const place = (l: any) =>
        [l?.address, l?.countryDescription || l?.country].filter(Boolean).join(', ') || null
      return {
        source: this.id,
        target,
        sourceId: String(j.id),
        // The job id, NOT `d.number`. `number` looks like a requisition number
        // and is the HEADCOUNT -- how many people the opening is for. Mapping
        // it here gave 190 of 216 postings the requisition key "1", which
        // collapsed unrelated roles across Germany, France, Italy and the US
        // into single records. MokaHR publishes no requisition number on this
        // API; the uuid is the identifier it does publish.
        requisitionId: String(j.id),
        title: String(j.title ?? '').trim(),
        company: target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        locationRaw: locs.length ? place(locs[0]) : null,
        additionalLocations: locs.slice(1).map(place).filter(Boolean) as string[],
        descriptionHtml: j.jobDescription ?? d.jobDescription ?? null,
        department: d.department?.name ? String(d.department.name) : null,
        employmentType: d.commitment ? String(d.commitment) : null,
        remoteFlag: null,
        postedAt: toIso(d.publishedAt ?? j.openedAt ?? j.createdAt),
        updatedAt: toIso(j.updatedAt),
        applicationUrl: `${applyBase}${j.id}`,
        canonicalUrl: `${applyBase}${j.id}`,
        extra: { status: j.status, mokaSiteId: siteId },
      }
    }, warnings)

    return { jobs, incremental: false, warnings }
  }
}
