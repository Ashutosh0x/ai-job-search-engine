import { type NextRequest, NextResponse } from 'next/server'
import { searchJobs, type JobQuery } from '@/lib/job-index'
import { guard, EXPENSIVE_READ, publicReadCache } from '@/lib/api-guard'

export const runtime = 'nodejs'

/**
 * Job search with company-level facets.
 *
 * Filters the major boards do not offer, and the reason they matter:
 *
 *   valuationTier / minValuation  - "only companies worth $10B+", or the
 *                                   inverse, "only pre-unicorn". LinkedIn and
 *                                   Indeed expose company SIZE (headcount) but
 *                                   not company VALUE, so you cannot separate
 *                                   a 500-person unicorn from a 500-person
 *                                   agency.
 *   minOpenRoles                  - hiring momentum. A company with 600 open
 *                                   roles is in a different phase from one
 *                                   with three, and that is invisible when you
 *                                   are looking at a single posting.
 *   postedWithinDays              - real freshness. Aggregators show "reposted"
 *                                   dates; this is the date the employer's own
 *                                   ATS reports, and a posting with no date is
 *                                   EXCLUDED rather than assumed fresh.
 *   provider                      - which ATS, which is a decent proxy for how
 *                                   the application process will go.
 *
 * Every facet count is computed over the filtered set, so the counts shown
 * next to each filter are what you would actually get.
 */
export async function GET(request: NextRequest) {
  // No global limiter covers API routes: middleware.ts excludes them.
  const limited = guard(request, 'search', EXPENSIVE_READ)
  if (limited) return limited

  const sp = new URL(request.url).searchParams

  const list = (key: string): string[] | undefined => {
    const raw = sp.get(key)
    if (!raw) return undefined
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
    return items.length ? items : undefined
  }
  const num = (key: string): number | undefined => {
    const raw = sp.get(key)
    if (raw === null) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }

  const query: JobQuery = {
    q: sp.get('q') ?? undefined,
    location: sp.get('location') ?? undefined,
    remote: sp.get('remote') === 'true' ? true : undefined,
    valuationTiers: list('valuationTier'),
    minValuation: num('minValuation'),
    minOpenRoles: num('minOpenRoles'),
    postedWithinDays: num('postedWithinDays'),
    departments: list('department'),
    cities: list('city'),
    countries: list('country'),
    companies: list('company'),
    providers: list('provider'),
    employmentTypes: list('employmentType'),
    earlyCareer: list('earlyCareer'),
    minSalary: num('minSalary'),
    salaryCurrency: sp.get('salaryCurrency')?.trim().toUpperCase() || undefined,
    sort: (sp.get('sort') as JobQuery['sort']) ?? undefined,
    page: num('page'),
    pageSize: num('pageSize'),
  }

  const result = await searchJobs(query)

  if (!result) {
    // No invented listings when the index is missing -- say so, and say how to
    // fix it, rather than returning plausible-looking placeholder jobs.
    return NextResponse.json(
      {
        success: false,
        error: 'Job index is not available',
        hint: 'Run `npx tsx scripts/ingest-jobs.mjs` to build the index from the ATS APIs.',
      },
      { status: 503 }
    )
  }

  return NextResponse.json({ success: true, ...result }, { headers: publicReadCache() })
}
