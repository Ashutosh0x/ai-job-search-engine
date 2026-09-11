/**
 * Build a bounded index that can actually be served from a serverless function.
 *
 *   node --max-old-space-size=8192 scripts/build-deploy-index.mjs
 *   node --max-old-space-size=8192 scripts/build-deploy-index.mjs --budget-mb 25
 *
 * WHY A SUBSET, STATED PLAINLY
 * ============================
 * The full index is 382 MB. Measured projections of the same corpus:
 *
 *   full record                      382 MB
 *   240-char description snippets    277 MB
 *   no descriptions at all           199 MB
 *
 * A Vercel serverless function has a 250 MB uncompressed bundle ceiling (50 MB
 * on Hobby), and would have to parse whatever it loads on every cold start.
 * None of those three fits, and the last one is already stripped of the text
 * that search quality depends on. So this is not a tuning problem: serving
 * 242k jobs from a JSON file in a serverless function does not work at any
 * field projection.
 *
 * The right long-term fix is Postgres with a GIN index, or a search service.
 * `lib/job-index.ts` was written with that in mind -- its query shape is the
 * one Postgres executes directly. Until then, a deployment carries a bounded
 * slice and SAYS SO, which is the part that matters: the API response carries
 * `deployment.bounded = true` with the selection rule and the corpus total, so
 * nobody can mistake 30k jobs for the whole market.
 *
 * HOW THE SLICE IS CHOSEN
 * -----------------------
 * Not "the first N". Ranked by a blend of posting quality, freshness and
 * direct-apply, then capped per company so a single 6,000-role employer cannot
 * consume the whole budget. A subset that is 20% JPMorgan is a worse product
 * than one spanning many employers, even at identical job count.
 */

