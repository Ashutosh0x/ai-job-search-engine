/**
 * Crawl a career site that publishes a sitemap of job pages, reading
 * schema.org JobPosting off each page.
 *
 *   node scripts/crawl-sitemap-board.mjs \
 *     --sitemap https://apply.careers.microsoft.com/careers/sitemap.xml \
 *     --company Microsoft --out microsoft-roles.txt
 *
 * WHY A SITEMAP AND NOT AN API
 * ----------------------------
 * Some large employers have no readable JSON feed. Microsoft is the case this
 * was written for: it runs Eightfold, but its instance answers
 * `403 Not authorized for PCSX` to the standard /api/apply/v2/jobs endpoint
 * that HSBC, Netflix and Bayer serve openly, and the older
 * gcsservices.careers.microsoft.com host is retired -- it now presents a
 * *.azureedge.net certificate and returns a 404 page.
 *
 * What is still public is the sitemap the company publishes for search
 * engines, plus the schema.org JobPosting block each job page carries for the
 * same reason. That is a documented, intended-for-machines route, and it is
 * the same sitemap + schema.org approach this repo already uses for eBay.
 *
 * ONE REQUEST PER ROLE
 * --------------------
 * A JSON board returns hundreds of roles in one call; this costs one page
 * fetch each, so it is slow and deliberately rate-limited. The sitemap alone
 * yields the title and location (both are encoded in the URL slug), so
 * --fast skips the per-page fetch when structured fields are not needed.
 */
import { writeFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const SITEMAP = val('sitemap', '')
const COMPANY = val('company', 'unknown')
const OUT = val('out', `${COMPANY.toLowerCase().replace(/\W+/g, '-')}-roles.txt`)
const CONCURRENCY = Number(val('concurrency', 6))
const LIMIT = Number(val('limit', 0))
const FAST = has('fast')
/** Milliseconds to wait after each page fetch. Microsoft starts returning 403
 *  under sustained load, and the only fix that works is asking more slowly. */
const DELAY = Number(val('delay', 0))

if (!SITEMAP) { console.error('need --sitemap'); process.exit(1) }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/**
 * Returns page text, or one of two sentinels:
 *   null      the posting is genuinely gone (404/410)
 *   BLOCKED   the site refused us (403/429) -- our problem, not a closed role
 *
 * TELLING THESE APART IS THE WHOLE POINT.
 * Microsoft answers 403 once it decides you are crawling too fast, and the
 * first version of this script counted 403 as "gone". Two runs five minutes
 * apart reported 887 then 1,125 roles closed -- and a URL that had returned a
 * JobPosting minutes earlier was in the second batch. Nothing had closed; we
 * were being throttled, and the report was calling live roles expired.
 *
 * A 403 is therefore retried with long backoff and, if it persists, counted
 * and reported as blocked so the coverage line stays honest.
 */
const BLOCKED = Symbol('blocked')

async function get(url, tries = 4, timeoutMs = 40000) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } })
      if (r.status === 404 || r.status === 410) return null
      if (r.status === 403 || r.status === 429) {
        if (i === tries - 1) return BLOCKED
        // Long, growing backoff: a rate limiter wants quiet, not a fast retry.
        await new Promise((res) => setTimeout(res, 15000 * (i + 1) + Math.random() * 5000))
        continue
      }
      if (r.status >= 500) throw new Error(`http ${r.status}`)
      if (!r.ok) return null
      return await r.text()
    } catch {
      if (i === tries - 1) return undefined
      await new Promise((res) => setTimeout(res, 2000 * (i + 1) + Math.random() * 1000))
    } finally { clearTimeout(t) }
  }
}

/* ------------------------------- sitemap ---------------------------------- */

console.log(`sitemap: ${SITEMAP}`)
const xml = await get(SITEMAP, 3, 90000)
if (!xml) { console.error('sitemap unreadable'); process.exit(1) }

let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
// Nested sitemap index: follow one level.
if (/<sitemapindex/i.test(xml)) {
  const nested = []
  for (const s of urls) {
    const sub = await get(s, 3, 90000)
    if (sub) nested.push(...[...sub.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()))
  }
  urls = nested
}

const jobUrls = urls.filter((u) => /\/job[s]?\//.test(u))
console.log(`${urls.length} urls in sitemap, ${jobUrls.length} look like job pages`)
const targets = LIMIT ? jobUrls.slice(0, LIMIT) : jobUrls

/**
 * Title and location are both in the slug, e.g.
 *   /job/1970393556875000-cost-management-campus-lead-united-states-maryland-annapolis-junction
 * The id is numeric and leading; everything after it is words. The split
 * between title and place is not marked, so this is only the fallback -- the
 * schema.org block on the page is authoritative when we fetch it.
 */
function fromSlug(url) {
  const m = url.match(/\/job\/(\d+)-([^?#]+)/)
  if (!m) return { id: '', slug: '' }
  return { id: m[1], slug: m[2].replace(/-/g, ' ') }
}

/** Pull the JobPosting object out of the page's ld+json blocks. */
function schemaOf(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])]
      const jp = nodes.find((n) => n && n['@type'] === 'JobPosting')
      if (jp) return jp
    } catch { /* a malformed block must not stop the others */ }
  }
  return null
}

