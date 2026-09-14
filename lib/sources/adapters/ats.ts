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

  /**
   * Board tokens that are all digits are not company names.
   *
   * Most Greenhouse tokens read like the employer ("stripe"), so using the
   * token as a display name works and the pipeline relies on it. A handful are
   * numeric -- board 103644278 is Lume Deodorant, 8451 is 84.51 -- and those
   * shipped into the index as company names, so search results showed a row
   * whose employer was "103644278".
   *
   * Greenhouse exposes the real name on the board endpoint, which this adapter
   * never called. Resolve it only when needed: one extra request per numeric
   * board, cached for the process, and never on the common path.
   *
   * Note that a numeric token is not proof of a bad name -- board 540 really is
   * called "540". Resolution returns whatever the board says and does not
   * second-guess it.
   */
  private static boardNames = new Map<string, string | null>()

  private async resolveBoardName(token: string, warnings: string[]): Promise<string | null> {
    if (GreenhouseAdapter.boardNames.has(token)) {
      return GreenhouseAdapter.boardNames.get(token) ?? null
    }
    let name: string | null = null
    try {
      const board = await this.json<{ name?: string }>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`,
        { cacheTtlMs: this.ttl.jobListing },
      )
      // Greenhouse pads some names with trailing whitespace ("84.51 ").
      const n = board?.name?.trim()
      if (n) name = n
      else warnings.push(`greenhouse:${token} board endpoint returned no name`)
    } catch {
      warnings.push(`greenhouse:${token} board name could not be resolved`)
    }
    GreenhouseAdapter.boardNames.set(token, name)
    return name
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []

    // A numeric token would otherwise become the displayed employer name.
    let companyName = target.companyName ?? null
    if (!companyName || /^\d+$/.test(companyName)) {
      companyName = (await this.resolveBoardName(target.token, warnings)) ?? companyName
    }

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
      company: companyName,
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

/**
 * Oracle Recruiting Cloud (the "CE" candidate-experience API).
 *
 * Used by large enterprises that run Oracle HCM -- Nokia publishes 590 roles
 * through it. It was worth writing an adapter for rather than skipping,
 * because nothing else in this pipeline could reach that class of employer.
 *
 * TWO HOSTS, AND THEY ARE NOT INTERCHANGEABLE
 * -------------------------------------------
 * The API lives on an Oracle pod (`fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com`)
 * whose name is unguessable -- it was found by reading the careers page, not by
 * pattern. The page a candidate should actually land on lives on the employer's
 * own domain (`jobs.nokia.com`). `host` carries the first; `applyHost` the
 * second. Linking to the pod would technically work and would still be the
 * wrong thing: this index links to the employer's own posting, never to an
 * intermediary, and an Oracle pod URL is not something a candidate recognises.
 *
 * The site number (`CX_1`) is a required finder parameter, not a path segment.
 */
export class OracleAdapter extends BaseAdapter {
  readonly id: SourceId = 'oracle'
  readonly displayName = 'Oracle Recruiting Cloud'
  readonly hostPatterns = [/(^|\.)oraclecloud\.com$/i]
  protected discoveryPattern = '*.fa.ocs.oraclecloud.com/*'
  protected healthUrl() {
    return (
      'https://fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/' +
      'recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_1,limit=1,offset=0'
    )
  }

  /** Oracle caps a page at 200; ask for that and walk until the total is met. */
  private static readonly PAGE = 200
  private static readonly MAX_PAGES = 40

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const host = target.host
    const site = target.site

    if (!host || !site) {
      return {
        jobs: [],
        incremental: false,
        warnings: [`oracle:${target.token} needs both host and site (e.g. CX_1); got host=${host} site=${site}`],
      }
    }

    // Where a candidate should land. Falls back to the API host only if no
    // public careers host was configured, which is better than dropping the row.
    const applyHost = target.applyHost || host

    const rows: any[] = []
    let total: number | null = null

    for (let page = 0; page < OracleAdapter.MAX_PAGES; page++) {
      const offset = page * OracleAdapter.PAGE
      const url =
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList` +
        `&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=${OracleAdapter.PAGE},offset=${offset}`

      const data = await this.json<{ items?: any[] }>(url, {
        cacheTtlMs: this.ttl.jobListing,
        signal: opts.signal,
      })

      const item = data?.items?.[0]
      const batch: any[] = item?.requisitionList ?? []
      if (total === null) total = Number(item?.TotalJobsCount ?? 0) || null

      if (!batch.length) break
      rows.push(...batch)
      if (total !== null && rows.length >= total) break
    }

    if (!rows.length) {
      return { jobs: [], incremental: false, warnings: [`oracle:${target.token} returned no requisitions`] }
    }
    if (total !== null && rows.length < total) {
      warnings.push(`oracle:${target.token} read ${rows.length} of ${total} postings before the page budget ran out`)
    }

    const jobs = this.mapRows(rows, target, (j) => ({
      source: this.id,
      target,
      sourceId: String(j.Id),
      requisitionId: String(j.Id),
      title: String(j.Title ?? '').trim(),
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      // Oracle gives one display string plus an ISO country code. Both are
      // kept: the string is what the employer wrote, the code is reliable.
      locationRaw: j.PrimaryLocation ?? null,
      additionalLocations: [],
      // ShortDescriptionStr is a truncated teaser, not the full posting. It is
      // still the only description this endpoint returns without a per-job
      // fetch, and labelling it honestly beats fetching 590 detail pages.
      descriptionHtml: j.ShortDescriptionStr ?? null,
      department: j.Department ?? j.JobFamily ?? j.Organization ?? null,
      employmentType: j.JobType ?? j.JobSchedule ?? null,
      // ORA_REMOTE / ORA_HYBRID / ORA_ONSITE. Anything else is unknown rather
      // than assumed on-site.
      remoteFlag:
        j.WorkplaceTypeCode === 'ORA_REMOTE'
          ? true
          : j.WorkplaceTypeCode === 'ORA_ONSITE' || j.WorkplaceTypeCode === 'ORA_HYBRID'
            ? false
            : null,
      postedAt: toIso(j.PostedDate),
      updatedAt: toIso(j.PostedDate),
      applicationUrl: `https://${applyHost}/en/sites/${site}/job/${j.Id}`,
      canonicalUrl: `https://${applyHost}/en/sites/${site}/job/${j.Id}`,
      extra: {
        workplaceType: j.WorkplaceType ?? null,
        country: j.PrimaryLocationCountry ?? null,
      },
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/* --------------------------------- Workday -------------------------------- */

/**
 * Maximum results Workday's CxS search will page through. Past this the API
 * clamps the offset and returns the same page forever, so a bigger board comes
 * back as exactly this many postings with no error of any kind.
 */
const WORKDAY_RESULT_CAP = 2000

/**
 * Searches one tenant may cost before the read gives up and says it is short.
 *
 * Recursive splitting fans out: 40 job families x 55 countries is thousands of
 * searches, and one board like that must not be able to consume a whole crawl.
 * 4,000 covers every tenant measured -- the largest, Accenture, finished well
 * inside it -- while still bounding the worst case.
 */
const WORKDAY_TENANT_REQUEST_BUDGET = 4000

/**
 * Recover a posting's location from its `externalPath`.
 *
 * `locationsText` IS OPTIONAL AND ITS ABSENCE IS SILENT. Most tenants populate
 * it; some never send the field at all and encode the place in the path
 * instead, as `/job/Pernambuco---Recife/Pessoa-Analista_R00253057`. Reading
 * only `locationsText` therefore produced a location-less posting with no
 * error to notice -- measured across a full crawl of every known tenant,
 * 47,435 of 152,651 postings (31%) had no location, and 42,528 of those were
 * Accenture alone, the single largest Workday board in the corpus.
 *
 * That is not a cosmetic gap: location is the primary filter in this product,
 * and a posting without one is unfindable by the query most users actually
 * make.
 *
 * The slug encodes a separator as a triple dash and spaces as single dashes,
 * so "Pernambuco---Recife" is "Pernambuco - Recife" -- the same shape tenants
 * that DO send `locationsText` write ("Australia - Sydney"). What the slug
 * names is up to the tenant: some write a city, others a facility ("Three
 * Meadows Post Acute"). That matches the range already present in
 * `locationsText` and is left for the location parser to resolve.
 */
/**
 * The requisition id for a Workday posting.
 *
 * `bulletFields[0]` IS NOT THE REQUISITION ID. It is whatever the tenant put
 * first in its bullet list, and tenants configure that freely:
 *
 *   NVIDIA    ["JR2017846"]                                  -> index 0
 *   Thales    ["Regular Employee", "R0334962", "20 - SOFTWARE", ...] -> index 1
 *
 * Reading index 0 gave every Thales posting the requisition id "Regular
 * Employee". That is not merely a wrong field: `sourceId` was read from the
 * same place and the canonical job id is `source:token:sourceId`, so all 740
 * postings on that board collapsed onto 8 ids -- one per employment type.
 * Thales entered the index as an employer with 8 openings. Across the corpus
 * the same shape accounted for 253,114 postings whose "requisition" was an
 * employment type, a city or a country ("Texas", "Permanent", "Contrat à durée
 * indéterminée"), and nothing failed while it happened.
 *
 * `externalPath` is the reliable source: Workday ends it with `_{REQ}`, and a
 * repost of the same requisition gets a `-N` suffix
 * (`..._JR2018178-3`). So the path yields both identities -- the posting
 * (with the suffix) and the opening (without it).
 */
function workdayRequisition(path: string, bulletFields: unknown): { sourceId: string; requisitionId: string | null } {
  /**
   * A trailing `-N` marks a re-post of the same requisition -- but only when
   * it is SHORT. Requisition ids very often end in a dash and a long number,
   * and stripping that destroys the id:
   *
   *   JR2018178-3        NVIDIA        -3     re-post of JR2018178
   *   2026-00812-1       F.N.B.        -1     re-post of 2026-00812
   *   202608-121816-1    Roche         -1     re-post of 202608-121816
   *   JR2023-22829       Topgolf       -22829 IS the id (year + sequence)
   *   R-26-20076         Moog          -20076 IS the id
   *
   * Getting this wrong is not a cosmetic error. Treating `-22829` as a repost
   * marker collapsed 1,354 distinct Topgolf postings onto the "requisition"
   * JR2023, 758 Moog postings onto R-26, and 266 Roche postings onto 202608 --
   * which then reads as an employer advertising one job a thousand times.
   *
   * A repost counter is a small integer; a sequence number is not. Two digits
   * is the cut, and the base must still contain a digit so that an id like
   * `REQ-42` is not reduced to `REQ`.
   */
  const stripRepost = (id: string): string => {
    const base = id.replace(/-\d{1,2}$/, '')
    return base !== id && /\d/.test(base) ? base : id
  }

  // Everything after the final underscore, which is where Workday puts it.
  const tail = /_([A-Za-z0-9][\w.-]*)$/.exec(path)?.[1]
  if (tail) return { sourceId: tail, requisitionId: stripRepost(tail) }

  // No id in the path: take the first bullet field that is SHAPED like an id
  // rather than the first one that exists. Ids have a digit and no spaces;
  // "Regular Employee" and "20 - SOFTWARE" have spaces and are rejected.
  const fields = Array.isArray(bulletFields) ? bulletFields : []
  for (const f of fields) {
    const s = String(f ?? '').trim()
    if (s && !/\s/.test(s) && /\d/.test(s) && s.length <= 40) {
      return { sourceId: s, requisitionId: stripRepost(s) }
    }
  }

  // Nothing id-shaped anywhere. The path is unique per posting, so it keeps
  // ids distinct even when the requisition is unknowable -- losing the
  // requisition is recoverable, collapsing postings onto one id is not.
  return { sourceId: path, requisitionId: null }
}

function workdayLocationFromPath(path: string): string {
  // /job/{location}/{title-slug}_{req}, sometimes behind an /en-US/ locale.
  const seg = path.split('/').filter(Boolean)
  const i = seg.indexOf('job')
  const slug = i !== -1 ? seg[i + 1] : undefined
  if (!slug) return ''
  // Split on the separator BEFORE collapsing single dashes to spaces. Doing
  // it the other way round loses which dashes were separators, and
  // "Nova-Lima-Shopping-Alta-Vila" comes back as "Nova - Lima - Shopping - Alta - Vila".
  return slug
    .split('---')
    .map((part) => part.replace(/-+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')
}

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
    const maxPages = opts.maxPages ?? 200
    // Dedupe across facet partitions -- a posting can belong to several.
    const seenPaths = new Set<string>()

    /**
     * Page one search (optionally facet-filtered) to exhaustion.
     * Returns what the board REPORTED as the total for that search.
     */
    const drain = async (facets: Record<string, string[]>): Promise<number> => {
      let offset = 0
      // `total` is reported only on the first response; later pages come back
      // with total: 0 while still returning postings, so it is a hint, not a
      // stop condition.
      let total = Infinity
      let reportedTotal = 0

      for (let page = 0; page < maxPages; page++) {
        // Pages count against the tenant's budget too. Charging only the
        // probes would leave the budget bounding the number of slices while
        // the actual request count ran away with them.
        if (!spend()) break
        const data = await this.postJson<{ jobPostings?: any[]; total?: number }>(
          endpoint,
          { appliedFacets: facets, limit: PAGE, offset, searchText: '' },
          { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }
        )
        const postings = data?.jobPostings ?? []
        if (postings.length === 0) break

        if (page === 0) {
          reportedTotal = Number(data?.total ?? 0)
          if (reportedTotal > 0) total = reportedTotal
        }

        const fresh = postings.filter((j: any) => {
          const path = String(j.externalPath ?? '')
          if (!path || seenPaths.has(path)) return false
          seenPaths.add(path)
          return true
        })

        all.push(...this.mapRows(fresh, target, (j) => {
        const path = String(j.externalPath ?? '')
        return {
          source: this.id,
          target,
          // See workdayRequisition: bulletFields[0] is not the requisition id,
          // and using it as sourceId collapsed whole boards onto a handful of
          // canonical job ids.
          ...workdayRequisition(path, j.bulletFields),
          title: String(j.title ?? '').trim(),
          company: target.companyName ?? null,
          companyDomain: target.companyDomain ?? null,
          // `||` not `??`: tenants that omit the place send an empty string as
          // often as they send nothing, and `??` keeps the empty string.
          locationRaw: j.locationsText || workdayLocationFromPath(path) || null,
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
      return reportedTotal
    }

    /**
     * WORKDAY WILL NOT PAGE PAST 2,000 RESULTS
     * ----------------------------------------
     * An unfiltered search reports `total: 2000` and clamps: offsets 2000,
     * 2200 and 3000 all return the SAME page. So a board with more than 2,000
     * openings silently yields exactly 2,000 and looks complete -- there is no
     * error, no short page, nothing to notice.
     *
     * NVIDIA's facet counts sum to 2,636. We were indexing 2,000 of them and
     * had been for every crawl. Four other employers sat at exactly 2,000:
     * Citi, Applied Materials, ABB and Circle K. A round number is the tell.
     *
     * The way out is to ask smaller questions, and to KEEP asking smaller ones
     * until the answer fits. Splitting once on `jobFamilyGroup` is not enough:
     * measured on the live boards, Accenture's largest job family holds 20,730
     * postings and Walmart, Abercrombie and 10 other tenants each had at least
     * one family still pinned at exactly 2,000 after the single split. A crawl
     * of every known tenant left 13 boards truncated that way.
     *
     * So the split recurses. Each level picks the facet that best breaks up
     * what is left and applies it on top of the filters already in force;
     * Citi, for instance, exposes Country_and_Jurisdiction and
     * State_or_Province alongside jobFamilyGroup, which the old single-facet
     * split could never reach for.
     *
     * Postings can belong to several partitions, so results stay deduped by
     * externalPath.
     */

    /**
     * Facets that are not partitions.
     *
     * `distance` is a radius selector whose values overlap completely, and
     * `locationMainGroup` comes back with counts of 0 on every tenant measured
     * -- splitting on either yields the same rows again and burns the budget.
     */
    const UNUSABLE_FACETS = new Set(['distance', 'locationMainGroup'])

    /**
     * A hard ceiling on requests per tenant.
     *
     * Recursion over a board with 40 job families x 55 countries is thousands
     * of searches, and one pathological tenant must not be able to consume a
     * whole crawl. When the budget runs out the read stops and says so, which
     * is the honest outcome -- silently returning a partial board is the exact
     * failure this whole routine exists to prevent.
     */
    let requestBudget = opts.maxRequests ?? WORKDAY_TENANT_REQUEST_BUDGET
    const spend = () => (requestBudget > 0 ? (requestBudget--, true) : false)

    /**
     * How evenly a facet splits what is left; smaller is better.
     *
     * FACET COUNTS ARE THEMSELVES CLAMPED AT THE CAP. Bank of America reports
     * `timeType` largest 2,004, `workerSubType` 2,003 and `jobFamilyGroup`
     * 2,005 — three numbers that all mean "at least 2,000" and nothing more.
     * Ranking on them picked the 2-value facet over the 11-value one, burned
     * two levels of recursion on splits that barely divided anything, and left
     * the board truncated at 2,004 of the 13,794 its own facets imply.
     *
     * So a clamped count is not comparable with an unclamped one. Any facet
     * that still reports a real maximum is preferred; among clamped facets the
     * tie is broken on cardinality, because more values necessarily means
     * smaller slices.
     */
    const scoreFacet = (f: any): number => {
      const values: any[] = f?.values ?? []
      if (values.length < 2) return Infinity
      const counts = values.map((v) => Number(v?.count) || 0)
      if (counts.reduce((a, b) => a + b, 0) === 0) return Infinity
      const max = Math.max(...counts)
      if (max >= WORKDAY_RESULT_CAP) return WORKDAY_RESULT_CAP + 1 / values.length
      return max
    }

    // 4, not 3: Bank of America needs workerSubType x timeType x jobFamilyGroup
    // and still has slices over the cap at depth 3.
    const MAX_SPLIT_DEPTH = 4
    let truncatedLeaves = 0
    /** Root facets, kept so the read can be checked against what the board claims. */
    let rootFacets: any[] = []
    /** What the unfiltered search reported. CAP means it was clamped. */
    let rootTotal = 0

    /**
     * Read one slice of the board, splitting it further if it is capped.
     *
     * The total is taken from a 1-row probe rather than by draining first, so
     * an oversized slice costs one request to diagnose instead of 100 wasted
     * pages before we discover it needs splitting anyway.
     */
    const partition = async (applied: Record<string, string[]>, depth: number): Promise<void> => {
      if (!spend()) return
      const probe = await this.postJson<{ total?: number; facets?: any[] }>(
        endpoint,
        { appliedFacets: applied, limit: 1, offset: 0, searchText: '' },
        { cacheTtlMs: this.ttl.jobListing, signal: opts.signal }
      )
      const total = Number(probe?.total ?? 0)
      if (depth === 0) { rootFacets = probe?.facets ?? []; rootTotal = total }
      if (total === 0) return

      /**
       * THE CLAMP REPORTS EXACTLY 2,000, SO ONLY EXACTLY 2,000 MEANS CLAMPED.
       *
       * `>=` looks like the safe comparison and is the wrong one. Bank of
       * America's board reports total 2,004 -- a real count, above the cap,
       * which is itself proof the response was NOT clamped, because a clamped
       * response says 2000 and nothing else. Treating it as capped sent the
       * read into facet partitioning it did not need, and then every leaf came
       * back "at the cap" and the board was reported as truncated. It was
       * complete: 2,004 postings read of 2,004.
       *
       * The partitioning also cannot help such a board. BofA's jobFamilyGroup
       * values are overlapping groupings, not a partition -- "Band (Management
       * Level)" alone returns all 2,004 -- which is why its facet counts sum to
       * 13,794 against a 2,004 board. Splitting on overlapping facets can only
       * re-read the same rows.
       */
      if (total !== WORKDAY_RESULT_CAP) {
        await drain(applied)
        return
      }

      // Capped. Find a facet not already in force that still divides this slice.
      const candidates = (probe?.facets ?? [])
        .filter((f: any) => f?.facetParameter && !(f.facetParameter in applied))
        .filter((f: any) => !UNUSABLE_FACETS.has(String(f.facetParameter)))
        .map((f: any) => ({ f, score: scoreFacet(f) }))
        .filter((c) => Number.isFinite(c.score))
        .sort((a, b) => a.score - b.score)

      if (depth >= MAX_SPLIT_DEPTH || !candidates.length) {
        // Nothing left to split by: take the 2,000 we can reach and say the
        // rest is unreachable rather than presenting it as the whole board.
        await drain(applied)
        truncatedLeaves++
        const where = Object.entries(applied).map(([k, v]) => `${k}=${v[0]}`).join(', ')
        warnings.push(
          `workday:${target.token} ${where ? `slice [${where}]` : 'board'} is at the ` +
          `${WORKDAY_RESULT_CAP} cap with no further facet to split by -- still truncated`
        )
        return
      }

      const best = candidates[0].f
      for (const v of best.values ?? []) {
        if (!v?.id) continue
        if (requestBudget <= 0) break
        await partition({ ...applied, [String(best.facetParameter)]: [String(v.id)] }, depth + 1)
      }
    }

    await partition({}, 0)

    /**
     * What the board says it holds, as a check on what we actually read.
     *
     * Each facet's values partition the whole board, so any facet's counts sum
     * to the real total -- and they are reported even when `total` is clamped
     * at 2,000, which is what makes them usable as ground truth. The largest
     * sum is taken because a facet whose values do not cover every posting
     * under-counts, and under-counting here would hide a shortfall.
     */
    const trueTotal = rootFacets
      .filter((f: any) => !UNUSABLE_FACETS.has(String(f?.facetParameter)))
      .reduce((best: number, f: any) => {
        const sum = (f?.values ?? []).reduce((n: number, v: any) => n + (Number(v?.count) || 0), 0)
        return Math.max(best, sum)
      }, 0)

    /**
     * Only meaningful when the board was actually clamped.
     *
     * The check assumes a facet's values partition the board, so their counts
     * sum to its size. Some tenants expose overlapping groupings instead:
     * Bank of America's jobFamilyGroup includes "Band (Management Level)",
     * which alone returns the entire board, so its facet counts sum to 13,787
     * against a 2,004-posting board. Reporting that as a 11,783-posting
     * shortfall labels a complete read as incomplete.
     *
     * When the root total was under the cap it is the real size and we read
     * it, so there is nothing to compare against.
     */
    if (rootTotal === WORKDAY_RESULT_CAP && trueTotal > 0 && all.length < trueTotal) {
      warnings.push(
        `workday:${target.token} facets report ${trueTotal} postings, read ${all.length}`
      )
    }

    if (truncatedLeaves > 0) {
      warnings.push(
        `workday:${target.token} ${truncatedLeaves} slice(s) could not be read in full`
      )
    }
    if (requestBudget <= 0) {
      warnings.push(
        `workday:${target.token} hit its request budget -- the board may be incomplete`
      )
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

/* ----------------------------------- Keka --------------------------------- */

/**
 * Keka Hire — public, unauthenticated career-portal feed.
 *
 * FOUND BY ASKING, NOT BY READING
 * -------------------------------
 * Keka is routinely described as having no public job API, needing a headless
 * browser. The career page does look that way: a 4KB shell with an empty
 * `<div id="kh-jobs-section">`. But the shell's own bundle calls
 * `api/jobs/{portal}/active` against a `<base href="/careers/">`, and that
 * endpoint answers anyone, with no key and no cookie.
 *
 * The portal segment is the trap. It reads like a tenant name, and the obvious
 * guess -- `/careers/api/jobs/scimplify/active` for scimplify.keka.com --
 * returns HTTP 200 with an empty array. That is a silent wrong answer: the
 * board looks like an employer with nothing open. The literal string `default`
 * is what returns the postings (76 for the same tenant), because the segment
 * names the PORTAL, and tenants that never renamed theirs keep the default.
 *
 * The payload is unusually complete for a list endpoint -- full HTML
 * description, structured city/state/country, department, experience and
 * publish date -- so unlike Workday there is no per-posting detail fetch to
 * pay for.
 */
export class KekaAdapter extends BaseAdapter {
  readonly id: SourceId = 'keka'
  readonly displayName = 'Keka'
  readonly hostPatterns = [/(^|\.)keka\.com$/i]
  protected discoveryPattern = '*.keka.com'
  protected healthUrl() {
    return 'https://scimplify.keka.com/careers/api/jobs/default/active'
  }

  /**
   * Derived by observation, not documentation: the value was read off the
   * rendered job page for a posting of each type. Unseen values stay null --
   * a guessed employment type is worse than an absent one, because everything
   * downstream treats it as fact.
   */
  private static readonly JOB_TYPE: Record<number, string> = {
    1: 'Part-Time',
    2: 'Full-Time',
  }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const host = target.host || `${target.token}.keka.com`
    // `site` carries the portal name for the rare tenant that renamed it.
    const portal = target.site || 'default'
    const base = `https://${host}/careers`

    const data = await this.json<any[]>(`${base}/api/jobs/${encodeURIComponent(portal)}/active`, {
      cacheTtlMs: this.ttl.jobListing,
      signal: opts.signal,
    })
    if (!Array.isArray(data)) {
      return { jobs: [], incremental: false, warnings: [`keka:${target.token} no data`] }
    }

    const jobs = this.mapRows(data, target, (j: any) => {
      const locs: any[] = Array.isArray(j.jobLocations) ? j.jobLocations : []
      const names = locs
        .map((l) => String(l?.name ?? [l?.city, l?.state, l?.countryName].filter(Boolean).join(', ')))
        .filter(Boolean)
      return {
        source: this.id,
        target,
        sourceId: String(j.id),
        requisitionId: String(j.id),
        title: String(j.title ?? '').trim(),
        company: target.companyName ?? null,
        companyDomain: target.companyDomain ?? null,
        locationRaw: names[0] ?? null,
        additionalLocations: names.slice(1),
        descriptionHtml: j.description ?? null,
        description: j.excerpt ?? null,
        department: j.departmentName ?? null,
        employmentType: KekaAdapter.JOB_TYPE[Number(j.jobType)] ?? null,
        remoteFlag: /\bremote\b/i.test(names.join(' ')),
        postedAt: toIso(j.publishedOn),
        // `salaryRange` carries a currency and period but no amounts on every
        // tenant measured, so there is nothing to report as pay.
        salaryCurrency: j.salaryRange?.currency ?? null,
        applicationUrl: `${base}/jobdetails/${j.id}`,
        canonicalUrl: `${base}/jobdetails/${j.id}`,
        extra: {
          experience: j.experience ?? null,
          skills: Array.isArray(j.skillNames) ? j.skillNames : [],
          jobTypeRaw: j.jobType ?? null,
          countryCode: locs[0]?.countryCode ?? null,
        },
      }
    }, warnings)

    return { jobs, incremental: false, warnings }
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

/**
 * Radancy TalentBrew.
 *
 * WHY THIS IS AN ADAPTER AND NOT A BOEING SCRAPER
 * -----------------------------------------------
 * Boeing was recorded as "no verified board" because autodiscovery looked for
 * vendor API hosts and found none. That verdict was wrong: the page at
 * jobs.boeing.com/search-jobs already CONTAINS the jobs, server-rendered, 1,342
 * of them per page load. There was nothing dynamic to defeat -- the fingerprint
 * set simply had no signature for this vendor.
 *
 * Radancy powers career sites for many large enterprises, so this parses the
 * platform rather than one employer. A new Radancy employer is a registry line,
 * not new code.
 *
 * WHY IT PARSES HTML
 * ------------------
 * Every other adapter here calls a JSON API, which is always preferable.
 * Radancy does not publish one. The markup it emits is a stable, generated
 * template -- fixed class names, one <li> per posting -- which is the one case
 * where HTML parsing is a reasonable source rather than a fragile shortcut.
 * It is still more brittle than JSON, so the adapter warns loudly when a page
 * yields no rows instead of silently reporting success with nothing.
 */
export class RadancyAdapter extends BaseAdapter {
  readonly id: SourceId = 'radancy'
  readonly displayName = 'Radancy TalentBrew'
  readonly hostPatterns = [/(^|\.)jobs\.[a-z0-9-]+\.com$/i]
  protected discoveryPattern = 'jobs.*/search-jobs'
  protected healthUrl() {
    return 'https://jobs.boeing.com/search-jobs'
  }

  /** Radancy serves a fixed page size; stop when a page adds nothing new. */
  private static readonly MAX_PAGES = 120

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const host = target.host || `jobs.${target.token}.com`
    const path = target.site || 'search-jobs'

    const seen = new Set<string>()
    let barren = 0
    const rows: {
      id: string; title: string; href: string; location: string | null; date: string | null
    }[] = []

    for (let page = 1; page <= RadancyAdapter.MAX_PAGES; page++) {
      const url = `https://${host}/${path}?p=${page}`
      const res = await this.get(url, { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })
      if (!res.ok || !res.body) break
      const html = res.body

      const before = rows.length
      let parsedThisPage = 0

      // One <li> per posting. The anchor carries the id and the apply path; the
      // two info spans carry location and date.
      const blocks = html.split('search-results__job-link').slice(1)
      for (const block of blocks) {
        const href = block.match(/href="([^"]+)"/)?.[1]
        const id = block.match(/data-job-id="([0-9]+)"/)?.[1]
        const title = block.match(/search-results__job-title[^>]*>([^<]+)</)?.[1]
        if (!href || !id || !title) continue
        parsedThisPage++
        if (seen.has(id)) continue
        seen.add(id)

        const location = block.match(/search-results__job-info location[^>]*>([^<]+)</)?.[1]?.trim() ?? null
        const date = block.match(/search-results__job-info date[^>]*>([^<]+)</)?.[1]?.trim() ?? null
        rows.push({ id, title: decodeEntities(title.trim()), href, location, date })
      }

      // Radancy re-ranks between requests, so an individual page can legitimately
      // contain only ids already seen -- measured: page 5 led with an id that
      // page 3 had returned moments earlier. Breaking on the first such page cut
      // Boeing off at 45 postings out of far more.
      //
      // So exhaustion means several CONSECUTIVE pages adding nothing new, while
      // a page that parses zero rows at all means the listing really has ended.
      if (parsedThisPage === 0) break
      if (rows.length === before) {
        if (++barren >= 3) break
      } else {
        barren = 0
      }
    }

    if (!rows.length) {
      return {
        jobs: [],
        incremental: false,
        warnings: [
          `radancy:${target.token} returned no rows. The markup may have changed -- ` +
          `this adapter parses generated HTML, so a template change breaks it silently ` +
          `unless it says so here.`,
        ],
      }
    }

    const jobs = this.mapRows(rows, target, (j) => ({
      source: this.id,
      target,
      sourceId: j.id,
      requisitionId: j.id,
      title: j.title,
      company: target.companyName ?? null,
      companyDomain: target.companyDomain ?? null,
      locationRaw: j.location,
      additionalLocations: [],
      // Radancy's listing carries no description; the detail page does, and
      // fetching one page per posting is not worth it at this volume.
      descriptionHtml: null,
      department: null,
      employmentType: null,
      remoteFlag: j.location ? /\bremote\b/i.test(j.location) : null,
      postedAt: toIso(j.date),
      updatedAt: toIso(j.date),
      applicationUrl: j.href.startsWith('http') ? j.href : `https://${host}${j.href}`,
      canonicalUrl: j.href.startsWith('http') ? j.href : `https://${host}${j.href}`,
    }), warnings)

    return { jobs, incremental: false, warnings }
  }
}

/** The handful of entities Radancy's templates actually emit. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}
