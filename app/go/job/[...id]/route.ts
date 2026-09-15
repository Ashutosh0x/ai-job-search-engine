import { NextResponse, type NextRequest } from 'next/server'
import { getJobById, jobIdFromSegments } from '@/lib/job-index'
import { buildEvent, recordAndForget, shouldSkip } from '@/lib/analytics/record'
import { isSafeApplyUrl } from '@/lib/analytics/redirect'

export const runtime = 'nodejs'
/** Never cached: every hit is an event, and a cached 307 records nothing. */
export const dynamic = 'force-dynamic'

/**
 * Tracked Apply redirect.
 *
 *   GET /go/job/greenhouse/stripe/123  ->  307 -> https://boards.greenhouse.io/...
 *
 * WHY A REDIRECT AND NOT AN onclick BEACON
 * ----------------------------------------
 * A click handler that fires a beacon then follows the link loses the event
 * whenever the browser tears the page down first -- which on a link that
 * navigates away is often. Apply clicks are the single most valuable signal on
 * a job board, so they are recorded server-side where the record is made before
 * the response is sent and cannot be lost to a page unload.
 *
 * THE OPEN-REDIRECT RULE
 * ----------------------
 * The destination is NEVER taken from the request. The URL carries a job ID;
 * the destination is looked up in the job index and validated. There is no
 * parameter a caller can set to influence where they are sent, which is what
 * makes this endpoint useless as an open redirect -- the class of bug that
 * turns a job board into a phishing relay.
 *
 * `isSafeApplyUrl` then re-checks the stored value, because the index is built
 * from third-party ATS responses and a stored destination is still data from
 * outside this system.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * Analytics never blocks the redirect. The event is queued fire-and-forget with
 * a timeout; if the store is down the user still reaches the employer. An
 * outage that stopped people applying for jobs would be far worse than losing a
 * day of metrics.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string[] } },
): Promise<Response> {
  const jobId = jobIdFromSegments(params.id)
  if (!jobId) return notFound('That job link is malformed.')

  const found = await getJobById(jobId)
  if (!found) {
    /**
     * A 404 here is also the answer for a job that has left the index, which is
     * the common case on a board where postings expire. Saying so plainly beats
     * redirecting to a stale URL that will 404 on the employer's own site.
     */
    return notFound('That job is no longer in the index.')
  }

  const { job } = found
  const destination = job.applyUrl

  if (!isSafeApplyUrl(destination)) {
    // The stored destination failed validation. Refuse rather than send the
    // user somewhere unvetted, and make it loud: it means the crawler accepted
    // something it should not have.
    console.error(
      `[go] refusing to redirect ${jobId}: stored applyUrl is not a safe http(s) URL (${String(destination).slice(0, 120)})`,
    )
    return notFound('That job has no valid application link.')
  }

  if (!shouldSkip(req)) {
    const ctx = { source: job.provider, companySlug: job.companySlug }
    recordAndForget([
      buildEvent(req, { type: 'apply_click', jobId, companySlug: job.companySlug }, ctx),
      /**
       * Both events, deliberately.
       *
       * `apply_click` is intent and `external_redirect` is delivery. They are
       * equal here because this route does both at once, but keeping them
       * distinct means the funnel does not have to change shape if a
       * confirmation step is ever added between them.
       */
      buildEvent(req, { type: 'external_redirect', jobId, companySlug: job.companySlug }, ctx),
    ])
  }

  const res = NextResponse.redirect(destination, 307)
  /**
   * `noreferrer` strips the Referer header, so the employer's ATS never learns
   * the internal path the visitor came from -- which would leak the job id and,
   * on a search-results referrer, the query someone typed.
   */
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  // Keeps this endpoint out of search results; it is a machine route.
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

/**
 * A readable dead end rather than a bare 404.
 *
 * People arrive here from shared links and stale tabs, so the response says
 * what happened and offers a way onward instead of a blank page.
 */
function notFound(reason: string): Response {
  const body = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Job link unavailable</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
       font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       background:#f8fafc;color:#0f172a}
  @media(prefers-color-scheme:dark){body{background:#020617;color:#e2e8f0}}
  .card{max-width:30rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{margin:0 0 1.5rem;color:#64748b}
  a{display:inline-block;padding:.625rem 1.25rem;border-radius:.5rem;
    background:#7c3aed;color:#fff;text-decoration:none;font-weight:500}
</style></head>
<body><div class="card">
  <h1>This job link is no longer available</h1>
  <p>${escapeHtml(reason)}</p>
  <a href="/explore-jobs">Browse open roles</a>
</div></body></html>`

  return new Response(body, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

/** The reason strings are ours, but escaping them keeps this safe by construction. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
