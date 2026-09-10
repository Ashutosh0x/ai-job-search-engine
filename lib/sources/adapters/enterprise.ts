import { BaseAdapter } from './base'
import type { FetchOptions, FetchResult, RawJob, SourceId, SourceTarget } from '../types'
import { toIso } from '../types'

/**
 * Adapters for large-enterprise career platforms.
 *
 * The mid-market ATS platforms (Greenhouse, Lever, Ashby) cover startups and
 * scale-ups well, but the largest employers -- banks, retailers, big tech --
 * run either an enterprise ATS (Eightfold, Avature, Phenom) or an entirely
 * bespoke portal. Their boards are also where the highest job volumes are, so
 * omitting them leaves a systematic gap: no HSBC, no Walmart, no Amazon.
 *
 * Every endpoint below is the public JSON API the employer's own careers page
 * calls, discovered by inspecting that page. No authentication is involved.
 */

/* -------------------------------- Eightfold ------------------------------- */

/**
 * Eightfold AI powers the careers portals of a number of large enterprises
 * (HSBC among them). The public search endpoint is:
 *
 *   GET {tenant}.eightfold.ai/api/apply/v2/jobs?domain={domain}&start=&num=
 *
 * `domain` is required and is the employer's own domain, not the tenant.
 */
export class EightfoldAdapter extends BaseAdapter {
  readonly id: SourceId = 'eightfold'
  readonly displayName = 'Eightfold'
  readonly hostPatterns = [/(^|\.)eightfold\.ai$/i]
  protected discoveryPattern = '*.eightfold.ai/*'
  protected healthUrl() {
    return 'https://hsbc.eightfold.ai/api/apply/v2/jobs?domain=hsbc.com&start=0&num=1'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const domain = target.companyDomain || `${target.token}.com`
    const all: RawJob[] = []
    // The server caps a page at 10 and silently ignores a larger `num`.
    // Asking for 100 and then stopping because "fewer than 100 came back"
    // ended every crawl after one page -- HSBC reported 1,611 jobs and yielded
    // 10. Page size must match what the API will actually return.
    const PAGE = 10
    let start = 0
    // 1,611 jobs at 10 a page needs ~162 requests, so the page ceiling has to
    // be high enough for the largest board rather than tuned for a small one.
    const maxPages = opts.maxPages ?? 400

    // Most tenants sit at {token}.eightfold.ai, but an employer can front the
    // same API on its own hostname -- Netflix serves it from
    // explore.jobs.netflix.net. Honour an explicit host when one is given
    // rather than assuming the vendor domain.
    const host = target.host || `${target.token}.eightfold.ai`

    for (let page = 0; page < maxPages; page++) {
      const url =
        `https://${host}/api/apply/v2/jobs` +
        `?domain=${encodeURIComponent(domain)}&start=${start}&num=${PAGE}`
      const data = await this.json<{ positions?: any[]; count?: number }>(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal: opts.signal,
      })
      const positions = data?.positions ?? []
      if (positions.length === 0) break

      all.push(...this.mapRows(positions, target, (p) => {
        const locations: string[] = Array.isArray(p.locations) ? p.locations : []
        // work_location_option is the employer's own workplace declaration --
        // far more reliable than inferring it from the description.
        const wlo = String(p.work_location_option ?? '').toLowerCase()
        return {
          source: this.id,
          target,
          sourceId: String(p.id),
          requisitionId: p.display_job_id ? String(p.display_job_id) : String(p.id),
          title: String(p.name ?? '').trim(),
          company: target.companyName ?? null,
          companyDomain: domain,
          locationRaw: p.location ?? locations[0] ?? null,
          additionalLocations: locations.slice(1),
          descriptionHtml: p.job_description ?? null,
          department: p.department ?? p.business_unit ?? null,
          employmentType: p.employment_type ?? null,
          remoteFlag: wlo ? wlo.includes('remote') : null,
          // t_update is epoch seconds.
          postedAt: toIso(p.t_create ?? p.t_update),
          updatedAt: toIso(p.t_update),
          applicationUrl: String(
            p.canonicalPositionUrl ?? `https://${host}/careers/job/${p.id}`
          ),
          canonicalUrl: String(p.canonicalPositionUrl ?? ''),
          extra: { workLocationOption: p.work_location_option ?? null },
        }
      }, warnings))

      start += positions.length
      const total = Number(data?.count ?? 0)
      // Stop on the reported total or an empty page -- never on a short one.
      // A short page here means the server trimmed the batch, not that the
      // board is exhausted.
      if (total > 0 && start >= total) break
    }

    return { jobs: all, incremental: false, warnings }
  }
}

/* --------------------------------- Amazon --------------------------------- */

/**
 * Amazon runs its own portal at amazon.jobs, backed by a public search JSON
 * endpoint. It reports `hits: 10000` as a ceiling rather than a true total, so
 * pagination stops on a short page rather than trusting the count.
 *
 * The same endpoint serves AWS, Whole Foods and the other subsidiaries, which
 * is why `business_category` is preserved as the department.
 */
export class AmazonAdapter extends BaseAdapter {
  readonly id: SourceId = 'custom'
  readonly displayName = 'Amazon Jobs'
  readonly hostPatterns = [/(^|\.)amazon\.jobs$/i]
  protected discoveryPattern = null
  protected healthUrl() {
    return 'https://www.amazon.jobs/en/search.json?result_limit=1&sort=recent'
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const all: RawJob[] = []
    const PAGE = 100
    let offset = 0
    const maxPages = opts.maxPages ?? 40

    for (let page = 0; page < maxPages; page++) {
      const url =
        `https://www.amazon.jobs/en/search.json?result_limit=${PAGE}&offset=${offset}&sort=recent`
      const data = await this.json<{ jobs?: any[]; hits?: number }>(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal: opts.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobSparkAI/1.0)' },
      })
      const jobs = data?.jobs ?? []
      if (jobs.length === 0) break

