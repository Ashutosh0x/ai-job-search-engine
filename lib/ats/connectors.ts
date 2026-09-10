import {
  type AtsBoard,
  type AtsProvider,
  type FetchResult,
  type NormalizedJob,
  detectRemote,
  toIsoDate,
} from './types'

/**
 * Connectors for the public job-board APIs of the six major ATS platforms.
 * All endpoints are documented, unauthenticated, and intended for public
 * consumption -- they are what each employer's own careers page calls.
 *
 * Verified endpoint shapes (Sep 2026):
 *   greenhouse       GET  boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 *   lever            GET  api.lever.co/v0/postings/{company}?mode=json
 *   ashby            GET  api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 *   smartrecruiters  GET  api.smartrecruiters.com/v1/companies/{company}/postings
 *   recruitee        GET  {company}.recruitee.com/api/offers/
 *   workday          POST {host}/wday/cxs/{tenant}/{site}/jobs   (page size capped at 20)
 */

const USER_AGENT = 'JobSparkAI/1.0 (+https://jobspark.ai; job aggregation)'
const TIMEOUT_MS = 20_000

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(init?.headers || {}) },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------- Greenhouse ------------------------------- */

async function fetchGreenhouse(board: AtsBoard): Promise<FetchResult> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`
  const data = await getJson(url)
  const warnings: string[] = []

  const jobs: NormalizedJob[] = (data?.jobs ?? []).map((j: any) => {
    // `departments` and `offices` are arrays of objects. The original
    // /api/jobs route did String(job.department) on this and rendered
    // "[object Object]".
    const department = Array.isArray(j.departments) && j.departments.length
      ? String(j.departments[0]?.name ?? '')
      : null
    const location = j.location?.name ?? null

    return {
      externalId: `greenhouse:${board.token}:${j.id}`,
      provider: 'greenhouse' as AtsProvider,
      companySlug: board.companySlug,
      title: String(j.title ?? '').trim(),
      location,
      department: department || null,
      employmentType: null,
      isRemote: detectRemote(location, j.title),
      descriptionHtml: j.content ?? null,
      postedAt: toIsoDate(j.updated_at ?? j.first_published),
      applyUrl: String(j.absolute_url ?? ''),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    }
  })

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings }
}

/* ---------------------------------- Lever --------------------------------- */

async function fetchLever(board: AtsBoard): Promise<FetchResult> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`
  const data = await getJson(url)

  const jobs: NormalizedJob[] = (Array.isArray(data) ? data : []).map((j: any) => {
    const location = j.categories?.location ?? null
    const salary = j.salaryRange ?? null
    return {
      externalId: `lever:${board.token}:${j.id}`,
      provider: 'lever' as AtsProvider,
      companySlug: board.companySlug,
      title: String(j.text ?? '').trim(),
      location,
      department: j.categories?.team ?? j.categories?.department ?? null,
      employmentType: j.categories?.commitment ?? null,
      isRemote: detectRemote(location, j.workplaceType, j.text),
      descriptionHtml: j.descriptionPlain ? `<p>${j.descriptionPlain}</p>` : (j.description ?? null),
      // Lever's createdAt is epoch milliseconds.
      postedAt: toIsoDate(j.createdAt),
      applyUrl: String(j.hostedUrl ?? j.applyUrl ?? ''),
      salaryMin: typeof salary?.min === 'number' ? salary.min : null,
      salaryMax: typeof salary?.max === 'number' ? salary.max : null,
      salaryCurrency: salary?.currency ?? null,
    }
  })

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings: [] }
}

/* ---------------------------------- Ashby --------------------------------- */

async function fetchAshby(board: AtsBoard): Promise<FetchResult> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`
  const data = await getJson(url)

  const jobs: NormalizedJob[] = (data?.jobs ?? []).map((j: any) => {
    const comp = j.compensation?.summaryComponents?.find(
      (c: any) => c?.compensationType === 'Salary'
    )
    return {
      externalId: `ashby:${board.token}:${j.id}`,
      provider: 'ashby' as AtsProvider,
      companySlug: board.companySlug,
      title: String(j.title ?? '').trim(),
      location: j.location ?? null,
      department: j.department ?? j.team ?? null,
      employmentType: j.employmentType ?? null,
      isRemote: Boolean(j.isRemote) || detectRemote(j.location, j.title),
      descriptionHtml: j.descriptionHtml ?? null,
      postedAt: toIsoDate(j.publishedAt ?? j.updatedAt),
      applyUrl: String(j.jobUrl ?? j.applyUrl ?? ''),
      salaryMin: typeof comp?.minValue === 'number' ? comp.minValue : null,
      salaryMax: typeof comp?.maxValue === 'number' ? comp.maxValue : null,
      salaryCurrency: comp?.currencyCode ?? null,
    }
  })

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings: [] }
}

/* ----------------------------- SmartRecruiters ---------------------------- */

async function fetchSmartRecruiters(board: AtsBoard): Promise<FetchResult> {
  // This one paginates; everything else returns the full board in one call.
  const jobs: NormalizedJob[] = []
  const warnings: string[] = []
  const limit = 100
  let offset = 0

  for (let page = 0; page < 20; page++) {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings?limit=${limit}&offset=${offset}`
    const data = await getJson(url)
    const content = data?.content ?? []

    for (const j of content) {
      const city = j.location?.city ?? ''
      const country = j.location?.country ?? ''
      const location = [city, country].filter(Boolean).join(', ') || null
      jobs.push({
        externalId: `smartrecruiters:${board.token}:${j.id}`,
        provider: 'smartrecruiters',
        companySlug: board.companySlug,
        title: String(j.name ?? '').trim(),
        location,
        department: j.department?.label ?? j.function?.label ?? null,
        employmentType: j.typeOfEmployment?.label ?? null,
        isRemote: Boolean(j.location?.remote) || detectRemote(location, j.name),
        descriptionHtml: null,
        postedAt: toIsoDate(j.releasedDate ?? j.createdOn),
        applyUrl: String(
          j.applyUrl ?? `https://jobs.smartrecruiters.com/${board.token}/${j.id}`
        ),
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
      })
    }

    const total = Number(data?.totalFound ?? 0)
    offset += limit
    if (content.length < limit || offset >= total) break
    if (page === 19) warnings.push(`SmartRecruiters ${board.token}: stopped at pagination cap`)
  }

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings }
}

