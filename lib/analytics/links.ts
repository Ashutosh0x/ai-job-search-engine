/**
 * The Apply link a user actually clicks.
 *
 * Every Apply control points at /go/job/... rather than straight at the
 * employer, so the click is recorded server-side before the redirect. Recording
 * it in the browser instead loses the event whenever the page is torn down by
 * the navigation, which on a link that leaves the site is most of the time --
 * and apply clicks are the most valuable signal this product has.
 *
 * WHAT THE USER SEES
 * ------------------
 * A normal link. The status bar shows a first-party /go/job/... path rather than
 * an ATS URL full of tracking parameters, and the redirect is immediate.
 *
 * WHY THE DESTINATION IS NOT IN THE URL
 * -------------------------------------
 * The path carries only the job id. /go/job resolves the destination from the
 * index, which is what makes the endpoint useless as an open redirect: there is
 * no parameter a caller can set to choose where they land.
 */

/**
 * Path to the tracked redirect for a posting.
 *
 * Every id in the corpus is `provider:companyToken:sourceId` -- exactly three
 * colon-separated parts, all unique, none containing a slash -- so the parts map
 * onto path segments losslessly. Mirrors jobPath()/jobIdFromSegments() in
 * lib/job-index.ts, which are the server-side inverse.
 */
export function applyHref(externalId: string): string {
  return `/go/job/${externalId.split(':').map(encodeURIComponent).join('/')}`
}

/**
 * Attributes every outbound Apply link should carry.
 *
 * `noreferrer` is the one that matters and is easy to omit: without it the
 * employer's ATS receives the page the visitor came from, which leaks the job
 * id and -- from a results page -- the search someone typed. `nofollow` keeps
 * crawlers from treating these as endorsements, and `noopener` closes the
 * reverse-tabnabbing hole on `target="_blank"`.
 */
export const APPLY_LINK_ATTRS = {
  target: '_blank',
  rel: 'noopener noreferrer nofollow',
} as const
