/**
 * The site's own absolute origin.
 *
 * Canonical links, Open Graph URLs, sitemap entries and JobPosting structured
 * data all need an absolute URL, and getting it wrong is not a visible bug --
 * it is a silently wrong canonical pointing at localhost, which tells a crawler
 * the real page is one it cannot reach.
 *
 * Resolution order, most explicit first:
 *
 *   NEXT_PUBLIC_SITE_URL   what the operator configured. Always wins.
 *   VERCEL_PROJECT_PRODUCTION_URL
 *                          the project's stable production domain. Vercel sets
 *                          this on every deployment, including previews, so a
 *                          preview build still emits canonicals pointing at
 *                          production -- which is what you want, since preview
 *                          deployments must not compete for the same rankings.
 *   VERCEL_URL             the per-deployment hostname. Last resort: it is
 *                          unique per deploy, so it is only right when nothing
 *                          better is set.
 *   localhost:3000         development.
 *
 * Note VERCEL_* are provided without a scheme, hence the prefixing below.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (prod) return `https://${prod.replace(/\/+$/, '')}`

  const deployment = process.env.VERCEL_URL?.trim()
  if (deployment) return `https://${deployment.replace(/\/+$/, '')}`

  return 'http://localhost:3000'
}

export const SITE_URL = resolveSiteUrl()

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL + '/').toString()
}

/**
 * Is this deployment the canonical one?
 *
 * Preview deployments must not be indexed: they serve the same content as
 * production, so letting a crawler in creates duplicate-content competition
 * against the site's own pages. robots.ts uses this to disallow everything on
 * anything that is not the production deployment.
 */
export const IS_PRODUCTION_DEPLOYMENT =
  process.env.VERCEL_ENV === undefined || process.env.VERCEL_ENV === 'production'

export const SITE_NAME = 'AI Job Search'
