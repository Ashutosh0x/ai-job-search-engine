/**
 * Search every known Workday tenant for a role in a given place.
 *
 *   npx tsx scripts/find-workday-roles.mjs --query "technical recruiter" \
 *     --location Argentina --out jobs.txt
 *
 * SCOPE, STATED PLAINLY
 * ---------------------
 * This covers the Workday tenants THIS REPO KNOWS ABOUT -- the curated registry
 * plus everything discovery has found via Common Crawl. That is 350 tenants,
 * not "all of Workday", which runs to tens of thousands of customers. There is
 * no global Workday index to query: each tenant is a separate host with its own
 * search endpoint, and the only way to know a tenant exists is to have found a
 * link to it. Saying "all Workday jobs" would be a claim about coverage that
 * cannot be backed.
 *
 * HOW THE MATCH IS MADE
 * ---------------------
 * `searchText` narrows server-side so each tenant costs a page or two rather
 * than a full crawl. Title and location are then checked locally, because
 * Workday's relevance search is loose -- it will happily return "Recruiting
 * Coordinator" for "recruiter", and a tenant's location facet ids differ per
 * tenant so they cannot be applied generically.
 *
 * Location matching is deliberately conservative. "Argentina" and "Buenos
 * Aires" are unambiguous; "Cordoba", "Rosario" and "Mendoza" are NOT -- they
 * name places in Spain and Mexico too. Matching those would put non-Argentine
 * roles in the output under an Argentina heading, which is the kind of quiet
 * wrongness this codebase treats as worse than a miss.
 */

import { readFileSync, writeFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const QUERY = val('query', 'technical recruiter')
const PLACE = val('location', 'Argentina')
const OUT = val('out', 'jobs.txt')
const CONCURRENCY = Number(val('concurrency', 10))
const MAX_DEPTH = Number(val('depth', 1000))

/** Terms that must appear in the title for the role to count. */
const TITLE_RE = /recruit|talent\s+acquisition|sourcer|talent\s+partner/i
/** Narrower: the user asked for TECHNICAL recruiters specifically. */
const TECHNICAL_RE = /\b(technical|technology|tech|engineering|it|software|r&d)\b/i

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)

const PLACE_RE = {
  argentina: /\bargentina\b|\bbuenos\s+aires\b|\bcaba\b/i,
}[PLACE.toLowerCase()] ?? new RegExp('\\b' + escapeRe(PLACE) + '\\b', 'i')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

async function post(url, body, timeoutMs = 20000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

/* ----------------------------- gather tenants ----------------------------- */

const targets = []
const seen = new Set()
const add = (t) => {
  const key = `${t.host}|${t.token}|${t.site}`
  if (t.host && t.token && t.site && !seen.has(key)) { seen.add(key); targets.push(t) }
}

const reg = readFileSync('lib/companies/registry.ts', 'utf8')
for (const m of reg.matchAll(
  /provider: 'workday', token: '([^']*)', site: '([^']*)', host: '([^']*)'/g
)) add({ token: m[1], site: m[2], host: m[3], name: null })

try {
  const disc = JSON.parse(readFileSync('scripts/discovered-boards.json', 'utf8'))
  for (const b of disc.boards ?? []) {
    if (b.provider === 'workday') add({ token: b.token, site: b.site, host: b.host, name: b.token })
  }
} catch { /* discovery file optional */ }

console.log(`searching ${targets.length} Workday tenants for "${QUERY}" in ${PLACE}\n`)

/* -------------------------------- search ---------------------------------- */

const hits = []
let done = 0, reachable = 0, failed = 0

/**
 * Where a posting says it is.
 *
 * `locationsText` IS OPTIONAL AND ITS ABSENCE IS SILENT. NVIDIA and Barclays
 * populate it; Accenture omits the field entirely and encodes the place in
 * `externalPath` instead (`/job/Pernambuco---Recife/...`). Filtering on
 * `locationsText` alone therefore tested an empty string for those tenants and
 * matched nothing -- the first run of this script reported 0 hits across 340
 * tenants and looked like a clean answer.
 *
 * So the haystack is every field that can carry a place, with the path's dashes
 * flattened to spaces so "Buenos-Aires" matches "buenos aires".
 */
function placeHaystack(j) {
  return [
    String(j.locationsText ?? ''),
    String(j.externalPath ?? '').replace(/[-_/]+/g, ' '),
    Array.isArray(j.bulletFields) ? j.bulletFields.join(' ') : '',
  ].join(' | ')
}

