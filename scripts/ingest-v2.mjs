/**
 * Multi-source ingestion.
 *
 *   npx tsx scripts/ingest-v2.mjs                       # all discovered boards
 *   npx tsx scripts/ingest-v2.mjs --limit 60            # bounded
 *   npx tsx scripts/ingest-v2.mjs --no-enrich           # prove §36: jobs unaffected
 *   npx tsx scripts/ingest-v2.mjs --sources workday,ashby
 *
 * Writes public/data/jobs-v2.json (index) and .ingest-state.json (cursors and
 * hashes for the next incremental run).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const { runIngest } = await import('../lib/pipeline/orchestrator.ts')
const { COMPANIES } = await import('../lib/companies/registry.ts')
const { getMarketCap } = await import('../lib/companies/market-cap.ts')
const { humanizeToken } = await import('../lib/companies/discovered.ts')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i+1] ? args[i+1] : d }
const has = (n) => args.includes(`--${n}`)

const limit = Number(val('limit', Infinity))
const concurrency = Number(val('concurrency', 8))
const sourceFilter = val('sources', null)?.split(',').map((s) => s.trim())
const doEnrich = !has('no-enrich')
const hydrate = Number(val('hydrate', 0))
const OUT = val('out', 'public/data/jobs-v2.json')
const STATE = '.ingest-state.json'

/* ---------------------------- build target list ---------------------------- */

const targets = []

// Curated companies carry the metadata a machine cannot derive.
for (const c of COMPANIES) {
  for (const b of c.boards) {
    targets.push({
      source: b.provider, token: b.token, site: b.site, host: b.host,
      companySlug: c.slug, companyName: c.name, companyDomain: c.domain,
      discoveredVia: 'curated', confidence: 1,
    })
  }
}

// Auto-discovered, already API-verified boards.
if (existsSync('scripts/discovered-boards.json')) {
  const disc = JSON.parse(readFileSync('scripts/discovered-boards.json', 'utf8'))
  const seen = new Set(targets.map((t) => `${t.source}|${t.token.toLowerCase()}`))
  for (const b of disc.boards ?? []) {
    const key = `${b.provider}|${b.token.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({
      source: b.provider, token: b.token, site: b.site, host: b.host,
      companyName: humanizeToken(b.token),
      discoveredVia: 'common-crawl', confidence: 0.9,
    })
  }
}

const selected = targets
  .filter((t) => !sourceFilter || sourceFilter.includes(t.source))
  .slice(0, limit)

const bySourceCount = {}
for (const t of selected) bySourceCount[t.source] = (bySourceCount[t.source] ?? 0) + 1

console.log(`Targets: ${selected.length}`)
for (const [s, n] of Object.entries(bySourceCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(18)} ${n}`)
}
console.log(`Concurrency: ${concurrency}  Enrichment: ${doEnrich ? 'on' : 'OFF'}\n`)

/* ------------------------------ previous state ----------------------------- */

const previous = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : { hashes: {}, firstPosted: {}, knownIds: [] }

/* -------------------------------- enrichment ------------------------------- */
//
// Deliberately a separate, failable function. It receives finished jobs and
// returns a map; it cannot modify or drop a job. This is the structural fix for
// the defect where skipping enrichment reduced job/valuation coverage.

async function enrichValuations(jobs) {
  const slugs = new Set(jobs.map((j) => j.companySlug))
  const out = {}

  // Curated private valuations: already known, no network needed.
  for (const c of COMPANIES) {
    if (!slugs.has(c.slug)) continue
    if (typeof c.reportedValuationUsd === 'number') out[c.slug] = c.reportedValuationUsd
  }

  // Public companies: derive market cap. Each lookup is independently guarded
  // so one bad ticker cannot fail the whole enrichment.
  const publicCos = COMPANIES.filter((c) => slugs.has(c.slug) && c.valuationKind === 'public' && c.ticker)
  for (const c of publicCos) {
    try {
      const mc = await getMarketCap(c.ticker)
      if (mc.marketCapUsd) out[c.slug] = mc.marketCapUsd
    } catch { /* leave null; a missing valuation is a known-unknown */ }
    await new Promise((r) => setTimeout(r, 120)) // SEC asks for <=10 req/s
  }

  return out
}

/* ----------------------------------- run ----------------------------------- */