/* -------------------------------- Recruitee ------------------------------- */

async function fetchRecruitee(board: AtsBoard): Promise<FetchResult> {
  const url = `https://${encodeURIComponent(board.token)}.recruitee.com/api/offers/`
  const data = await getJson(url)

  const jobs: NormalizedJob[] = (data?.offers ?? []).map((j: any) => {
    const location = [j.city, j.country].filter(Boolean).join(', ') || j.location || null
    return {
      externalId: `recruitee:${board.token}:${j.id}`,
      provider: 'recruitee' as AtsProvider,
      companySlug: board.companySlug,
      title: String(j.title ?? '').trim(),
      location,
      department: j.department ?? null,
      employmentType: j.employment_type_code ?? j.employment_type ?? null,
      isRemote: detectRemote(location, j.remote ? 'remote' : '', j.title),
      descriptionHtml: j.description ?? null,
      postedAt: toIsoDate(j.published_at ?? j.created_at),
      applyUrl: String(j.careers_url ?? j.careers_apply_url ?? ''),
      salaryMin: typeof j.salary?.min === 'number' ? j.salary.min : null,
      salaryMax: typeof j.salary?.max === 'number' ? j.salary.max : null,
      salaryCurrency: j.salary?.currency ?? null,
    }
  })

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings: [] }
}

/* --------------------------------- Workday -------------------------------- */

async function fetchWorkday(board: AtsBoard): Promise<FetchResult> {
  const host = board.host || `${board.token}.wd1.myworkdayjobs.com`
  const site = board.site || 'External'
  const endpoint = `https://${host}/wday/cxs/${encodeURIComponent(board.token)}/${encodeURIComponent(site)}/jobs`
  const warnings: string[] = []
  const jobs: NormalizedJob[] = []

  // Workday hard-caps the page size at 20; a larger limit returns an empty
  // array rather than an error, which is an easy way to silently get nothing.
  const PAGE = 20
  let offset = 0
  // Workday reports `total` only on the first response; later pages come back
  // with total: 0 while still returning postings. Trusting it every time made
  // `offset >= total` true on page 3 and silently truncated large boards to 40
  // jobs (Salesforce: 40 of 1436).
  let total = Infinity

  for (let page = 0; page < 200; page++) {
    const data = await getJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText: '' }),
    })

    const postings = data?.jobPostings ?? []
    for (const j of postings) {
      const path = String(j.externalPath ?? '')
      jobs.push({
        externalId: `workday:${board.token}:${j.bulletFields?.[0] ?? path}`,
        provider: 'workday',
        companySlug: board.companySlug,
        title: String(j.title ?? '').trim(),
        location: j.locationsText ?? null,
        department: null,
        employmentType: j.timeType ?? null,
        isRemote: detectRemote(j.locationsText, j.title),
        descriptionHtml: null,
        // postedOn is relative text ("Posted 5 Days Ago"), not a date.
        postedAt: toIsoDate(j.startDate),
        applyUrl: path ? `https://${host}/${site}${path}` : '',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
      })
    }

    if (page === 0) {
      const reported = Number(data?.total ?? 0)
      if (reported > 0) total = reported
    }

    offset += PAGE
    // Primary stop condition is a short page; `total` is only a secondary hint.
    if (postings.length < PAGE || offset >= total) break
    if (page === 199) warnings.push(`Workday ${board.token}: stopped at pagination cap`)
  }

  return { jobs: jobs.filter((j) => j.title && j.applyUrl), warnings }
}

/* --------------------------------- Registry ------------------------------- */

const CONNECTORS: Record<AtsProvider, (b: AtsBoard) => Promise<FetchResult>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  smartrecruiters: fetchSmartRecruiters,
  recruitee: fetchRecruitee,
  workday: fetchWorkday,
}

/**
 * Fetch one board. Never throws: a dead board must not abort a whole ingest
 * run, so failures come back as warnings with an empty job list.
 */
export async function fetchBoard(board: AtsBoard): Promise<FetchResult> {
  const connector = CONNECTORS[board.provider]
  if (!connector) {
    return { jobs: [], warnings: [`Unknown provider: ${board.provider}`] }
  }
  try {
    return await connector(board)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { jobs: [], warnings: [`${board.provider}:${board.token} failed: ${message}`] }
  }
}

export const SUPPORTED_PROVIDERS = Object.keys(CONNECTORS) as AtsProvider[]
