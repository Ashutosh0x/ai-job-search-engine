/**
 * Index-selection tests.
 *
 * THE ORIGINAL BUG
 * ----------------
 * The loader walked a candidate list and served the first file that existed and
 * parsed. MEASURED, 2026-09-15: an interrupted `npm run ingest` left a
 * well-formed jobs-v2.json holding 935 postings beside a jobs-deploy.json
 * holding 113,416. The small file won. Searching "London" returned ZERO results
 * while 2,768 London postings sat in the file next to it.
 *
 * THE FIRST FIX WAS NOT ENOUGH
 * ----------------------------
 * Ranking the candidates by job count stopped that specific failure but kept
 * the real defect: which corpus got served was still decided by whatever
 * happened to be on disk. Two machines on the same commit could serve different
 * data and neither would say so.
 *
 * WHAT IS PINNED NOW
 * ------------------
 * There is exactly one production index, `jobs-deploy.json`. jobs-v2.json is a
 * PIPELINE INTERMEDIATE -- the raw full-corpus output of scripts/refresh.mjs
 * that build-deploy-index.mjs reduces into the served slice -- and is not a
 * serving candidate at any size. An operator can override explicitly with
 * JOB_INDEX_FILE, and a broken override fails loudly instead of quietly
 * serving something else.
 *
 * The loader reads from process.cwd()/public/data, so each case runs in a
 * throwaway directory with its own fixtures rather than touching the real index.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Best-effort temp cleanup.
 *
 * Windows keeps a handle on a directory briefly after it stops being the
 * process cwd, so rmdir can throw EBUSY on a directory we are genuinely done
 * with. These live under the OS temp dir; failing to remove one is not a test
 * failure, and letting it throw turns a passing suite into a crash.
 */
async function cleanup(dir) {
  try { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) }
  catch { /* the OS will reap it */ }
}

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/** A minimal but schema-real v2 index holding `n` postings. */
function fixture(n, tag) {
  const jobs = Array.from({ length: n }, (_, i) => ({
    id: `${tag}:acme:${i}`,
    source: 'greenhouse',
    company: 'Acme',
    companySlug: 'acme',
    companyDomain: 'acme.com',
    title: `${tag} Engineer ${i}`,
    description: 'Build things.',
    locationRaw: 'London, England, United Kingdom',
    locationDisplay: 'London',
    city: 'London',
    state: 'England',
    country: 'United Kingdom',
    remote: false,
    employmentType: 'Full-time',
    seniority: 'mid',
    department: 'Engineering',
    salaryMin: null, salaryMax: null, salaryCurrency: null,
    skills: ['typescript'],
    postedAt: '2026-09-01T00:00:00.000Z',
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    applicationUrl: `https://acme.com/jobs/${tag}-${i}`,
    isDirectApplication: true,
  }))
  return { generatedAt: '2026-09-14T20:00:00.000Z', jobCount: n, jobs }
}

/**
 * Run `fn` with cwd pointed at a temp dir holding the given public/data files.
 *
 * The module caches the loaded index in module scope, so each case imports it
 * fresh with a cache-busting query string. `env` sets process.env for the
 * duration and restores it after.
 */
async function withIndex(files, fn, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'idx-'))
  await mkdir(join(dir, 'public', 'data'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(
      join(dir, 'public', 'data', name),
      typeof body === 'string' ? body : JSON.stringify(body),
    )
  }
  const cwd = process.cwd()
  const savedEnv = {}
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  process.chdir(dir)
  // Silence the selection notice; the point here is the choice, not the log.
  const info = console.info, err = console.error, warn = console.warn
  console.info = () => {}; console.error = () => {}; console.warn = () => {}
  try {
    const mod = await import(`../lib/job-index.ts?case=${Math.random()}`)
    return await fn(mod, dir)
  } finally {
    console.info = info; console.error = err; console.warn = warn
    process.chdir(cwd)
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await cleanup(dir)
  }
}

