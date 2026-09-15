/**
 * Corpus data-quality report.
 *
 *   node --max-old-space-size=8192 scripts/data-quality.mjs
 *   node --max-old-space-size=8192 scripts/data-quality.mjs --json docs/data-quality.json
 *   node --max-old-space-size=8192 scripts/data-quality.mjs --index public/data/jobs-v2.json
 *
 * WHAT THIS IS FOR
 * ----------------
 * Search quality is bounded by corpus quality. A ranking change cannot fix a
 * posting whose country is wrong, and a JobPosting schema cannot be emitted for
 * a row with no date. This measures the things that bound the product, so those
 * numbers are counted rather than assumed.
 *
 * Every check below is a COUNT OVER REAL RECORDS. Nothing is estimated and
 * nothing is sampled: the whole index is read.
 *
 * It reports, it never writes to the index. Fixing is scripts/backfill-locations.mjs.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const jsonOut = flag('--json')
const explicitIndex = flag('--index')

/* ------------------------------- load ------------------------------------ */

/**
 * Read the same index the app serves.
 *
 * Mirrors lib/job-index.ts: the primary file names its shards, and a shard that
 * cannot be read makes the report WRONG rather than merely smaller -- so a
 * missing shard is fatal here instead of quietly halving every count.
 */
function loadJobs(indexPath) {
  const dir = 'public/data'
  let primary = indexPath
  if (!primary) {
    const candidates = readdirSync(dir).filter((f) => /^jobs-deploy\.json$/.test(f))
    primary = candidates.length ? join(dir, candidates[0]) : join(dir, 'jobs-v2.json')
  }
  if (!existsSync(primary)) {
    console.error(`No index at ${primary}`)
    process.exit(1)
  }
  const root = JSON.parse(readFileSync(primary, 'utf8'))
  const jobs = [...(root.jobs || [])]
  for (const name of root.shards || []) {
    const p = join(dir, String(name))
    if (!existsSync(p)) {
      console.error(`FATAL: ${primary} names shard "${name}" which is missing. Counts would be wrong.`)
      process.exit(1)
    }
    const shard = JSON.parse(readFileSync(p, 'utf8'))
    jobs.push(...(shard.jobs || []))
  }
  return { jobs, generatedAt: root.generatedAt, declared: root.jobCount ?? null, file: primary }
}

const { jobs, generatedAt, declared, file } = loadJobs(explicitIndex)
const n = jobs.length

/* ---------------------------- reference data ------------------------------ */

/**
 * US state codes and two-letter country codes that COLLIDE.
 *
 * These are the values that cannot be resolved from a bare code: "IN" is both
 * Indiana and India, "CA" both California and Canada. A city field holding one
 * of these is a parse failure either way, which is what makes them worth
 * counting separately from the unambiguous ones.
 */
const US_STATE_CODES = new Set(
  ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO ' +
   'MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR')
    .split(' '),
)
const AMBIGUOUS = new Set(['IN', 'CA', 'DE', 'ID', 'LA', 'MO', 'MT', 'NE', 'PA', 'SC', 'MD', 'ME', 'AL'])

/** Words that are never a city but keep showing up in one. */
const NON_PLACE_CITY = new Set([
  'remote', 'anywhere', 'worldwide', 'various', 'multiple', 'n/a', 'na', 'tbd',
  'unknown', 'other', 'global', 'virtual', 'home', 'field', 'nationwide',
])

const ISO2 = /^[A-Z]{2}$/
const ISO3 = /^[A-Z]{3}$/

/* ------------------------------- helpers ---------------------------------- */

const pct = (k) => (n ? `${((100 * k) / n).toFixed(1)}%` : '0%')
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0

