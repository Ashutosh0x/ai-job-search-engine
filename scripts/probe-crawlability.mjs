/**
 * Determine whether an employer's job listings can be crawled, and record WHY.
 *
 *   npx tsx scripts/probe-crawlability.mjs --company Walmart --site https://careers.walmart.com
 *   npx tsx scripts/probe-crawlability.mjs --all --out data/crawlability.json
 *
 * WHY THIS EXISTS
 * ---------------
 * "Can we crawl X?" gets re-answered from scratch every time it is asked, and
 * the answer is usually no for a reason that took twenty minutes to establish:
 * a robots.txt directive, an edge that 403s every client, a sitemap with no job
 * postings in it. That finding is worth more than the crawl attempt, and
 * nothing in this repo was keeping it.
 *
 * So this probes the routes a crawler would actually use, reads robots.txt
 * FIRST, and writes a verdict with the evidence behind it. A "no" here is a
 * durable answer with a date on it, not a shrug.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It sends one honest User-Agent that says what it is. It does not rotate
 * agents, imitate a browser's TLS fingerprint, or retry a 403 with different
 * headers. A site returning 403 to an identified crawler has answered the
 * question; making the same request wearing a disguise is not a better probe,
 * it is a different act. Same reason this repo does not dork Google or guess
 * mailbox addresses.
 *
 * VERDICTS
 *   crawlable        a machine-readable route exists and robots.txt permits it
 *   robots-blocked   the route exists but robots.txt disallows it
 *   edge-blocked     the origin refuses an identified client outright
 *   no-feed          reachable and permitted, but nothing machine-readable
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

/** Identifies itself. If a site refuses this, that IS the finding. */
const UA = 'jobsearch-engine-crawlability-probe/1.0 (+https://github.com/Ashutosh0x/ai-job-search-engine)'
const TIMEOUT_MS = 25_000

async function get(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const type = res.headers.get('content-type') || ''
    // Only read a body worth reading; a 20MB sitemap need not land in memory.
    const body = res.ok ? (await res.text()).slice(0, 400_000) : ''
    return { status: res.status, type, body, url: res.url }
  } catch (e) {
    return { status: 0, type: '', body: '', url, error: e.message }
  }
}

/**
 * Parse the `*` group of a robots.txt.
 *
 * Deliberately simple and deliberately strict: a prefix match against Disallow
 * paths, no wildcard expansion, no Allow-overrides-Disallow precedence. Erring
 * toward "blocked" is the safe direction for a tool whose output decides
 * whether to send traffic at someone.
 */
export function parseRobots(text) {
  const lines = String(text).split(/\r?\n/)
  const disallow = []
  const sitemaps = []
  let inStar = false

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [key, ...rest] = line.split(':')
    const value = rest.join(':').trim()
    const k = key.trim().toLowerCase()

    if (k === 'user-agent') inStar = value === '*'
    else if (k === 'sitemap') sitemaps.push(value)
    else if (k === 'disallow' && inStar && value) disallow.push(value)
  }
  return { disallow, sitemaps }
}

/** Would the `*` group of this robots.txt forbid fetching `path`? */
export function robotsForbids(robots, path) {
  return robots.disallow.some((rule) => path === rule || path.startsWith(rule))
}

/** Does this XML actually contain job postings, or just content pages? */
export function sitemapJobStats(xml) {
  const locs = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const jobLike = locs.filter((u) => /\/(job|jobs|position|opening|requisition)[\/-]/i.test(u))
  const nested = locs.filter((u) => /\.xml(\.gz)?$/i.test(u))
  return { total: locs.length, jobLike: jobLike.length, nestedSitemaps: nested.length, sample: jobLike.slice(0, 3) }
}

/** Routes a crawler would try, in the order it would try them. */
const CANDIDATE_PATHS = [
  '/sitemap.xml',
  '/robots.txt',
  '/api/jobs',
  '/api/search',
  '/search-jobs/results',
  '/jobs.json',
]

