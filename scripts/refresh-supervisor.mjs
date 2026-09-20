/**
 * Keep the job index continuously fresh, one tier at a time.
 *
 *   npx tsx scripts/refresh-supervisor.mjs
 *   npx tsx scripts/refresh-supervisor.mjs --hot 600 --warm 10800 --cold 86400
 *   npx tsx scripts/refresh-supervisor.mjs --once          # one pass, then exit
 *
 * WHY A SUPERVISOR RATHER THAN THREE `--loop` PROCESSES
 * -----------------------------------------------------
 * `refresh.mjs --loop` already polls a single tier forever. Running three of
 * them does NOT give you three tiers refreshing independently: refresh.mjs
 * takes a process-wide lock for its whole lifetime, deliberately, so that only
 * one process ever writes the index. Three loops means the first one holds the
 * lock and the other two fail immediately.
 *
 * This runs the tiers as one process instead. Each tier has its own interval
 * and its own next-due time; whichever is due runs next, and only one crawl is
 * ever in flight, so the index has a single writer by construction.
 *
 * WHAT "REAL-TIME" HONESTLY MEANS HERE
 * ------------------------------------
 * The same thing refresh.mjs says, because nothing here changes it: every ATS
 * in this system is poll-only, there are no webhooks, and freshness is bounded
 * by poll interval and nothing else. The defaults reflect what each tier can
 * actually sustain:
 *
 *   hot    greenhouse / ashby / lever / workable       every 10 min
 *   warm   smartrecruiters / recruitee / teamtailor    every 3 h
 *   cold   workday / eightfold / custom                every 24 h
 *
 * A Workday board takes 20-60s to crawl, so a 10-minute cold tier would be one
 * continuous crawl of other people's servers that never finished a pass. The
 * cadence per tier is the honest ceiling, not a throttle we could remove.
 *
 * PUBLISHING
 * ----------
 * refresh.mjs rebuilds the bounded deploy index on every pass. This adds the
 * gate: after a pass, verify-deploy-index.mjs runs against the previous index
 * and a rebuild that fails — shrank, lost a declared shard, blew the file
 * ceiling — is ROLLED BACK rather than left in place. An unattended loop that
 * can quietly replace a good index with a broken one is worse than no loop.
 */

import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const DEPLOY = val('deploy', 'public/data/jobs-deploy.json')
const INDEX = val('index', 'public/data/jobs-v2.json')
const BACKUP = val('backup', '.refresh-backup/jobs-deploy.json')
const LOG = val('log', '.refresh-backup/supervisor.log')
const ONCE = has('once')
const CONCURRENCY = val('concurrency', '10')

/** Seconds between passes for each tier. See the cadence note above. */
const TIERS = [
  { name: 'hot',  interval: Number(val('hot',  '600')) },
  { name: 'warm', interval: Number(val('warm', '10800')) },
  { name: 'cold', interval: Number(val('cold', '86400')) },
]

const isWindows = process.platform === 'win32'

function log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`
  console.log(stamped)
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, stamped + '\n')
  } catch {
    // A log we cannot write must not stop the refresh.
  }
}

function run(cmd, argv) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=12288' },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => resolve({ code, out }))
  })
}

/**
 * One tier pass: back up the current index, refresh, gate the rebuild, and
 * roll back if the gate rejects it.
 */
async function pass(tier) {
  const started = Date.now()
  log(`[${tier}] refresh starting`)

  const haveBaseline = existsSync(DEPLOY)
  if (haveBaseline) {
    mkdirSync(dirname(BACKUP), { recursive: true })
    copyFileSync(DEPLOY, BACKUP)
  }

  const refresh = await run(isWindows ? 'npx.cmd' : 'npx', [
    'tsx', 'scripts/refresh.mjs',
    '--tier', tier,
    '--concurrency', CONCURRENCY,
    '--out', INDEX,
  ])

  // The crawl summary is the useful line; the rest is per-board chatter.
  const summary = refresh.out.split('\n').filter((l) => /crawled|boards|jobs\b/.test(l)).slice(-3)
  for (const line of summary) log(`[${tier}] ${line.trim()}`)

  if (refresh.code !== 0) {
    log(`[${tier}] refresh FAILED (exit ${refresh.code}) — index untouched`)
    return
  }

  const gate = await run('node', [
    'scripts/verify-deploy-index.mjs',
    '--file', DEPLOY,
    ...(haveBaseline ? ['--floor-against', BACKUP] : []),
  ])

  if (gate.code !== 0) {
    const reason = gate.out.split('\n').find((l) => l.startsWith('FAIL')) ?? 'gate rejected the rebuild'
    log(`[${tier}] GATE REJECTED: ${reason.replace(/^FAIL\s+/, '')}`)
    if (haveBaseline) {
      copyFileSync(BACKUP, DEPLOY)
      log(`[${tier}] rolled back to the previous index`)
    }
    return
  }

  const accepted = gate.out.split('\n').find((l) => /jobs of .* corpus/.test(l)) ?? ''
  log(`[${tier}] published in ${((Date.now() - started) / 1000).toFixed(0)}s — ${accepted.replace(/^ok\s+/, '').trim()}`)
}

/* ----------------------------------- run ----------------------------------- */

if (ONCE) {
  for (const t of TIERS) await pass(t.name)
  log('single pass complete')
  process.exit(0)
}

log(`supervisor starting — ${TIERS.map((t) => `${t.name} every ${t.interval}s`).join(', ')}`)
log('one crawl at a time; Ctrl-C to stop.')

// Every tier is due immediately on the first cycle so the index gets one full
// refresh before settling into its cadence.
const dueAt = new Map(TIERS.map((t) => [t.name, 0]))

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) process.exit(1)   // a second Ctrl-C is impatience, honour it
    stopping = true
    log(`${sig} received — finishing the current pass, then stopping`)
  })
}

for (;;) {
  const now = Date.now()
  const due = TIERS.filter((t) => dueAt.get(t.name) <= now)

  if (due.length > 0) {
    // Cheapest tier first when several are due together, so a 24h cold pass
    // never delays a 10-minute hot one that came due while it was waiting.
    due.sort((a, b) => a.interval - b.interval)
    const tier = due[0]
    try {
      await pass(tier.name)
    } catch (err) {
      log(`[${tier.name}] supervisor error: ${err.message}`)
    }
    dueAt.set(tier.name, Date.now() + tier.interval * 1000)
  }

  if (stopping) {
    log('supervisor stopped')
    process.exit(0)
  }

  const nextDue = Math.min(...TIERS.map((t) => dueAt.get(t.name)))
  const waitMs = Math.max(1000, Math.min(nextDue - Date.now(), 60_000))
  await new Promise((r) => setTimeout(r, waitMs))
}
