/**
 * Analytics retention.
 *
 *   npx tsx scripts/prune-analytics.mjs               # dry run
 *   npx tsx scripts/prune-analytics.mjs --write
 *   ANALYTICS_RETENTION_DAYS=30 npx tsx scripts/prune-analytics.mjs --write
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A DATABASE JOB
 * --------------------------------------------------
 * Because the store is an interface with more than one driver, and only one of
 * them is Postgres. A `pg_cron` job would silently do nothing on the others,
 * which is the worst kind of retention policy: one that is documented, believed,
 * and not running.
 *
 * WHY RETENTION IS NOT OPTIONAL
 * -----------------------------
 * Even pseudonymous behavioural data becomes more identifying the longer it is
 * kept and the more of it there is. Keeping raw events forever is a liability
 * that grows on its own, and "we never got round to deleting it" is not a
 * defensible answer to a data-subject request. 90 days is the default because it
 * covers a full quarter of seasonality, which is the longest window any report
 * on this dashboard actually looks at.
 *
 * Run it from whatever scheduler the deployment has. On Vercel that is a cron
 * hitting an endpoint, or a GitHub Action -- this repository already runs
 * scheduled workflows for the crawl (.github/workflows/refresh-jobs.yml).
 */

import { getAnalyticsStore } from '../lib/analytics/store.ts'

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')

const DEFAULT_RETENTION_DAYS = 90
const days = Number(process.env.ANALYTICS_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS)

if (!Number.isFinite(days) || days < 1) {
  console.error(`ANALYTICS_RETENTION_DAYS must be a positive number, got ${process.env.ANALYTICS_RETENTION_DAYS}`)
  process.exit(1)
}

const store = getAnalyticsStore()
const health = await store.health()
const cutoff = new Date(Date.now() - days * 86_400_000)

console.log(`Driver:    ${health.driver}${health.durable ? '' : ' (not durable)'}`)
console.log(`Retention: ${days} days`)
console.log(`Cutoff:    ${cutoff.toISOString()}  (anything older is removed)`)

if (!health.writable) {
  // Nothing to prune and nothing to be alarmed about, but say which it is:
  // "0 removed" from a broken store looks identical to "0 removed" from a
  // healthy empty one.
  console.log(`\nStore is not writable, so there is nothing to prune.\n  ${health.detail}`)
  process.exit(0)
}

if (!WRITE) {
  /**
   * The dry run counts rather than deletes.
   *
   * `read()` is bounded by the driver, so on a large table this is a floor
   * rather than an exact figure -- stated here rather than presented as exact.
   */
  const stale = await store.read({ from: new Date(0), to: cutoff })
  console.log(`\nDRY RUN: at least ${stale.length.toLocaleString('en-US')} events are older than the cutoff.`)
  console.log('Re-run with --write to delete them.')
  process.exit(0)
}

const removed = await store.prune(cutoff)
console.log(`\nRemoved ${removed.toLocaleString('en-US')} events older than ${cutoff.toISOString()}.`)
