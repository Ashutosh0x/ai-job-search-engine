/**
 * Crawl every posting at the financial institutions in the registry.
 *
 *   npx tsx scripts/crawl-financial-sector.mjs
 *   npx tsx scripts/crawl-financial-sector.mjs --slugs citi,jpmorgan-chase
 *   npx tsx scripts/crawl-financial-sector.mjs --out data/financial
 *
 * WHY A SEPARATE SCRIPT FROM crawl-all-workday.mjs
 * ------------------------------------------------
 * This set is not one platform. JPMorgan and BNY are Oracle Recruiting Cloud,
 * Jane Street is Greenhouse, HSBC is Eightfold, and the rest are Workday --
 * across 24 boards, because several institutions run more than one (Citi has a
 * main and an early-careers site; CBA has four, including Bankwest and x15).
 *
 * Routing is `getAdapter`, so every platform is read by the adapter that knows
 * its protocol -- including Workday's 2,000-result cap, which Citi and others
 * sit above. Board configuration comes from lib/companies/registry.ts rather
 * than a list in this file, so there is one place where a board is defined and
 * this script cannot drift from it.
 *
 * WHAT "ALL JOBS" MEANS HERE
 * --------------------------
 * Every posting each board serves, deduped by application URL. Where a board
 * is capped and cannot be fully read, the run says so per company instead of
 * reporting the truncated number as the total.
 */

import { writeFileSync, mkdirSync, createWriteStream } from 'fs'
import { COMPANIES } from '../lib/companies/registry.ts'
import { getAdapter } from '../lib/sources/registry.ts'
import { httpStats } from '../lib/sources/http.ts'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const OUT_DIR = val('out', 'data/financial')
const CONCURRENCY = Number(val('concurrency', 4))

/** The institutions from the sector table, by registry slug. */
const DEFAULT_SLUGS = [
  'jpmorgan-chase', 'citi', 'bank-of-america', 'wells-fargo', 'bny-mellon',
  'deutsche-bank', 'morgan-stanley', 'mastercard', 'barclays', 'visa', 'mufg',
  'lloyds-banking-group', 'national-australia-bank', 'commonwealth-bank', 'jane-street', 'paypal',
  'natwest', 'standard-chartered', 'hsbc', 'clsa',
]
const SLUGS = (val('slugs', '') || DEFAULT_SLUGS.join(',')).split(',').map((s) => s.trim()).filter(Boolean)

mkdirSync(OUT_DIR, { recursive: true })
const NDJSON = `${OUT_DIR}/financial-jobs.ndjson`
const LINKS = `${OUT_DIR}/financial-links.txt`
const SUMMARY = `${OUT_DIR}/financial-summary.txt`
const BY_COMPANY = `${OUT_DIR}/financial-by-company.json`

/* ------------------------------ build targets ----------------------------- */

const targets = []
const missing = []
for (const slug of SLUGS) {
  const c = COMPANIES.find((x) => x.slug === slug)
  if (!c) { missing.push(slug); continue }
  if (!c.boards?.length) { missing.push(`${slug} (no board configured)`); continue }
  for (const b of c.boards) {
    targets.push({
      slug: c.slug,
      companyName: c.name,
      companyDomain: c.domain,
      provider: b.provider,
      token: b.token,
      site: b.site,
      host: b.host,
    })
  }
}

console.log(`${SLUGS.length} companies -> ${targets.length} boards`)
if (missing.length) console.log(`not crawled: ${missing.join(', ')}`)
console.log('')

/* --------------------------------- crawl ---------------------------------- */

const out = createWriteStream(NDJSON)
const rows = []
let totalJobs = 0
const seenUrls = new Set()
const started = Date.now()

async function crawlBoard(t) {
  const adapter = getAdapter(t.provider, t.token, t.host)
  if (!adapter) {
    rows.push({ ...t, jobs: 0, outcome: 'no-adapter', warnings: [] })
    console.log(`  ${t.companyName.padEnd(22)} ${String(t.provider).padEnd(12)} NO ADAPTER for provider "${t.provider}"`)
    return
  }

  const target = {
    source: t.provider,
    token: t.token,
    site: t.site,
    host: t.host,
    companySlug: t.slug,
    companyName: t.companyName,
    companyDomain: t.companyDomain,
  }

  let jobs = [], warnings = [], error = null
  try {
    // Generous limits: JPMorgan alone is 7,400+ requisitions at 200/page, and
    // Citi needs facet partitioning to get past Workday's 2,000 clamp.
    const r = await adapter.fetchJobs(target, { maxPages: 200, maxRequests: 6000 })
    jobs = r.jobs ?? []
    warnings = r.warnings ?? []
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  let fresh = 0
  const lines = []
  for (const j of jobs) {
    const url = j.applicationUrl
    if (!url || seenUrls.has(url)) continue
    seenUrls.add(url)
    fresh++
    lines.push(JSON.stringify({
      company: t.companyName,
      slug: t.slug,
      platform: adapter.displayName,
      board: t.site ? `${t.token}/${t.site}` : t.token,
      title: j.title,
      location: j.locationRaw ?? '',
      additionalLocations: j.additionalLocations ?? [],
      department: j.department ?? '',
      employmentType: j.employmentType ?? '',
      remote: j.remoteFlag ?? null,
      requisitionId: j.requisitionId ?? '',
      postedAt: j.postedAt ?? '',
      url,
    }))
  }
  if (lines.length) out.write(lines.join('\n') + '\n')

  totalJobs += fresh
  const truncated = warnings.some((w) => /truncat/i.test(w))
  rows.push({
    slug: t.slug, company: t.companyName, platform: adapter.displayName,
    board: t.site ? `${t.token}/${t.site}` : t.token,
    jobs: fresh, rawJobs: jobs.length, truncated, error, warnings: warnings.slice(0, 5),
  })

  console.log(
    `  ${t.companyName.padEnd(22)} ${adapter.displayName.padEnd(22)} ` +
    `${String(fresh).padStart(6)} jobs${truncated ? '  [TRUNCATED]' : ''}${error ? `  ERROR ${error}` : ''}`
  )
}

const queue = [...targets]
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await crawlBoard(queue.shift())
}))
await new Promise((res) => out.end(res))

