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
    const PAGE = 100
    let start = 0
    const maxPages = opts.maxPages ?? 60

    for (let page = 0; page < maxPages; page++) {
      const url =
        `https://${encodeURIComponent(target.token)}.eightfold.ai/api/apply/v2/jobs` +
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
            p.canonicalPositionUrl ?? `https://${target.token}.eightfold.ai/careers/job/${p.id}`
          ),
          canonicalUrl: String(p.canonicalPositionUrl ?? ''),
          extra: { workLocationOption: p.work_location_option ?? null },
        }
      }, warnings))

      start += PAGE
      const total = Number(data?.count ?? 0)
      if (positions.length < PAGE || (total > 0 && start >= total)) break
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
