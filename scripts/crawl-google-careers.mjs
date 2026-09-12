/**
 * Crawl every posting on Google's careers site, with links.
 *
 *   node scripts/crawl-google-careers.mjs --out google-roles.txt
 *   node scripts/crawl-google-careers.mjs --query "software engineer" --location London
 *
 * WHY THE LISTING PAGES AND NOT A JSON API
 * ----------------------------------------
 * Google's careers site has no public JSON endpoint any more: the old
 * careers.google.com/api/v3/search 404s, and the /about/careers/applications
 * paths answer with the app shell rather than data. What it does serve is
 * fully server-rendered result pages -- title, company, every location and the
 * canonical job link are all in the HTML.
 *
 * That makes the whole corpus reachable in one request per 20 roles (168
 * requests for ~3,356 roles) instead of one request per role, which is both
 * faster and far politer than fetching every detail page.
 *
 * PARSING GOOGLE'S MARKUP IS THE FRAGILE PART
 * -------------------------------------------
 * The class names are compiler-generated (`r0wTof`, `l103df`) and can change
 * without notice. So the anchor is the stable thing -- `href="jobs/results/
 * {id}-{slug}"` plus its `aria-label="Learn more about {Title}"` -- and the
 * cosmetic classes are only used to pull locations out of the card. If the
 * class names change, locations go missing while titles and links keep
 * working, so the run reports how many roles came back without a location
 * rather than quietly emitting blanks.
 */
import { writeFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const OUT = val('out', 'google-roles.txt')
const QUERY = val('query', '')
const LOCATION = val('location', '')
const MAX_PAGES = Number(val('pages', 400))
const DELAY = Number(val('delay', 400))

const BASE = 'https://www.google.com/about/careers/applications/jobs/results'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 45000)
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } })
      if (r.status === 404) return null
      if (r.status === 403 || r.status === 429 || r.status >= 500) throw new Error(`http ${r.status}`)
      if (!r.ok) return null
      return await r.text()
    } catch (e) {
      if (i === tries - 1) { console.error(`  ! ${url}: ${e.message}`); return undefined }
      await new Promise((res) => setTimeout(res, 4000 * (i + 1) + Math.random() * 2000))
    } finally { clearTimeout(t) }
  }
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim()

/**
 * Multi-location cards render as "Atlanta, GA, USA; Austin, TX, USA", and the
 * separator lands inside the second span -- so the raw text is "; Austin, TX,
 * USA". Left alone that produces two distinct "locations" for one city and a
 * location list that sorts wrongly.
 */
const cleanLocation = (s) => decode(s).replace(/^[;,\s]+/, '').replace(/[;,\s]+$/, '').trim()

/**
 * One card per posting. Cards are split on the job anchor, and each card's
 * text before its anchor carries the company and location spans.
 */
