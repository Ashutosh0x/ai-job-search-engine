/**
 * Refresh merge safety.
 *
 * This is the one pipeline operation that can DESTROY data: it replaces part of
 * a good index. Every assertion here is about not losing jobs that are still
 * open, and about not resetting the timestamps the delta feed and ghost-job
 * detection depend on.
 */

import { mergeRefresh, boardKeyOf, boardKeyOfTarget, unsafeMergeReason } from '../lib/pipeline/merge.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 300)) }
}

const job = (id, source, firstSeenAt) => ({ id, source, firstSeenAt, title: 'Engineer' })

/* ---------- rule 1: a board we did not crawl must not be emptied ----------- */
{
  const existing = [
    job('greenhouse:stripe:1', 'greenhouse', '2026-01-01T00:00:00.000Z'),
    job('workday:hp:9', 'workday', '2026-01-01T00:00:00.000Z'),
    job('workday:hp:10', 'workday', '2026-01-01T00:00:00.000Z'),
  ]
  // A hot-tier pass: Greenhouse only. Workday was never asked.
  const crawled = new Set(['greenhouse|stripe'])
  const fresh = [job('greenhouse:stripe:1', 'greenhouse'), job('greenhouse:stripe:2', 'greenhouse')]

  const r = mergeRefresh({ existing, fresh, crawledBoards: crawled })

  t('jobs from an un-crawled board survive', r.carriedThrough === 2, r)
  t('un-crawled jobs are still present by id',
    r.jobs.filter((j) => j.source === 'workday').length === 2, r.jobs.map((j) => j.id))
  t('a genuinely new job is counted as added', r.added === 1, r)
  t('a job seen again is counted as updated', r.updated === 1, r)
  t('nothing is reported removed', r.removed === 0, r)
  t('total is carried + fresh', r.jobs.length === 4, r.jobs.length)
}

/* ---------------- rule 2: firstSeenAt must never be reset ----------------- */
{
  const ORIGINAL = '2026-03-01T12:00:00.000Z'
  const existing = [job('greenhouse:stripe:1', 'greenhouse', ORIGINAL)]
  const crawled = new Set(['greenhouse|stripe'])
  // The board returns it again, this time with no firstSeenAt of its own.
  const fresh = [job('greenhouse:stripe:1', 'greenhouse', undefined)]

  const r = mergeRefresh({ existing, fresh, crawledBoards: crawled, now: '2026-09-11T00:00:00.000Z' })
  t('firstSeenAt is preserved across a refresh',
    r.jobs[0].firstSeenAt === ORIGINAL, r.jobs[0].firstSeenAt)
}
{
  // A genuinely new job gets `now`, so the delta cursor can find it.
  const r = mergeRefresh({
    existing: [],
    fresh: [job('greenhouse:stripe:2', 'greenhouse', undefined)],
    crawledBoards: new Set(['greenhouse|stripe']),
    now: '2026-09-11T00:00:00.000Z',
  })
  t('a new job is stamped with now', r.jobs[0].firstSeenAt === '2026-09-11T00:00:00.000Z', r.jobs[0])
}

/* --------------- a crawled board's closed job IS removed ------------------ */
{
  const existing = [
    job('greenhouse:stripe:1', 'greenhouse', '2026-01-01T00:00:00.000Z'),
    job('greenhouse:stripe:2', 'greenhouse', '2026-01-01T00:00:00.000Z'),
  ]
  const crawled = new Set(['greenhouse|stripe'])
  const fresh = [job('greenhouse:stripe:1', 'greenhouse')]

  const r = mergeRefresh({ existing, fresh, crawledBoards: crawled })
  t('a job gone from a crawled board is removed', r.removed === 1, r)
  t('and is absent from the merged set',
    !r.jobs.some((j) => j.id === 'greenhouse:stripe:2'), r.jobs.map((j) => j.id))
}

/* ------- a multi-site tenant is ONE unit, because ids carry no site -------- */
//
// Lloyds runs lbg_Careers and Graduate_careers. Their job ids are both
// `workday:lbg:<jobid>` -- the site is NOT in the id -- so the two sites cannot
// be told apart after the fact. This is safe only because a tier refresh
// selects by provider and therefore crawls every site on a tenant in the same
// pass. These assert that invariant holds.
{
  const existing = [
    job('workday:lbg:1', 'workday', '2026-01-01T00:00:00.000Z'),   // lbg_Careers
    job('workday:lbg:2', 'workday', '2026-01-01T00:00:00.000Z'),   // Graduate_careers
  ]
  // Both sites crawled together, as the tier refresh does.
  const crawled = new Set(['workday|lbg'])
  const fresh = [job('workday:lbg:1', 'workday'), job('workday:lbg:2', 'workday')]

  const r = mergeRefresh({ existing, fresh, crawledBoards: crawled })
  t('a tenant crawled completely keeps all its jobs', r.jobs.length === 2, r.jobs.map((j) => j.id))
  t('and loses none of them', r.removed === 0, r)

  // The dangerous case, made explicit: a PARTIAL crawl of a multi-site tenant
  // would drop the uncrawled site's jobs, because nothing distinguishes them.
  const partial = mergeRefresh({
    existing, fresh: [job('workday:lbg:1', 'workday')], crawledBoards: crawled,
  })
  t('a PARTIAL tenant crawl does drop the missing site (known limitation)',
    partial.removed === 1, partial)
}

/* ------------------------- board key derivation --------------------------- */
{
  t('board key matches between a job and its target',
    boardKeyOf({ id: 'workday:hp:123', source: 'workday' }) ===
      boardKeyOfTarget({ source: 'workday', token: 'hp', site: 'ExternalCareerSite' }))
  t('a site-less board keys consistently',
    boardKeyOf({ id: 'greenhouse:stripe:9', source: 'greenhouse' }) ===
      boardKeyOfTarget({ source: 'greenhouse', token: 'stripe' }))
}

/* ---------------------------- the safety valve ---------------------------- */
{
  t('a >50% loss is refused', unsafeMergeReason(1000, 400) !== null, unsafeMergeReason(1000, 400))
  t('a normal churn is allowed', unsafeMergeReason(1000, 980) === null)
  t('an exactly-half merge is allowed', unsafeMergeReason(1000, 500) === null)
  t('building from an empty index is allowed', unsafeMergeReason(0, 0) === null)
  t('the refusal explains itself', /merge fault/i.test(unsafeMergeReason(1000, 10) ?? ''))
}

/* ------------------------------- empty cases ------------------------------ */
{
  const r = mergeRefresh({ existing: [], fresh: [], crawledBoards: new Set() })
  t('empty in, empty out', r.jobs.length === 0 && r.added === 0, r)

  // A crawled board legitimately returning nothing empties only itself.
  const r2 = mergeRefresh({
    existing: [job('greenhouse:dead:1', 'greenhouse', '2026-01-01T00:00:00.000Z')],
    fresh: [],
    crawledBoards: new Set(['greenhouse|dead']),
  })
  t('a board that returned nothing removes only its own jobs',
    r2.jobs.length === 0 && r2.removed === 1, r2)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
