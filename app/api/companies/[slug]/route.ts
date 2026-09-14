import { type NextRequest, NextResponse } from 'next/server'
import { getCompany } from '@/lib/job-index'
import { getRecruitingContacts } from '@/lib/companies/recruiting-contacts'
import { guard, PUBLIC_READ } from '@/lib/api-guard'

export const runtime = 'nodejs'

/**
 * One company: profile, valuation with its provenance, and every open role.
 *
 * `valuationSource` and `valuationAsOf` are returned alongside the figure and
 * the UI shows both. A valuation without a date is a number pretending to be a
 * fact -- a private company's last round can be years old, and presenting that
 * as "current" is the kind of quiet inaccuracy worth designing against.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  // No global limiter covers API routes: middleware.ts excludes them.
  const limited = guard(request, 'company-detail', PUBLIC_READ)
  if (limited) return limited

  const result = await getCompany(params.slug)

  if (!result) {
    return NextResponse.json(
      { success: false, error: 'Company not found' },
      { status: 404 }
    )
  }

  const { company, jobs } = result

  // Breakdowns that make the company page useful rather than decorative.
  const byDepartment = new Map<string, number>()
  const byLocation = new Map<string, number>()
  for (const j of jobs) {
    if (j.department) byDepartment.set(j.department, (byDepartment.get(j.department) ?? 0) + 1)
    if (j.location) byLocation.set(j.location, (byLocation.get(j.location) ?? 0) + 1)
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n)

  const dated = jobs.filter((j) => j.postedAt).map((j) => new Date(j.postedAt!).getTime())
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const recruiting = await getRecruitingContacts(company.slug, company.boards)

  return NextResponse.json({
    success: true,
    company: {
      slug: company.slug,
      name: company.name,
      domain: company.domain,
      website: `https://${company.domain}`,
      logoUrl: company.logoUrl,
      industry: company.industry ?? null,
      hqLocation: company.hqLocation ?? null,
      foundedYear: company.foundedYear ?? null,
      ticker: company.ticker ?? null,
      openRoles: jobs.length,
      valuation: {
        usd: company.valuationUsd ?? null,
        kind: company.valuationKind,
        tier: company.valuationTier,
        asOf: company.valuationAsOf ?? null,
        source: company.valuationSource ?? null,
      },
      atsProviders: company.boards.map((b) => b.provider),
      hiringSignals: {
        openRoles: jobs.length,
        remoteRoles: jobs.filter((j) => j.isRemote).length,
        postedLast30Days: dated.filter((t) => t >= thirtyDaysAgo).length,
        newestPostingAt: dated.length ? new Date(Math.max(...dated)).toISOString() : null,
        departments: top(byDepartment, 15),
        locations: top(byLocation, 15),
      },
      recruiting,
    },
    jobs,
  })
}
