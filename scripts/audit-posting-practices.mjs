/**
 * Audit employer posting behaviour across the crawled corpus.
 *
 *   node --max-old-space-size=4096 scripts/audit-posting-practices.mjs
 *
 * WHAT THIS IS FOR
 * ----------------
 * A job board's counts are produced by employers, and some of that production
 * is not hiring. Résumé-collection reqs that no one is hired into, one opening
 * advertised as forty, and agency listings that hide whose job it actually is
 * all inflate what a searcher sees. None of it is detectable from a single
 * posting -- it only shows up across a whole board, which is what a full crawl
 * gives us.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not call anything shady. Every pattern below has an innocent
 * explanation available -- a role genuinely open in four cities, a graduate
 * scheme that really does take applications year-round -- so the output is
 * ranked evidence for a human to read, not a verdict. The counts are the
 * finding; the motive is not ours to assert.
 *
 * It also does not report staleness, ghost-job age, salary transparency or
 * description quality, all of which are the obvious things to want here.
 * Workday's list endpoint returns no posted date for 99.6% of the corpus and
 * no description at all, so every one of those measures would be computed from
 * absent data. An audit that invents its own evidence is worse than no audit.
 *
 * SCOPE
 * -----
 * Reads data/workday/workday-jobs.ndjson -- the Workday tenants this repo can
 * name. Deduped by URL, last write wins, matching the crawler's own reporting.
 */

import { createReadStream, writeFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'

const IN = 'data/workday/workday-jobs.ndjson'
const OUT = 'data/workday/posting-practices.txt'
const OUT_JSON = 'data/workday/posting-practices.json'

if (!existsSync(IN)) {
  console.error(`no corpus at ${IN} -- run scripts/crawl-all-workday.mjs first`)
  process.exit(1)
}

/**
 * Titles that advertise no specific opening.
 *
 * These are real and common: a posting that exists to collect CVs into a pool.
 * That is not fraud -- many are labelled honestly -- but a searcher counting
 * openings is counting these too, and they can never be "applied to" in the
 * sense the count implies. Matched on the title alone, which is the only field
 * populated across the whole corpus.
 */
const PIPELINE_RE = new RegExp([
  'general\\s+application', 'speculative', 'talent\\s+(community|pool|network|pipeline)',
  'expression\\s+of\\s+interest', 'future\\s+(opening|opportunit|vacanc)',
  'candidate\\s+pool', 'open\\s+application', 'join\\s+our\\s+talent',
  'register\\s+your\\s+interest', 'prospective\\s+applicant', 'we\\s+are\\s+always\\s+hiring',
  'submit\\s+your\\s+(cv|resume)', 'evergreen\\s+req',
].join('|'), 'i')

/** Wording that hides which employer the job is actually at. */
const UNDISCLOSED_RE = /\b(confidential|undisclosed|client\s+of|our\s+client|unnamed\s+client|leading\s+(?:global\s+)?(?:client|company|firm))\b/i

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const seen = new Set()
let total = 0

const byTenant = new Map()                 // tenant -> count
const pipelineByTenant = new Map()         // tenant -> [titles]
const undisclosedByTenant = new Map()
const reqSpread = new Map()                // tenant|req -> Set(url)
const titleSpread = new Map()              // tenant|normTitle -> Set(location)
const titleCount = new Map()               // tenant|normTitle -> count

const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity })
for await (const line of rl) {
  if (!line.trim()) continue
  let j
  try { j = JSON.parse(line) } catch { continue }
  if (!j.url || seen.has(j.url)) continue
  seen.add(j.url)
  total++

  const tenant = j.tenant ?? '?'
  byTenant.set(tenant, (byTenant.get(tenant) ?? 0) + 1)

  const title = String(j.title ?? '')
  if (PIPELINE_RE.test(title)) {
    if (!pipelineByTenant.has(tenant)) pipelineByTenant.set(tenant, [])
    const l = pipelineByTenant.get(tenant)
    if (l.length < 5) l.push(title)
    else l.push(null)                      // keep counting without keeping strings
  }
  if (UNDISCLOSED_RE.test(title)) {
    if (!undisclosedByTenant.has(tenant)) undisclosedByTenant.set(tenant, [])
    const l = undisclosedByTenant.get(tenant)
    if (l.length < 5) l.push(title)
    else l.push(null)
  }

  /**
   * One requisition, many postings.
   *
   * The requisition is recomputed FROM THE URL, not read from the stored
   * `requisitionId`. The first run of this audit reported that 253,114
   * postings -- 40% of the corpus -- reused a requisition, which read as
   * employers inflating their boards. It was our own bug: the adapter took the
   * id from `bulletFields[0]`, which on many tenants is an employment type or
   * a city, so "Regular Employee", "Permanent" and "Texas" were being counted
   * as requisitions shared by thousands of postings. Thales alone had 4,760
   * postings under the "requisition" Regular Employee.
   *
   * The adapter is fixed (see workdayRequisition in lib/sources/adapters/ats.ts)
   * but this corpus predates the fix. The URL ends with `_{REQ}` plus an
   * optional `-N` re-post marker, so deriving it here gives the real answer
   * against the data we already have instead of waiting for a full re-crawl.
   */
  const tail = /_([A-Za-z0-9][\w.-]*)$/.exec(String(j.url ?? ''))?.[1]
  if (tail) {
    // Same rule as workdayRequisition: a repost counter is 1-2 digits; a
    // longer trailing number is part of the id (JR2023-22829, R-26-20076).
    const base = tail.replace(/-\d{1,2}$/, '')
    const req = base !== tail && /\d/.test(base) ? base : tail
    const k = `${tenant}	${req}`
    reqSpread.set(k, (reqSpread.get(k) ?? 0) + 1)
  }

  // One title, many locations.
  const nt = norm(title)
  if (nt) {
    const k = `${tenant}	${nt}`
    titleCount.set(k, (titleCount.get(k) ?? 0) + 1)
    if (!titleSpread.has(k)) titleSpread.set(k, new Set())
    const locs = titleSpread.get(k)
    if (locs.size < 200) locs.add(j.location || '(none)')
  }
}

