/**
 * Crawl every board in a named group of employers and report their open roles.
 *
 *   npx tsx scripts/crawl-ecosystem.mjs --slugs solana-labs,phantom,helius
 *   npx tsx scripts/crawl-ecosystem.mjs --preset solana --out data/solana-roles.json
 *
 * Reads each employer's OWN ATS feed through the registry's board config, so
 * the result is what that company is advertising right now — not an
 * aggregator's copy of it.
 *
 * WHY THIS IS NOT "crawl jobs.solana.com"
 * ---------------------------------------
 * The registry's own note on the Solana entries says it plainly:
 * solana.com/careers redirects to jobs.solana.com, which is an ECOSYSTEM
 * board aggregating postings from independent companies building on Solana.
 * Crawling it would file other companies' jobs under Solana Labs. Solana
 * Labs' own board is Ashby `solanalabs`, and Solana Mobile is NOT a separate
 * employer — its roles post to that same board and are distinguished by
 * Ashby's `team` field, so registering it separately would double-count.
 *
 * This script therefore crawls each ecosystem member's real board separately
 * and attributes every posting to the company that actually published it.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { parseRegistry } from './lib/parse-registry.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const PRESET = val('preset', '')
const SLUGS = val('slugs', '')
const OUT = val('out', '')
const CONCURRENCY = Number(val('concurrency', '4'))
const UA = 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0)'

/**
 * Named groups. `solana` is the ecosystem as the registry defines it: Solana
 * Labs plus the independent companies discovered from the ecosystem board and
 * each verified against its own ATS.
 */
const PRESETS = {
  solana: [
    'solana-labs', 'phantom', 'ondo-finance', 'wormhole-labs', 'douro-labs',
    'magic-eden', 'helius', 'rain-cards', 'baton', 'edisyl', 'fomo-labs',
    'anza', 'jito',
  ],
}

const wanted = SLUGS
  ? SLUGS.split(',').map((s) => s.trim()).filter(Boolean)
  : PRESETS[PRESET]

if (!wanted) {
  console.error(`Need --slugs a,b,c or --preset <${Object.keys(PRESETS).join('|')}>`)
  process.exit(1)
}

/* ---------- Board config from the registry ---------- */

const { companies } = parseRegistry()
const registrySrc = (await import('fs')).readFileSync('lib/companies/registry.ts', 'utf8')

/** Pull the board list for one slug straight out of the registry source. */
function boardsFor(slug) {
  // Each entry is `{ slug: 'x', ... boards: [ ... ] }`; read from this slug up
  // to the start of the next entry so a token is never taken from a neighbour.
  const start = registrySrc.indexOf(`slug: '${slug}'`)
  if (start === -1) return []
  const nextEntry = registrySrc.indexOf('{ slug:', start + 1)
  const block = registrySrc.slice(start, nextEntry === -1 ? undefined : nextEntry)

  const boards = []
  for (const m of block.matchAll(/provider:\s*'([^']+)'\s*,\s*token:\s*'([^']+)'/g)) {
    boards.push({ provider: m[1], token: m[2] })
  }
  return boards
}

const targets = wanted.map((slug) => {
  const company = companies.find((c) => c.slug === slug)
  return company ? { ...company, boards: boardsFor(slug) } : { slug, missing: true }
})

const missing = targets.filter((t) => t.missing)
if (missing.length) {
  console.warn(`Not in the registry, skipped: ${missing.map((m) => m.slug).join(', ')}\n`)
}

/* ---------- ATS adapters ---------- */

const strip = (html) => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim()

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

