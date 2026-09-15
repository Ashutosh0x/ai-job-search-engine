import { loadIndex, type IndexedJob } from '@/lib/job-index'
import { absoluteUrl } from '@/lib/site'

/**
 * Sitemap index.
 *
 * `generateSitemaps()` in app/sitemap.ts emits the shards -- /sitemap/0.xml,
 * /sitemap/1.xml -- but Next does NOT generate the index that points at them.
 * Verified against the build output: `.next/server/app/sitemap/` holds
 * 0.xml.body and 1.xml.body and nothing else, so the `Sitemap:` line in
 * robots.txt was aimed at a URL that 404s.
 *
 * That is the quiet version of this failure: robots.txt parses, the shards
 * exist and are individually valid, and the only symptom is that no crawler
 * ever finds them. This route is the missing piece.
 *
 * The shard count is derived the same way app/sitemap.ts derives it, so the two
 * cannot drift apart.
 */

export const revalidate = 3600

/** Must match PER_SITEMAP in app/sitemap.ts. */
const PER_SITEMAP = 20_000

/** Must match isIndexable() in app/sitemap.ts. */
function isIndexable(job: IndexedJob): boolean {
  return Boolean(job.postedAt) && (job.descriptionText || '').trim().length >= 50
}

export async function GET(): Promise<Response> {
  const index = await loadIndex()
  const indexable = index ? index.jobs.filter(isIndexable).length : 0
  const shards = Math.max(1, Math.ceil(indexable / PER_SITEMAP))
  const lastModified = new Date(index?.generatedAt ?? Date.now()).toISOString()

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    Array.from({ length: shards }, (_, id) =>
      `<sitemap>\n<loc>${absoluteUrl(`/sitemap/${id}.xml`)}</loc>\n<lastmod>${lastModified}</lastmod>\n</sitemap>\n`,
    ).join('') +
    `</sitemapindex>\n`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
