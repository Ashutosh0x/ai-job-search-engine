import type { MetadataRoute } from 'next'
import { loadIndex, jobPath, type IndexedJob } from '@/lib/job-index'
import { absoluteUrl } from '@/lib/site'

/**
 * XML sitemap.
 *
 * The site had none, which for a job board is most of the SEO problem: a
 * crawler's only route to a posting was a link from a listing page, and until
 * job detail pages existed there were no posting URLs to link to at all.
 *
 * WHAT GOES IN, AND WHAT DELIBERATELY DOES NOT
 * --------------------------------------------
 * Only pages we are asking to have indexed. A sitemap entry is a request to
 * index; listing a URL that also sends `noindex` is a contradiction, and a
 * sitemap full of thin pages devalues the ones that are not.
 *
 * The job page applies `noindex` to any posting with no date or under 50
 * characters of description, so the same rule selects entries here. Measured
 * over the 113,416-posting served index: 39,868 qualify (35.2%). The other
 * two thirds stay crawlable and linked -- they are simply not submitted.
 *
 * SHARDING
 * --------
 * The sitemap protocol caps a file at 50,000 URLs, and the qualifying set is
 * already 39,868 against a corpus designed to keep growing. `generateSitemaps`
 * emits a sitemap index plus numbered shards, so passing that cap adds a shard
 * instead of silently truncating.
 */

/** Well under the protocol's 50,000 so a shard never has to be split late. */
const PER_SITEMAP = 20_000

/** Pages that exist regardless of the index, highest value first. */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1.0, changeFrequency: 'daily' },
  { path: '/explore-jobs', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/jobs', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/companies', priority: 0.8, changeFrequency: 'daily' },
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
async function indexableJobs(): Promise<IndexedJob[]> {
  const index = await loadIndex()
  if (!index) return []
  return index.jobs
    .filter(isIndexable)
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
}

export async function generateSitemaps() {
  const jobs = await indexableJobs()
  // Shard 0 always exists, even with no index, so /sitemap.xml is never a 404.
  const shards = Math.max(1, Math.ceil(jobs.length / PER_SITEMAP))
  return Array.from({ length: shards }, (_, id) => ({ id }))
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const index = await loadIndex()
  const jobs = await indexableJobs()

  const entries: MetadataRoute.Sitemap = []

  // Static routes and company pages ride in the first shard so they are found
  // without a crawler having to walk the whole index.
  if (id === 0) {
    for (const r of STATIC_ROUTES) {
      entries.push({
        url: absoluteUrl(r.path),
        lastModified: index ? new Date(index.generatedAt) : new Date(),
        changeFrequency: r.changeFrequency,
        priority: r.priority,
      })
    }

    for (const company of index?.companies ?? []) {
      // A company page with nothing on it is a thin page. Only list employers
      // that actually have roles to show.
      if (company.openRoles < 1) continue
      entries.push({
        url: absoluteUrl(`/companies/${company.slug}`),
        lastModified: index ? new Date(index.generatedAt) : new Date(),
        changeFrequency: 'daily',
        // Employers with more hiring are more useful landing pages, but the
        // spread is kept narrow: priority is a hint about relative importance
        // within this site, not a ranking lever.
        priority: company.openRoles >= 50 ? 0.7 : 0.6,
      })
    }
  }

  for (const job of jobs.slice(id * PER_SITEMAP, (id + 1) * PER_SITEMAP)) {
    entries.push({
      url: absoluteUrl(jobPath(job)),
      // The employer's own posted date. Not the crawl date -- lastModified is
      // read as a claim about the content, and "we looked at it today" is not
      // the same as "it changed today".
      lastModified: new Date(job.postedAt!),
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }

  return entries
}
