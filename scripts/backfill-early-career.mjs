/**
 * Backfill `earlyCareer` onto the already-committed deploy shards.
 *
 *   node scripts/backfill-early-career.mjs --dry
 *   node scripts/backfill-early-career.mjs
 *
 * The classifier runs at normalize time, so only newly crawled postings carry
 * the field. Re-crawling 113k postings to populate a value that is *derived
 * from text already in the index* would be wasteful and would put avoidable
 * load on every employer's ATS.
 *
 * This preserves the index rather than replacing it: it reads each shard, adds
 * two fields, and writes the same rows back. No posting is added, removed or
 * reordered, and the job count must be identical afterwards -- which is
 * asserted rather than assumed, because a backfill that silently drops rows
 * looks exactly like a successful one.
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'fs'
import { classifyEarlyCareer, EARLY_CAREER_CATEGORIES } from '../lib/pipeline/early-career.ts'

const dry = process.argv.includes('--dry')
const shards = readdirSync('public/data').filter((f) => /^jobs-deploy.*\.json$/.test(f)).sort()

if (!shards.length) {
  console.error('No deploy shards in public/data.')
  process.exit(1)
}

console.log(dry ? 'DRY RUN -- nothing will be written\n' : 'backfilling\n')

const totals = new Map()
let grandBefore = 0
let grandAfter = 0
let grandClassified = 0

for (const f of shards) {
  const path = `public/data/${f}`
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const isBare = Array.isArray(parsed)
  const rows = isBare ? parsed : parsed.jobs || []

  const before = rows.length
  let classified = 0
  let alreadyHad = 0

  for (const j of rows) {
    if (j.earlyCareer !== undefined && j.earlyCareer !== null) alreadyHad++
    const m = classifyEarlyCareer(j.title || '', j.description || '')
    j.earlyCareer = m?.category ?? null
    j.earlyCareerLevel = m?.level ?? null
    if (m) {
      classified++
      totals.set(m.category, (totals.get(m.category) || 0) + 1)
    }
  }

  const after = rows.length
  // A backfill must never change the row count. Saying so loudly beats
  // discovering it after the shard is committed.
  if (before !== after) {
    console.error(`  ABORT ${f}: row count changed ${before} -> ${after}`)
    process.exit(1)
  }

  grandBefore += before
  grandAfter += after
  grandClassified += classified

  console.log(`  ${f.padEnd(22)} ${String(before).padStart(6)} rows  ${String(classified).padStart(5)} classified` +
              `${alreadyHad ? `  (${alreadyHad} already had a value)` : ''}`)

  if (!dry) {
    // Keep one backup of the pre-backfill shard. Cheap insurance against a
    // classifier change that turns out to be wrong.
    const bak = `${path}.pre-earlycareer.bak`
    if (!existsSync(bak)) copyFileSync(path, bak)
    writeFileSync(path, JSON.stringify(isBare ? rows : { ...parsed, jobs: rows }))
  }
}

console.log(`\nrows before ${grandBefore}   rows after ${grandAfter}   ` +
            `${grandBefore === grandAfter ? 'UNCHANGED (correct)' : 'CHANGED -- investigate'}`)
console.log(`classified  ${grandClassified}  (${((grandClassified / grandAfter) * 100).toFixed(2)}%)\n`)

for (const c of EARLY_CAREER_CATEGORIES) {
  console.log(`  ${c.padEnd(14)} ${String(totals.get(c) || 0).padStart(6)}`)
}

if (dry) console.log('\n(dry run -- re-run without --dry to write)')
