import { loadIndex, jobPath, type IndexedJob } from '@/lib/job-index'
import { absoluteUrl } from '@/lib/site'

/**
 * Sitemap shards: /sitemap/0.xml, /sitemap/1.xml, ...
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT app/sitemap.ts
 * --------------------------------------------------
 * This was a metadata route (`app/sitemap.ts` + `generateSitemaps()`). That
 * file claims BOTH `/sitemap/[__metadata_id__]` AND `/sitemap.xml`, which
 * collides with the sitemap index in app/sitemap.xml/route.ts. `next build`
 * tolerates the collision; `next dev` refuses to start on it at all:
 *
 *   Error: You cannot define a route with the same specificity as a optional
 *   catch-all route ("/sitemap.xml" and "/sitemap.xml[[...__metadata_id__]]").
 *
 * So the dev server could not run while both existed. Serving the shards from
 * an explicit route handler keeps every public URL exactly as it was —
 * /sitemap.xml is still the index, /sitemap/N.xml are still the shards — with
 * no path claimed twice.
 *
 * WHAT GOES IN, AND WHAT DELIBERATELY DOES NOT
 * --------------------------------------------
 * Only pages we are asking to have indexed. A sitemap entry is a request to
 * index; listing a URL that also sends `noindex` is a contradiction, and a
 * sitemap full of thin pages devalues the ones that are not.
 *
 * The job page applies `noindex` to any posting with no date or under 50
 * characters of description, so the same rule selects entries here.
 */

export const revalidate = 3600

/** Must match PER_SITEMAP in app/sitemap.xml/route.ts. */
const PER_SITEMAP = 20_000

/** Pages that exist regardless of the index, highest value first. */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: string }[] = [
  { path: '/', priority: 1.0, changeFrequency: 'daily' },
  { path: '/explore-jobs', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/jobs', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/companies', priority: 0.8, changeFrequency: 'daily' },
  { path: '/recruiters', priority: 0.7, changeFrequency: 'daily' },
  { path: '/pricing', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/resume-builder', priority: 0.6, changeFrequency: 'monthly' },
]

/** The rule the job page's `robots` directive uses. Kept identical on purpose. */
function isIndexable(job: IndexedJob): boolean {
  return Boolean(job.postedAt) && (job.descriptionText || '').trim().length >= 50
}

/**
 * Freshest first.
 *
 * Crawl budget is finite and spent top-down, so the ordering decides which
 * postings get seen while they are still open. A job board's value decays
 * fast; an eight-month-old listing crawled ahead of yesterday's is wasted.
 */
function indexableJobs(jobs: IndexedJob[]): IndexedJob[] {
  return jobs
    .filter(isIndexable)
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function urlEntry(loc: string, lastModified: string, changeFrequency: string, priority: number): string {
  return (
    `<url>\n` +
    `<loc>${escapeXml(loc)}</loc>\n` +
    `<lastmod>${lastModified}</lastmod>\n` +
    `<changefreq>${changeFrequency}</changefreq>\n` +
    `<priority>${priority.toFixed(1)}</priority>\n` +
    `</url>\n`
  )
}

export async function GET(
  _req: Request,
  { params }: { params: { shard: string } }
): Promise<Response> {
  // The path segment carries the extension: "0.xml".
  const match = params.shard.match(/^(\d+)\.xml$/)
  if (!match) return new Response('Not found', { status: 404 })

  const id = Number(match[1])
  const index = await loadIndex()
  const jobs = indexableJobs(index?.jobs ?? [])

  // Shard 0 always exists, even with no index, so it is never a 404.
  const shards = Math.max(1, Math.ceil(jobs.length / PER_SITEMAP))
  if (id >= shards) return new Response('Not found', { status: 404 })

  const generatedAt = new Date(index?.generatedAt ?? Date.now()).toISOString()
  let body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`

  // Static routes and company pages ride in the first shard so they are found
  // without a crawler having to walk the whole index.
  if (id === 0) {
    for (const r of STATIC_ROUTES) {
      body += urlEntry(absoluteUrl(r.path), generatedAt, r.changeFrequency, r.priority)
    }
    for (const company of index?.companies ?? []) {
      // A company page with nothing on it is a thin page. Only list employers
      // that actually have roles to show.
      if (company.openRoles < 1) continue
      // Employers with more hiring are more useful landing pages, but the
      // spread is kept narrow: priority is a hint about relative importance
      // within this site, not a ranking lever.
      body += urlEntry(
        absoluteUrl(`/companies/${company.slug}`),
        generatedAt,
        'daily',
        company.openRoles >= 50 ? 0.7 : 0.6
      )
    }
  }

  for (const job of jobs.slice(id * PER_SITEMAP, (id + 1) * PER_SITEMAP)) {
    // The employer's own posted date. Not the crawl date -- lastModified is
    // read as a claim about the content, and "we looked at it today" is not
    // the same as "it changed today".
    body += urlEntry(absoluteUrl(jobPath(job)), new Date(job.postedAt!).toISOString(), 'weekly', 0.7)
  }

  body += `</urlset>\n`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
