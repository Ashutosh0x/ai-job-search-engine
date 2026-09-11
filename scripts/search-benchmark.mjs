/**
 * Search quality benchmark (§20, §48).
 *
 *   npx tsx scripts/search-benchmark.mjs
 *   npx tsx scripts/search-benchmark.mjs --json out.json
 *   npx tsx scripts/search-benchmark.mjs --only visa      (filter by tag)
 *
 * METHODOLOGY -- READ THIS BEFORE QUOTING ANY NUMBER
 * ===================================================
 * Relevance here is judged by a PREDICATE over the indexed structured fields,
 * not by a human. For "remote ML jobs with visa sponsorship" a result counts as
 * relevant when its workplaceType is REMOTE and its visaStatus is EXPLICIT or
 * LIKELY and its title/skills are ML-ish.
 *
 * What that DOES measure, reliably:
 *   - whether the ranker surfaces what the data says is relevant
 *   - ranking regressions between two builds of the same index
 *   - constraint leakage (a "remote" query returning onsite jobs)
 *
 * What it does NOT measure, and must not be claimed:
 *   - human relevance. A predicate agrees with the index by construction, so a
 *     field that is wrong in the index is wrong in the judgment too.
 *   - true Recall. Real recall needs the complete set of relevant jobs in the
 *     world; we have the set we ingested. What is reported as recall below is
 *     recall against the POOL -- the relevant items present in this index --
 *     which is a ceiling, not the real thing. It is labelled poolRecall for
 *     exactly that reason.
 *
 * A benchmark that overstates what it proves is worse than none, because it
 * launders a guess into a number.
 */

import { writeFileSync } from 'fs'
import { smartSearch, loadIndex } from '../lib/job-index.ts'

const argv = process.argv.slice(2)
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null
const onlyTag = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null

/* ------------------------------ judgment helpers -------------------------- */

const text = (j) => `${j.title ?? ''} ${(j.skills ?? []).join(' ')}`.toLowerCase()
const titleHas = (j, ...words) => words.some((w) => (j.title ?? '').toLowerCase().includes(w))
const anyText = (j, ...words) => words.some((w) => text(j).includes(w))
const inCountry = (j, c) => (j.country ?? '').toLowerCase() === c.toLowerCase()
const inCity = (j, c) => (j.city ?? '').toLowerCase().includes(c.toLowerCase())
const isRemote = (j) => j.workplace === 'REMOTE' || j.remote === true
const isHybrid = (j) => j.workplace === 'HYBRID'
const sponsors = (j) => ['SPONSORSHIP_EXPLICIT', 'SPONSORSHIP_LIKELY'].includes(j.visaStatus)
const freshWithin = (j, days) =>
  j.postedAt && (Date.now() - new Date(j.postedAt)) / 86400000 <= days
const seniorityIs = (j, s) => (j.seniority ?? '').toUpperCase() === s

/* --------------------------------- queries -------------------------------- */
//
// Drawn from §45 plus coverage of the facets the brief calls out. Each carries
// the predicate that defines relevance for THAT query.

