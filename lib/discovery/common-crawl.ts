/**
 * Board discovery via the Common Crawl URL index.
 *
 * WHY THIS AND NOT GOOGLE DORKING
 * -------------------------------
 * The hard part of aggregating jobs is not reading an ATS API -- those are
 * public and documented -- it is knowing WHICH boards exist. There is no master
 * list of Greenhouse tokens or Workday tenants; you have to find them.
 *
 * The obvious instinct is to Google `site:myworkdayjobs.com` and harvest the
 * results. That does not work in practice and is not permitted in principle:
 *
 *   - Google's Terms of Service prohibit automated querying of Search. The
 *     supported route is the Custom Search JSON API, which is capped at 100
 *     free queries/day and 10 results per query -- 1,000 URLs/day, before the
 *     dedupe that removes most of them.
 *   - SERP scraping gets IP-blocked and CAPTCHA'd quickly, so a pipeline built
 *     on it is unreliable by construction.
 *   - Google returns a ranked *sample*, not an enumeration. It is optimised to
 *     show you the best ten results, which is the opposite of what enumeration
 *     needs.
 *
 * Common Crawl is the better tool for exactly this job. It is an open,
 * web-scale crawl published specifically for programmatic analysis, its URL
 * index is queryable by wildcard host pattern, it paginates to completion, and
 * it returns structured URLs rather than HTML to scrape. Where a dork gives a
 * ranked sample, this gives the set.
 *
 * Discovery is only half of it: every candidate found here is then verified
 * against the provider's live API before it enters the registry (see
 * scripts/discover-boards.mjs). A URL in a year-old crawl proves a board once
 * existed, not that it exists now.
 */

export interface CrawlCandidate {
  provider: string
  token: string
  site?: string
  host?: string
  /** How many distinct crawled URLs pointed at this board. */
  hits: number
}

const INDEX_BASE = 'https://index.commoncrawl.org'
const UA = 'JobSparkAI/1.0 (+https://jobspark.ai; board discovery)'

/** URL shapes that identify each ATS, and how to pull the board id out. */
export const PROVIDER_PATTERNS: {
  provider: string
  urlPattern: string
  extract: (url: string) => { token: string; site?: string; host?: string } | null
}[] = [
  {
    provider: 'workday',
    urlPattern: '*.myworkdayjobs.com/*',
    extract: (url) => {
      // https://{tenant}.{shard}.myworkdayjobs.com/[{locale}/]{site}/...
      const m = url.match(
        /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/i
      )
      if (!m) return null
      const site = m[3]
      // Skip infrastructure paths that are not career sites.
      if (/^(robots\.txt|sitemap|favicon|assets|static|wday)$/i.test(site)) return null
      return { token: m[1].toLowerCase(), site, host: `${m[1].toLowerCase()}.${m[2]}.myworkdayjobs.com` }
    },
  },
  {
    provider: 'greenhouse',
    urlPattern: 'boards.greenhouse.io/*',
    extract: (url) => {
      const m = url.match(/^https?:\/\/boards\.greenhouse\.io\/([a-z0-9_-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(embed|api|assets|favicon|robots\.txt)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'lever',
    urlPattern: 'jobs.lever.co/*',
    extract: (url) => {
      const m = url.match(/^https?:\/\/jobs\.lever\.co\/([a-z0-9_-]+)/i)
      if (!m) return null
      return { token: m[1].toLowerCase() }
    },
  },
  {
    provider: 'ashby',
    urlPattern: 'jobs.ashbyhq.com/*',
    extract: (url) => {
      const m = url.match(/^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(api|assets|_next|favicon\.ico|robots\.txt)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'smartrecruiters',
    urlPattern: 'jobs.smartrecruiters.com/*',
    extract: (url) => {
      const m = url.match(/^https?:\/\/jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/)
      if (!m) return null
      const token = m[1]
      if (/^(oauth|api|assets|favicon\.ico|robots\.txt)$/i.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'recruitee',
    urlPattern: '*.recruitee.com/*',
    extract: (url) => {
      const m = url.match(/^https?:\/\/([a-z0-9-]+)\.recruitee\.com\//i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(www|app|api|help|status|blog)$/.test(token)) return null
      return { token }
    },
  },
]

/** Most recent crawl id, e.g. CC-MAIN-2026-34. */
export async function latestCrawl(): Promise<string> {
  const res = await fetch(`${INDEX_BASE}/collinfo.json`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`collinfo: ${res.status}`)
  const cols = (await res.json()) as { id: string }[]
  if (!cols.length) throw new Error('No Common Crawl collections returned')
  return cols[0].id
}

/**
 * Page through the index for one URL pattern.
 *
 * The index is NDJSON, one record per line, and returns 404 for a pattern with
 * no matches -- which is a normal outcome, not an error.
 */
export async function* queryIndex(
  crawl: string,
  urlPattern: string,
  { maxPages = 20, pageSize = 5000 }: { maxPages?: number; pageSize?: number } = {}
): AsyncGenerator<string> {
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${INDEX_BASE}/${crawl}-index?url=${encodeURIComponent(urlPattern)}` +
      `&output=json&limit=${pageSize}&page=${page}`

    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA } })
    } catch {
      return // network trouble: stop this pattern rather than abort the run
    }

    if (res.status === 404) return // no more pages
    if (!res.ok) return

    const text = await res.text()
    const lines = text.split('\n').filter(Boolean)
    if (lines.length === 0) return

    for (const line of lines) {
      try {
        const rec = JSON.parse(line)
        if (rec.url) yield rec.url as string
      } catch {
        // Index rows are occasionally truncated; skip rather than fail.
      }
    }

    if (lines.length < pageSize) return
    // Be a considerate client of a free public service.
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Discover candidate boards for one provider. */
export async function discoverProvider(
  crawl: string,
  providerName: string,
  opts?: { maxPages?: number }
): Promise<CrawlCandidate[]> {
  const spec = PROVIDER_PATTERNS.find((p) => p.provider === providerName)
  if (!spec) return []

  const found = new Map<string, CrawlCandidate>()

  for await (const url of queryIndex(crawl, spec.urlPattern, opts)) {
    const parsed = spec.extract(url)
    if (!parsed) continue
    const key = `${parsed.token}|${parsed.site ?? ''}`
    const existing = found.get(key)
    if (existing) {
      existing.hits++
    } else {
      found.set(key, { provider: providerName, hits: 1, ...parsed })
    }
  }

  // Rank by how often the board appeared: a real careers site is linked and
  // crawled repeatedly, a one-off URL usually is not.
  return [...found.values()].sort((a, b) => b.hits - a.hits)
}
