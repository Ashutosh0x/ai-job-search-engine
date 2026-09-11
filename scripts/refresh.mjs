/**
 * Incremental refresh: keep the live index current without a full re-crawl.
 *
 *   node scripts/refresh.mjs --tier hot          # fast boards, minutes
 *   node scripts/refresh.mjs --tier warm
 *   node scripts/refresh.mjs --tier all --concurrency 12
 *   node scripts/refresh.mjs --tier hot --loop 900   # run forever, every 15 min
 *
 * WHY THIS EXISTS RATHER THAN JUST RUNNING THE FULL INGEST MORE OFTEN
 * ==================================================================
 * A full ingest crawls every registered board and rewrites a ~275MB index. It
 * takes ~20 minutes and saturates the network the whole time, so running it
 * every 15 minutes is not "fresher data" -- it is one continuous crawl that
 * hammers 1,200 employers and still leaves any individual board 20 minutes
 * stale on average.
 *
 * Refresh inverts the economics: crawl a SUBSET, merge the result INTO the
 * existing index, leave everything else untouched. A hot-tier pass over the
 * fast platforms finishes in seconds, so those boards can be polled every few
 * minutes while the long tail is refreshed daily.
 *
 * WHAT "REAL-TIME" HONESTLY MEANS HERE
 * ------------------------------------
 * There are no webhooks. Every ATS in this system is poll-only, so freshness is
 * bounded by poll interval and nothing else. What is achievable:
 *
 *   Greenhouse / Ashby / Lever   small JSON, ~0.5s per board  -> minutes
 *   SmartRecruiters / Recruitee  paginated, ~1-5s per board   -> tens of minutes
 *   Workday / Eightfold / ORC    ~20-60s per board            -> hours
 *
 * Calling any of that "real-time" without saying which tier would be a claim
 * about latency we cannot meet for most of the corpus. The report prints the
 * tier and the elapsed time so the claim stays checkable.
 *
 * MERGE SAFETY -- THE PART THAT MATTERS
 * ------------------------------------
 * A refresh must never lose jobs. Two rules:
 *
 *   1. Only boards that were ACTUALLY CRAWLED in this pass may have their jobs
 *      replaced. Everything else is copied through untouched. Without this, a
 *      hot-tier pass would delete every Workday job in the index.
 *
 *   2. `firstSeenAt` is preserved from the existing record. It is the cursor
 *      /api/jobs/delta pages on and the basis of ghost-job staleness, so
 *      resetting it on every refresh would make every job look new forever.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync, renameSync } from 'fs'
import { dirname, resolve } from 'path'

const { runIngest } = await import('../lib/pipeline/orchestrator.ts')
const { COMPANIES } = await import('../lib/companies/registry.ts')
const { mergeRefresh, boardKeyOfTarget, unsafeMergeReason } = await import('../lib/pipeline/merge.ts')
const { humanizeToken } = await import('../lib/companies/discovered.ts')
const { writeDeployIndex } = await import('../lib/pipeline/deploy-index.mjs')
const { readIndexJobs } = await import('../lib/pipeline/read-index.mjs')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const TIER = val('tier', 'hot')
const OUT = val('out', 'public/data/jobs-v2.json')
const STATE = '.ingest-state.json'
const DISCOVERED = 'scripts/discovered-boards.json'
const DEPLOY_OUT = val('deploy-out', 'public/data/jobs-deploy.json')
const DEPLOY_BUDGET_MB = Number(val('deploy-budget-mb', 30))
const concurrency = Number(val('concurrency', 8))
const loopSeconds = Number(val('loop', 0))
const dryRun = has('dry-run')

/**
 * Tiers by how expensive a board is to poll, which in practice means how the
 * platform paginates. These are measured averages from this repo's own crawl
 * reports, not guesses: Greenhouse ~436ms, Ashby ~700ms, SmartRecruiters
 * ~1.2-5.6s, Workday ~23-101s per board.
 */
const TIERS = {
  hot: ['greenhouse', 'ashby', 'lever', 'workable'],
  warm: ['smartrecruiters', 'recruitee', 'teamtailor', 'personio', 'mokahr'],
  cold: ['workday', 'eightfold', 'custom'],
}
TIERS.all = [...TIERS.hot, ...TIERS.warm, ...TIERS.cold]

