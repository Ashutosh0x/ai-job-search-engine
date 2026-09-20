/**
 * Crawl a SAP SuccessFactors career site.
 *
 *   npx tsx scripts/crawl-successfactors.mjs --host jobs.sap.com --location bangalore
 *   npx tsx scripts/crawl-successfactors.mjs --host jobs.sap.com --all --out data/sap-roles.json
 *
 * SuccessFactors "Career Site Builder" boards render their result table into
 * the HTML — `class="jobTitle"` rows with `/job/...` links — and paginate with
 * `startrow`. That makes them readable without a browser, unlike the legacy
 * career*.successfactors.com RCM portal, which is JavaScript-only.
 *
 * WHY THIS ADAPTER EXISTS
 * -----------------------
 * SAP, and a long tail of large employers, are absent from the corpus because
 * they run SuccessFactors rather than one of the JSON ATS platforms the
 * pipeline already speaks. For Bengaluru specifically, most of the genuinely
 * large employers -- SAP among them -- were simply never crawled.
 *
 * A NOTE ON LOCALITY
 * ------------------
 * This records whatever the board publishes in its location column. Boards
 * state a city ("Bangalore, IN"), and only occasionally a sub-locality. If
 * you are looking for a specific office, filter on what comes back rather
 * than assuming the field carries it -- a search for "Whitefield" against
 * SAP's board returns nothing, because SAP tags those roles "Bangalore".
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const HOST = val('host', 'jobs.sap.com')
const LOCATION = val('location', '')
const QUERY = val('q', '')
const ALL = has('all')
const MAX_PAGES = Number(val('max-pages', '40'))
const OUT = val('out', '')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36'

/** SuccessFactors serves 25 rows per page and pages with `startrow`. */
const PAGE_SIZE = 25

function strip(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchPage(startrow) {
  const params = new URLSearchParams()
  params.set('q', QUERY)
  if (LOCATION) params.set('locationsearch', LOCATION)
  params.set('startrow', String(startrow))

  const url = `https://${HOST}/search/?${params}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

/**
 * Parse one results page.
 *
 * Rows look like:
 *   <td class="colTitle"> <span ...> <a class="jobTitle-link" href="/job/...">Title</a>
 *   <td class="colLocation"> ... </td>
 * The table markup varies between tenants, so this reads each `/job/` anchor
 * and then takes the nearest following location cell rather than assuming a
 * fixed column order.
 */
function parsePage(html) {
  const jobs = []
  const seen = new Set()

  const anchorRe = /<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const m of html.matchAll(anchorRe)) {
    const href = m[1]
    const title = strip(m[2])
    if (!title || seen.has(href)) continue
    seen.add(href)

    // The location cell follows the title anchor in the same row.
    const after = html.slice(m.index, m.index + 2500)
    const locMatch =
      after.match(/class="[^"]*colLocation[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i) ||
      after.match(/class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i)
    const dateMatch = after.match(/class="[^"]*jobDate[^"]*"[^>]*>([\s\S]*?)<\/(?:td|span)>/i)

    jobs.push({
      title,
      url: href.startsWith('http') ? href : `https://${HOST}${href}`,
      location: locMatch ? strip(locMatch[1]) : null,
      postedAt: dateMatch ? strip(dateMatch[1]) : null,
    })
  }

  return jobs
}

/**
 * The board's own stated total, used to stop rather than guess.
 *
 * Must be anchored on SuccessFactors' own results banner. A loose
 * `([\d,]+)\s*Jobs?` matches the first number-then-"Jobs" anywhere in 250 KB
 * of markup -- on jobs.sap.com it hit a nav label and returned 2, so the crawl
 * stopped after one page believing it had everything. A wrong small total is
 * worse than none: it truncates silently and the result looks complete.
 */
