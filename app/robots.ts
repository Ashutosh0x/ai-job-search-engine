import type { MetadataRoute } from 'next'
import { SITE_URL, IS_PRODUCTION_DEPLOYMENT } from '@/lib/site'

/**
 * robots.txt.
 *
 * There was no robots.txt and no sitemap at all, so the only way a crawler
 * found anything here was by following links from the home page -- and until
 * the job detail pages existed there was nothing to follow to. Naming the
 * sitemap is what turns 113,416 postings from undiscoverable into crawlable.
 *
 * PREVIEW DEPLOYMENTS ARE DISALLOWED OUTRIGHT. Every Vercel preview serves the
 * same content on its own hostname; letting a crawler index one creates a
 * duplicate of the entire site competing with production for the same queries.
 * This is the standard reason a staging URL ends up outranking the real one.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_PRODUCTION_DEPLOYMENT) {
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Authenticated surfaces: nothing to index, and a crawler hitting
          // them just generates redirects to /login.
          '/dashboard',
          '/profile',
          '/settings',
          '/preferences',
          '/resume',
          '/reset-password',
          '/forgot-password',
          '/login',
          '/signup',
          // Every API route is data for the app, not a page for a reader.
          '/api/',
          // A demo harness that exists to exercise toasts.
          '/toast-demo',
          // Internal tooling. Also noindex'd on the page itself; a crawler that
          // ignores robots.txt still reads the meta tag.
          '/admin',
          // The tracked Apply redirect. A crawler following these would fire an
          // apply_click for every posting and drown the real ones.
          '/go/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
