import { type NextRequest, NextResponse } from 'next/server'
import { searchJobs } from '@/lib/job-index'

export const runtime = 'nodejs'

/**
 * Job search for the Explore page.
 *
 * WHY THIS NO LONGER READS SUPABASE
 * ---------------------------------
 * It used to query a `jobs` table via `getSupabaseServerClient()`, which builds
 * a client from `NEXT_PUBLIC_SUPABASE_URL!` and `SUPABASE_SERVICE_ROLE_KEY!`.
 * Neither is set in production, so the constructor threw `supabaseUrl is
 * required` on every request and the route answered 503 -- while 246,402
 * crawled postings sat in the index that every OTHER route already reads.
 *
 * The table was also never the real source: nothing writes crawled jobs into
 * Supabase. This route was pointed at a store that was empty by construction.
 *
 * It now reads the same snapshot as /api/search, so the Explore page shows the
 * same corpus as the rest of the app and links to the same employer ATS pages.
 *
 * NO FABRICATED FALLBACK
 * ----------------------
 * An earlier version returned three invented postings with `success: true` when
 * the upstream failed. That is worse than an error, because a user can apply to
 * a job that does not exist. A failure is reported as a failure.
 */

const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20

export interface JobSearchResult {
  /** `provider:token:sourceId` -- stable, and the key the rest of the app uses. */
  id: string
  title: string
  company: string
  companySlug: string
  companyDomain: string | null
  location: string | null
  department: string | null
  employmentType: string | null
  isRemote: boolean
  postedAt: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  /** The employer's own application page, never an aggregator redirect. */
  applyUrl: string
  provider: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const q = (searchParams.get('q') || '').trim()
  const location = (searchParams.get('location') || '').trim()
  const workType = (searchParams.get('workType') || '').trim()
  const jobType = (searchParams.get('type') || '').trim()
  const department = (searchParams.get('department') || '').trim()

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE)
  )
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  try {
    const result = await searchJobs({
      q: q || undefined,
      location: location || undefined,
      // "any" is the UI's neutral value, not a filter.
      remote: workType && workType !== 'any' ? /remote/i.test(workType) : undefined,
      employmentTypes: jobType && jobType !== 'any' ? [jobType] : undefined,
      departments: department && department !== 'all' ? [department] : undefined,
      sort: q ? 'relevance' : 'recent',
      page,
      pageSize,
    })

    // `searchJobs` returns null only when no snapshot could be loaded at all.
    // Say that plainly rather than returning an empty page, which would read as
    // "no jobs match" and send the user looking for a better query.
    if (!result) {
      return NextResponse.json(
        {
          success: false,
          error: 'Job index is not available',
          detail: 'The deployment has no job snapshot to search.',
        },
        { status: 503 }
      )
    }

    const jobs: JobSearchResult[] = result.jobs.map((j) => ({
      id: j.externalId,
      title: j.title,
      company: j.companyName,
      companySlug: j.companySlug,
      companyDomain: j.companyDomain ?? null,
      location: j.locationDisplay ?? j.location ?? null,
      department: j.department ?? null,
      employmentType: j.employmentType ?? null,
      isRemote: j.isRemote,
      postedAt: j.postedAt ?? null,
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      salaryCurrency: j.salaryCurrency ?? null,
      applyUrl: j.applyUrl,
      provider: j.provider,
    }))

    return NextResponse.json({
      success: true,
      jobs,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      hasMore: result.page < result.totalPages,
      departments: result.facets.departments,
      // Carried through so the page can say it is showing a bounded slice
      // rather than implying it has the whole market.
      deployment: result.deployment,
      generatedAt: result.generatedAt,
    })
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return NextResponse.json(
      { success: false, error: 'Job search is temporarily unavailable' },
      { status: 503 }
    )
  }
}
