/**
 * Measure the contact-discovery engine against real company domains.
 *
 *   npx tsx scripts/measure-contact-discovery.mjs --limit 40
 *   npx tsx scripts/measure-contact-discovery.mjs --limit 273 --concurrency 6
 *
 * This is a MEASUREMENT harness, not a test: it makes live network calls and
 * reports what each discovery source actually returns. Nothing is written to
 * a database and nothing is asserted — the output is the finding.
 *
 * It exists because the unit suites only ever exercised the pure functions on
 * synthetic input. `inferPattern` can be perfect while the source feeding it
 * returns nothing at all, and no assertion in the repo would notice.
 *
 * It runs the shipped modules (lib/contacts/*) so the numbers describe the
 * code that actually ships. Company pages are fetched only where robots.txt
 * allows it, one request at a time per host.
 */

import { readFileSync, writeFileSync } from 'fs'
import { promises as dns } from 'dns'
import { discoverPatterns } from '../lib/contacts/email-patterns.ts'
import { scrapeCareersPage } from '../lib/contacts/scraper.ts'
import { verifyDomain } from '../lib/contacts/verify.ts'
import { parseRobots, robotsDecision } from '../lib/sources/robots.ts'
import { parseRegistry } from './lib/parse-registry.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const LIMIT = Number(val('limit', '40'))
const CONCURRENCY = Number(val('concurrency', '4'))
const SKIP_GITHUB = has('skip-github')
const UA = 'AIJobSearchBot'
const OUT = val('out', 'data/contact-discovery-measurement.json')

/* ---------- Targets ---------- */

const { companies } = parseRegistry()

const targets = companies.slice(0, LIMIT)
console.log(`Measuring ${targets.length} of ${companies.length} companies (concurrency ${CONCURRENCY})\n`)

/* ---------- robots.txt ---------- */