/* ------------------------------- assemble --------------------------------- */

const pipelineRows = [...pipelineByTenant]
  .map(([tenant, list]) => ({
    tenant,
    count: list.length,
    share: byTenant.get(tenant) ? list.length / byTenant.get(tenant) : 0,
    postings: byTenant.get(tenant) ?? 0,
    examples: list.filter(Boolean).slice(0, 3),
  }))
  .sort((a, b) => b.count - a.count)

const undisclosedRows = [...undisclosedByTenant]
  .map(([tenant, list]) => ({
    tenant, count: list.length, postings: byTenant.get(tenant) ?? 0,
    examples: list.filter(Boolean).slice(0, 3),
  }))
  .sort((a, b) => b.count - a.count)

const reqRows = [...reqSpread]
  .filter(([, n]) => n > 1)
  .map(([k, n]) => ({ tenant: k.split('	')[0], req: k.split('	')[1], postings: n }))
  .sort((a, b) => b.postings - a.postings)

const titleRows = [...titleCount]
  .filter(([, n]) => n >= 10)
  .map(([k, n]) => {
    const [tenant, t] = k.split('	')
    const locs = titleSpread.get(k) ?? new Set()
    return { tenant, title: t, postings: n, locations: locs.size, sample: [...locs].slice(0, 3) }
  })
  // A role open in many places is ordinary; the same title repeated in ONE
  // place is the shape worth a look.
  .sort((a, b) => (b.postings / Math.max(b.locations, 1)) - (a.postings / Math.max(a.locations, 1)))

const totalPipeline = pipelineRows.reduce((s, r) => s + r.count, 0)
const totalUndisclosed = undisclosedRows.reduce((s, r) => s + r.count, 0)
const reqInflated = reqRows.reduce((s, r) => s + (r.postings - 1), 0)

/* -------------------------------- report ---------------------------------- */

const L = []
const pct = (n) => `${((100 * n) / total).toFixed(2)}%`
L.push('# POSTING PRACTICES ACROSS THE CRAWLED WORKDAY CORPUS')
L.push(`# generated ${new Date().toISOString()}`)
L.push(`# ${total.toLocaleString()} unique postings across ${byTenant.size.toLocaleString()} tenants`)
L.push('')
L.push('HOW TO READ THIS')
L.push('  Every pattern here has an innocent explanation available. These are')
L.push('  counts, ranked, for a human to judge -- not accusations. What they have')
L.push('  in common is that each one makes a board look like it holds more')
L.push('  opportunity than a searcher can actually apply to.')
L.push('')
L.push('  NOT MEASURED: how long a posting has been open, whether it names a')
L.push('  salary, and whether the description matches the title. Workday returns')
L.push('  no posted date for 99.6% of these postings and no description at all,')
L.push('  so those findings would be computed from data we do not have.')
L.push('')

