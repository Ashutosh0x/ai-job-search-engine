/**
 * Load crawled jobs into Postgres (Neon).
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/load-jobs-postgres.mjs \
 *     [--file public/data/jobs-v2.json] [--only jpmorgan-chase,nokia] \
 *     [--migrate] [--prune] [--dry]
 *
 *   --file     a pipeline index: jobs-v2.json, or a jobs-deploy shard
 *   --only     company slugs to load (default: everything in the file)
 *   --migrate  apply supabase/migrations/20260920_jobs_bm25.sql first (idempotent)
 *   --prune    delete rows of each loaded board that this file no longer has.
 *              Only correct when the file is a COMPLETE crawl of those boards
 *              (an `ingest-v2 --only` run is; a size-bounded deploy shard is not).
 *   --dry      map and validate, print counts, touch nothing
 *
 * Upserts in batches inside one transaction per batch. first_seen_at keeps the
 * earliest sighting (see buildUpsertQuery). Every loaded board gets a
 * job_crawls row with the count actually written.
 *
 * Use the DIRECT (non-pooled) Neon connection string for this script: it runs
 * long transactions, which the pooler's transaction mode handles poorly.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { buildUpsertQuery, buildPruneQuery } from '../lib/db/jobs-query.ts'
import { toJobRow } from '../lib/db/job-row.ts'

const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const val = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}

const file = val('file', 'public/data/jobs-v2.json')
const only = val('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const BATCH = 500

const raw = JSON.parse(readFileSync(file, 'utf8'))
const all = Array.isArray(raw) ? raw : raw.jobs
if (!Array.isArray(all)) throw new Error(`${file}: no jobs array`)
const jobs = only.length ? all.filter((j) => only.includes(j.companySlug)) : all
if (jobs.length === 0) throw new Error(`${file}: no jobs match ${only.join(',') || '(all)'}`)

const seenAt = new Date().toISOString()
const rows = []
const rejected = []
for (const j of jobs) {
  try {
    rows.push(toJobRow(j, seenAt))
  } catch (e) {
    rejected.push(`${j?.id}: ${e.message}`)
  }
}

const byBoard = new Map()
for (const r of rows) {
  const b = byBoard.get(r.board_key) ?? []
  b.push(r.id)
  byBoard.set(r.board_key, b)
}

console.log(`file:      ${file}`)
console.log(`jobs:      ${jobs.length.toLocaleString()} selected, ${rows.length.toLocaleString()} valid, ${rejected.length} rejected`)
console.log(`boards:    ${[...byBoard].map(([k, v]) => `${k} (${v.length})`).join(', ')}`)
console.log(`with desc: ${rows.filter((r) => typeof r.description === 'string' && r.description.length > 200).length.toLocaleString()}`)
for (const r of rejected.slice(0, 10)) console.log(`  rejected  ${r}`)

if (flag('dry')) process.exit(0)

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Nothing was written.')
  process.exit(2)
}

const client = new pg.Client({ connectionString: url, ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: true } })
await client.connect()
try {
  if (flag('migrate')) {
    const sql = readFileSync(fileURLToPath(new URL('../supabase/migrations/20260920_jobs_bm25.sql', import.meta.url)), 'utf8')
    await client.query(sql)
    const { rows: m } = await client.query('SELECT jobs_search_mode() AS mode')
    console.log(`migrated:  search mode = ${m[0].mode}`)
  }

  let written = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const q = buildUpsertQuery(rows.slice(i, i + BATCH))
    await client.query('BEGIN')
    try {
      await client.query(q.text, q.values)
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`batch at ${i} failed (${written} rows already committed): ${e.message}`)
    }
    written += Math.min(BATCH, rows.length - i)
    process.stdout.write(`\rupserted:  ${written.toLocaleString()} / ${rows.length.toLocaleString()}`)
  }
  process.stdout.write('\n')

  for (const [boardKey, ids] of byBoard) {
    let pruned = 0
    if (flag('prune')) {
      const q = buildPruneQuery(boardKey, ids)
      pruned = (await client.query(q.text, q.values)).rowCount ?? 0
    }
    await client.query(
      `INSERT INTO job_crawls (board_key, provider, crawled_at, jobs_found, ok, error)
       VALUES ($1, $2, $3, $4, TRUE, NULL)
       ON CONFLICT (board_key) DO UPDATE SET provider = EXCLUDED.provider, crawled_at = EXCLUDED.crawled_at,
         jobs_found = EXCLUDED.jobs_found, ok = TRUE, error = NULL`,
      [boardKey, boardKey.split(':')[0], seenAt, ids.length]
    )
    console.log(`board:     ${boardKey}  written ${ids.length}${flag('prune') ? `, pruned ${pruned} closed` : ''}`)
  }

  const slugs = [...new Set(rows.map((r) => r.company_slug))]
  const { rows: c } = await client.query('SELECT company_slug, count(*)::int AS n FROM jobs WHERE company_slug = ANY($1) GROUP BY 1 ORDER BY 2 DESC', [slugs])
  for (const r of c) console.log(`in db:     ${r.company_slug}  ${r.n.toLocaleString()}`)
} finally {
  await client.end()
}
