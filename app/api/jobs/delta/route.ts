import { type NextRequest, NextResponse } from 'next/server'
import { loadIndex } from '@/lib/job-index'

export const runtime = 'nodejs'

/**
 * Incremental job feed for polling clients (browser extension, worker, cron).
 *
 *   GET /api/jobs/delta?since=2026-09-11T08:00:00Z&limit=200
 *
 * WHY THIS EXISTS
 * ---------------
 * Ingestion already reads 1,239 employer ATS boards directly, but everything
 * downstream had to re-fetch the whole index to find out what changed. That is
 * fine for a page render and hopeless for a client polling every 15 minutes:
 * the index is hundreds of megabytes and almost all of it is unchanged.
 *
 * This returns only what is new since a cursor the client already holds, which
 * is what makes near-real-time alerts affordable on the client side -- no
 * proxies, no headless browsers, no per-user server work.
 *
 * THE CURSOR IS `firstSeenAt`, NOT `postedAt`
 * -------------------------------------------
 * `postedAt` is the employer's own publication date and is the wrong cursor for
 * two independent reasons:
 *
 *   1. It is frequently absent. Workday's list endpoint returns no date at all,
 *      and Workday is ~48% of the corpus -- paging on `postedAt` would skip
 *      half of everything, silently.
 *   2. It is not monotonic with respect to our discovery. A board can expose a
 *      posting dated last month that we are seeing for the first time today.
 *      Paging on it would skip that posting forever.
 *
 * `firstSeenAt` is when this pipeline first observed the posting, so it is
 * monotonic, always present, and is the only field that answers "what is new
 * *to me* since I last asked".
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 * -------------------------------------
 * Competing products sell a "be in the first 50 applicants" alert. We cannot
 * see applicant counts -- no public ATS endpoint exposes them -- so we do not
 * assert one. What we can state as fact is how long a posting has been visible
 * to us, which is `discoveredMinutesAgo`. That is a measurement; an applicant
 * rank would be a guess wearing a number.
 */

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 100

export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams

  const sinceRaw = sp.get('since')
  const since = sinceRaw ? new Date(sinceRaw) : null
  if (sinceRaw && Number.isNaN(since!.getTime())) {
    return NextResponse.json(
      { success: false, error: 'Invalid `since`. Use an ISO 8601 timestamp.' },
      { status: 400 }
    )
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get('limit')) || DEFAULT_LIMIT))

  // Optional narrowing so a client subscribing to one slice does not download
  // the whole delta and filter it away locally.
  const csv = (k: string) =>
    sp.get(k)?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) ?? null
  const countries = csv('country')
  const companies = csv('company')
  const sources = csv('source')
  const remoteOnly = sp.get('remote') === 'true'

  const index = await loadIndex()
  if (!index) {
    return NextResponse.json(
      {
        success: false,
        error: 'Job index is not available',
        hint: 'Build it with `npx tsx scripts/ingest-v2.mjs`.',
      },
      { status: 503 }
    )
  }

  const all = index.jobs ?? []

  // An index built before `firstSeenAt` was projected into the slim record has
  // no cursor field. Say so rather than returning an empty delta that looks
  // like "nothing is new" -- a silent empty result would make a polling client
  // believe it is up to date forever.
  const cursored = all.filter((j: any) => typeof j.firstSeenAt === 'string')
  // Applies with or without `since`: an un-cursored index cannot serve this
  // endpoint at all, and returning `jobs: []` would read as "nothing new"
  // rather than "this index cannot answer the question".
  if (all.length > 0 && cursored.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'This index predates incremental delivery',
        detail:
          'No posting in the current index carries `firstSeenAt`, so "new since" cannot be computed. Re-run ingestion to produce an index that supports it.',
      },
      { status: 409 }
    )
  }

  const sinceMs = since ? since.getTime() : null
  const matched = cursored
    .filter((j: any) => {
      if (sinceMs !== null && new Date(j.firstSeenAt).getTime() <= sinceMs) return false
      if (countries && !countries.includes((j.country ?? '').toLowerCase())) return false
      if (companies && !companies.includes((j.companySlug ?? '').toLowerCase())) return false
      if (sources && !sources.includes((j.source ?? '').toLowerCase())) return false
      if (remoteOnly && !j.remote) return false
      return true
    })
    // Newest first: a client that truncates at `limit` should keep the freshest,
    // and its next cursor is then the newest item it actually received.
    .sort((a: any, b: any) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime())

  const page = matched.slice(0, limit)
  const now = Date.now()

  return NextResponse.json({
    success: true,
    // Feed this back as `since` on the next poll. Taken from the newest item
    // actually returned, so a truncated page is resumed rather than skipped.
    cursor: page.length ? page[0].firstSeenAt : sinceRaw ?? index.generatedAt,
    total: matched.length,
    returned: page.length,
    hasMore: matched.length > page.length,
    indexGeneratedAt: index.generatedAt,
    jobs: page.map((j: any) => ({
      id: j.id,
      title: j.title,
      // `companyName` is the field on IndexedJob; `company` is the raw v2 name
      // and is absent after the loader's mapping. Reading only `company` here
      // returned undefined for every row.
      company: j.companyName ?? j.company,
      companySlug: j.companySlug,
      location: j.locationDisplay ?? j.locationRaw,
      country: j.country,
      remote: j.remote,
      workplaceType: j.workplaceType,
      seniority: j.seniority,
      skills: j.skills,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      salaryCurrency: j.salaryCurrency,
      postedAt: j.postedAt,
      firstSeenAt: j.firstSeenAt,
      // Measured, not inferred: how long this has been visible to us.
      discoveredMinutesAgo: Math.max(
        0,
        Math.round((now - new Date(j.firstSeenAt).getTime()) / 60000)
      ),
      visaStatus: j.visaStatus,
      sponsorCountries: j.sponsorCountries,
      // The employer's own application page, never an aggregator redirect.
      applyUrl: j.applicationUrl,
      isDirectApplication: j.isDirectApplication,
      source: j.source,
    })),
  })
}
