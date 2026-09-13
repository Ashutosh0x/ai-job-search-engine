/**
 * Where the job postings actually are: volume, concentration, cost.
 *
 *   node --max-old-space-size=6144 scripts/analyze-corpus-volume.mjs
 *
 * WHAT "MOST TRAFFIC" CAN AND CANNOT MEAN HERE
 * --------------------------------------------
 * We have no visitor data for anyone else's site and no way to get it, so this
 * does not report how much traffic an employer's careers page receives. Two
 * things we CAN measure exactly are reported instead:
 *
 *   SUPPLY    how many postings each endpoint actually served us
 *   COST      how many requests each endpoint cost our crawler to read
 *
 * Those are different questions with different answers, and the gap between
 * them is the interesting part: the endpoints holding the most jobs are not
 * the ones that cost the most to read.
 *
 * A MEASUREMENT ASYMMETRY THAT MUST NOT BE HIDDEN
 * -----------------------------------------------
 * Workday is the only provider this repo has crawled posting-by-posting. For
 * every other provider we hold a VERIFIED ROLE COUNT per board -- the number
 * its API reported when we called it -- but not the postings themselves. So
 * cross-provider comparisons below use reported counts on both sides, and the
 * Workday deep-dive uses real postings. Mixing the two would overstate Workday
 * simply because we looked at it harder.
 */

import { createReadStream, readFileSync, writeFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'

const NDJSON = 'data/workday/workday-jobs.ndjson'
const BOARDS = 'scripts/discovered-boards.json'
const OUT = 'data/corpus-volume.txt'

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(2)}%` : '-')
const num = (n) => n.toLocaleString('en-US')

/* ------------------- 1. cross-provider, reported counts ------------------- */

const boards = JSON.parse(readFileSync(BOARDS, 'utf8')).boards
const byProvider = new Map()
for (const b of boards) {
  const p = b.provider
  if (!byProvider.has(p)) byProvider.set(p, { boards: 0, roles: 0, max: 0, maxToken: '' })
  const e = byProvider.get(p)
  e.boards++
  const n = Number(b.openRoles) || 0
  e.roles += n
  if (n > e.max) { e.max = n; e.maxToken = b.token }
}
const provRows = [...byProvider].map(([p, e]) => ({ provider: p, ...e }))
  .sort((a, b) => b.roles - a.roles)
const totalRoles = provRows.reduce((s, r) => s + r.roles, 0)
const totalBoards = provRows.reduce((s, r) => s + r.boards, 0)

/* --------------------- 2. Workday corpus, real postings ------------------- */

let total = 0
const seen = new Set()
const byTenant = new Map()      // tenant -> postings
const byEndpoint = new Map()    // host/site -> postings
const byShard = new Map()       // wdN -> postings
const byHostTenant = new Map()  // tenant -> host

if (existsSync(NDJSON)) {
  const rl = createInterface({ input: createReadStream(NDJSON), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    /**
     * Fold the site segment's case before deduping.
     *
     * Workday serves the same board at any casing of the site path -- verified
     * live: `AccentureCareers`, `accenturecareers` and `ACCENTURECAREERS` all
     * return the same total and the same first posting. The crawl read several
     * spellings as separate boards, and because the site segment sits inside
     * the posting URL, plain URL dedupe could not collapse them. Left
     * unfolded, this corpus reports 814,389 "unique" postings when it holds
     * 593,607 -- a 27.1% overcount, with Accenture appearing twice at ~21,000
     * postings each.
     */
    const m = /^(https:\/\/[^/]+)\/([^/]+)(\/.*)?$/.exec(j.url)
    const canonical = m ? `${m[1]}/${m[2].toLowerCase()}${m[3] ?? ''}` : j.url
    if (seen.has(canonical)) continue
    seen.add(canonical)
    total++

    byTenant.set(j.tenant, (byTenant.get(j.tenant) ?? 0) + 1)
    const ep = `${String(j.host).toLowerCase()}/${String(j.site).toLowerCase()}`
    byEndpoint.set(ep, (byEndpoint.get(ep) ?? 0) + 1)
    const shard = /\.(wd\d+)\./.exec(String(j.host))?.[1] ?? 'other'
    byShard.set(shard, (byShard.get(shard) ?? 0) + 1)
    if (!byHostTenant.has(j.tenant)) byHostTenant.set(j.tenant, j.host)
  }
}

const tenantRows = [...byTenant].sort((a, b) => b[1] - a[1])
const endpointRows = [...byEndpoint].sort((a, b) => b[1] - a[1])
const shardRows = [...byShard].sort((a, b) => b[1] - a[1])

/** How concentrated is supply? Share held by the top N% of tenants. */
function topShare(rows, fraction) {
  const k = Math.max(1, Math.ceil(rows.length * fraction))
  const held = rows.slice(0, k).reduce((s, [, n]) => s + n, 0)
  return { k, held, share: total ? held / total : 0 }
}

/**
 * Gini coefficient over tenants: 0 = every tenant holds the same number of
 * postings, 1 = one tenant holds everything. Reported because "the top 10
 * tenants are big" is true of almost any corpus and says little on its own.
 */
function gini(values) {
  const v = [...values].sort((a, b) => a - b)
  const n = v.length
  if (!n) return 0
  const sum = v.reduce((s, x) => s + x, 0)
  if (!sum) return 0
  let cum = 0
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i]
  return (2 * cum) / (n * sum) - (n + 1) / n
}

/* ------------------------------- 3. report -------------------------------- */

const L = []
L.push('# WHERE THE JOB POSTINGS ARE')
L.push(`# generated ${new Date().toISOString()}`)
L.push('')
L.push('SCOPE OF THE WORD "TRAFFIC"')
L.push('  We have no visitor data for any employer site and no way to obtain it,')
L.push('  so nothing here reports how busy anyone else\'s careers page is. What is')
L.push('  measured is SUPPLY (postings served to us) and COST (requests we spent).')
L.push('')

