/**
 * Measure recruiter-contact recall: fixed-path scraper vs prioritised crawler.
 *
 *   npx tsx scripts/benchmark-recruiter-recall.mjs --limit 12
 *   npx tsx scripts/benchmark-recruiter-recall.mjs --domains stripe.com,gitlab.com
 *
 * Runs BOTH implementations over the same domains in the same run, so the
 * comparison is not against a remembered number from a different day with
 * different websites.
 *
 * Recall here means "companies for which we found at least one recruiting
 * mailbox". There is no ground-truth list of every recruiter address a company
 * has — that set is unknowable — so this measures relative recall between two
 * implementations, plus the precision of what the new one accepts.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { scrapeCareersPage } from '../lib/contacts/scraper.ts'
import { crawlForRecruiterContacts } from '../lib/contacts/recruiter-crawler.ts'
import { parseRegistry } from './lib/parse-registry.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const LIMIT = Number(val('limit', '12'))
const DOMAINS = val('domains', '')
const MAX_PAGES = Number(val('max-pages', '25'))
const OUT = val('out', 'data/recruiter-recall-benchmark.json')

let targets
if (DOMAINS) {
  targets = DOMAINS.split(',').map((d) => ({ domain: d.trim(), name: d.trim() }))
} else {
  // Spread across the registry rather than the first N, which are alphabetical
  // and therefore not representative of company size or sector.
  const { companies } = parseRegistry()
  const step = Math.max(1, Math.floor(companies.length / LIMIT))
  targets = companies.filter((_, i) => i % step === 0).slice(0, LIMIT)
}

console.log(`Benchmarking ${targets.length} domains (max ${MAX_PAGES} pages each)\n`)
console.log('domain                        old  new   pages  urls   new addresses')
console.log('-'.repeat(78))

const rows = []

for (const t of targets) {
  let oldHits = []
  try {
    const found = await scrapeCareersPage(t.domain)
    oldHits = found.filter((f) => f.source === 'careers-role').map((f) => f.email)
  } catch { /* counted as zero */ }

  let crawl = null
  try {
    crawl = await crawlForRecruiterContacts(t.domain, { maxPages: MAX_PAGES })
  } catch (err) {
    console.log(`${t.domain.padEnd(28)} crawl failed: ${err.message}`)
    continue
  }

  const newHits = crawl.recruiting.map((e) => e.email)
  const gained = newHits.filter((e) => !oldHits.includes(e))

  rows.push({
    domain: t.domain,
    old: oldHits,
    new: newHits,
    gained,
    pagesCrawled: crawl.pagesCrawled,
    urlsDiscovered: crawl.urlsDiscovered,
    rejected: crawl.other.map((e) => ({ email: e.email, why: e.recruiterScore.reasons[0] })),
    elapsedMs: crawl.elapsedMs,
  })

  console.log(
    t.domain.padEnd(28) +
    String(oldHits.length).padStart(4) +
    String(newHits.length).padStart(5) +
    String(crawl.pagesCrawled).padStart(8) +
    String(crawl.urlsDiscovered).padStart(6) +
    '   ' + (newHits.slice(0, 2).join(', ') || '-')
  )
}

/* ---------------------------------- report --------------------------------- */

const oldCompanies = rows.filter((r) => r.old.length > 0).length
const newCompanies = rows.filter((r) => r.new.length > 0).length
const oldAddresses = rows.reduce((a, r) => a + r.old.length, 0)
const newAddresses = rows.reduce((a, r) => a + r.new.length, 0)
const totalPages = rows.reduce((a, r) => a + r.pagesCrawled, 0)
const totalUrls = rows.reduce((a, r) => a + r.urlsDiscovered, 0)
const totalMs = rows.reduce((a, r) => a + r.elapsedMs, 0)

const pct = (n) => rows.length ? `${((n / rows.length) * 100).toFixed(0)}%` : '-'

console.log(`\n${'='.repeat(78)}`)
console.log('RECALL')
console.log('='.repeat(78))
console.log(`  companies with >=1 recruiting mailbox`)
console.log(`    fixed-path scraper : ${oldCompanies}/${rows.length}  (${pct(oldCompanies)})`)
console.log(`    prioritised crawler: ${newCompanies}/${rows.length}  (${pct(newCompanies)})`)
console.log(`  addresses found`)
console.log(`    fixed-path scraper : ${oldAddresses}`)
console.log(`    prioritised crawler: ${newAddresses}`)
console.log(`\nCOST`)
console.log(`  URLs discovered      : ${totalUrls.toLocaleString('en-US')}`)
console.log(`  pages actually read  : ${totalPages}`)
console.log(`  wall time            : ${(totalMs / 1000).toFixed(0)}s  (${(totalMs / 1000 / Math.max(1, rows.length)).toFixed(1)}s/domain)`)

const gainedAll = rows.flatMap((r) => r.gained)
if (gainedAll.length) {
  console.log(`\nADDRESSES THE OLD SCRAPER MISSED (${gainedAll.length}):`)
  for (const r of rows.filter((x) => x.gained.length)) {
    console.log(`  ${r.domain}: ${r.gained.join(', ')}`)
  }
}

// Precision is the other half: an engine that accepts everything has perfect
// recall and is useless. Show what was rejected so it can be eyeballed.
const rejected = rows.flatMap((r) => r.rejected)
if (rejected.length) {
  console.log(`\nREJECTED AS NON-RECRUITING (${rejected.length}, sample):`)
  for (const r of rejected.slice(0, 12)) console.log(`  ${r.email.padEnd(42)} ${r.why}`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  benchmarkedAt: new Date().toISOString(),
  maxPagesPerDomain: MAX_PAGES,
  domains: rows.length,
  summary: { oldCompanies, newCompanies, oldAddresses, newAddresses, totalPages, totalUrls, totalMs },
  rows,
}, null, 2))
console.log(`\nWrote ${OUT}`)