/* -------------------------------- report ---------------------------------- */

const byCompany = new Map()
for (const r of rows) {
  if (!byCompany.has(r.company)) byCompany.set(r.company, { company: r.company, platform: r.platform, jobs: 0, boards: 0, truncated: false })
  const e = byCompany.get(r.company)
  e.jobs += r.jobs
  e.boards++
  if (r.truncated) e.truncated = true
}
const companyRows = [...byCompany.values()].sort((a, b) => b.jobs - a.jobs)
const grand = companyRows.reduce((s, r) => s + r.jobs, 0)

const stats = httpStats()
const mins = ((Date.now() - started) / 60000).toFixed(1)

const L = []
L.push('# FINANCIAL SECTOR -- ALL POSTINGS')
L.push(`# generated ${new Date().toISOString()} in ${mins} min`)
L.push(`# ${companyRows.length} companies, ${targets.length} boards, ${grand.toLocaleString()} unique postings`)
L.push('')
L.push('   #  company                 platform                 postings   share   cum.')
let cum = 0
companyRows.forEach((r, i) => {
  cum += r.jobs
  L.push(
    `  ${String(i + 1).padStart(2)}  ${r.company.padEnd(22)} ${r.platform.padEnd(22)} ` +
    `${String(r.jobs).padStart(8)}  ${((100 * r.jobs) / grand).toFixed(2).padStart(5)}%  ${((100 * cum) / grand).toFixed(1).padStart(5)}%` +
    (r.truncated ? '   [board capped -- see below]' : '')
  )
})
L.push('')
const trunc = rows.filter((r) => r.truncated)
if (trunc.length) {
  L.push('BOARDS THAT COULD NOT BE READ IN FULL')
  L.push('  Workday clamps a search at 2,000 results. Where a facet partition is')
  L.push('  itself at the cap, part of the board is unreachable and the number')
  L.push('  above is a floor, not a total.')
  for (const r of trunc) {
    L.push(`    ${r.company} (${r.board}) -- ${r.jobs} read`)
    for (const w of r.warnings) L.push(`        ${w}`)
  }
  L.push('')
}
const errs = rows.filter((r) => r.error || r.outcome === 'no-adapter')
if (errs.length) {
  L.push('BOARDS THAT FAILED')
  for (const r of errs) L.push(`    ${r.company ?? r.companyName} (${r.board ?? r.token}) -- ${r.error ?? r.outcome}`)
  L.push('')
}
L.push('PER-BOARD DETAIL')
for (const r of rows.sort((a, b) => b.jobs - a.jobs)) {
  L.push(`  ${String(r.jobs).padStart(7)}  ${String(r.company ?? r.companyName).padEnd(22)} ${String(r.platform ?? r.provider).padEnd(22)} ${r.board ?? r.token}`)
}
L.push('')
L.push('HTTP')
L.push(`  requests ${stats.requests.attempted.toLocaleString()}, ok ${stats.requests.ok.toLocaleString()}, blocked ${stats.requests.blocked}, notFound ${stats.requests.notFound}, success rate ${stats.successRate}`)

writeFileSync(SUMMARY, L.join('\n'))
writeFileSync(BY_COMPANY, JSON.stringify({
  generatedAt: new Date().toISOString(),
  companies: companyRows, boards: rows, totalPostings: grand, http: stats,
}, null, 2))

// Plain link list.
const links = createWriteStream(LINKS)
links.write(`# Every posting at ${companyRows.length} financial institutions\n# generated ${new Date().toISOString()}\n# ${grand} unique application URLs\n\n`)
const { createReadStream } = await import('fs')
const { createInterface } = await import('readline')
for await (const line of createInterface({ input: createReadStream(NDJSON), crlfDelay: Infinity })) {
  if (!line.trim()) continue
  try {
    const j = JSON.parse(line)
    links.write(`${j.url}\n    ${j.title}  |  ${j.company}  |  ${j.location || '(no location)'}${j.postedAt ? `  |  ${j.postedAt.slice(0, 10)}` : ''}\n`)
  } catch { /* skip */ }
}
await new Promise((res) => links.end(res))

console.log('')
console.log(L.slice(3, 3 + companyRows.length + 2).join('\n'))
console.log(`\nwrote ${NDJSON}, ${LINKS}, ${SUMMARY}, ${BY_COMPANY}`)