L.push('=============================================================')
L.push('1. POSTINGS THAT ADVERTISE NO SPECIFIC OPENING')
L.push('=============================================================')
L.push('  Talent pools, speculative applications, "future opportunities". A CV')
L.push('  goes in; no particular job comes out. Counted in the board total all')
L.push('  the same.')
L.push('')
L.push(`  ${totalPipeline.toLocaleString()} postings (${pct(totalPipeline)} of the corpus) across ${pipelineRows.length} tenants`)
L.push('')
L.push('   count   share of board   tenant')
for (const r of pipelineRows.slice(0, 25)) {
  L.push(`  ${String(r.count).padStart(6)}   ${(100 * r.share).toFixed(1).padStart(6)}%  of ${String(r.postings).padStart(6)}   ${r.tenant}`)
  for (const e of r.examples) L.push(`            ${e.slice(0, 90)}`)
}
L.push('')

L.push('=============================================================')
L.push('2. ONE REQUISITION, MANY POSTINGS')
L.push('=============================================================')
L.push('  The requisition id is the employer\'s own identifier for a single')
L.push('  opening. Where one id backs many live postings, the board is showing')
L.push('  one job several times. Legitimate when a role is genuinely open across')
L.push('  sites; at the top of this list the multiples stop looking like that.')
L.push('')
L.push(`  ${reqRows.length.toLocaleString()} requisitions appear more than once, inflating the visible`)
L.push(`  count by ${reqInflated.toLocaleString()} postings (${pct(reqInflated)} of the corpus).`)
L.push('')
L.push('   postings  tenant / requisition')
for (const r of reqRows.slice(0, 25)) {
  L.push(`  ${String(r.postings).padStart(8)}  ${r.tenant} / ${r.req}`)
}
L.push('')

L.push('=============================================================')
L.push('3. THE SAME TITLE, REPEATED IN THE SAME PLACE')
L.push('=============================================================')
L.push('  Ranked by postings-per-location, so a role open in 40 cities sinks and')
L.push('  a title posted 40 times into one city rises. High-volume hiring looks')
L.push('  like this and so does flooding a search page; the count cannot tell')
L.push('  you which, only that it is happening.')
L.push('')
L.push('   postings  locs  per-loc  tenant / title')
for (const r of titleRows.slice(0, 25)) {
  const ratio = (r.postings / Math.max(r.locations, 1)).toFixed(1)
  L.push(`  ${String(r.postings).padStart(8)}  ${String(r.locations).padStart(4)}  ${ratio.padStart(7)}  ${r.tenant} / ${r.title.slice(0, 60)}`)
  L.push(`            e.g. ${r.sample.join(' | ').slice(0, 100)}`)
}
L.push('')

L.push('=============================================================')
L.push('4. POSTINGS THAT DO NOT NAME THE EMPLOYER')
L.push('=============================================================')
L.push('  "Confidential client", "our client", "a leading global firm". The')
L.push('  applicant cannot tell who they would work for, or whether they have')
L.push('  already applied to the same job elsewhere.')
L.push('')
L.push(`  ${totalUndisclosed.toLocaleString()} postings (${pct(totalUndisclosed)}) across ${undisclosedRows.length} tenants`)
L.push('')
for (const r of undisclosedRows.slice(0, 20)) {
  L.push(`  ${String(r.count).padStart(6)}  of ${String(r.postings).padStart(6)}   ${r.tenant}`)
  for (const e of r.examples) L.push(`            ${e.slice(0, 90)}`)
}
L.push('')

writeFileSync(OUT, L.join('\n'))
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  corpus: { postings: total, tenants: byTenant.size },
  notMeasured: ['posting age', 'salary disclosure', 'description quality'],
  pipelinePostings: { total: totalPipeline, tenants: pipelineRows.length, top: pipelineRows.slice(0, 100) },
  requisitionReuse: { requisitions: reqRows.length, inflation: reqInflated, top: reqRows.slice(0, 100) },
  repeatedTitles: { top: titleRows.slice(0, 100) },
  undisclosedEmployer: { total: totalUndisclosed, tenants: undisclosedRows.length, top: undisclosedRows.slice(0, 100) },
}, null, 2))

console.log(L.slice(0, 14).join('\n'))
console.log(`\npipeline postings   : ${totalPipeline.toLocaleString()} (${pct(totalPipeline)})`)
console.log(`requisition reuse   : ${reqRows.length.toLocaleString()} reqs, +${reqInflated.toLocaleString()} postings (${pct(reqInflated)})`)
console.log(`undisclosed employer: ${totalUndisclosed.toLocaleString()} (${pct(totalUndisclosed)})`)
console.log(`\nwrote ${OUT} and ${OUT_JSON}`)