function statedTotal(html) {
  const patterns = [
    /Results?\s+1\s*[–-]\s*\d+\s+of\s+([\d,]+)/i,   // "Results 1 – 25 of 1,234"
    /\bof\s+([\d,]+)\s+(?:Jobs?|Results?|Positions?)\b/i,
    /searchResultsCount[^\d]{0,20}([\d,]+)/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m) {
      const n = Number(m[1].replace(/,/g, ''))
      // A total smaller than one page contradicts a full page of results.
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/* ----------------------------------- run ----------------------------------- */

console.log(`Crawling ${HOST}${LOCATION ? ` location="${LOCATION}"` : ''}${QUERY ? ` q="${QUERY}"` : ''}\n`)

const all = []
const seenUrls = new Set()
let total = null

for (let page = 0; page < MAX_PAGES; page++) {
  const startrow = page * PAGE_SIZE
  let html
  try {
    html = await fetchPage(startrow)
  } catch (err) {
    console.error(`  page ${page + 1}: ${err.message}`)
    break
  }

  if (total === null) {
    total = statedTotal(html)
    if (total !== null) console.log(`  board states ${total.toLocaleString('en-US')} matching roles`)
  }

  const jobs = parsePage(html)
  const fresh = jobs.filter((j) => !seenUrls.has(j.url))
  for (const j of fresh) seenUrls.add(j.url)
  all.push(...fresh)

  console.log(`  page ${String(page + 1).padStart(2)}  +${fresh.length} (${all.length} total)`)

  // A page that adds nothing new means the board is repeating itself, which is
  // what SuccessFactors does past the last page rather than returning empty.
  if (fresh.length === 0) break
  // Only trust the stated total once it is at least consistent with what we
  // have actually collected; see statedTotal() for why it can be nonsense.
  if (total !== null && total >= all.length && all.length >= total) break

  // Deliberate pacing: this is someone else's careers site.
  await new Promise((r) => setTimeout(r, 900))
}

/* ---------------------------------- report --------------------------------- */

console.log(`\n${'='.repeat(60)}`)
console.log(`${all.length} roles from ${HOST}`)
console.log('='.repeat(60))

const byLocation = {}
for (const j of all) {
  const key = j.location || '(no location stated)'
  byLocation[key] = (byLocation[key] ?? 0) + 1
}

console.log('\nBy location as the board states it:')
Object.entries(byLocation).sort((a, b) => b[1] - a[1]).slice(0, 25)
  .forEach(([loc, n]) => console.log(`  ${String(n).padStart(4)}  ${loc}`))

/**
 * Whitefield detection, by POSTAL CODE rather than by name.
 *
 * This is the whole reason the adapter was worth writing. SuccessFactors
 * publishes "Bangalore, IN, 560066" — the locality is in the PIN, and no
 * board anywhere writes the word "Whitefield" in its location field. Matching
 * on the name returns zero for a board where 31 of 35 roles are in Whitefield.
 *
 * 560066 is Whitefield/ITPL; 560067, 560087 and 560048 cover the adjoining
 * Kadugodi, Brookefield and ITPL Main Road stretches.
 */
const WHITEFIELD_PINS = /\b(560066|560067|560087|560048)\b/

const localityHits = all.filter((j) =>
  WHITEFIELD_PINS.test(j.location || '') ||
  /whitefield|itpl|international tech park|epip/i.test(`${j.location} ${j.title}`)
)

console.log(`\nRoles in the Whitefield area (by PIN or name): ${localityHits.length} of ${all.length}`)
localityHits.slice(0, 20).forEach((j) => console.log(`  ${j.title.slice(0, 56).padEnd(58)}${j.location}`))
if (localityHits.length > 20) console.log(`  … and ${localityHits.length - 20} more`)

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    host: HOST,
    location: LOCATION || null,
    crawledAt: new Date().toISOString(),
    statedTotal: total,
    collected: all.length,
    byLocation,
    jobs: all,
  }, null, 2))
  console.log(`\nWrote ${OUT}`)
}
