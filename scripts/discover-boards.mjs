/**
 * Discover ATS boards from the open web index, then verify each one against
 * the provider's live API before admitting it.
 *
 *   npx tsx scripts/discover-boards.mjs                      # all providers
 *   npx tsx scripts/discover-boards.mjs --provider workday   # one
 *   npx tsx scripts/discover-boards.mjs --pages 2 --top 200  # bounded run
 *
 * Two stages, and the second is the one that matters:
 *
 *   DISCOVER  Common Crawl tells us a board URL existed when the crawl ran.
 *   VERIFY    We call the board's own API now. Only boards that answer with
 *             live postings are written out.
 *
 * A URL in a crawl is evidence, not proof: companies churn off ATS platforms,
 * rename tenants, and close boards. Skipping the verify step is how aggregators
 * end up listing dead companies and ghost jobs.
 */

import { writeFileSync } from 'fs'

const { latestCrawl, discoverProvider, PROVIDER_PATTERNS } = await import(
  '../lib/discovery/common-crawl.ts'
)

const args = process.argv.slice(2)
const argVal = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const onlyProvider = argVal('provider', null)
const maxPages = Number(argVal('pages', 3))
const topN = Number(argVal('top', 150))
const OUT = argVal('out', 'scripts/discovered-boards.json')
const VERIFY_CONCURRENCY = 10

const providers = onlyProvider
  ? [onlyProvider]
  : PROVIDER_PATTERNS.map((p) => p.provider)

const crawl = await latestCrawl()
console.log(`Common Crawl index: ${crawl}`)
console.log(`Providers: ${providers.join(', ')}`)
console.log(`Index pages per provider: ${maxPages}, verifying top ${topN}\n`)

/* ------------------------------- verification ------------------------------ */

async function verify(candidate) {
  const { provider, token, site, host } = candidate
  const timeout = AbortSignal.timeout(20_000)
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'JobSparkAI/1.0 (+https://jobspark.ai; board verification)',
  }

  try {
    let res, data, count = 0

    switch (provider) {
      case 'greenhouse':
        res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, { headers, signal: timeout })
        if (!res.ok) return null
        data = await res.json()
        count = data?.jobs?.length ?? 0
        break
      case 'lever':
        res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`, { headers, signal: timeout })
        if (!res.ok) return null
        data = await res.json()
        count = Array.isArray(data) ? data.length : 0
        break
      case 'ashby':
        res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${token}`, { headers, signal: timeout })
        if (!res.ok) return null
        data = await res.json()
        count = data?.jobs?.length ?? 0
        break
      case 'smartrecruiters':
        res = await fetch(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=1`, { headers, signal: timeout })
        if (!res.ok) return null
        data = await res.json()
        count = Number(data?.totalFound ?? 0)
        break
      case 'recruitee':
        res = await fetch(`https://${token}.recruitee.com/api/offers/`, { headers, signal: timeout })
        if (!res.ok) return null
        data = await res.json()
        count = data?.offers?.length ?? 0
        break
      case 'workday':
        res = await fetch(`https://${host}/wday/cxs/${token}/${site}/jobs`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
          signal: timeout,
        })
        if (!res.ok) return null
        data = await res.json()
        count = Number(data?.total ?? 0)
        break
      default:
        return null
    }

    return count > 0 ? { ...candidate, openRoles: count } : null
  } catch {
    return null // dead, renamed, blocked, or timed out -- all mean "not usable"
  }
}

/* ---------------------------------- run ----------------------------------- */

const verified = []
const stats = []

for (const provider of providers) {
  process.stdout.write(`Discovering ${provider}... `)
  let candidates = []
  try {
    candidates = await discoverProvider(crawl, provider, { maxPages })
  } catch (err) {
    console.log(`failed: ${err.message}`)
    continue
  }

  const shortlist = candidates.slice(0, topN)
  process.stdout.write(`${candidates.length} candidates, verifying ${shortlist.length}... `)

  const queue = [...shortlist]
  const live = []
  await Promise.all(
    Array.from({ length: VERIFY_CONCURRENCY }, async () => {
      while (queue.length) {
        const c = queue.shift()
        const ok = await verify(c)
        if (ok) live.push(ok)
      }
    })
  )

  // One tenant can expose several career sites (External, External_Career_Site,
  // a locale variant...) that all serve the same requisitions. Without this,
  // the same company is counted once per site and its roles are multiplied.
  // Keep the site with the most roles.
  const byTenant = new Map()
  for (const b of live) {
    const key = `${b.provider}|${b.token}`
    const prev = byTenant.get(key)
    if (!prev || b.openRoles > prev.openRoles) byTenant.set(key, b)
  }
  const deduped = [...byTenant.values()].sort((a, b) => b.openRoles - a.openRoles)

  verified.push(...deduped)
  stats.push({ provider, candidates: candidates.length, verified: deduped.length })
  console.log(`${deduped.length} live`)
}

/* --------------------------------- report --------------------------------- */

console.log('\nVerified boards by provider')
for (const s of stats) {
  console.log(`  ${s.provider.padEnd(16)} ${String(s.verified).padStart(4)} live / ${s.candidates} candidates`)
}

const totalRoles = verified.reduce((sum, b) => sum + b.openRoles, 0)
console.log(`\nTop boards found`)
for (const b of verified.slice(0, 25)) {
  console.log(`  ${String(b.openRoles).padStart(6)}  ${b.provider}/${b.token}${b.site ? ` (${b.site})` : ''}`)
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      discoveredAt: new Date().toISOString(),
      crawl,
      stats,
      totalBoards: verified.length,
      totalOpenRoles: totalRoles,
      boards: verified,
    },
    null,
    2
  )
)

console.log(`\n${verified.length} verified boards, ${totalRoles.toLocaleString()} open roles`)
console.log(`wrote ${OUT}`)