const QUERIES = [
  // --- role + location ----------------------------------------------------
  { q: 'AI engineer jobs in Bengaluru', tags: ['role', 'location'],
    rel: (j) => anyText(j, 'ai', 'machine learning', 'ml ', 'artificial intelligence') && inCity(j, 'bangalore') },
  { q: 'senior backend engineer in London', tags: ['role', 'location', 'seniority'],
    rel: (j) => titleHas(j, 'backend', 'back-end', 'back end') && inCity(j, 'london') },
  { q: 'data scientist in Germany', tags: ['role', 'location'],
    rel: (j) => titleHas(j, 'data scientist', 'data science') && inCountry(j, 'Germany') },
  { q: 'software engineer in Amsterdam', tags: ['role', 'location'],
    rel: (j) => titleHas(j, 'engineer', 'developer') && inCity(j, 'amsterdam') },
  { q: 'semiconductor jobs in Bengaluru', tags: ['role', 'location'],
    rel: (j) => anyText(j, 'semiconductor', 'silicon', 'vlsi', 'asic', 'rtl', 'chip') && inCity(j, 'bangalore') },
  { q: 'platform engineer in India', tags: ['role', 'location'],
    rel: (j) => titleHas(j, 'platform') && inCountry(j, 'India') },

  // --- remote / workplace -------------------------------------------------
  { q: 'remote python backend jobs', tags: ['remote', 'skill'],
    rel: (j) => isRemote(j) && anyText(j, 'python', 'backend') },
  { q: 'remote software engineer jobs', tags: ['remote', 'role'],
    rel: (j) => isRemote(j) && titleHas(j, 'engineer', 'developer') },
  { q: 'hybrid engineering jobs in London', tags: ['hybrid', 'location'],
    rel: (j) => isHybrid(j) && inCity(j, 'london') },
  { q: 'remote data engineer jobs', tags: ['remote', 'role'],
    rel: (j) => isRemote(j) && titleHas(j, 'data engineer', 'data engineering') },
  { q: 'fully remote machine learning jobs', tags: ['remote', 'role'],
    rel: (j) => isRemote(j) && anyText(j, 'machine learning', 'ml', 'ai') },

  // --- visa ---------------------------------------------------------------
  { q: 'jobs with visa sponsorship', tags: ['visa'],
    rel: (j) => sponsors(j) },
  { q: 'remote ML jobs with visa sponsorship', tags: ['visa', 'remote'],
    rel: (j) => sponsors(j) && isRemote(j) && anyText(j, 'machine learning', 'ml', 'ai', 'data') },
  { q: 'software engineer jobs that sponsor visas in the UK', tags: ['visa', 'location'],
    rel: (j) => sponsors(j) && inCountry(j, 'United Kingdom') },
  { q: 'engineering jobs with sponsorship in the Netherlands', tags: ['visa', 'location'],
    rel: (j) => sponsors(j) && inCountry(j, 'Netherlands') },

  // --- seniority ----------------------------------------------------------
  { q: 'senior machine learning engineer', tags: ['seniority', 'role'],
    rel: (j) => seniorityIs(j, 'SENIOR') && anyText(j, 'machine learning', 'ml', 'ai') },
  { q: 'staff software engineer', tags: ['seniority', 'role'],
    rel: (j) => seniorityIs(j, 'STAFF') && titleHas(j, 'engineer') },
  { q: 'principal engineer roles', tags: ['seniority'],
    rel: (j) => seniorityIs(j, 'PRINCIPAL') },
  { q: 'internships in machine learning', tags: ['seniority', 'role'],
    rel: (j) => seniorityIs(j, 'INTERN') && anyText(j, 'machine learning', 'ml', 'ai', 'data') },
  { q: 'fresh graduate software jobs', tags: ['seniority'],
    rel: (j) => ['ENTRY', 'JUNIOR', 'INTERN'].includes((j.seniority ?? '').toUpperCase()) },
  { q: 'engineering manager jobs', tags: ['seniority'],
    rel: (j) => seniorityIs(j, 'MANAGER') || titleHas(j, 'engineering manager') },

  // --- freshness ----------------------------------------------------------
  { q: 'senior AI jobs posted today', tags: ['freshness'],
    rel: (j) => freshWithin(j, 2) && anyText(j, 'ai', 'machine learning', 'ml') },
  { q: 'software engineer jobs posted this week', tags: ['freshness'],
    rel: (j) => freshWithin(j, 7) && titleHas(j, 'engineer', 'developer') },
  { q: 'data jobs posted in the last 3 days', tags: ['freshness'],
    rel: (j) => freshWithin(j, 3) && anyText(j, 'data') },

  // --- skills -------------------------------------------------------------
  { q: 'jobs requiring Kubernetes and AWS', tags: ['skill'],
    rel: (j) => anyText(j, 'kubernetes', 'k8s') && anyText(j, 'aws', 'amazon web services') },
  { q: 'React frontend developer jobs', tags: ['skill', 'role'],
    rel: (j) => anyText(j, 'react') || titleHas(j, 'frontend', 'front-end') },
  { q: 'Java backend engineer', tags: ['skill', 'role'],
    rel: (j) => anyText(j, 'java') && titleHas(j, 'backend', 'engineer') },
  { q: 'Rust systems programming jobs', tags: ['skill'],
    rel: (j) => anyText(j, 'rust') },
  { q: 'PyTorch deep learning jobs', tags: ['skill'],
    rel: (j) => anyText(j, 'pytorch', 'deep learning', 'tensorflow') },
  { q: 'Go golang engineer', tags: ['skill'],
    rel: (j) => anyText(j, 'golang', ' go ') || titleHas(j, 'go ') },

  // --- domains beyond tech (the brief is explicit that this must not be
  //     technology-only) ----------------------------------------------------
  { q: 'nurse jobs', tags: ['healthcare'],
    rel: (j) => titleHas(j, 'nurse', 'nursing') },
  { q: 'marketing manager jobs', tags: ['business'],
    rel: (j) => titleHas(j, 'marketing') },
  { q: 'financial analyst jobs', tags: ['business'],
    rel: (j) => titleHas(j, 'financial analyst', 'finance', 'analyst') },
  { q: 'mechanical engineer jobs', tags: ['engineering'],
    rel: (j) => titleHas(j, 'mechanical') },
  { q: 'sales representative jobs', tags: ['business'],
    rel: (j) => titleHas(j, 'sales') },
  { q: 'accountant jobs', tags: ['business'],
    rel: (j) => titleHas(j, 'account') && !titleHas(j, 'account executive', 'account manager') },
  { q: 'logistics supply chain jobs', tags: ['operations'],
    rel: (j) => anyText(j, 'logistics', 'supply chain', 'warehouse') },
  { q: 'security engineer jobs', tags: ['security'],
    rel: (j) => titleHas(j, 'security') },
  { q: 'product manager jobs', tags: ['product'],
    rel: (j) => titleHas(j, 'product manager', 'product management') },
  { q: 'devops SRE jobs', tags: ['role'],
    rel: (j) => anyText(j, 'devops', 'sre', 'site reliability') },

  // --- company ------------------------------------------------------------
  { q: 'jobs at NVIDIA', tags: ['company'],
    rel: (j) => (j.company ?? '').toLowerCase().includes('nvidia') },
  { q: 'engineering jobs at JPMorgan', tags: ['company'],
    rel: (j) => (j.company ?? '').toLowerCase().includes('jpmorgan') },
  { q: 'AI jobs at OpenAI', tags: ['company'],
    rel: (j) => (j.company ?? '').toLowerCase().includes('openai') },
]