import { readFileSync, writeFileSync, openSync, writeSync, closeSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const IN = val('in', 'public/data/jobs-v2.json')
const OUT = val('out', 'public/data/jobs-deploy.json')
const BUDGET_MB = Number(val('budget-mb', 30))
/** No employer may exceed this share of the slice. */
const MAX_COMPANY_SHARE = Number(val('max-company-share', 0.04))

console.log(`reading ${IN} ...`)
// Streaming byte reader: the full index exceeds Node's ~512MB string cap.
const { readIndexJobs } = await import('../lib/pipeline/read-index.mjs')
const { head: src, jobs: all } = readIndexJobs(IN)
console.log(`corpus: ${all.length.toLocaleString()} jobs`)

/* ------------------------------- projection ------------------------------- */
//
// Keep every field the search, ranking and UI paths read. Descriptions are
// truncated rather than dropped: `descriptionText` feeds BM25 body matching and
// the resume matcher, and removing it entirely would degrade relevance in a way
// the job count would not reveal.
const SNIPPET = 200

const project = (x) => ({
  id: x.id,
  source: x.source,
  company: x.company,
  companySlug: x.companySlug,
  companyDomain: x.companyDomain,
  title: x.title,
  normalizedTitle: x.normalizedTitle,
  description: (x.description || '').slice(0, SNIPPET),
  locationRaw: x.locationRaw,
  locationDisplay: x.locationDisplay,
  city: x.city,
  state: x.state,
  country: x.country,
  remote: x.remote,
  workplaceType: x.workplaceType,
  workplaceDisplay: x.workplaceDisplay,
  employmentType: x.employmentType,
  seniority: x.seniority,
  department: x.department,
  skills: (x.skills || []).slice(0, 12),
  salaryMin: x.salaryMin,
  salaryMax: x.salaryMax,
  salaryCurrency: x.salaryCurrency,
  postedAt: x.postedAt,
  firstSeenAt: x.firstSeenAt,
  freshnessScore: x.freshnessScore,
  applicationUrl: x.applicationUrl,
  isDirectApplication: x.isDirectApplication,
  visaStatus: x.visaStatus,
  visaEvidence: (x.visaEvidence || []).slice(0, 1),
  sponsorCountries: x.sponsorCountries,
  qualityScore: x.qualityScore,
  ghostRisk: x.ghostRisk,
  ghostLabel: x.ghostLabel,
  companyValuationUsd: x.companyValuationUsd,
  sourceCount: x.sourceCount,
})

/* -------------------------------- ranking --------------------------------- */

const now = Date.now()
const score = (j) => {
  const quality = j.qualityScore ?? 0
  const fresh = j.freshnessScore ?? 0
  // A posting we can date is worth more than one we cannot, and a recent one
  // more than an old one -- but absence of a date is not evidence of staleness,
  // so it scores neutral rather than zero.
  const ageDays = j.postedAt ? (now - new Date(j.postedAt).getTime()) / 86_400_000 : null
  const recency = ageDays === null ? 0.4 : Math.max(0, 1 - ageDays / 90)
  const direct = j.isDirectApplication ? 1 : 0
  const hasText = (j.description || '').length > 200 ? 1 : 0
  const ghost = 1 - (j.ghostRisk ?? 0)
  return 0.30 * quality + 0.20 * fresh + 0.20 * recency + 0.10 * direct + 0.10 * hasText + 0.10 * ghost
}

const ranked = all
  .map((j) => ({ j, s: score(j) }))
  .sort((a, b) => b.s - a.s)

/* ------------------------- select within the budget ----------------------- */

const budgetBytes = BUDGET_MB * 1024 * 1024
// Sample the real serialised size rather than guessing at it.
const sampleBytes =
  ranked.slice(0, 2000).reduce((n, { j }) => n + Buffer.byteLength(JSON.stringify(project(j))) + 1, 0) /
  Math.min(2000, ranked.length)
const targetCount = Math.floor(budgetBytes / sampleBytes)
const perCompanyCap = Math.max(20, Math.floor(targetCount * MAX_COMPANY_SHARE))

console.log(`~${Math.round(sampleBytes)} B/job -> budget fits ~${targetCount.toLocaleString()} jobs`)
console.log(`per-company cap: ${perCompanyCap.toLocaleString()}`)

const perCompany = new Map()
const chosen = []
// Pass 1: respect the cap, so the slice spans employers.
for (const { j } of ranked) {
  if (chosen.length >= targetCount) break
  const n = perCompany.get(j.companySlug) ?? 0
  if (n >= perCompanyCap) continue
  perCompany.set(j.companySlug, n + 1)
  chosen.push(j)
}
// Pass 2: if the cap left the budget unspent, backfill by rank.
if (chosen.length < targetCount) {
  const have = new Set(chosen.map((j) => j.id))
  for (const { j } of ranked) {
    if (chosen.length >= targetCount) break
    if (!have.has(j.id)) { chosen.push(j); have.add(j.id) }
  }
}

/* --------------------------------- write ---------------------------------- */

function writeJsonStream(path, head, arrayKey, rows) {
  const fd = openSync(path, 'w')
  try {
    const parts = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    writeSync(fd, `{${parts.join(',')},${JSON.stringify(arrayKey)}:[`)
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

mkdirSync(dirname(OUT), { recursive: true })
writeJsonStream(
  OUT,
  {
    generatedAt: src.generatedAt,
    builtAt: new Date().toISOString(),
    jobCount: chosen.length,
    // Carried into the API response. A consumer must be able to tell that this
    // is a slice without reading this script.
    deployment: {
      bounded: true,
      corpusTotal: all.length,
      budgetMb: BUDGET_MB,
      descriptionChars: SNIPPET,
      perCompanyCap,
      selection:
        'Ranked by posting quality, freshness, recency, direct-apply and ghost-risk, ' +
        'then capped per employer so no single company dominates the slice.',
      note:
        'This deployment serves a bounded subset of the crawled corpus. The full index ' +
        'is 382MB and cannot be loaded by a serverless function; serving all of it needs ' +
        'Postgres or a search service.',
    },
    report: src.report ?? null,
  },
  'jobs',
  chosen.map(project)
)

const bytes = Buffer.byteLength(readFileSync(OUT, 'utf8'))
const companies = new Set(chosen.map((j) => j.companySlug)).size
const countries = new Set(chosen.map((j) => j.country).filter(Boolean)).size
const withText = chosen.filter((j) => (j.description || '').length > 150).length

console.log(`\nwrote ${OUT}`)
console.log(`  ${chosen.length.toLocaleString()} jobs  ${(bytes / 1048576).toFixed(1)} MB`)
console.log(`  ${companies.toLocaleString()} companies  ${countries} countries`)
console.log(`  ${((withText / chosen.length) * 100).toFixed(0)}% carry description text`)
console.log(`  ${((chosen.length / all.length) * 100).toFixed(1)}% of the ${all.length.toLocaleString()}-job corpus`)