function collect(t, postings) {
  for (const j of postings) {
    const title = String(j.title ?? '')
    if (!TITLE_RE.test(title)) continue
    const where = placeHaystack(j)
    if (!PLACE_RE.test(where)) continue
    const path = String(j.externalPath ?? '')
    if (!path) continue
    hits.push({
      title: title.trim(),
      tenant: t.token,
      host: t.host,
      location: String(j.locationsText ?? '').trim() || path.split('/').filter(Boolean)[1]?.replace(/-+/g, ' ') || '',
      posted: String(j.postedOn ?? '').trim(),
      technical: TECHNICAL_RE.test(title),
      url: `https://${t.host}/${t.site}${path}`,
    })
  }
}

async function searchTenant(t) {
  const endpoint = `https://${t.host}/wday/cxs/${t.token}/${t.site}/jobs`
  let any = false

  // Two searches per tenant, unioned.
  //
  // Workday ORs the words in `searchText` -- "technical recruiter" returns
  // "RELEX Technical Consultant" -- so neither query alone is reliable:
  //
  //   by ROLE  ("recruiter") hits the 2,000 cap on a big tenant, and the
  //            Argentine roles may sit past it.
  //   by PLACE ("Argentina") is far narrower (155 at Accenture vs 2,000) and
  //            reaches roles the role-query would never page to.
  //
  // Running both and deduping by URL gets what either would miss on its own.
  for (const term of [QUERY, PLACE]) {
    // 1,000 deep, not 200. The place-query is the narrow one (155 results at
    // Accenture vs 2,000 for the role-query), so paging it shallowly is what
    // decides whether a match is found at all -- and 200 was not enough to
    // exhaust it at a large tenant. Stays under Workday's 2,000 clamp.
    for (let offset = 0; offset < MAX_DEPTH; offset += 20) {
      const data = await post(endpoint, { appliedFacets: {}, limit: 20, offset, searchText: term })
      if (!data) break
      any = true
      const postings = data.jobPostings ?? []
      if (!postings.length) break
      collect(t, postings)
      if (postings.length < 20) break
    }
  }

  if (any) reachable++; else failed++
  done++
  if (done % 25 === 0) process.stdout.write(`  ${done}/${targets.length} tenants, ${hits.length} hits\r`)
}

const queue = [...targets]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await searchTenant(queue.shift())
}))

/* -------------------------------- report ---------------------------------- */

const uniq = [...new Map(hits.map((h) => [h.url, h])).values()]
  .sort((a, b) => Number(b.technical) - Number(a.technical) || a.tenant.localeCompare(b.tenant))

const technical = uniq.filter((h) => h.technical)

console.log(`\n\ntenants reachable : ${reachable}/${targets.length} (${failed} did not answer)`)
console.log(`recruiting roles in ${PLACE} : ${uniq.length}`)
console.log(`  of which TECHNICAL      : ${technical.length}`)

const lines = []
lines.push(`# ${QUERY} -- ${PLACE}`)
lines.push(`# generated ${new Date().toISOString()}`)
lines.push(`# searched ${targets.length} known Workday tenants (${reachable} answered)`)
lines.push(`# NOT all of Workday: only tenants this repo has discovered. See script header.`)
lines.push(`# ${uniq.length} recruiting roles matched, ${technical.length} of them technical`)
lines.push('')
lines.push('## TECHNICAL RECRUITING ROLES')
lines.push('')
for (const h of technical) {
  lines.push(h.url)
  lines.push(`    ${h.title}  |  ${h.tenant}  |  ${h.location}${h.posted ? `  |  ${h.posted}` : ''}`)
  lines.push('')
}
const other = uniq.filter((h) => !h.technical)
if (other.length) {
  lines.push('## OTHER RECRUITING ROLES IN THE SAME LOCATION')
  lines.push('# Matched "recruiter" but not a technical/engineering qualifier.')
  lines.push('')
  for (const h of other) {
    lines.push(h.url)
    lines.push(`    ${h.title}  |  ${h.tenant}  |  ${h.location}${h.posted ? `  |  ${h.posted}` : ''}`)
    lines.push('')
  }
}

writeFileSync(OUT, lines.join('\n'))
console.log(`\nwrote ${OUT}`)
for (const h of technical.slice(0, 10)) console.log(`  ${h.title}  |  ${h.tenant}  |  ${h.location}`)
