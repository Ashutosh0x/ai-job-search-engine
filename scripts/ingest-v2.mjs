/**
 * Multi-source ingestion.
 *
 *   npx tsx scripts/ingest-v2.mjs                       # all discovered boards
 *   npx tsx scripts/ingest-v2.mjs --limit 60            # bounded
 *   npx tsx scripts/ingest-v2.mjs --no-enrich           # prove §36: jobs unaffected
 *   npx tsx scripts/ingest-v2.mjs --sources workday,ashby
 *   npx tsx scripts/ingest-v2.mjs --only barclays,jane-street   (named companies)
 *
 * Writes public/data/jobs-v2.json (index) and .ingest-state.json (cursors and
 * hashes for the next incremental run).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync } from 'fs'
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

// Boards seeded from external reports, already ATS-verified.
if (existsSync('scripts/report-boards.json')) {
  const rep = JSON.parse(readFileSync('scripts/report-boards.json', 'utf8'))
  const seen = new Set(targets.map((t) => `${t.source}|${t.token.toLowerCase()}`))
  let added = 0
  for (const b of rep.boards ?? []) {
    const key = `${b.provider}|${b.token.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({
      source: b.provider, token: b.token,
      companySlug: b.companySlug, companyName: b.companyName, companyDomain: b.companyDomain,
      discoveredVia: b.discoveredVia, confidence: 0.95,
    })
    added++
  }
  if (added) console.log(`+${added} boards seeded from report-boards.json`)
}

const onlyFilter = val('only', null)?.split(',').map((s) => s.trim().toLowerCase())

const selected = targets
  .filter((t) => !sourceFilter || sourceFilter.includes(t.source))
  .filter((t) => !onlyFilter || onlyFilter.includes((t.companySlug ?? '').toLowerCase()))
  .slice(0, limit)

if (onlyFilter && !selected.length) {
  console.error(`--only matched no boards. Known slugs: ${
    [...new Set(targets.map((t) => t.companySlug).filter(Boolean))].sort().join(', ')}`)
  process.exit(1)
}

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

// Two artefacts, deliberately.
//
// The full record carries everything a job detail page or the debug view could
// want -- full descriptions, per-rule validation issues, evidence spans. At
// ~97k jobs that is ~290MB, and loading it to answer a search is absurd: the
// search path needs a snippet, not the whole posting.
//
// So the search index gets a slim projection (~1/5 the size) and the heavy
// fields stay in the archive, fetched by id only when something actually needs
// them. This is the cheap version of the eventual move to Postgres; it does not
// change the schema, only what gets loaded per request.
const SNIPPET = 600

/**
 * Government sponsor licences, if scripts/build-sponsors.mjs has been run.
 *
 * This is kept strictly separate from `visaStatus`. visaStatus is inferred from
 * what the posting says; a licence is a published fact about the EMPLOYER. An
 * employer holding a Skilled Worker licence does not mean this particular role
 * is open to sponsorship, so the two are never merged into one field.
 *
 * Only licences covering a skilled-work route are attached: the register also
 * lists religious, charity and seasonal routes, which are irrelevant here and,
 * where they are the only routes held, usually indicate a different
 * organisation that happens to share a name.
 */
let sponsorsBySlug = {}
if (existsSync('public/data/sponsors.json')) {
  try {
    const s = JSON.parse(readFileSync('public/data/sponsors.json', 'utf8'))
    for (const [slug, rec] of Object.entries(s.companies ?? {})) {
      const good = (rec.licences ?? []).filter((l) => l.coversSkilledWork && !l.lowConfidence)
      if (good.length) sponsorsBySlug[slug] = good
    }
    console.log(`sponsor licences loaded for ${Object.keys(sponsorsBySlug).length} companies`)
  } catch (e) {
    console.warn(`could not read sponsors.json: ${e.message}`)
  }
}

const sponsorCountriesFor = (slug) =>
  (sponsorsBySlug[slug] ?? []).map((l) => l.country)

