/**
 * Build a bounded index that can actually be served from a serverless function.
 *
 *   node --max-old-space-size=12288 scripts/build-deploy-index.mjs
 *   node --max-old-space-size=12288 scripts/build-deploy-index.mjs --budget-mb 120
 *
 * This is a THIN CLI over lib/pipeline/deploy-index.mjs. It does not implement
 * selection or sharding itself.
 *
 * WHY THAT MATTERS
 * ================
 * It used to. This script carried its own projection, its own ranking, its own
 * per-company cap and its own single-file writer, while scripts/refresh.mjs
 * called `writeDeployIndex` from lib/pipeline/deploy-index.mjs. Two
 * implementations of the same artifact, and they drifted:
 *
 *   - The shared module shards the output and declares the extra files in the
 *     primary's `shards` array, which is what lib/job-index.ts reads.
 *   - This script wrote ONE file and no `shards` key. At a 120 MB budget that
 *     is a single 117 MB blob -- over GitHub's 100 MiB hard limit, so the push
 *     fails after the crawl has already run.
 *
 * The daily publish workflow called this one. It produced an index that could
 * not be committed, and if the limit had been higher it would have silently
 * dropped the `shards` key and served a partial index while looking healthy --
 * the exact failure lib/job-index.ts and test-deploy-index.mjs were written to
 * prevent.
 *
 * So selection and writing live in ONE place, covered by
 * scripts/test-deploy-index.mjs. This file only parses arguments, reads the
 * corpus and reports.
 *
 * WHY A SUBSET, STATED PLAINLY
 * ============================
 * The full index is 382 MB. A Vercel serverless function has a 250 MB
 * uncompressed bundle ceiling (50 MB on Hobby) and would have to parse whatever
 * it loads on every cold start. Stripping descriptions entirely still leaves
 * 199 MB and destroys the text search quality depends on, so this is not a
 * tuning problem. A deployment carries a bounded slice and SAYS SO: the API
 * response carries `deployment.bounded = true` with the selection rule and the
 * corpus total, so nobody can mistake a slice for the whole market.
 *
 * The long-term fix is Postgres with a GIN index, or a search service.
 * lib/job-index.ts was written with that in mind.
 */

import { statSync, existsSync } from 'fs'
import { readIndexJobs } from '../lib/pipeline/read-index.mjs'
import { writeDeployIndex } from '../lib/pipeline/deploy-index.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const IN = val('in', 'public/data/jobs-v2.json')
const OUT = val('out', 'public/data/jobs-deploy.json')
const BUDGET_MB = Number(val('budget-mb', 30))

console.log(`reading ${IN} ...`)
// Streaming byte reader: the full index exceeds Node's ~512MB string cap.
const { head: src, jobs: all } = readIndexJobs(IN)
console.log(`corpus: ${all.length.toLocaleString()} jobs`)

// The same source refresh.mjs uses, so both paths make the same guarantee:
// every posting at a curated employer is served in full.
let curated = null
try {
  const { COMPANIES } = await import('../lib/companies/registry.ts')
  curated = new Set(COMPANIES.map((c) => c.slug))
  console.log(`curated employers: ${curated.size}`)
} catch (e) {
  // Selection still works without it, but curated employers lose their
  // served-complete guarantee. Say so rather than degrading in silence.
  console.warn(`warning: no curated slugs (${e.message}) — no employer served complete`)
}

const res = writeDeployIndex(all, OUT, src, BUDGET_MB, curated)

// writeDeployIndex returns a shard COUNT, not names. Shard i is OUT with
// `.{i+1}.json` substituted, matching shardPath() in the shared module.
const files = [OUT]
for (let i = 1; i < (res.shards ?? 1); i++) files.push(OUT.replace(/\.json$/, `.${i + 1}.json`))
const present = files.filter((f) => existsSync(f))
const bytes = present.reduce((n, f) => n + statSync(f).size, 0)

if (present.length !== files.length) {
  // A shard the writer reported but did not leave on disk is exactly the
  // "named but unreadable" case lib/job-index.ts treats as fatal. Fail here
  // rather than let it be committed.
  console.error(`expected ${files.length} shard(s), found ${present.length}: ${files.filter((f) => !present.includes(f)).join(', ')}`)
  process.exit(1)
}

console.log(`\nwrote ${present.length} file(s)`)
for (const f of present) console.log(`  ${f}  ${(statSync(f).size / 1048576).toFixed(1)} MB`)
console.log(`  ${res.count.toLocaleString()} jobs  ${(bytes / 1048576).toFixed(1)} MB total`)
console.log(`  ${((res.count / all.length) * 100).toFixed(1)}% of the ${all.length.toLocaleString()}-job corpus`)
