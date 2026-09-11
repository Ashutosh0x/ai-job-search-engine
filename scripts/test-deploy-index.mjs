/**
 * Deploy-index selection and sharding.
 *
 * Two properties, both of which have already failed in production:
 *
 *   1. A tracked employer's roles must all be served. Selecting purely by rank
 *      served Barclays 3 postings out of 1,024 -- the crawl was complete and
 *      the slice threw it away.
 *   2. Every posting written must be readable back. The index is delivered
 *      through git, GitHub rejects blobs over 100 MiB, so it is sharded -- and
 *      a shard that is written but never read serves a partial index while
 *      looking perfectly healthy.
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { selectForDeploy, writeDeployIndex } from '../lib/pipeline/deploy-index.mjs'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const job = (i, slug, over = {}) => ({
  id: `greenhouse:${slug}:${i}`,
  source: 'greenhouse',
  company: slug,
  companySlug: slug,
  companyDomain: `${slug}.com`,
  title: `Engineer ${i}`,
  normalizedTitle: `engineer ${i}`,
  description: 'x'.repeat(200),
  city: 'London', country: 'United Kingdom',
  applicationUrl: `https://boards.greenhouse.io/${slug}/jobs/${i}`,
  isDirectApplication: true,
  postedAt: '2026-09-01T00:00:00.000Z',
  firstSeenAt: '2026-09-01T00:00:00.000Z',
  // Deliberately the WORST possible scores, so nothing here can win on rank.
  qualityScore: 0, freshnessScore: 0, ghostRisk: 1,
  skills: [],
  ...over,
})

/* --------------------- curated employers are complete --------------------- */
{
  // One tracked employer with many low-scoring roles, drowning in a field of
  // high-scoring ones from untracked boards.
  const tracked = Array.from({ length: 400 }, (_, i) => job(i, 'barclays'))
  const noise = Array.from({ length: 5000 }, (_, i) =>
    job(i, `board${i % 50}`, { qualityScore: 1, freshnessScore: 1, ghostRisk: 0 }))

  const withoutGuarantee = selectForDeploy([...tracked, ...noise], 1)
  const servedBefore = withoutGuarantee.chosen.filter((j) => j.companySlug === 'barclays').length

  const withGuarantee = selectForDeploy([...tracked, ...noise], 1, new Set(['barclays']))
  const servedAfter = withGuarantee.chosen.filter((j) => j.companySlug === 'barclays').length

  t('rank alone strands a tracked employer', servedBefore < 400, servedBefore)
  t('a curated employer is served complete', servedAfter === 400, servedAfter)
  t('and is reported as such', withGuarantee.completeCount === 400, withGuarantee.completeCount)

  // The per-employer cap must not apply to the complete pass, or a large
  // employer gets truncated to a share of the budget -- the original bug.
  t('the per-employer cap does not truncate a curated employer',
    servedAfter > withGuarantee.perCompanyCap || withGuarantee.perCompanyCap >= 400,
    { servedAfter, cap: withGuarantee.perCompanyCap })

  // Untracked boards must still get the floor rather than being crowded out.
  const floors = new Map()
  for (const j of withGuarantee.chosen) {
    if (j.companySlug === 'barclays') continue
    floors.set(j.companySlug, (floors.get(j.companySlug) ?? 0) + 1)
  }
  t('discovered boards still reach the floor',
    [...floors.values()].every((n) => n >= 3), [...floors].slice(0, 5))
}

/* ----------------------- sharded write/read round-trip --------------------- */
{
  const dir = mkdtempSync(join(tmpdir(), 'deploy-idx-'))
  const out = join(dir, 'jobs-deploy.json')
  try {
    // The shard cap is injectable so this does not need 120MB of fixtures.
    // Rows project to ~700B each, so 20KB per shard forces several.
    const SHARD = 20_000
    const many = Array.from({ length: 300 }, (_, i) => job(i, 'acme'))

    const res = writeDeployIndex(many, out, {}, 4096, new Set(['acme']), SHARD)

    t('every job is selected', res.count === 300, res.count)
    t('the write actually sharded', res.shards > 1, res.shards)

    const head = JSON.parse(readFileSync(out, 'utf8'))
    t('the primary file names its shards',
      Array.isArray(head.shards) && head.shards.length === res.shards - 1, head.shards)
    t('the header job count is the WHOLE index, not the primary shard',
      head.jobCount === 300 && head.jobs.length < 300,
      { jobCount: head.jobCount, inPrimary: head.jobs.length })

    // Reassemble exactly as lib/job-index.ts does.
    let total = head.jobs.length
    const ids = new Set(head.jobs.map((j) => j.id))
    for (const name of head.shards) {
      const shard = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      total += shard.jobs.length
      for (const j of shard.jobs) ids.add(j.id)
    }
    t('primary plus shards reassemble to the full index', total === 300, total)
    t('no job is duplicated or lost across shards', ids.size === 300, ids.size)

    // A shrinking corpus must not leave an orphaned tail behind, or the loader
    // keeps serving postings this build dropped.
    const fewer = writeDeployIndex(many.slice(0, 3), out, {}, 4096, new Set(['acme']), SHARD)
    const orphan = out.replace(/\.json$/, `.${res.shards}.json`)
    t('a smaller rebuild deletes the shards it no longer needs',
      fewer.shards < res.shards && !existsSync(orphan), { was: res.shards, now: fewer.shards })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