async function robotsAllows(domain, path) {
  for (const host of [`https://www.${domain}`, `https://${domain}`]) {
    try {
      const res = await fetch(`${host}/robots.txt`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const policy = parseRobots(await res.text(), UA)
      return robotsDecision(policy, `${host}${path}`).allowed
    } catch {
      continue
    }
  }
  // No reachable robots.txt means no stated policy, which RFC 9309 treats as
  // full allow. Recorded separately below so it does not read as consent.
  return null
}

/* ---------- One company ---------- */

async function measure(company) {
  const { domain, name, slug } = company
  const started = Date.now()

  const row = {
    slug, name, domain,
    dnsResolves: false,
    mx: null,
    spf: null,
    dmarc: null,
    robots: null,
    careersAddresses: [],
    otherAddresses: [],
    githubPatterns: [],
    githubSource: null,
    error: null,
  }

  // 1. Does the domain exist and accept mail at all?
  try {
    await dns.resolve4(domain)
    row.dnsResolves = true
  } catch {
    row.dnsResolves = false
  }

  if (row.dnsResolves) {
    try {
      const posture = await verifyDomain(domain)
      row.mx = posture.hasMx
      row.spf = posture.hasSpf
      row.dmarc = posture.dmarcPolicy ?? null
    } catch (err) {
      row.error = `verifyDomain: ${err.message}`
    }
  }

  // 2. Careers-page scraping, robots permitting.
  if (row.dnsResolves) {
    row.robots = await robotsAllows(domain, '/careers')
    if (row.robots !== false) {
      try {
        const found = await scrapeCareersPage(domain)
        row.careersAddresses = found.filter((f) => f.source === 'careers-role').map((f) => f.email)
        row.otherAddresses = found.filter((f) => f.source !== 'careers-role').map((f) => f.email)
      } catch (err) {
        row.error = `${row.error ? row.error + '; ' : ''}careers: ${err.message}`
      }
    }
  }

  // 3. GitHub commit mining — the engine's primary pattern source.
  if (!SKIP_GITHUB && row.dnsResolves) {
    try {
      const patterns = await discoverPatterns(domain)
      row.githubPatterns = patterns.map((p) => ({
        pattern: p.pattern,
        confidence: p.confidence,
        sampleSize: p.sampleSize,
        sources: p.sources,
      }))
      // discoverPatterns returns a fallback entry when mining finds nothing.
      // Recording which it was is the entire point of this run.
      row.githubSource = patterns[0]?.sources?.[0] ?? 'none'
    } catch (err) {
      row.error = `${row.error ? row.error + '; ' : ''}github: ${err.message}`
    }
  }

  row.ms = Date.now() - started
  return row
}

/* ---------- Run ---------- */

const results = []
let done = 0

async function worker(queue) {
  while (queue.length) {
    const company = queue.shift()
    const row = await measure(company)
    results.push(row)
    done++

    const bits = [
      row.dnsResolves ? 'dns✓' : 'dns✗',
      row.mx ? 'mx✓' : 'mx✗',
      row.robots === false ? 'robots✗' : row.robots === null ? 'robots?' : 'robots✓',
      `careers:${row.careersAddresses.length}`,
      `other:${row.otherAddresses.length}`,
      `gh:${row.githubSource ?? 'skipped'}`,
    ]
    console.log(`[${String(Math.round((done / targets.length) * 100)).padStart(3)}%] ${row.domain.padEnd(28)} ${bits.join(' ')}`)
  }
}

const queue = [...targets]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

/* ---------- Report ---------- */

const n = results.length
const resolved = results.filter((r) => r.dnsResolves)
const withMx = results.filter((r) => r.mx)
const withCareers = results.filter((r) => r.careersAddresses.length > 0)
const totalAddresses = results.reduce((a, r) => a + r.careersAddresses.length, 0)
const totalOther = results.reduce((a, r) => a + (r.otherAddresses?.length ?? 0), 0)
const robotsBlocked = results.filter((r) => r.robots === false)
const robotsUnknown = results.filter((r) => r.robots === null)

const ghReal = results.filter((r) => r.githubSource === 'github')
const ghFallback = results.filter((r) => r.githubSource === 'fallback')
const ghError = results.filter((r) => r.githubSource === 'fallback_error')

console.log(`\n${'='.repeat(64)}`)
console.log('CONTACT DISCOVERY — MEASURED RESULTS')
console.log('='.repeat(64))
console.log(`Companies measured            ${n}`)
console.log(`Domain resolves               ${resolved.length}/${n}`)
console.log(`Domain has MX (accepts mail)  ${withMx.length}/${n}`)
console.log(`robots.txt disallows /careers ${robotsBlocked.length}/${n}  (no policy found: ${robotsUnknown.length})`)
console.log('')
console.log('SOURCE 1 — careers-page scraping')
console.log(`  companies yielding >=1 address  ${withCareers.length}/${n}  (${((withCareers.length / n) * 100).toFixed(1)}%)`)
console.log(`  total recruiting addresses      ${totalAddresses}`)
console.log(`  non-recruiting, labelled other  ${totalOther}`)
const precision = (totalAddresses + totalOther) > 0
  ? ((totalAddresses / (totalAddresses + totalOther)) * 100).toFixed(1) : '0.0'
console.log(`  recruiting share of all found   ${precision}%`)
if (withCareers.length) {
  for (const r of withCareers.slice(0, 12)) {
    console.log(`    ${r.domain}: ${r.careersAddresses.join(', ')}`)
  }
}
console.log('')
console.log('SOURCE 2 — GitHub commit mining')
if (SKIP_GITHUB) {
  console.log('  skipped (--skip-github)')
} else {
  console.log(`  real patterns mined             ${ghReal.length}/${n}  (${((ghReal.length / n) * 100).toFixed(1)}%)`)
  console.log(`  fell back to a guessed default  ${ghFallback.length}/${n}`)
  console.log(`  errored (rate limit etc.)       ${ghError.length}/${n}`)
}
console.log('='.repeat(64))

writeFileSync(OUT, JSON.stringify({
  measuredAt: new Date().toISOString(),
  companiesMeasured: n,
  githubSkipped: SKIP_GITHUB,
  summary: {
    resolved: resolved.length,
    withMx: withMx.length,
    robotsBlocked: robotsBlocked.length,
    robotsUnknown: robotsUnknown.length,
    careersCompaniesWithAddresses: withCareers.length,
    careersTotalAddresses: totalAddresses,
    careersOtherAddresses: totalOther,
    githubRealPatterns: ghReal.length,
    githubFallback: ghFallback.length,
    githubError: ghError.length,
  },
  results,
}, null, 2))

console.log(`\nWrote ${OUT}`)
