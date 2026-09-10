import { type NextRequest, NextResponse } from 'next/server'
import { smartSearch } from '@/lib/job-index'

export const runtime = 'nodejs'

/**
 * Natural-language job search.
 *
 *   GET /api/smart-search?q=senior ML engineer in Bangalore with visa sponsorship
 *
 * The sentence is parsed into structured constraints, those become real
 * filters, and what survives is ranked by an explainable 100-point scorer.
 *
 * Two things are returned that a conventional search API does not give you:
 *
 *   `intentSummary` — how the query was understood, in plain language, so the
 *                     user can see and correct a misreading rather than being
 *                     silently given the wrong results.
 *   `matchReasons`  — per-result badges naming what actually earned the rank.
 *
 * `?debug=1` adds the full per-signal score breakdown.
 */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams
  const q = sp.get('q') ?? ''
  const debug = sp.get('debug') === '1'
  const page = Number(sp.get('page')) || 1
  const pageSize = Math.min(50, Number(sp.get('pageSize')) || 20)

  if (!q.trim()) {
    return NextResponse.json({ success: false, error: 'Provide a query with ?q=' }, { status: 400 })
  }

  const started = Date.now()
  const result = await smartSearch(q, { page, pageSize })

  if (!result) {
    return NextResponse.json(
      {
        success: false,
        error: 'Job index is not available',
        hint: 'Run `npx tsx scripts/ingest-v2.mjs` to build it.',
      },
      { status: 503 }
    )
  }

  return NextResponse.json({
    success: true,
    query: q,
    // How the sentence was read. Shown to the user, not just logged.
    understood: result.intentSummary,
    intent: {
      topic: result.intent.topic,
      skills: result.intent.skills,
      locations: result.intent.locations,
      countries: result.intent.countries,
      seniority: result.intent.seniority,
      workplace: result.intent.workplace,
      visa: result.intent.visa,
      postedWithinDays: result.intent.postedWithinDays,
      salaryMin: result.intent.salaryMin,
      companies: result.intent.companies,
      facets: result.intent.facets,
    },
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    tookMs: Date.now() - started,
    generatedAt: result.generatedAt,
    jobs: result.jobs.map((j: any) => ({
      id: j.externalId,
      title: j.title,
      company: j.companyName,
      companySlug: j.companySlug,
      location: j.locationDisplay ?? j.location,
      city: j.city,
      country: j.country,
      remote: j.isRemote,
      workplace: j.workplaceDisplay ?? null,
      seniority: j.seniority ?? null,
      skills: (j.skills ?? []).slice(0, 8),
      salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency,
      postedAt: j.postedAt,
      visaStatus: j.visaStatus ?? 'SPONSORSHIP_NOT_MENTIONED',
      visaEvidence: (j.visaEvidence ?? []).slice(0, 1),
      applyUrl: j.applyUrl,
      isDirectApplication: j.isDirectApplication ?? true,
      source: j.provider,
      // Why this result is here, and why it is ranked where it is.
      score: j.rankScore,
      matchReasons: j.matchReasons,
      ...(debug ? { signals: j.rankSignals, explain: j.rankExplain } : {}),
    })),
  })
}