function parsePage(html) {
  const out = []
  // Anchor form: href="jobs/results/{id}-{slug}?page=N" aria-label="Learn more about {Title}"
  const re = /href="(jobs\/results\/(\d+)-([a-z0-9-]+))[^"]*"[^>]*aria-label="Learn more about ([^"]+)"/g
  let m
  const marks = []
  while ((m = re.exec(html)) !== null) {
    marks.push({ index: m.index, path: m[1], id: m[2], slug: m[3], title: decode(m[4]) })
  }
  for (let i = 0; i < marks.length; i++) {
    const start = i === 0 ? 0 : marks[i - 1].index
    const card = html.slice(start, marks[i].index)
    const locs = [...card.matchAll(/class="r0wTof[^"]*"[^>]*>([^<]+)</g)].map((x) => cleanLocation(x[1])).filter(Boolean)
    const companyM = card.match(/class="l103df"[^>]*>([^<|]+)\|/)
    // "+N more" means the card truncated the location list; say so rather than
    // presenting a partial list as complete.
    const moreM = card.match(/\+\s*(\d+)\s*more/i)
    out.push({
      id: marks[i].id,
      title: marks[i].title,
      company: companyM ? decode(companyM[1]) : 'Google',
      locations: [...new Set(locs)],
      moreLocations: moreM ? Number(moreM[1]) : 0,
      url: `https://www.google.com/about/careers/applications/${marks[i].path}`,
    })
  }
  return out
}

/* --------------------------------- crawl ---------------------------------- */

const qs = (page) => {
  const u = new URL(BASE)
  u.searchParams.set('page', String(page))
  if (QUERY) u.searchParams.set('q', QUERY)
  if (LOCATION) u.searchParams.set('location', LOCATION)
  return u.toString()
}

const first = await get(qs(1))
if (!first) { console.error('could not read the first results page'); process.exit(1) }
const totalM = first.match(/of ([\d,]+) rows/)
const expected = totalM ? Number(totalM[1].replace(/,/g, '')) : null
console.log(`site reports ${expected ? expected.toLocaleString() : 'an unknown number of'} roles`)

const byId = new Map()
for (const r of parsePage(first)) byId.set(r.id, r)

let page = 2
let emptyPages = 0
while (page <= MAX_PAGES) {
  const html = await get(qs(page))
  if (!html) break
  const rows = parsePage(html)
  if (!rows.length) { if (++emptyPages >= 2) break } else emptyPages = 0
  let fresh = 0
  for (const r of rows) if (!byId.has(r.id)) { byId.set(r.id, r); fresh++ }
  process.stdout.write(`  page ${page}: +${fresh} (${byId.size} unique)\r`)
  // Stop when the site stops giving us anything new, not on a guessed page count.
  if (rows.length && fresh === 0 && page > 3) { emptyPages++; if (emptyPages >= 3) break }
  if (expected && byId.size >= expected) break
  page++
  if (DELAY) await new Promise((r) => setTimeout(r, DELAY))
}
process.stdout.write('\n')

/* -------------------------------- report ---------------------------------- */

const roles = [...byId.values()]
const noLocation = roles.filter((r) => !r.locations.length).length
const truncated = roles.filter((r) => r.moreLocations > 0).length

const byOrg = new Map()
const byLoc = new Map()
for (const r of roles) {
  byOrg.set(r.company, (byOrg.get(r.company) || 0) + 1)
  for (const l of (r.locations.length ? r.locations : ['(no location parsed)'])) {
    byLoc.set(l, (byLoc.get(l) || 0) + 1)
  }
}

const lines = []
lines.push('# Google careers -- all open roles')
lines.push(`# source: ${BASE} (server-rendered listing pages)`)
lines.push(`# generated ${new Date().toISOString()}`)
lines.push(`# ${roles.length} roles collected${expected ? ` of ${expected.toLocaleString()} the site reports` : ''}`)
if (expected && roles.length < expected) {
  lines.push(`# ${expected - roles.length} SHORT -- pagination stopped early; these are missing, not closed.`)
}
if (noLocation) lines.push(`# ${noLocation} roles have no location parsed (Google's class names may have changed)`)
if (truncated) lines.push(`# ${truncated} roles list "+N more" locations the card did not show`)
lines.push('')
lines.push('## BY ORGANISATION')
for (const [o, n] of [...byOrg].sort((a, b) => b[1] - a[1])) lines.push(`   ${String(n).padStart(5)}  ${o}`)
lines.push('')
lines.push('## TOP LOCATIONS')
for (const [l, n] of [...byLoc].sort((a, b) => b[1] - a[1]).slice(0, 30)) lines.push(`   ${String(n).padStart(5)}  ${l}`)
lines.push(`   ... and ${Math.max(0, byLoc.size - 30)} more locations`)
lines.push('')
lines.push('## ALL ROLES')
lines.push('')
for (const r of roles.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title))) {
  lines.push(`  ${r.title}`)
  lines.push(`    org      : ${r.company}`)
  lines.push(`    location : ${r.locations.join(' ; ') || '(not parsed)'}${r.moreLocations ? ` (+${r.moreLocations} more)` : ''}`)
  lines.push(`    url      : ${r.url}`)
  lines.push('')
}

writeFileSync(OUT, lines.join('\n'))
writeFileSync(OUT.replace(/\.txt$/, '.json'), JSON.stringify({
  source: BASE, generatedAt: new Date().toISOString(), expected, collected: roles.length, roles,
}, null, 2))
console.log(`${roles.length} roles -> ${OUT}`)
if (expected && roles.length < expected) console.log(`WARNING: ${expected - roles.length} short of the ${expected} the site reports`)
