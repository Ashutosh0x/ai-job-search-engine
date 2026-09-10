/**
 * Ingest every verified ATS board into a snapshot, enriching companies with a
 * derived market cap where they are public.
 *
 *   node scripts/ingest-jobs.mjs                  # write public/data/jobs-snapshot.json
 *   node scripts/ingest-jobs.mjs --no-marketcap   # skip SEC/Yahoo enrichment
 *   node scripts/ingest-jobs.mjs --limit 5        # first N companies (smoke test)
 *
 * The snapshot is a cache of real responses from official public APIs, not a
 * fixture: every posting in it came from the employer's own ATS. When Supabase
 * is configured the same records are upserted there; the snapshot is what lets
 * the app serve real listings in local development without a database.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { register } from 'node:module'

// Load the TypeScript sources directly (Node 22+ type stripping).
const { buildCompanyList } = await import('../lib/companies/discovered.ts')
const { fetchBoard } = await import('../lib/ats/connectors.ts')
const { htmlToText } = await import('../lib/ats/types.ts')
const { getMarketCap } = await import('../lib/companies/market-cap.ts')
const { parseLocations } = await import('../lib/location.ts')

const args = process.argv.slice(2)
const noMarketCap = args.includes('--no-marketcap')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity
const OUT = 'public/data/jobs-snapshot.json'

// Curated companies plus auto-discovered, verified boards. --curated-only
// restricts to the hand-checked list.
const curatedOnly = args.includes('--curated-only')
const minRolesIdx = args.indexOf('--min-roles')
const allCompanies = buildCompanyList({
  includeDiscovered: !curatedOnly,
  minOpenRoles: minRolesIdx !== -1 ? Number(args[minRolesIdx + 1]) : 5,
})
const companies = allCompanies.slice(0, limit)
console.log(`Ingesting ${companies.length} companies...\n`)

const allJobs = []
const companyOut = []
const warnings = []

// Boards are fetched with modest concurrency: these are other people's public
// endpoints and there is no reason to hammer them.
const CONCURRENCY = 4
const queue = [...companies]

async function worker() {
  while (queue.length) {
    const company = queue.shift()
    let openRoles = 0

    for (const board of company.boards) {
      const result = await fetchBoard({ ...board, companySlug: company.slug })
      warnings.push(...result.warnings)
      for (const job of result.jobs) {
        // Normalise the location at ingest so the search facet groups by real
        // places rather than by each ATS's spelling of them.
        const locations = parseLocations(job.location)
        const primary = locations[0]
        allJobs.push({
          ...job,
          companyName: company.name,
          companyDomain: company.domain,
          descriptionText: htmlToText(job.descriptionHtml).slice(0, 1200),
          descriptionHtml: undefined, // keep the snapshot small
          locationDisplay: primary?.display ?? null,
          city: primary?.city ?? null,
          region: primary?.region ?? null,
          country: primary?.country ?? null,
          locationKeys: [...new Set(locations.flatMap((l) => l.searchKeys))],
          // A provider flag or the text can each indicate remote.
          isRemote: job.isRemote || locations.some((l) => l.isRemote),
        })
      }
      openRoles += result.jobs.length
    }

    companyOut.push({ ...company, openRoles })
    console.log(`  ${String(openRoles).padStart(5)}  ${company.name}`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// ---- Market cap enrichment (public companies only) -------------------------
if (!noMarketCap) {
  const publicCos = companyOut.filter((c) => c.valuationKind === 'public' && c.ticker)
  console.log(`\nDeriving market cap for ${publicCos.length} public companies...`)
  for (const c of publicCos) {
    const mc = await getMarketCap(c.ticker)
    if (mc.marketCapUsd) {
      c.valuationUsd = mc.marketCapUsd
      c.valuationAsOf = mc.priceAsOf
      c.valuationSource = `Derived: SEC EDGAR shares outstanding (${mc.sharesAsOf}) x last close $${mc.price}`
      console.log(`  ${c.ticker.padEnd(6)} $${(mc.marketCapUsd / 1e9).toFixed(1)}B`)
    } else {
      console.log(`  ${c.ticker.padEnd(6)} unavailable: ${mc.error}`)
      warnings.push(`market cap ${c.ticker}: ${mc.error}`)
    }
    // SEC asks for <= 10 req/s; stay well under.
    await new Promise((r) => setTimeout(r, 150))
  }
}

// Private companies keep their curated figure under the same field name so the
// UI does not need to know which path produced it -- but the source string
// always says which, and the as-of date is always shown.
for (const c of companyOut) {
  if (c.valuationUsd == null && c.reportedValuationUsd != null) {
    c.valuationUsd = c.reportedValuationUsd
  }
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  sources: [...new Set(companies.flatMap((c) => c.boards.map((b) => b.provider)))],
  companyCount: companyOut.length,
  jobCount: allJobs.length,
  companies: companyOut,
  jobs: allJobs,
  warnings,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(snapshot))

const withVal = companyOut.filter((c) => c.valuationUsd).length
console.log(`\n${allJobs.length} jobs from ${companyOut.length} companies`)
console.log(`${withVal}/${companyOut.length} companies have a valuation`)
if (warnings.length) console.log(`${warnings.length} warnings`)
console.log(`\nwrote ${OUT} (${(JSON.stringify(snapshot).length / 1e6).toFixed(1)} MB)`)