const ADAPTERS = {
  async greenhouse(token) {
    const d = await get(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`)
    return (d.jobs ?? []).map((j) => ({
      title: j.title,
      location: j.location?.name ?? null,
      team: j.departments?.[0]?.name ?? null,
      url: j.absolute_url,
      postedAt: j.updated_at ?? null,
      description: strip(j.content).slice(0, 400),
    }))
  },

  async lever(token) {
    const d = await get(`https://api.lever.co/v0/postings/${token}?mode=json`)
    return (d ?? []).map((j) => ({
      title: j.text,
      location: j.categories?.location ?? null,
      team: j.categories?.team ?? null,
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      description: strip(j.descriptionPlain ?? j.description).slice(0, 400),
    }))
  },

  // Same endpoint the production WorkableAdapter uses
  // (lib/sources/adapters/ats.ts), so this script and the ingest pipeline
  // agree on what a Workable board contains.
  async workable(token) {
    const d = await get(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`)
    return (d.jobs ?? []).map((j) => ({
      title: j.title,
      location: [j.city, j.state, j.country].filter(Boolean).join(', ') || null,
      team: j.department ?? null,
      url: j.url ?? j.application_url,
      postedAt: j.published_on ?? null,
      description: strip(j.description).slice(0, 400),
    }))
  },

  async ashby(token) {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`)
    return (d.jobs ?? []).map((j) => ({
      title: j.title,
      location: j.location ?? null,
      // Ashby's `team` is what separates Solana Mobile from Solana Labs on the
      // one shared board, so it is carried through rather than flattened away.
      team: j.team ?? j.department ?? null,
      url: j.jobUrl ?? j.applyUrl,
      postedAt: j.publishedAt ?? null,
      description: strip(j.descriptionPlain ?? j.descriptionHtml).slice(0, 400),
    }))
  },
}

/* ---------- Crawl ---------- */

const results = []
let done = 0

async function worker(queue) {
  while (queue.length) {
    const company = queue.shift()
    const row = { slug: company.slug, name: company.name, domain: company.domain, jobs: [], errors: [] }

    for (const board of company.boards ?? []) {
      const adapter = ADAPTERS[board.provider]
      if (!adapter) {
        row.errors.push(`${board.provider}: no adapter in this script`)
        continue
      }
      try {
        const jobs = await adapter(board.token)
        for (const j of jobs) row.jobs.push({ ...j, provider: board.provider, board: board.token })
      } catch (err) {
        row.errors.push(`${board.provider}/${board.token}: ${err.message}`)
      }
    }

    results.push(row)
    done++
    const status = row.errors.length && row.jobs.length === 0 ? `FAILED (${row.errors[0]})` : `${row.jobs.length} roles`
    console.log(`[${String(done).padStart(2)}/${targets.length}] ${(row.name ?? row.slug).padEnd(16)} ${status}`)
  }
}

const queue = targets.filter((t) => !t.missing)
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker(queue)))

/* ---------- Report ---------- */

results.sort((a, b) => b.jobs.length - a.jobs.length)

const totalJobs = results.reduce((a, r) => a + r.jobs.length, 0)
const failed = results.filter((r) => r.jobs.length === 0 && r.errors.length)

console.log(`\n${'='.repeat(64)}`)
console.log(`${PRESET || 'group'}: ${totalJobs} open roles across ${results.length} employers`)
console.log('='.repeat(64))

for (const r of results) {
  if (!r.jobs.length) continue
  console.log(`\n${r.name} (${r.domain}) — ${r.jobs.length}`)

  // Group by team so a shared board (Solana Labs / Solana Mobile) reads correctly.
  const byTeam = new Map()
  for (const j of r.jobs) {
    const key = j.team ?? 'Unspecified'
    if (!byTeam.has(key)) byTeam.set(key, [])
    byTeam.get(key).push(j)
  }
  for (const [team, jobs] of [...byTeam].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${team} (${jobs.length})`)
    for (const j of jobs.slice(0, 12)) {
      console.log(`    · ${j.title}${j.location ? ` — ${j.location}` : ''}`)
    }
    if (jobs.length > 12) console.log(`    … and ${jobs.length - 12} more`)
  }
}

if (failed.length) {
  console.log(`\nBoards that returned nothing:`)
  for (const r of failed) console.log(`  ${r.name}: ${r.errors.join('; ')}`)
}

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    group: PRESET || 'custom',
    crawledAt: new Date().toISOString(),
    totalJobs,
    employers: results.length,
    results,
  }, null, 2))
  console.log(`\nWrote ${OUT}`)
}