/* ============ THE BUG: a partial index must never shadow production ======== */
{
  await withIndex(
    { 'jobs-v2.json': fixture(935, 'partial'), 'jobs-deploy.json': fixture(113416, 'full') },
    async ({ searchJobs, lastIndexLoad }) => {
      const r = await searchJobs({ pageSize: 1 })
      t('the production index is served, not the partial pipeline file',
        r.total === 113416, r?.total)
      t('London is findable (it returned 0 before the fix)',
        (await searchJobs({ location: 'London', pageSize: 1 })).total === 113416)
      t('the served rows come from the production index',
        r.jobs[0].title.startsWith('full'), r.jobs[0]?.title)
      t('and the load reports which file it served',
        lastIndexLoad()?.origin === 'production', lastIndexLoad())
    },
  )
}

/* ====== jobs-v2.json is NOT a candidate, even when it is much larger ====== */
// This is the invariant the job-count ranking could not give: selection does
// not depend on what happens to be on disk.
{
  await withIndex(
    { 'jobs-v2.json': fixture(50000, 'v2'), 'jobs-deploy.json': fixture(200, 'deploy') },
    async ({ searchJobs }) => {
      const r = await searchJobs({ pageSize: 1 })
      t('a larger jobs-v2.json does NOT win — it is a pipeline input, not a corpus',
        r.total === 200, r?.total)
      t('and the served rows are the production ones',
        r.jobs[0].title.startsWith('deploy'), r.jobs[0]?.title)
    },
  )
}

/* ------------------- selection is stable across runs ---------------------- */
{
  await withIndex(
    { 'jobs-v2.json': fixture(100, 'v2'), 'jobs-deploy.json': fixture(100, 'deploy') },
    async ({ searchJobs }) => {
      const a = await searchJobs({ pageSize: 1 })
      const b = await searchJobs({ pageSize: 1 })
      t('equal-sized files do not make the choice ambiguous',
        a.jobs[0].title.startsWith('deploy') && b.jobs[0].title === a.jobs[0].title, a.jobs[0]?.title)
    },
  )
}

/* ------------------------- shards are still loaded ------------------------ */
{
  const primary = fixture(10, 'main')
  primary.jobCount = 25
  primary.shards = ['jobs-deploy.2.json']
  await withIndex(
    { 'jobs-deploy.json': primary, 'jobs-deploy.2.json': fixture(15, 'shard') },
    async ({ searchJobs }) => {
      const r = await searchJobs({ pageSize: 1 })
      t('shards named by the primary are loaded', r.total === 25, r?.total)
      t('and a complete shard set is not reported as degraded', !r.degraded, r?.degraded)
    },
  )
}

/* ---------------- a missing shard is announced, not hidden ---------------- */
{
  const primary = fixture(10, 'main')
  primary.jobCount = 25
  primary.shards = ['jobs-deploy.2.json']
  await withIndex({ 'jobs-deploy.json': primary }, async ({ searchJobs }) => {
    const r = await searchJobs({ pageSize: 1 })
    t('a missing shard still serves what loaded', r.total === 10, r?.total)
    t('but the result says it is degraded', Boolean(r.degraded), r?.degraded)
    t('and names the shard that failed',
      r.degraded?.missingShards?.includes('jobs-deploy.2.json'), r?.degraded)
  })
}

/* ---------------- a corrupt production index is FATAL, not fallback ------- */
// Falling back to a different corpus is the failure this file exists to stop,
// whichever direction it is approached from.
{
  await withIndex(
    {
      'jobs-deploy.json': '{ this is not json',
      'jobs-v2.json': fixture(500, 'v2'),
      'jobs-snapshot.json': { generatedAt: 'x', sources: [], companies: [], jobs: [], warnings: [] },
    },
    async ({ searchJobs }) => {
      const r = await searchJobs({ pageSize: 1 })
      t('an unreadable production index returns null rather than serving another file',
        r === null, r?.total)
    },
  )
}