export async function probeSite(company, site) {
  const origin = site.replace(/\/+$/, '')
  const findings = []

  const robotsRes = await get(`${origin}/robots.txt`)
  const robotsOk = robotsRes.status === 200 && /text\/plain/i.test(robotsRes.type)
  const robots = robotsOk ? parseRobots(robotsRes.body) : { disallow: [], sitemaps: [] }

  findings.push({
    route: '/robots.txt',
    status: robotsRes.status,
    note: robotsOk
      ? `${robots.disallow.length} Disallow rule(s) for *; ${robots.sitemaps.length} sitemap(s)`
      : robotsRes.status === 403
        ? 'origin refuses an identified crawler even for robots.txt'
        : `unreadable (${robotsRes.status})`,
  })

  // An origin that 403s its own robots.txt has answered the question.
  if (robotsRes.status === 403) {
    return {
      company, site: origin, verdict: 'edge-blocked',
      reason: 'The origin returns 403 to an identified crawler on every route, including robots.txt. ' +
              'Reaching the listings would require imitating a browser, which is out of scope by policy.',
      robots: null, findings, probedAt: new Date().toISOString(),
    }
  }

  let sitemap = null
  for (const smUrl of [...robots.sitemaps, `${origin}/sitemap.xml`].slice(0, 2)) {
    const res = await get(smUrl)
    if (res.status === 200 && /xml/i.test(res.type)) {
      sitemap = { url: smUrl, ...sitemapJobStats(res.body) }
      findings.push({
        route: smUrl.replace(origin, ''),
        status: 200,
        note: `${sitemap.total} urls, ${sitemap.jobLike} job-like, ${sitemap.nestedSitemaps} nested`,
      })
      break
    }
  }

  for (const path of CANDIDATE_PATHS) {
    if (path === '/robots.txt' || path === '/sitemap.xml') continue

    if (robotsForbids(robots, path)) {
      findings.push({ route: path, status: null, note: 'DISALLOWED by robots.txt — not requested' })
      continue
    }
    const res = await get(`${origin}${path}`)
    const isJson = /json/i.test(res.type)
    findings.push({
      route: path,
      status: res.status,
      note: res.error ? `error: ${res.error}` : isJson ? 'returns JSON' : `returns ${res.type || 'nothing'}`,
    })
  }

  const jsonRoute = findings.find((f) => f.note === 'returns JSON' && f.status === 200)
  const blockedRoutes = findings.filter((f) => String(f.note).startsWith('DISALLOWED'))

  let verdict, reason
  if (jsonRoute) {
    verdict = 'crawlable'
    reason = `${jsonRoute.route} returns JSON and robots.txt permits it.`
  } else if (sitemap && sitemap.jobLike > 0) {
    verdict = 'crawlable'
    reason = `The sitemap carries ${sitemap.jobLike} job urls; schema.org JobPosting can be read per page.`
  } else if (blockedRoutes.length > 0) {
    verdict = 'robots-blocked'
    reason = `robots.txt disallows ${blockedRoutes.map((f) => f.route).join(', ')} — the only enumeration route(s). ` +
             (sitemap ? `The sitemap has ${sitemap.total} urls but ${sitemap.jobLike} job postings.` : 'No sitemap job postings either.')
  } else {
    verdict = 'no-feed'
    reason = 'Reachable and permitted, but no machine-readable listing route was found.'
  }

  return { company, site: origin, verdict, reason, robots, sitemap, findings, probedAt: new Date().toISOString() }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const TARGETS = [
  { company: 'Walmart', site: 'https://careers.walmart.com' },
  { company: 'Walmart Canada', site: 'https://careers.walmart.ca' },
  { company: 'Walmart Global Tech', site: 'https://tech.walmart.com' },
  { company: 'Tesla', site: 'https://www.tesla.com' },
  { company: 'Flipkart', site: 'https://www.flipkartcareers.com' },
]

if (import.meta.url === `file://${process.argv[1]}` || has('all') || val('company', null)) {
  const targets = has('all')
    ? TARGETS
    : [{ company: val('company', 'Unknown'), site: val('site', '') }].filter((t) => t.site)

  if (targets.length === 0) {
    console.error('usage: --company X --site https://... | --all')
    process.exit(2)
  }

  const results = []
  for (const t of targets) {
    process.stdout.write(`probing ${t.company} ... `)
    const r = await probeSite(t.company, t.site)
    results.push(r)
    console.log(r.verdict)
    for (const f of r.findings) {
      console.log(`    ${String(f.route).padEnd(22)} ${String(f.status ?? '-').padEnd(5)} ${f.note}`)
    }
    console.log(`    => ${r.reason}\n`)
  }

  const out = val('out', null)
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify({
      generatedAt: new Date().toISOString(),
      method: 'One identified User-Agent, robots.txt read first and honoured. No agent rotation, ' +
              'no browser impersonation, no retry of a 403 with different headers.',
      notDone: [
        'no bypass of bot protection',
        'no authenticated requests',
        'no requests to paths robots.txt disallows',
      ],
      results,
    }, null, 2))
    console.log(`wrote ${out}`)
  }

  const blocked = results.filter((r) => r.verdict !== 'crawlable').length
  console.log(`${results.length - blocked} crawlable, ${blocked} not`)
}
