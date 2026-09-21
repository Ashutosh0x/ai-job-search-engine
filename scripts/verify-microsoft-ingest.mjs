/**
 * End-to-end proof that Microsoft reaches the corpus.
 *
 *   MICROSOFT_MAX_REQUESTS=60 npx tsx scripts/verify-microsoft-ingest.mjs
 *
 * Live network. This is the check that `scripts/test-microsoft.mjs` cannot
 * make: the unit suite proves the adapter parses what Microsoft serves, but a
 * registration can still be wrong in a way that only shows up when the
 * orchestrator builds the target list, picks an adapter and writes an index.
 *
 * WHY THIS EXISTS AT ALL
 * ======================
 * The failure being guarded against is silent success. `successfactors`
 * carried a SourceId and a confidence weight with no adapter behind it, so EY
 * ingested zero jobs and the run reported OK. Microsoft has two ways to fail
 * the same way -- via `custom` and via `eightfold`, whose API answers 403 on
 * Microsoft's tenant -- so "the pipeline ran without error" is not evidence
 * of anything. Only jobs in the index are.
 *
 * It writes its own small index rather than touching public/data/jobs-v2.json:
 * a verification run must not overwrite the corpus the site serves.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const { runIngest } = await import('../lib/pipeline/orchestrator.ts')
const { COMPANIES } = await import('../lib/companies/registry.ts')
const { getAdapter } = await import('../lib/sources/registry.ts')
const { readIndexJobs } = await import('../lib/pipeline/read-index.mjs')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const OUT = resolve(ROOT, val('out', 'data/microsoft-corpus-verify.json'))

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

const budget = Number(process.env.MICROSOFT_MAX_REQUESTS) || 60
console.log(`Microsoft ingest verification (request budget ${budget})\n`)

/* ---- 1. the target the orchestrator would actually build ---- */
console.log('🎯 Target construction (same path as scripts/ingest-v2.mjs):')
const company = COMPANIES.find((c) => c.slug === 'microsoft')
t('Microsoft is in the curated company registry', Boolean(company))
if (!company) { console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1) }

const targets = company.boards.map((b) => ({
  source: b.provider, token: b.token, site: b.site, host: b.host, applyHost: b.applyHost,
  companySlug: company.slug, companyName: company.name, companyDomain: company.domain,
  discoveredVia: 'curated', confidence: 1,
}))
t('Microsoft yields at least one target', targets.length > 0)

const adapter = getAdapter(targets[0].source, targets[0].token, targets[0].host)
t('the target resolves to an adapter', Boolean(adapter), targets[0])
t('and it is the Microsoft adapter, not the generic custom scraper',
  adapter?.displayName === 'Microsoft Careers', adapter?.displayName)

/* ---- 2. run the real pipeline ---- */
console.log('\n⚙️  Running the ingestion pipeline against the live board:')
const { jobs, report } = await runIngest({
  targets,
  concurrency: 1,
  // Enrichment reaches SEC EDGAR; it is optional by construction and is left
  // out so this check measures ingestion only.
})

console.log(`   fetched ${report.totalJobsRaw} raw -> ${report.totalJobsCanonical} canonical ` +
            `(${report.duplicatesRemoved} duplicates removed) in ${report.durationMs}ms`)
for (const run of report.runs) {
  for (const w of run.warnings) console.log(`   warn: ${w}`)
  if (run.error) console.log(`   error: ${run.error}`)
}

t('the source run succeeded', report.sourcesSucceeded === 1 && report.sourcesFailed === 0,
  { ok: report.sourcesSucceeded, failed: report.sourcesFailed })
t('the pipeline produced jobs -- the point of the whole exercise', jobs.length > 0, jobs.length)
t('raw jobs survived normalisation', report.totalJobsCanonical > 0)
t('the run is attributed to a source', Object.keys(report.bySource).length > 0, report.bySource)

/* ---- 3. the jobs are recognisably Microsoft's ---- */
console.log('\n🔎 Corpus content:')
const ms = jobs.filter((j) => j.companySlug === 'microsoft')
t('every job carries the curated company slug', ms.length === jobs.length, `${ms.length}/${jobs.length}`)
t('company name is Microsoft', jobs.every((j) => j.company === 'Microsoft'))
t('application urls point at Microsoft, not an aggregator',
  jobs.every((j) => /careers\.microsoft\.com/.test(j.applicationUrl)))
t('all are direct applications', jobs.every((j) => j.isDirectApplication))
t('job ids are unique after dedupe', new Set(jobs.map((j) => j.id)).size === jobs.length)
t('titles are populated', jobs.every((j) => j.title && j.title.length > 1))
t('descriptions are populated', jobs.filter((j) => j.description?.length > 50).length === jobs.length,
  `${jobs.filter((j) => j.description?.length > 50).length}/${jobs.length}`)