      all.push(...this.mapRows(jobs, target, (j) => {
        const path = String(j.job_path ?? '')
        return {
          source: this.id,
          target,
          sourceId: String(j.id_icims ?? j.id),
          requisitionId: j.id_icims ? String(j.id_icims) : null,
          title: String(j.title ?? '').trim(),
          company: 'Amazon',
          companyDomain: 'amazon.com',
          // "US, AZ, Mesa" -> the normaliser handles the comma form directly.
          locationRaw: j.location ?? ([j.city, j.state, j.country_code].filter(Boolean).join(', ') || null),
          description: j.description_short ?? null,
          descriptionHtml: j.description ?? null,
          department: j.job_category ?? j.business_category ?? null,
          team: j.team?.label ?? null,
          employmentType: j.job_schedule_type ?? null,
          remoteFlag: /virtual|remote/i.test(String(j.location ?? '')),
          postedAt: toIso(j.posted_date),
          applicationUrl: path ? `https://www.amazon.jobs${path}` : '',
          canonicalUrl: path ? `https://www.amazon.jobs${path}` : '',
          extra: { businessCategory: j.business_category ?? null },
        }
      }, warnings))

      offset += PAGE
      // `hits` caps at 10000 and is not a real total, so a short page is the
      // only trustworthy stop condition.
      if (jobs.length < PAGE) break
    }

    return { jobs: all, incremental: false, warnings }
  }
}

/* --------------------------- Oracle Recruiting Cloud ---------------------- */

/**
 * Oracle Recruiting Cloud (ORC), the ATS inside Oracle Fusion HCM.
 *
 * Each customer gets its own Fusion pod, so the host varies
 * (`eeho.fa.us2.oraclecloud.com`, `<tenant>.fa.em2.oraclecloud.com`, ...) and
 * the careers site within it is identified by a `siteNumber` such as `CX_1`.
 * Both are supplied per target: `host` and `token`.
 *
 *   GET {host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
 *       ?onlyData=true&expand=requisitionList
 *       &finder=findReqs;siteNumber={site},limit=,offset=
 *
 * The response nests the page inside `items[0].requisitionList`, and the true
 * total arrives as `items[0].TotalJobsCount` -- read once, because later pages
 * report it inconsistently. This is the same trap Workday sets, where trusting
 * a per-page total truncated a 1,436-job board to 40.
 */
export class OracleRecruitingAdapter extends BaseAdapter {
  readonly id: SourceId = 'custom'
  readonly displayName = 'Oracle Recruiting Cloud'
  readonly hostPatterns = [/(^|\.)oraclecloud\.com$/i]
  protected discoveryPattern = '*.oraclecloud.com/hcmRestApi/*'
  protected healthUrl() {
    return (
      'https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/' +
      'recruitingCEJobRequisitions?onlyData=true&expand=requisitionList' +
      '&finder=findReqs;siteNumber=CX_1,limit=1'
    )
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const all: RawJob[] = []
    const host = target.host
    const site = target.token || 'CX_1'
    if (!host) {
      return { jobs: [], incremental: false, warnings: ['Oracle target has no host'] }
    }

    const PAGE = 200
    let offset = 0
    let total = Infinity
    const maxPages = opts.maxPages ?? 60

    for (let page = 0; page < maxPages; page++) {
      const url =
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList` +
        `&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=${PAGE},offset=${offset}`

      const data = await this.json<{ items?: any[] }>(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal: opts.signal,
      })

      const item = data?.items?.[0]
      const rows: any[] = item?.requisitionList ?? []
      if (rows.length === 0) break

      // Only the first page's count is trustworthy.
      if (page === 0) {
        const reported = Number(item?.TotalJobsCount ?? 0)
        if (reported > 0) total = reported
      }

      all.push(...this.mapRows(rows, target, (r) => {
        const id = String(r.Id ?? r.RequisitionId ?? '')
        const others: string[] = Array.isArray(r.OtherLocations) ? r.OtherLocations : []
        return {
          source: this.id,
          target,
          sourceId: id,
          requisitionId: r.RequisitionId ? String(r.RequisitionId) : id,
          title: String(r.Title ?? '').trim(),
          company: target.companyName ?? null,
          companyDomain: target.companyDomain ?? null,
          locationRaw: r.PrimaryLocation ?? null,
          additionalLocations: others,
          descriptionHtml: r.ShortDescriptionStr ?? r.ExternalDescriptionStr ?? null,
          department: r.JobFamily ?? r.Category ?? null,
          employmentType: r.JobType ?? null,
          // ORC states the workplace explicitly; do not infer it from prose.
          remoteFlag: r.WorkplaceTypeCode
            ? /remote/i.test(String(r.WorkplaceTypeCode))
            : null,
          postedAt: toIso(r.PostedDate),
          updatedAt: toIso(r.PostedDate),
          applicationUrl: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`,
          canonicalUrl: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`,
          extra: { workplaceTypeCode: r.WorkplaceTypeCode ?? null },
        }
      }, warnings))

      // Advance by what actually arrived. ORC returns slightly fewer than the
      // limit on some pages (offset=200 yields 199), so treating a short page
      // as the end of the board truncated Oracle from 2,197 jobs to 306.
      offset += rows.length
      if (offset >= total) break
    }

    return { jobs: all, incremental: false, warnings }
  }
}