/**
 * schema.org address fields are "Text or Thing", so any of them can arrive as
 * a string, as {name}, or as {@type, value}. Coercing with String() turned 19
 * Microsoft roles into "[object Object]" -- a location that looks like data
 * and is not. Read the known text-bearing keys, and return '' rather than
 * emit a placeholder.
 */
const asText = (v) => {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') return asText(v.name ?? v.value ?? v['@value'] ?? v.alternateName ?? '')
  return ''
}

const placeOf = (jp) => {
  const locs = Array.isArray(jp.jobLocation) ? jp.jobLocation : [jp.jobLocation].filter(Boolean)
  const parts = locs.map((l) => {
    const a = l?.address || {}
    // Microsoft writes the country into addressRegion as well as
    // addressCountry, so the naive join gives "Redmond, WA,US, US". Splitting
    // every field on commas and deduping fixes that without assuming a shape.
    const bits = [a.addressLocality, a.addressRegion, a.addressCountry]
      .map(asText)
      .filter(Boolean)
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set(bits)].join(', ')
  }).filter(Boolean)
  return [...new Set(parts)].join(' | ')
}

/* -------------------------------- crawl ----------------------------------- */

const roles = []
let done = 0, ok = 0, dead = 0, unreachable = 0, blocked = 0

if (FAST) {
  for (const u of targets) {
    const { id, slug } = fromSlug(u)
    roles.push({ id, title: slug, location: '', posted: '', employmentType: '', url: u, via: 'sitemap-slug' })
  }
  ok = roles.length
} else {
  const queue = [...targets]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const u = queue.shift()
      const html = await get(u)
      if (DELAY) await new Promise((r) => setTimeout(r, DELAY))
      done++
      if (html === BLOCKED) blocked++
      else if (html === undefined) unreachable++
      else if (html === null) dead++
      else {
        const jp = schemaOf(html)
        const { id, slug } = fromSlug(u)
        if (jp) {
          ok++
          roles.push({
            id: jp.identifier?.value || id,
            title: asText(jp.title) || slug,
            location: placeOf(jp),
            posted: (jp.datePosted || '').slice(0, 10),
            employmentType: Array.isArray(jp.employmentType) ? jp.employmentType.join(', ') : (jp.employmentType || ''),
            url: u,
            via: 'schema.org',
          })
        } else {
          // The page answered but carried no JobPosting block. Keep the role
          // with what the URL gives rather than dropping it silently, and say
          // which fields are weaker.
          ok++
          roles.push({ id, title: slug, location: '', posted: '', employmentType: '', url: u, via: 'sitemap-slug' })
        }
      }
      if (done % 25 === 0 || done === targets.length) {
        process.stdout.write(`  ${done}/${targets.length}  ${ok} read, ${dead} gone, ${unreachable} unreachable\r`)
      }
    }
  }))
  process.stdout.write('\n')
}

/* -------------------------------- report ---------------------------------- */

const viaSchema = roles.filter((r) => r.via === 'schema.org').length
const byLoc = new Map()
for (const r of roles) {
  const k = r.location || '(location only in url slug)'
  byLoc.set(k, (byLoc.get(k) || 0) + 1)
}

const lines = []
lines.push(`# ${COMPANY} -- all open roles`)
lines.push(`# source: ${SITEMAP}`)
lines.push(`# generated ${new Date().toISOString()}`)
lines.push(`# ${roles.length} roles (${viaSchema} with schema.org fields, ${roles.length - viaSchema} from the url slug only)`)
if (dead) lines.push(`# ${dead} postings gone (404) -- closed since the sitemap was built`)
if (blocked) {
  lines.push(`# ${blocked} pages BLOCKED (403) -- the site rate-limited this crawl, so those`)
  lines.push(`#   roles are missing from this file and are NOT known to be closed.`)
  lines.push(`#   Re-run with a lower --concurrency and a --delay to reach them.`)
}
if (unreachable) lines.push(`# ${unreachable} never answered`)
lines.push('')
lines.push('## BY LOCATION')
for (const [loc, n] of [...byLoc].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  lines.push(`   ${String(n).padStart(4)}  ${loc}`)
}
if (byLoc.size > 40) lines.push(`   ... and ${byLoc.size - 40} more locations`)
lines.push('')
lines.push('## ALL ROLES')
lines.push('')
for (const r of roles.sort((a, b) => (b.posted || '').localeCompare(a.posted || '') || a.title.localeCompare(b.title))) {
  lines.push(`  ${r.title}`)
  if (r.location) lines.push(`    location : ${r.location}`)
  if (r.employmentType) lines.push(`    type     : ${r.employmentType}`)
  if (r.posted) lines.push(`    posted   : ${r.posted}`)
  lines.push(`    url      : ${r.url}`)
  lines.push('')
}

writeFileSync(OUT, lines.join('\n'))
writeFileSync(OUT.replace(/\.txt$/, '.json'), JSON.stringify({ company: COMPANY, sitemap: SITEMAP, count: roles.length, roles }, null, 2))
console.log(`${roles.length} roles -> ${OUT}`)