let lastPct = -1
const { jobs, report, state } = await runIngest({
  targets: selected,
  concurrency,
  previous,
  enrich: doEnrich ? enrichValuations : undefined,
  hydrateDescriptions: hydrate > 0 ? { maxJobs: hydrate, concurrency: 8 } : undefined,
  onProgress: (done, total) => {
    const pct = Math.floor((done / total) * 100)
    if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  ${pct}%\r`) }
  },
})

/* ---------------------------------- output --------------------------------- */

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generatedAt: report.finishedAt,
  jobCount: jobs.length,
  report: { ...report, runs: undefined }, // runs are large; keep them out of the index
  jobs,
}))
writeFileSync(STATE, JSON.stringify(state))

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')
const R = report

console.log(`\n${'='.repeat(64)}`)
console.log('INGESTION REPORT')
console.log('='.repeat(64))
console.log(`Total companies:            ${R.totalCompanies}`)
console.log(`Total jobs (raw):           ${R.totalJobsRaw.toLocaleString()}`)
console.log(`Total jobs (canonical):     ${R.totalJobsCanonical.toLocaleString()}`)
console.log(`Duplicates removed:         ${R.duplicatesRemoved.toLocaleString()}  (${pct(R.duplicatesRemoved, R.totalJobsRaw)})`)
console.log(`  by requisition id:        ${R.dedupeTiers.requisition}`)
console.log(`  by application URL:       ${R.dedupeTiers.url}`)
console.log(`  by title+location:        ${R.dedupeTiers.titleLocation}`)
console.log(`  by fuzzy match:           ${R.dedupeTiers.fuzzy}`)
console.log()
console.log(`New jobs:                   ${R.newJobs.toLocaleString()}`)
console.log(`Updated jobs:               ${R.updatedJobs.toLocaleString()}`)
console.log(`Unchanged jobs:             ${R.unchangedJobs.toLocaleString()}`)
console.log(`Closed (gone since last):   ${R.closedJobs.toLocaleString()}`)
console.log(`Reposts detected:           ${R.reposts.toLocaleString()}`)
console.log()
console.log(`Direct application URLs:    ${R.directApplicationUrls.toLocaleString()}  (${pct(R.directApplicationUrls, R.totalJobsCanonical)})`)
console.log(`Jobs with normalized city:  ${R.jobsWithCity.toLocaleString()}  (${pct(R.jobsWithCity, R.totalJobsCanonical)})`)
console.log(`Jobs with country:          ${R.jobsWithCountry.toLocaleString()}  (${pct(R.jobsWithCountry, R.totalJobsCanonical)})`)
console.log(`Jobs with salary:           ${R.jobsWithSalary.toLocaleString()}  (${pct(R.jobsWithSalary, R.totalJobsCanonical)})`)
console.log(`Jobs with posted date:      ${R.jobsWithPostedDate.toLocaleString()}  (${pct(R.jobsWithPostedDate, R.totalJobsCanonical)})`)
console.log()
console.log(`Companies with valuation:   ${R.companiesWithValuation}`)
console.log(`Enrichment ran:             ${R.enrichmentRan}${R.enrichmentError ? `  (error: ${R.enrichmentError})` : ''}`)
console.log(`Descriptions hydrated:      ${(R.descriptionsHydrated ?? 0).toLocaleString()}`)
console.log()
console.log(`Sources crawled OK:         ${R.sourcesSucceeded}`)
console.log(`Sources failed:             ${R.sourcesFailed}`)
console.log(`Avg source response:        ${R.avgSourceResponseMs} ms`)
console.log(`Total ingestion time:       ${(R.durationMs / 1000).toFixed(1)} s`)

console.log(`\nTop sources by jobs discovered`)
for (const s of R.topSources) {
  const b = R.bySource[s.source]
  console.log(`  ${s.source.padEnd(18)} ${String(s.jobs).padStart(7)}  (${b.targets} boards, ${b.failures} failed, avg ${b.avgMs}ms)`)
}

console.log(`\nTop 20 companies by jobs discovered`)
for (const c of R.topCompanies) {
  console.log(`  ${String(c.jobs).padStart(6)}  ${c.company}`)
}

if (R.failureReasons.length) {
  console.log(`\nTop failure reasons`)
  for (const f of R.failureReasons) console.log(`  ${String(f.count).padStart(5)}  ${f.reason}`)
}

console.log(`\nwrote ${OUT}`)