/* --------------------------------- metrics -------------------------------- */

const dcg = (gains) => gains.reduce((s, g, i) => s + g / Math.log2(i + 2), 0)

function evaluate(results, rel, poolSize) {
  const flags = results.map((j) => (rel(j) ? 1 : 0))
  const at = (k) => flags.slice(0, k)

  const p10 = at(10).reduce((a, b) => a + b, 0) / Math.min(10, flags.length || 1)
  const ideal = [...flags].sort((a, b) => b - a)
  const ndcg10 = dcg(at(10)) / (dcg(ideal.slice(0, 10)) || 1)

  const found = (k) => at(k).reduce((a, b) => a + b, 0)
  return {
    returned: results.length,
    poolSize,
    precision10: p10,
    ndcg10,
    // Recall against the POOL of relevant items present in this index.
    poolRecall10: poolSize ? found(10) / Math.min(10, poolSize) : 0,
    poolRecall25: poolSize ? found(25) / Math.min(25, poolSize) : 0,
    poolRecall50: poolSize ? found(50) / Math.min(50, poolSize) : 0,
  }
}

/* ----------------------------------- run ---------------------------------- */

const index = await loadIndex()
if (!index) {
  console.error('No index. Build one with: npx tsx scripts/ingest-v2.mjs')
  process.exit(1)
}
const all = index.jobs ?? index
console.log(`index: ${all.length.toLocaleString()} jobs\n`)

const queries = onlyTag ? QUERIES.filter((q) => q.tags.includes(onlyTag)) : QUERIES
const rows = []

for (const spec of queries) {
  const t0 = Date.now()
  const res = await smartSearch(spec.q, { pageSize: 50 })
  const ms = Date.now() - t0
  const jobs = res?.jobs ?? []

  // Pool = every relevant job in the index, computed over the whole corpus.
  // This is what makes poolRecall meaningful and also exposes queries whose
  // relevant set is empty (which is a data-coverage finding, not a ranking one).
  const poolSize = all.filter((j) => {
    try { return spec.rel(j) } catch { return false }
  }).length

  const m = evaluate(jobs, spec.rel, poolSize)
  rows.push({ query: spec.q, tags: spec.tags, ms, ...m })

  const bar = m.precision10 >= 0.7 ? '████' : m.precision10 >= 0.4 ? '██  ' : m.precision10 > 0 ? '█   ' : '    '
  console.log(
    `${bar} P@10 ${m.precision10.toFixed(2)}  NDCG ${m.ndcg10.toFixed(2)}  ` +
      `pool ${String(poolSize).padStart(6)}  ${String(ms).padStart(5)}ms  ${spec.q}`
  )
}

/* --------------------------------- summary -------------------------------- */

const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length
const summary = {
  queries: rows.length,
  meanPrecision10: mean((r) => r.precision10),
  meanNdcg10: mean((r) => r.ndcg10),
  meanPoolRecall10: mean((r) => r.poolRecall10),
  meanPoolRecall25: mean((r) => r.poolRecall25),
  meanPoolRecall50: mean((r) => r.poolRecall50),
  meanLatencyMs: mean((r) => r.ms),
  zeroResultQueries: rows.filter((r) => r.returned === 0).length,
  emptyPoolQueries: rows.filter((r) => r.poolSize === 0).map((r) => r.query),
}

console.log('\n' + '='.repeat(62))
console.log(`queries              ${summary.queries}`)
console.log(`mean P@10            ${summary.meanPrecision10.toFixed(3)}`)
console.log(`mean NDCG@10         ${summary.meanNdcg10.toFixed(3)}`)
console.log(`mean poolRecall@10   ${summary.meanPoolRecall10.toFixed(3)}`)
console.log(`mean poolRecall@25   ${summary.meanPoolRecall25.toFixed(3)}`)
console.log(`mean poolRecall@50   ${summary.meanPoolRecall50.toFixed(3)}`)
console.log(`mean latency         ${summary.meanLatencyMs.toFixed(0)}ms`)
console.log(`queries with 0 hits  ${summary.zeroResultQueries}`)
if (summary.emptyPoolQueries.length) {
  console.log(`\nempty relevant pool (a COVERAGE gap, not a ranking one):`)
  summary.emptyPoolQueries.forEach((q) => console.log(`  - ${q}`))
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ summary, rows }, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
