/**
 * Pagination regression tests for the enterprise adapters.
 *
 * The same bug has now appeared three times, in three different adapters:
 *
 *   Workday    trusted a per-page `total` and truncated 1,436 jobs to 40.
 *   Eightfold  asked for 100, got the server's hard cap of 10, and treated the
 *              short page as "board exhausted" -- 1,611 jobs became 10.
 *   Oracle     returns 199 rows for a limit of 200 partway through a board, so
 *              the short-page break ended the crawl at 306 of 2,197.
 *
 * The lesson each time: a page shorter than requested does NOT mean the board
 * is finished. These tests pin that behaviour with fake servers so the next
 * adapter cannot regress it quietly.
 */
const { EightfoldAdapter, OracleRecruitingAdapter } = await import('../lib/sources/adapters/enterprise.ts')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/** Swap global fetch for a scripted responder, then restore it. */
async function withFetch(handler, fn) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => new Response(JSON.stringify(handler(String(url))), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
  try { return await fn() } finally { globalThis.fetch = original }
}

/* -------------------------------- Eightfold ------------------------------- */
{
  const TOTAL = 47
  const CAP = 10 // server ignores `num` and returns at most this many
  let requests = 0

  const jobs = await withFetch((url) => {
    requests++
    const start = Number(new URL(url).searchParams.get('start') ?? 0)
    const n = Math.max(0, Math.min(CAP, TOTAL - start))
    return {
      count: TOTAL,
      positions: Array.from({ length: n }, (_, i) => ({
        id: start + i, name: `Job ${start + i}`, location: 'London',
        canonicalPositionUrl: `https://x.eightfold.ai/careers/job/${start + i}`,
      })),
    }
  }, async () => {
    const a = new EightfoldAdapter()
    const r = await a.fetchJobs({ source: 'eightfold', token: 'acme', companyDomain: 'acme.com', companyName: 'Acme' })
    return r.jobs
  })

  t('eightfold walks the whole board despite the 10-per-page cap',
    jobs.length === TOTAL, jobs.length)
  t('eightfold made more than one request', requests > 1, requests)
  t('eightfold ids are unique (no repeated page)',
    new Set(jobs.map(j => j.sourceId)).size === TOTAL, new Set(jobs.map(j => j.sourceId)).size)
}

/* ---------------------------------- Oracle -------------------------------- */
{
  const TOTAL = 653
  const LIMIT = 200
  // Deliberately return a SHORT page in the middle -- the exact shape that
  // truncated the real crawl.
  const shortAt = 200

  const jobs = await withFetch((url) => {
    const m = /offset=(\d+)/.exec(url)
    const offset = Number(m?.[1] ?? 0)
    let n = Math.max(0, Math.min(LIMIT, TOTAL - offset))
    if (offset === shortAt) n = Math.min(n, LIMIT - 1) // 199, not 200
    return {
      items: [{
        TotalJobsCount: TOTAL,
        requisitionList: Array.from({ length: n }, (_, i) => ({
          Id: offset + i, Title: `Role ${offset + i}`, PrimaryLocation: 'Austin, TX',
          PostedDate: '2026-09-01',
        })),
      }],
    }
  }, async () => {
    const a = new OracleRecruitingAdapter()
    const r = await a.fetchJobs({
      source: 'custom', token: 'CX_1', host: 'eeho.fa.us2.oraclecloud.com',
      companyName: 'Oracle', companyDomain: 'oracle.com',
    })
    return r.jobs
  })

  t('oracle does not stop on a mid-stream short page',
    jobs.length === TOTAL, jobs.length)
  t('oracle ids are unique (offset advanced by rows received)',
    new Set(jobs.map(j => j.sourceId)).size === TOTAL, new Set(jobs.map(j => j.sourceId)).size)
}

/* --------------------------- empty page terminates ------------------------ */
{
  // A board whose reported count overstates reality must still terminate.
  const jobs = await withFetch((url) => {
    const start = Number(new URL(url).searchParams.get('start') ?? 0)
    return { count: 9999, positions: start >= 20 ? [] : Array.from({ length: 10 }, (_, i) => ({
      id: start + i, name: `Job ${start + i}`, location: 'X',
    })) }
  }, async () => {
    const a = new EightfoldAdapter()
    // A DIFFERENT token: the adapter caches by URL for the life of the
    // process, so reusing 'acme' here would replay the previous block's pages.
    const r = await a.fetchJobs({ source: 'eightfold', token: 'lying-count', companyDomain: 'lying-count.com' })
    return r.jobs
  })
  t('an empty page ends the crawl even when count lies', jobs.length === 20, jobs.length)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