/* -------------- an empty production index is not "no jobs" --------------- */
{
  await withIndex(
    { 'jobs-deploy.json': { generatedAt: 'x', jobCount: 0, jobs: [] } },
    async ({ searchJobs }) => {
      t('an index with zero postings is refused, not served as an empty market',
        (await searchJobs({ pageSize: 1 })) === null)
    },
  )
}

/* ------------------------- no index at all -------------------------------- */
{
  await withIndex({}, async ({ searchJobs }) => {
    t('no index returns null rather than an empty result set',
      (await searchJobs({ pageSize: 1 })) === null)
  })
}

/* ====================== the JOB_INDEX_FILE override ======================= */
{
  await withIndex(
    { 'jobs-v2.json': fixture(4242, 'v2'), 'jobs-deploy.json': fixture(200, 'deploy') },
    async ({ searchJobs, lastIndexLoad }) => {
      const r = await searchJobs({ pageSize: 1 })
      t('an explicit override serves the file the operator named',
        r.total === 4242, r?.total)
      t('and records that the choice was configured, not inferred',
        lastIndexLoad()?.origin === 'configured', lastIndexLoad()?.origin)
    },
    { JOB_INDEX_FILE: 'public/data/jobs-v2.json' },
  )
}

{
  await withIndex(
    { 'jobs-deploy.json': fixture(200, 'deploy'), 'jobs-snapshot.json': { generatedAt: 'x', sources: [], companies: [], jobs: [{}], warnings: [] } },
    async ({ searchJobs }) => {
      t('an override pointing at nothing FAILS — it does not fall back to production',
        (await searchJobs({ pageSize: 1 })) === null)
    },
    { JOB_INDEX_FILE: 'public/data/does-not-exist.json' },
  )
}

/* ----------------- the legacy snapshot is a last resort ------------------- */
{
  const legacy = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    sources: ['greenhouse'],
    companies: [{ slug: 'acme', name: 'Acme', domain: 'acme.com', boards: [], openRoles: 1 }],
    jobs: [{
      externalId: 'legacy:acme:1', provider: 'greenhouse', companySlug: 'acme',
      companyName: 'Acme', companyDomain: 'acme.com', title: 'Engineer',
      location: 'London', department: null, employmentType: null, isRemote: false,
      descriptionText: 'x', postedAt: null, applyUrl: 'https://acme.com/1',
      salaryMin: null, salaryMax: null, salaryCurrency: null,
    }],
    warnings: [],
  }
  await withIndex({ 'jobs-snapshot.json': legacy }, async ({ searchJobs, lastIndexLoad }) => {
    const r = await searchJobs({ pageSize: 1 })
    t('the legacy snapshot serves when production is absent', r?.total === 1, r?.total)
    t('and says so', lastIndexLoad()?.origin === 'legacy-snapshot', lastIndexLoad()?.origin)
  })

  await withIndex(
    { 'jobs-deploy.json': fixture(7, 'deploy'), 'jobs-snapshot.json': legacy },
    async ({ searchJobs, lastIndexLoad }) => {
      t('but never when production exists', (await searchJobs({ pageSize: 1 })).total === 7)
      t('and production is what is reported', lastIndexLoad()?.origin === 'production')
    },
  )
}

/* ------------------- the cache watches the file it loaded ----------------- */
// The cache key used to be re-derived independently of the load, so rewriting
// the file actually being served changed no mtime the cache could see and the
// refresh stayed invisible for the full five-minute TTL.
{
  await withIndex(
    { 'jobs-v2.json': fixture(10, 'partial'), 'jobs-deploy.json': fixture(500, 'full') },
    async ({ searchJobs }, dir) => {
      t('starts on the production index', (await searchJobs({ pageSize: 1 })).total === 500)

      // Rewrite the file being served. A refresh landing new jobs must be
      // visible on the next request, not five minutes later.
      await new Promise((r) => setTimeout(r, 12))
      await writeFile(
        join(dir, 'public', 'data', 'jobs-deploy.json'),
        JSON.stringify(fixture(650, 'full')),
      )
      t('a rewrite of the SERVED file invalidates the cache',
        (await searchJobs({ pageSize: 1 })).total === 650)
    },
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
