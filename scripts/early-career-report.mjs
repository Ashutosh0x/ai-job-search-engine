/**
 * Early-career coverage across the deployed index.
 *
 *   node scripts/early-career-report.mjs
 *   node scripts/early-career-report.mjs --write public/data/early-career.json
 *
 * Classifies every indexed posting and reports what is there and, more
 * usefully, what is not. A crawler report that only counts what it found tells
 * you nothing about blind spots -- so this prints countries with zero coverage
 * and categories with none, rather than quietly omitting them.
 *
 * It reads the committed deploy shards, so it measures what the site actually
 * serves rather than what some working file happens to hold.
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { classifyEarlyCareer, EARLY_CAREER_CATEGORIES } from '../lib/pipeline/early-career.ts'

const args = process.argv.slice(2)
const writeTo = args.includes('--write') ? args[args.indexOf('--write') + 1] : null

/* ------------------------------ load the index ---------------------------- */
const jobs = []
for (const f of readdirSync('public/data')) {
  if (!/^jobs-deploy.*\.json$/.test(f)) continue
  const j = JSON.parse(readFileSync(`public/data/${f}`, 'utf8'))
  jobs.push(...(Array.isArray(j) ? j : j.jobs || []))
}
if (!jobs.length) {
  console.error('No deploy shards found in public/data. Nothing to report on.')
  process.exit(1)
}

/* -------------------------------- classify -------------------------------- */
const byCategory = new Map()
const byCountry = new Map()
const byLang = new Map()
const bySource = new Map()
const byCompany = new Map()
const ukRegions = new Map()
const usStates = new Map()
const samples = new Map()

/**
 * Geography buckets read the STRUCTURED country field, not a regex over
 * concatenated location text.
 *
 * The first version tested /\buk\b/ against `country + locationDisplay`, which
 * put three Sydney postings in the UK bucket because something in their
 * location string contained "UK". Matching free text for a two-letter country
 * code is exactly the substring trap this classifier exists to avoid, and doing
 * it in the report that measures the classifier would be worse.
 */
const isUK = (j) =>
  /^(united kingdom|england|scotland|wales|northern ireland)$/i.test((j.country || '').trim())
const isUS = (j) =>
  /^(united states|united states of america|usa)$/i.test((j.country || '').trim())

let classified = 0
for (const j of jobs) {
  const m = classifyEarlyCareer(j.title || '', j.description || '')
  if (!m) continue
  classified++

  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1)
  bump(byCategory, m.category)
  bump(byLang, m.lang)
  bump(bySource, j.source || 'unknown')
  bump(byCompany, j.company || 'unknown')
  bump(byCountry, j.country || '(no country)')

  if (!samples.has(m.category)) {
    samples.set(m.category, `${j.title}  [${j.company}, ${j.country || '?'}]`)
  }

  if (isUK(j)) bump(ukRegions, j.city || j.state || '(UK, city unknown)')
  if (isUS(j)) bump(usStates, j.state || j.city || '(US, state unknown)')
}

/* --------------------------------- report --------------------------------- */
const pct = (n) => `${((n / jobs.length) * 100).toFixed(2)}%`
const table = (map, limit = 15) =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)

console.log(`indexed postings        ${jobs.length.toLocaleString('en-US')}`)
console.log(`classified early-career ${classified.toLocaleString('en-US')}  (${pct(classified)})\n`)

console.log('BY CATEGORY')
for (const c of EARLY_CAREER_CATEGORIES) {
  const n = byCategory.get(c) || 0
  console.log(`  ${c.padEnd(14)} ${String(n).padStart(6)}${n === 0 ? '   <- none found' : ''}`)
  if (samples.has(c)) console.log(`  ${''.padEnd(14)}        e.g. ${samples.get(c).slice(0, 74)}`)
}

console.log('\nBY COUNTRY (top 15)')
for (const [k, v] of table(byCountry)) console.log(`  ${String(k).slice(0, 30).padEnd(32)} ${String(v).padStart(5)}`)

console.log('\nUK (top 12 locations)')
const ukTotal = [...ukRegions.values()].reduce((a, b) => a + b, 0)
console.log(`  total ${ukTotal}`)
for (const [k, v] of table(ukRegions, 12)) console.log(`    ${String(k).slice(0, 28).padEnd(30)} ${String(v).padStart(5)}`)

console.log('\nUS (top 12 locations)')
const usTotal = [...usStates.values()].reduce((a, b) => a + b, 0)
console.log(`  total ${usTotal}`)
for (const [k, v] of table(usStates, 12)) console.log(`    ${String(k).slice(0, 28).padEnd(30)} ${String(v).padStart(5)}`)

console.log('\nBY LANGUAGE OF MATCHED TERM')
for (const [k, v] of table(byLang, 12)) console.log(`  ${k.padEnd(6)} ${String(v).padStart(6)}`)

console.log('\nBY ATS SOURCE')
for (const [k, v] of table(bySource, 12)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}`)

console.log('\nTOP EMPLOYERS')
for (const [k, v] of table(byCompany, 12)) console.log(`  ${String(k).slice(0, 30).padEnd(32)} ${String(v).padStart(5)}`)

/* ------------------------------ blind spots -------------------------------- */
console.log('\nCOVERAGE GAPS')
const emptyCats = EARLY_CAREER_CATEGORIES.filter((c) => !byCategory.get(c))
console.log(`  categories with zero roles : ${emptyCats.length ? emptyCats.join(', ') : 'none'}`)

// Countries present in the index at all, but with no early-career roles.
const allCountries = new Set(jobs.map((j) => j.country).filter(Boolean))
const withEc = new Set([...byCountry.keys()])
const zero = [...allCountries].filter((c) => !withEc.has(c)).sort()
console.log(`  countries in the index     : ${allCountries.size}`)
console.log(`  of those, ZERO early-career: ${zero.length}`)
if (zero.length) console.log(`    ${zero.slice(0, 20).join(', ')}${zero.length > 20 ? ` ... +${zero.length - 20}` : ''}`)

if (writeTo) {
  writeFileSync(writeTo, JSON.stringify({
    generatedAt: new Date().toISOString(),
    indexed: jobs.length,
    classified,
    byCategory: Object.fromEntries(byCategory),
    byCountry: Object.fromEntries(table(byCountry, 100)),
    byLanguage: Object.fromEntries(byLang),
    bySource: Object.fromEntries(bySource),
    uk: { total: ukTotal, locations: Object.fromEntries(table(ukRegions, 60)) },
    us: { total: usTotal, locations: Object.fromEntries(table(usStates, 60)) },
    gaps: { emptyCategories: emptyCats, countriesWithNone: zero },
  }, null, 2))
  console.log(`\nwrote ${writeTo}`)
}
