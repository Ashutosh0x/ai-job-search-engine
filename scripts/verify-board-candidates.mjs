/**
 * Verify Common Crawl board candidates against each provider's live API.
 *
 *   npx tsx scripts/verify-board-candidates.mjs --sample 40
 *   npx tsx scripts/verify-board-candidates.mjs --provider ashby --limit 500 \
 *     --out data/verified-boards.json
 *
 * scripts/extract-board-universe.mjs produces ~24k candidate tokens. A token
 * only proves a board URL existed when the crawl ran — companies churn off
 * platforms and rename tenants constantly. This script is the gate between
 * "seen in an index" and "real employer with open roles right now".
 *
 * A candidate is admitted only when the provider's own API answers with at
 * least one live posting. Everything else is recorded with the reason it
 * failed, so a run says what it rejected rather than quietly shrinking.
 *
 * PACING
 * ------
 * These are other people's APIs and none of them owes us this traffic. The
 * default concurrency is deliberately low and every request carries a real
 * User-Agent. Raise it only if you have checked the provider's own limits.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const IN = val('in', 'data/board-universe.json')
const OUT = val('out', '')
const ONLY_PROVIDER = val('provider', '')
const SAMPLE = Number(val('sample', '0'))
const LIMIT = Number(val('limit', '0'))
const CONCURRENCY = Number(val('concurrency', '6'))
const UA = 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0; +job-index verification)'

/** Each probe returns the number of live postings, or throws. */
const PROBES = {
  async greenhouse(token) {
    const d = await get(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`)
    return (d.jobs ?? []).length
  },
  async lever(token) {
    const d = await get(`https://api.lever.co/v0/postings/${token}?mode=json`)
    return Array.isArray(d) ? d.length : 0
  },
  async ashby(token) {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
    return (d.jobs ?? []).length
  },
  async workable(token) {
    const d = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}`)
    return (d.jobs ?? []).length
  },
  async smartrecruiters(token) {
    const d = await get(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=1`)
    return d.totalFound ?? (d.content ?? []).length
  },
  async recruitee(token) {
    const d = await get(`https://${token}.recruitee.com/api/offers/`)
    return (d.offers ?? []).length
  },
  async teamtailor(token) {
    // Teamtailor's API needs a key; the public board is the honest probe.
    const html = await getText(`https://${token}.teamtailor.com/jobs`)
    return (html.match(/\/jobs\/\d+/g) ?? []).length
  },
  async breezy(token) {
    const d = await get(`https://${token}.breezy.hr/json`)
    return Array.isArray(d) ? d.length : 0
  },
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/* ---------- Build the work list ---------- */

const universe = JSON.parse(readFileSync(IN, 'utf8'))
const work = []

for (const [provider, tokens] of Object.entries(universe.candidates ?? {})) {
  if (!PROBES[provider]) continue                       // no probe written yet
  if (ONLY_PROVIDER && provider !== ONLY_PROVIDER) continue

  let list = tokens
  if (SAMPLE > 0) {
    // Evenly spaced rather than the first N: tokens are sorted alphabetically,
    // so the head is all digits and "a" names and not representative.
    const step = Math.max(1, Math.floor(list.length / SAMPLE))
    list = list.filter((_, i) => i % step === 0).slice(0, SAMPLE)
  } else if (LIMIT > 0) {
    list = list.slice(0, LIMIT)
  }

  for (const token of list) work.push({ provider, token })
}

console.log(`Verifying ${work.length} candidates across ${new Set(work.map((w) => w.provider)).size} providers (concurrency ${CONCURRENCY})\n`)

/* ---------- Verify ---------- */

const live = []
const dead = []
let done = 0

async function worker(queue) {
  while (queue.length) {
    const { provider, token } = queue.shift()
    try {
      const count = await PROBES[provider](token)
      if (count > 0) live.push({ provider, token, openRoles: count })
      else dead.push({ provider, token, reason: 'board answered with 0 postings' })
    } catch (err) {
      dead.push({ provider, token, reason: err.message })
    }
    done++
    if (done % 25 === 0) process.stdout.write(`  ${done}/${work.length} probed, ${live.length} live\r`)
  }
}

const queue = [...work]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

/* ---------- Report ---------- */

const byProvider = {}
for (const row of live) {
  byProvider[row.provider] ??= { live: 0, roles: 0 }
  byProvider[row.provider].live++
  byProvider[row.provider].roles += row.openRoles
}
for (const row of dead) {
  byProvider[row.provider] ??= { live: 0, roles: 0 }
  byProvider[row.provider].dead = (byProvider[row.provider].dead ?? 0) + 1
}

console.log(`\n\n${'='.repeat(60)}`)
console.log('BOARD VERIFICATION')
console.log('='.repeat(60))
console.log('provider            probed    live    live%     open roles')
console.log('-'.repeat(60))

for (const [provider, s] of Object.entries(byProvider).sort((a, b) => b[1].live - a[1].live)) {
  const probed = s.live + (s.dead ?? 0)
  const pct = probed ? ((s.live / probed) * 100).toFixed(0) + '%' : '-'
  console.log(
    provider.padEnd(18) + String(probed).padStart(8) + String(s.live).padStart(8) +
    pct.padStart(9) + String(s.roles).padStart(15)
  )
}

const totalRoles = live.reduce((a, r) => a + r.openRoles, 0)
console.log('-'.repeat(60))
console.log(`${'TOTAL'.padEnd(18)}${String(work.length).padStart(8)}${String(live.length).padStart(8)}` +
  `${(work.length ? ((live.length / work.length) * 100).toFixed(0) + '%' : '-').padStart(9)}${String(totalRoles).padStart(15)}`)

if (SAMPLE > 0) {
  const rate = live.length / Math.max(1, work.length)
  const universeSize = Object.entries(universe.candidates ?? {})
    .filter(([p]) => PROBES[p] && (!ONLY_PROVIDER || p === ONLY_PROVIDER))
    .reduce((a, [, t]) => a + t.length, 0)
  console.log(`\nSampled ${work.length} of ${universeSize.toLocaleString('en-US')} candidates.`)
  console.log(`At the measured ${(rate * 100).toFixed(0)}% live rate that projects to ` +
    `~${Math.round(universeSize * rate).toLocaleString('en-US')} live boards ` +
    `and ~${Math.round(universeSize * rate * (totalRoles / Math.max(1, live.length))).toLocaleString('en-US')} open roles.`)
  console.log('A projection from a sample, not a count. Run without --sample to count.')
}

console.log('\nTop live boards by open roles:')
for (const row of [...live].sort((a, b) => b.openRoles - a.openRoles).slice(0, 15)) {
  console.log(`  ${String(row.openRoles).padStart(5)}  ${row.provider}/${row.token}`)
}

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    probed: work.length,
    liveCount: live.length,
    totalOpenRoles: totalRoles,
    sampled: SAMPLE > 0,
    live: live.sort((a, b) => b.openRoles - a.openRoles),
    deadCount: dead.length,
  }, null, 2))
  console.log(`\nWrote ${OUT}`)
}