const wanted = TIERS[TIER]
if (!wanted) {
  console.error(`Unknown tier "${TIER}". Use: ${Object.keys(TIERS).join(', ')}`)
  process.exit(1)
}

/* ------------------------------ write helper ------------------------------ */
//
// Same streaming writer as the full ingest: JSON.stringify of the whole corpus
// exceeds Node's 512MB max string length and throws at the very end, after all
// the work is done.
function writeJsonStream(path, head, arrayKey, rows) {
  // Write to a temp file and rename, rather than truncating the destination.
  //
  // openSync(path, 'w') truncates immediately and then streams for tens of
  // seconds on a 300MB+ index. For that whole window the file on disk is a
  // partial JSON document, so any reader -- the dev server, a serverless
  // function, a concurrent script -- gets a parse error and reports
  // "Job index is not available". rename() within the same directory is
  // atomic on both POSIX and Windows, so a reader sees either the old complete
  // file or the new one, never a half-written one.
  const tmp = `${path}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
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
  renameSync(tmp, path)
}

/* --------------------------------- one pass -------------------------------- */

async function refreshOnce() {
  const started = Date.now()

  if (!existsSync(OUT)) {
    console.error(`No index at ${OUT}. Run a full ingest first: npx tsx scripts/ingest-v2.mjs`)
    process.exit(1)
  }

  // Byte-level streaming read: the full index passed Node's ~512MB string
  // ceiling at 530MB, so readFileSync(OUT,'utf8') throws ERR_STRING_TOO_LONG
  // and refresh could no longer read its own base file.
  const { head: existing, jobs: existingJobs } = readIndexJobs(OUT)

  const targets = []
  const seen = new Set()
  const key = (p, t, st) => `${p}|${String(t).toLowerCase()}|${st ?? ''}`

  for (const c of COMPANIES) {
    for (const b of c.boards) {
      if (!wanted.includes(b.provider)) continue
      seen.add(key(b.provider, b.token, b.site))
      targets.push({
        source: b.provider, token: b.token, site: b.site, host: b.host,
        companySlug: c.slug, companyName: c.name, companyDomain: c.domain,
        discoveredVia: 'curated', confidence: 1,
      })
    }
  }

  // Auto-discovered boards too. The full ingest has always read these; refresh
  // did not, so every board found by scripts/discover-boards.mjs was invisible
  // to the incremental path -- discovery would add 66 verified tenants and the
  // next refresh would crawl none of them.
  //
  // They carry no curated metadata, so companySlug is left unset and
  // normalizeJob derives one from the domain, exactly as the full ingest does.
  if (existsSync(DISCOVERED)) {
    try {
      const disc = JSON.parse(readFileSync(DISCOVERED, 'utf8'))
      for (const b of disc.boards ?? []) {
        if (!wanted.includes(b.provider)) continue
        const k = key(b.provider, b.token, b.site)
        if (seen.has(k)) continue
        seen.add(k)
        targets.push({
          source: b.provider, token: b.token, site: b.site, host: b.host,
          companyName: humanizeToken(b.token),
          discoveredVia: 'common-crawl', confidence: 0.9,
        })
      }
    } catch {
      // A malformed discovery file must not stop a refresh of curated boards.
    }
  }

  console.log(`tier=${TIER}  ${targets.length} boards  (index has ${existingJobs.length.toLocaleString()} jobs)`)
  if (!targets.length) { console.log('nothing to refresh'); return }

  const previous = existsSync(STATE)
    ? JSON.parse(readFileSync(STATE, 'utf8'))
    : { hashes: {}, firstPosted: {}, knownIds: [] }

  const { jobs: fresh, report } = await runIngest({ targets, concurrency, previous })

  /* ------------------------------- the merge ------------------------------- */
  //
  // Delegated to lib/pipeline/merge.ts so the rules are unit-tested rather than
  // trusted. This is the one pipeline operation that can destroy data, and the
  // first version of the board key here was wrong in a way no crawl would have
  // revealed: it read the job id's third segment as a "site", but ids are
  // `source:token:sourceId` and carry no site, so every board looked empty.

  const now = new Date().toISOString()
  const crawledBoards = new Set(
    report.runs.filter((r) => r.ok).map((r) => boardKeyOfTarget(r.target))
  )

  const { jobs: merged, added, updated, removed, carriedThrough } = mergeRefresh({
    existing: existingJobs,
    fresh,
    crawledBoards,
    now,
  })

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `  crawled ${report.sourcesSucceeded}/${targets.length} boards` +
      `  +${added} new  ~${updated} seen again  -${removed} gone` +
      `  (${carriedThrough.toLocaleString()} untouched)  ${elapsed}s`
  )

  const H = report.http ?? {}
  if (H.requests?.blocked) console.log(`  ${H.requests.blocked} requests blocked`)
  if (report.sourcesFailed) console.log(`  ${report.sourcesFailed} boards failed`)

  // A refresh that lost most of the index is a bug, not a result. Refuse rather
  // than overwrite: a bad write here is unrecoverable without a full re-crawl.
  const unsafe = unsafeMergeReason(existingJobs.length, merged.length)
  if (unsafe) {
    console.error(`\nREFUSING TO WRITE: ${unsafe}`)
    process.exitCode = 1
    return
  }

  if (dryRun) { console.log('  --dry-run: not writing'); return }

  mkdirSync(dirname(OUT), { recursive: true })

  // When --out IS the deploy path, the two writes below would target the same
  // file and the second would silently clobber the first. Observed in CI: the
  // bounded 25,316-job index was written, then overwritten by the 47,104-job
  // merge, losing both the size budget and the `deployment.bounded` marker --
  // so the served index quietly stopped announcing that it was a slice.
  //
  // In that case the bounded write is the one that matters, because it is what
  // gets served. Write it alone and say so.
  const sameTarget = resolve(OUT) === resolve(DEPLOY_OUT)

  // Write the BOUNDED index too, from the array already in memory.
  //
  // The full index passed Node's ~512MB string ceiling at 530MB, which made it
  // unreadable by everything that consumed it -- including the app loader,
  // which silently fell back to a 14MB v1 snapshot and served 9,648 jobs while
  // 238,620 sat on disk. Regenerating the bounded slice by RE-READING the full
  // file would hit the same wall, so it is produced here instead, where the
  // records are already parsed.
  //
  // This makes the serving path independent of the archive's size: jobs-v2.json
  // can grow without limit, and jobs-deploy.json stays the thing that is loaded.
  try {
    const dep = writeDeployIndex(merged, DEPLOY_OUT, existing, DEPLOY_BUDGET_MB)
    console.log(`  deploy index: ${dep.count.toLocaleString()} jobs -> ${DEPLOY_OUT}`)
    if (sameTarget) {
      console.log('  --out is the deploy index; skipping the full write so it is not clobbered')
      return
    }
  } catch (e) {
    // A failure here must not lose the crawl that just completed.
    console.error(`  deploy index NOT written: ${e.message}`)
  }

  writeJsonStream(
    OUT,
    {
      generatedAt: now,
      jobCount: merged.length,
      refreshedTier: TIER,
      refreshedBoards: crawledBoards.size,
      // Keep the last FULL ingest report rather than overwriting it with a
      // partial one -- a tier report would otherwise look like corpus truth.
      report: existing.report ?? null,
      lastRefresh: {
        at: now, tier: TIER, boards: targets.length,
        added, updated, removed, durationMs: Date.now() - started,
      },
    },
    'jobs',
    merged
  )
  console.log(`  wrote ${OUT} (${merged.length.toLocaleString()} jobs)`)
}

/* ----------------------------------- run ----------------------------------- */

if (loopSeconds > 0) {
  console.log(`refreshing tier=${TIER} every ${loopSeconds}s. Ctrl-C to stop.\n`)
  for (;;) {
    try { await refreshOnce() } catch (e) { console.error('refresh failed:', e.message) }
    await new Promise((r) => setTimeout(r, loopSeconds * 1000))
  }
} else {
  await refreshOnce()
}
