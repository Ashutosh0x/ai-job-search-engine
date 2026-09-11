/**
 * Fetch the official sponsor registers and match them against the registry.
 *
 *   node scripts/build-sponsors.mjs            # UK + NL
 *   node scripts/build-sponsors.mjs --only UK
 *
 * Writes public/data/sponsors.json: for each company, whether a government
 * register lists it as licensed to sponsor, with the matched legal name, the
 * routes, the source URL and the publisher's date.
 *
 * A company absent from the register is recorded as `unknown`, never as "does
 * not sponsor". Absence here means we could not connect our name to a legal
 * entity in the register -- which is a limitation of the matcher, not evidence
 * about the employer.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const { fetchUkRegister, fetchNlRegister, fetchUsRegister, buildSponsorIndex, matchSponsor } =
  await import('../lib/visa/sponsor-registers.ts')
const { COMPANIES } = await import('../lib/companies/registry.ts')

const args = process.argv.slice(2)
const only = (() => { const i = args.indexOf('--only'); return i !== -1 ? args[i + 1] : null })()
const OUT = 'public/data/sponsors.json'

const registers = []
const failures = []

for (const [country, fetcher] of [['UK', fetchUkRegister], ['NL', fetchNlRegister], ['US', fetchUsRegister]]) {
  if (only && only.toUpperCase() !== country) continue
  process.stdout.write(`fetching ${country} register ... `)
  try {
    const reg = await fetcher()
    console.log(`${reg.rows.length.toLocaleString()} organisations` +
      (reg.publishedAt ? `, published ${reg.publishedAt.slice(0, 10)}` : ''))
    registers.push(reg)
  } catch (e) {
    console.log(`FAILED: ${e.message}`)
    failures.push({ country, error: String(e.message) })
  }
}

if (!registers.length) {
  console.error('\nNo register could be fetched. Writing nothing rather than a stale or empty file.')
  process.exit(1)
}

const indexes = registers.map(buildSponsorIndex)

const companies = {}
let matched = 0
for (const c of COMPANIES) {
  const found = []
  for (const idx of indexes) {
    const m = matchSponsor(c.name, idx)
    if (m) found.push(m)
  }
  if (found.length) matched++
  companies[c.slug] = {
    name: c.name,
    // Absence is unknown, not a negative finding.
    status: found.length ? 'licensed' : 'unknown',
    licences: found,
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  registers: registers.map((r) => ({
    country: r.country, sourceUrl: r.sourceUrl,
    publishedAt: r.publishedAt, organisations: r.rows.length,
    coverageNote: r.coverageNote ?? null,
  })),
  failures,
  companies,
}, null, 2))

console.log(`\n${matched} of ${COMPANIES.length} registry companies matched a government register`)
console.log(`wrote ${OUT}`)

const licensed = Object.values(companies).filter((c) => c.status === 'licensed')
const skilled = licensed.filter((c) => c.licences.some((l) => l.coversSkilledWork))
const suspect = licensed.flatMap((c) =>
  c.licences.filter((l) => l.lowConfidence).map((l) => ({ name: c.name, l })))

console.log(`  covering a skilled-work route: ${skilled.length}`)
console.log(`  flagged low confidence:        ${suspect.length}`)

if (suspect.length) {
  console.log('\nLOW-CONFIDENCE MATCHES (shown, not silently dropped):')
  for (const { name, l } of suspect) {
    console.log(`  ${name.padEnd(22)} ${l.country}  matched "${l.matchedName}"  routes: ${l.routes.join(', ').slice(0, 46)}`)
  }
}

const sample = skilled.slice(0, 10)
if (sample.length) {
  console.log('\nSample verified matches (the matched legal name is the evidence):')
  for (const c of sample) {
    for (const l of c.licences.filter((x) => x.coversSkilledWork)) {
      console.log(`  ${c.name.padEnd(24)} ${l.country}  ${l.matchedName.slice(0, 40).padEnd(42)} ${l.routes.join(', ').slice(0, 32)}`)
    }
  }
}