function isValidUrl(u) {
  if (!nonEmpty(u)) return false
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function validTimestamp(v) {
  if (!nonEmpty(v)) return false
  const t = new Date(v).getTime()
  if (!Number.isFinite(t)) return false
  // A posting dated in the future, or before the web had job boards, is a
  // parse error rather than a real date.
  const now = Date.now()
  return t > Date.UTC(1995, 0, 1) && t < now + 7 * 86400_000
}

/* ------------------------------- the checks -------------------------------- */

const issues = {
  missingTitle: [],
  missingCompany: [],
  missingApplyUrl: [],
  invalidApplyUrl: [],
  missingDescription: [],
  thinDescription: [],
  missingPostedAt: [],
  invalidPostedAt: [],
  missingLocationEntirely: [],
  cityIsCountryCode: [],
  cityIsUsStateCode: [],
  cityIsAmbiguousCode: [],
  cityIsNonPlaceWord: [],
  countryIsCode: [],
  missingCountry: [],
  missingCity: [],
  suspectCountryForCity: [],
  missingSalaryCurrency: [],
  salaryInverted: [],
}

const record = (bucket, job, extra) => {
  const list = issues[bucket]
  if (list.length < 25) {
    list.push({ id: job.id, company: job.company, title: job.title, locationRaw: job.locationRaw, ...extra })
  }
  issues[bucket].total = (issues[bucket].total ?? 0) + 1
}

const bySource = {}
const byCountry = {}
const idSeen = new Map()
const urlSeen = new Map()
/** provider + normalised title + company + city: the "same job, two URLs" key. */
const identitySeen = new Map()

let withCity = 0, withCountry = 0, withAnyLocation = 0, remoteCount = 0
let withSalary = 0, withEmploymentType = 0, withSkills = 0, withSeniority = 0
let withPostedAt = 0, withDescription = 0, schemaEligible = 0
let directApply = 0

const normTitle = (t) =>
  String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()

for (const j of jobs) {
  bySource[j.source] = (bySource[j.source] || 0) + 1
  if (nonEmpty(j.country)) byCountry[j.country] = (byCountry[j.country] || 0) + 1

  /* ---- required fields ---- */
  if (!nonEmpty(j.title)) record('missingTitle', j)
  if (!nonEmpty(j.company)) record('missingCompany', j)

  if (!nonEmpty(j.applicationUrl)) record('missingApplyUrl', j)
  else if (!isValidUrl(j.applicationUrl)) record('invalidApplyUrl', j, { url: j.applicationUrl })

  const desc = String(j.description || '').trim()
  if (!desc) record('missingDescription', j)
  else {
    withDescription++
    if (desc.length < 50) record('thinDescription', j, { length: desc.length })
  }

  /* ---- timestamps ---- */
  if (!nonEmpty(j.postedAt)) record('missingPostedAt', j)
  else if (!validTimestamp(j.postedAt)) record('invalidPostedAt', j, { postedAt: j.postedAt })
  else withPostedAt++

  /* ---- location ---- */
  const city = nonEmpty(j.city) ? j.city.trim() : null
  const country = nonEmpty(j.country) ? j.country.trim() : null
  if (j.remote) remoteCount++
  if (city) withCity++
  if (country) withCountry++
  if (city || country || j.remote) withAnyLocation++
  else if (!nonEmpty(j.locationRaw)) record('missingLocationEntirely', j)

  if (city) {
    const up = city.toUpperCase()
    if (AMBIGUOUS.has(up)) record('cityIsAmbiguousCode', j, { city })
    else if (US_STATE_CODES.has(up)) record('cityIsUsStateCode', j, { city })
    else if ((ISO2.test(up) || ISO3.test(up)) && city === up) record('cityIsCountryCode', j, { city })
    if (NON_PLACE_CITY.has(city.toLowerCase())) record('cityIsNonPlaceWord', j, { city })
  } else if (nonEmpty(j.locationRaw) && !j.remote) {
    record('missingCity', j)
  }

  if (!country && nonEmpty(j.locationRaw) && !j.remote) record('missingCountry', j)
  // A normalised country should be a NAME. A bare code means normalisation
  // did not complete.
  if (country && (ISO2.test(country) || ISO3.test(country)) && country === country.toUpperCase()) {
    record('countryIsCode', j, { country })
  }

  /**
   * The cross-continent smell: a raw string that leads with a non-US country
   * code while the normalised country says United States. This is the shape of
   * the "IT, RI, Passo Corese -> Rhode Island, United States" failure.
   */
  if (country === 'United States' && nonEmpty(j.locationRaw)) {
    const head = j.locationRaw.split(',')[0]?.trim().toUpperCase()
    if (head && ISO2.test(head) && !US_STATE_CODES.has(head) && head !== 'US') {
      record('suspectCountryForCity', j, { head, country })
    }
  }

  /* ---- salary ---- */
  if (j.salaryMin || j.salaryMax) {
    withSalary++
    if (!nonEmpty(j.salaryCurrency)) record('missingSalaryCurrency', j, { min: j.salaryMin, max: j.salaryMax })
    if (j.salaryMin && j.salaryMax && j.salaryMin > j.salaryMax) {
      record('salaryInverted', j, { min: j.salaryMin, max: j.salaryMax })
    }
  }

  if (nonEmpty(j.employmentType)) withEmploymentType++
  if (Array.isArray(j.skills) && j.skills.length) withSkills++
  if (nonEmpty(j.seniority)) withSeniority++
  if (j.isDirectApplication !== false) directApply++

  /* ---- schema eligibility (must mirror lib/seo/job-posting.ts) ---- */
  if (desc.length >= 50 && validTimestamp(j.postedAt) && (city || country || j.remote)) schemaEligible++

  /* ---- duplicates ---- */
  idSeen.set(j.id, (idSeen.get(j.id) || 0) + 1)
  if (nonEmpty(j.applicationUrl)) {
    urlSeen.set(j.applicationUrl, (urlSeen.get(j.applicationUrl) || 0) + 1)
  }
  const identity = `${j.source}|${j.companySlug}|${normTitle(j.title)}|${(city || '').toLowerCase()}`
  identitySeen.set(identity, (identitySeen.get(identity) || 0) + 1)
}

const dupIds = [...idSeen.values()].filter((c) => c > 1).length
const dupIdRows = [...idSeen.values()].filter((c) => c > 1).reduce((s, c) => s + c - 1, 0)
const dupUrls = [...urlSeen.values()].filter((c) => c > 1).length
const dupUrlRows = [...urlSeen.values()].filter((c) => c > 1).reduce((s, c) => s + c - 1, 0)
const dupIdentity = [...identitySeen.values()].filter((c) => c > 1).length
const dupIdentityRows = [...identitySeen.values()].filter((c) => c > 1).reduce((s, c) => s + c - 1, 0)

/* ---- staleness, over rows that HAVE a usable date ---- */
const now = Date.now()
const ages = []
for (const j of jobs) if (validTimestamp(j.postedAt)) ages.push((now - new Date(j.postedAt).getTime()) / 86400_000)
ages.sort((a, b) => a - b)
const q = (p) => (ages.length ? ages[Math.min(ages.length - 1, Math.floor(ages.length * p))] : null)
const olderThan = (d) => ages.filter((a) => a > d).length

/* -------------------------------- output ---------------------------------- */

const totalOf = (bucket) => issues[bucket].total ?? 0

const report = {
  generatedAt: new Date().toISOString(),
  index: { file, indexGeneratedAt: generatedAt, declaredJobCount: declared, actualJobCount: n },
  totals: {
    jobs: n,
    sources: Object.keys(bySource).length,
    companies: new Set(jobs.map((j) => j.companySlug)).size,
    countries: Object.keys(byCountry).length,
  },
  coverage: {
    title: n - totalOf('missingTitle'),
    company: n - totalOf('missingCompany'),
    applicationUrl: n - totalOf('missingApplyUrl') - totalOf('invalidApplyUrl'),
    anyLocation: withAnyLocation,
    city: withCity,
    country: withCountry,
    postedAt: withPostedAt,
    description: withDescription,
    salary: withSalary,
    employmentType: withEmploymentType,
    seniority: withSeniority,
    skills: withSkills,
    remote: remoteCount,
    directApply,
    jobPostingSchemaEligible: schemaEligible,
  },
  malformed: Object.fromEntries(Object.keys(issues).map((k) => [k, totalOf(k)])),
  duplicates: {
    duplicateExternalIdGroups: dupIds,
    duplicateExternalIdRows: dupIdRows,
    duplicateApplicationUrlGroups: dupUrls,
    duplicateApplicationUrlRows: dupUrlRows,
    duplicateIdentityGroups: dupIdentity,
    duplicateIdentityRows: dupIdentityRows,
  },
  freshness: {
    datedRows: ages.length,
    medianAgeDays: q(0.5) === null ? null : Number(q(0.5).toFixed(1)),
    p90AgeDays: q(0.9) === null ? null : Number(q(0.9).toFixed(1)),
    olderThan30d: olderThan(30),
    olderThan90d: olderThan(90),
    olderThan180d: olderThan(180),
  },
  bySource: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1])),
  topCountries: Object.fromEntries(Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 25)),
  samples: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.slice(0, 5)])),
}