const slim = jobs.map((j) => ({
  id: j.id, source: j.source,
  company: j.company, companySlug: j.companySlug, companyDomain: j.companyDomain,
  title: j.title, normalizedTitle: j.normalizedTitle,
  // A snippet is enough to rank and to show; the full text lives in the archive.
  description: (j.description || '').slice(0, SNIPPET),
  locationRaw: j.locationRaw, locationDisplay: j.locationDisplay,
  city: j.city, state: j.state, country: j.country,
  remote: j.remote, workplaceType: j.workplaceType, workplaceDisplay: j.workplaceDisplay,
  remoteScope: j.remoteScope, remoteCountries: j.remoteCountries,
  officeDaysPerWeek: j.officeDaysPerWeek,
  employmentType: j.employmentType, seniority: j.seniority,
  department: j.department, team: j.team,
  salaryMin: j.salaryMin, salaryMax: j.salaryMax, salaryCurrency: j.salaryCurrency,
  skills: j.skills,
  postedAt: j.postedAt, freshnessScore: j.freshnessScore,
  applicationUrl: j.applicationUrl, isDirectApplication: j.isDirectApplication,
  visaStatus: j.visaStatus, visaTypes: j.visaTypes,
  // One quoted line is what the UI shows; the rest is archive.
  visaEvidence: (j.visaEvidence || []).slice(0, 1),
  // Countries whose government register lists this EMPLOYER as licensed to
  // sponsor skilled workers. Not a claim about this role.
  sponsorCountries: sponsorCountriesFor(j.companySlug),
  qualityScore: j.qualityScore, ghostRisk: j.ghostRisk, ghostLabel: j.ghostLabel,
  companyValuationUsd: j.companyValuationUsd,
  duplicateConfidence: j.duplicateConfidence,
  sourceCount: (j.sourceUrls || []).length,
}))

/**
 * Write one JSON document without ever holding it as a single string.
 *
 * `JSON.stringify` of the full archive crashed with "Invalid string length"
 * once the corpus passed Node's 512MB maximum string length -- at the very end
 * of a 20-minute crawl, after all the work was already done. Serialising the
 * jobs array one element at a time keeps peak memory to a single record and
 * removes the ceiling entirely.
 */
function writeJsonStream(path, head, arrayKey, rows) {
  const fd = openSync(path, 'w')
  try {
    const parts = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    writeSync(fd, `{${parts.join(',')},${JSON.stringify(arrayKey)}:[`)
    // Batch the writes: one syscall per record is needlessly slow at 100k rows.
    let buf = ''
    for (let i = 0; i < rows.length; i++) {
      buf += (i ? ',' : '') + JSON.stringify(rows[i])
      if (buf.length > 4_000_000) { writeSync(fd, buf); buf = '' }
    }
    if (buf) writeSync(fd, buf)
    writeSync(fd, ']}')
  } finally {
    closeSync(fd)
  }
}

writeJsonStream(OUT, {
  generatedAt: report.finishedAt,
  jobCount: slim.length,
  report: { ...report, runs: undefined }, // runs are large; keep them out of the index
  // Full licence detail (matched legal name, routes, source, publish date) for
  // the company page; the per-job field carries only the country codes.
  sponsors: sponsorsBySlug,
}, 'jobs', slim)

// Full records, for job detail and the debug view.
const ARCHIVE = OUT.replace(/\.json$/, '-full.json')
writeJsonStream(ARCHIVE, { generatedAt: report.finishedAt }, 'jobs', jobs)
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
console.log(`Locations disambiguated:    ${(R.locationsResolved ?? 0).toLocaleString()}`)
console.log(`Rejected by validation:     ${(R.rejectedByValidation ?? 0).toLocaleString()}`)
console.log(`Suspected ghost postings:   ${(R.suspectedGhostJobs ?? 0).toLocaleString()}`)
console.log(`Avg quality score:          ${R.avgQualityScore ?? 0}`)
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