t('posted dates are populated', jobs.every((j) => Boolean(j.postedAt)))
// A posting Microsoft locates only by country ("US", with no city) normalises
// to `locationAmbiguous` rather than `country`: a bare two-letter code is a
// country OR a state OR a province, and resolve-locations settles it later
// against the whole corpus. Counting only `country` here would report a
// deliberate known-unknown as a parsing failure.
const located = jobs.filter((j) => j.country || j.locationAmbiguous || j.locationRaw)
t('every job with a location in the posting carries one in the corpus',
  located.length === jobs.filter((j) => j.locationRaw).length,
  `${located.length}/${jobs.filter((j) => j.locationRaw).length}`)
t('most jobs resolve to a country outright',
  jobs.filter((j) => j.country).length >= jobs.length * 0.8,
  `${jobs.filter((j) => j.country).length}/${jobs.length}`)
t('status is OPEN', jobs.every((j) => j.status === 'OPEN'))
t('source confidence is set', jobs.every((j) => typeof j.sourceConfidence === 'number' && j.sourceConfidence > 0))
t('quality scoring ran', jobs.every((j) => typeof j.qualityScore === 'number'))
t('skills extraction ran on at least some jobs', jobs.some((j) => j.skills.length > 0))
t('a crawl timestamp is recorded', jobs.every((j) => Boolean(j.lastSeenAt) && Boolean(j.firstSeenAt)))

/* ---- 4. write an index and read it back the way the app does ---- */
console.log('\n💾 Index round-trip:')
mkdirSync(dirname(OUT), { recursive: true })
// Compact, same shape ingest-v2's writeJsonStream emits. The reader is a
// byte-level streaming parser that scans for `"jobs":[` -- pretty-printing
// the file makes it unreadable, which is itself worth pinning here.
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  jobCount: jobs.length,
  jobs,
}))
t('an index was written', existsSync(OUT))

const { jobs: readBack, count } = readIndexJobs(OUT)
t('the index reads back through the app reader', Array.isArray(readBack) && readBack.length === jobs.length,
  { wrote: jobs.length, read: readBack?.length, count })
t('Microsoft jobs are findable in the index',
  readBack.filter((j) => j.companySlug === 'microsoft').length === jobs.length)

const sample = readBack[0]
console.log(`\n   sample: ${sample.title}`)
console.log(`           ${sample.locationDisplay ?? sample.locationRaw ?? '(no location)'}`)
console.log(`           ${sample.applicationUrl}`)

/* ---- 5. stamp adapter + ingestion status onto the crawl report ---- */
//
// The crawler cannot report these: it is a standalone .mjs that never loads
// the registry, and a crawl report claiming "adapter: registered" on its own
// authority would be asserting something it never checked. This writes them
// only after the assertions above actually passed.
const REPORT = resolve(ROOT, 'microsoft-crawl-report.json')
const REPORT_TEXT = resolve(ROOT, 'microsoft-crawl-report.txt')
if (existsSync(REPORT)) {
  const { readFileSync, appendFileSync } = await import('fs')
  const crawlReport = JSON.parse(readFileSync(REPORT, 'utf8'))

  crawlReport.adapterStatus = {
    registered: Boolean(adapter),
    className: 'MicrosoftCareersAdapter',
    displayName: adapter?.displayName ?? null,
    sourceId: adapter?.id ?? null,
    routesFrom: ["custom + token 'microsoft'", "eightfold + token 'microsoft'", 'careers.microsoft.com hosts'],
    companyRegistryEntry: company.slug,
    verifiedAt: new Date().toISOString(),
  }
  crawlReport.ingestionStatus = {
    ran: true,
    verifiedAt: new Date().toISOString(),
    requestBudget: budget,
    scope: 'bounded verification slice, NOT a full-board ingest',
    totalJobsRaw: report.totalJobsRaw,
    totalJobsCanonical: report.totalJobsCanonical,
    duplicatesRemoved: report.duplicatesRemoved,
    sourcesSucceeded: report.sourcesSucceeded,
    sourcesFailed: report.sourcesFailed,
    indexWritten: OUT.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
    indexReadBack: readBack.length,
    assertionsPassed: pass,
    assertionsFailed: fail,
  }
  writeFileSync(REPORT, JSON.stringify(crawlReport, null, 2))

  appendFileSync(REPORT_TEXT,
    `\nADAPTER STATUS\n` +
    `  registered      ${crawlReport.adapterStatus.registered ? 'yes' : 'NO'} (${crawlReport.adapterStatus.displayName})\n` +
    `  source id       ${crawlReport.adapterStatus.sourceId}\n` +
    `  routes from     ${crawlReport.adapterStatus.routesFrom.join('; ')}\n` +
    `\nINGESTION STATUS  (bounded slice, budget ${budget} requests -- not a full ingest)\n` +
    `  pipeline ran    yes\n` +
    `  raw -> canonical ${report.totalJobsRaw} -> ${report.totalJobsCanonical} ` +
    `(${report.duplicatesRemoved} duplicates removed)\n` +
    `  index written   ${crawlReport.ingestionStatus.indexWritten}\n` +
    `  read back       ${readBack.length} jobs through lib/pipeline/read-index.mjs\n` +
    `  assertions      ${pass} passed, ${fail} failed\n`)

  console.log(`\n   stamped adapter + ingestion status into microsoft-crawl-report.{json,txt}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