/* human summary */
const line = (label, value, of = n) =>
  console.log(`  ${label.padEnd(34)} ${String(value).padStart(8)}  ${of ? pct(value) : ''}`)

console.log(`\nCorpus data quality — ${file}`)
console.log(`Index generated ${generatedAt}; ${n.toLocaleString('en-US')} postings` +
  (declared !== null && declared !== n ? `  (header says ${declared.toLocaleString('en-US')} — MISMATCH)` : ''))

console.log('\nFIELD COVERAGE')
for (const [k, v] of Object.entries(report.coverage)) line(k, v)

console.log('\nMALFORMED / SUSPECT')
for (const [k, v] of Object.entries(report.malformed)) if (v) line(k, v)
if (!Object.values(report.malformed).some(Boolean)) console.log('  (none)')

console.log('\nDUPLICATES')
for (const [k, v] of Object.entries(report.duplicates)) line(k, v, 0)

console.log('\nFRESHNESS (rows with a valid date)')
for (const [k, v] of Object.entries(report.freshness)) line(k, v ?? 'n/a', 0)

console.log('\nBY SOURCE')
for (const [k, v] of Object.entries(report.bySource).slice(0, 15)) line(k, v)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`\nJSON written to ${jsonOut}`)
}

/**
 * Exit code reflects whether anything is WRONG, not whether anything is
 * missing. Missing salary is the market; a city holding a country code is a
 * bug, and CI should be able to tell the difference.
 */
const brokenness =
  totalOf('missingTitle') + totalOf('missingCompany') + totalOf('missingApplyUrl') +
  totalOf('invalidApplyUrl') + totalOf('cityIsCountryCode') + totalOf('cityIsUsStateCode') +
  totalOf('cityIsAmbiguousCode') + totalOf('countryIsCode') + totalOf('suspectCountryForCity') +
  totalOf('invalidPostedAt') + totalOf('salaryInverted') + dupIdRows
console.log(`\n${brokenness.toLocaleString('en-US')} rows carry a structural defect (${pct(brokenness)}).`)
process.exit(0)