L.push('=============================================================')
L.push('1. SUPPLY BY PLATFORM  (verified role counts, like for like)')
L.push('=============================================================')
L.push('  Every number is what that board\'s own API reported when called.')
L.push(`  ${num(totalBoards)} verified boards, ${num(totalRoles)} roles.`)
L.push('')
L.push('  platform          boards   share    roles      share   roles/board   largest board')
for (const r of provRows) {
  L.push(
    `  ${r.provider.padEnd(16)} ${String(r.boards).padStart(6)}  ${pct(r.boards, totalBoards).padStart(6)}  ` +
    `${num(r.roles).padStart(9)}  ${pct(r.roles, totalRoles).padStart(6)}  ` +
    `${(r.roles / r.boards).toFixed(1).padStart(11)}   ${r.maxToken} (${num(r.max)})`
  )
}
L.push('')
const wd = provRows.find((r) => r.provider === 'workday')
const gh = provRows.find((r) => r.provider === 'greenhouse')
if (wd && gh) {
  L.push(`  Workday holds ${pct(wd.roles, totalRoles)} of roles from ${pct(wd.boards, totalBoards)} of boards:`)
  L.push(`  ${(wd.roles / wd.boards).toFixed(0)} roles per board against Greenhouse's ${(gh.roles / gh.boards).toFixed(0)}.`)
  L.push(`  That ratio -- ${(wd.roles / wd.boards / (gh.roles / gh.boards)).toFixed(1)}x -- is the whole story of where enterprise hiring sits.`)
}
L.push('')

if (total) {
  L.push('=============================================================')
  L.push('2. THE WORKDAY CORPUS  (actual postings read)')
  L.push('=============================================================')
  L.push(`  ${num(total)} unique postings across ${num(byTenant.size)} tenants and ${num(byEndpoint.size)} endpoints.`)
  L.push('')
  L.push('  CONCENTRATION')
  for (const f of [0.001, 0.01, 0.05, 0.1, 0.25, 0.5]) {
    const t = topShare(tenantRows, f)
    L.push(`    top ${String(f * 100).padStart(5)}% of tenants (${String(t.k).padStart(4)}) hold ${num(t.held).padStart(9)} postings = ${pct(t.held, total)}`)
  }
  L.push(`    Gini across tenants: ${gini([...byTenant.values()]).toFixed(3)}  (0 = even, 1 = one tenant holds all)`)
  const median = tenantRows.length ? tenantRows[Math.floor(tenantRows.length / 2)][1] : 0
  L.push(`    mean ${(total / byTenant.size).toFixed(1)} postings/tenant, median ${median} -- a mean ${(total / byTenant.size / Math.max(median, 1)).toFixed(1)}x the median`)
  L.push('')

  L.push('  TOP 20 ENDPOINTS BY POSTINGS')
  L.push('    postings   share   cum.    endpoint')
  let cum = 0
  for (const [ep, n] of endpointRows.slice(0, 20)) {
    cum += n
    L.push(`    ${num(n).padStart(8)}  ${pct(n, total).padStart(6)}  ${pct(cum, total).padStart(6)}  ${ep}`)
  }
  L.push('')

  L.push('  BY WORKDAY SHARD')
  L.push('    postings   share   tenants   shard')
  const tenantsPerShard = new Map()
  for (const [t, host] of byHostTenant) {
    const s = /\.(wd\d+)\./.exec(String(host))?.[1] ?? 'other'
    tenantsPerShard.set(s, (tenantsPerShard.get(s) ?? 0) + 1)
  }
  for (const [s, n] of shardRows) {
    L.push(`    ${num(n).padStart(8)}  ${pct(n, total).padStart(6)}  ${String(tenantsPerShard.get(s) ?? 0).padStart(7)}   ${s}`)
  }
  L.push('')
}

writeFileSync(OUT, L.join('\n'))
console.log(L.join('\n'))
console.log(`\nwrote ${OUT}`)
