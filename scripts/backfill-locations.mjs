/**
 * Re-normalise every location in the served index from its preserved raw string.
 *
 *   node --max-old-space-size=8192 scripts/backfill-locations.mjs            # dry run
 *   node --max-old-space-size=8192 scripts/backfill-locations.mjs --write    # apply
 *
 * WHY THIS EXISTS
 * ---------------
 * lib/location.ts was fixed to understand country-first ("US, TX, Austin"),
 * region-first ("OH, Columbus"), trailing remote ("US Remote") and macro
 * regions ("Remote - Europe"). Fixing the parser does nothing for postings
 * already in the index: those were parsed by the old code and keep its answers
 * until something re-runs the stage.
 *
 * MEASURED before this ran, over the 113,416-posting served index:
 *
 *   city holds a bare country code        4,499
 *   city holds a US state code              199
 *   city holds an ambiguous code            624
 *   city holds a non-place word             390
 *   country missing entirely             21,996
 *   raw leads with a foreign country code
 *     while country says United States        68
 *
 * The worst of these were not cosmetic. "IT, RI, Passo Corese" -- a town in
 * Italy -- was filed as Rhode Island, United States: invisible to an Italy
 * filter and returned by a US one.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It re-derives ONLY from `locationRaw`, which every row preserves. It never
 * invents a place: a raw string that cannot be resolved leaves city and country
 * null, exactly as the parser returns them. A row is rewritten only when the
 * new parse is genuinely better (see `isImprovement`), so a re-run is a no-op
 * and a parser regression cannot quietly degrade rows that were already right.
 *
 * Writes are atomic (temp file + rename) and the shard layout is preserved, so
 * a crash mid-write cannot leave a half-written index behind.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { parseLocation } from '../lib/location.ts'
import { resolveAmbiguousLocations } from '../lib/pipeline/resolve-locations.ts'
import { canonicalJapaneseCity } from '../lib/location-japan.ts'

const argv = process.argv.slice(2)
const WRITE = argv.includes('--write')
const flagValue = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const DIR = flagValue('--dir') ?? join('public', 'data')
const PRIMARY = flagValue('--index') ?? join(DIR, 'jobs-deploy.json')

/* ------------------------------- load ------------------------------------- */

if (!existsSync(PRIMARY)) {
  console.error(`No index at ${PRIMARY}`)
  process.exit(1)
}

const root = JSON.parse(readFileSync(PRIMARY, 'utf8'))
/** file -> parsed object, so each shard can be written back where it came from. */
const files = new Map([[PRIMARY, root]])
for (const name of root.shards ?? []) {
  const p = join(DIR, String(name))
  if (!existsSync(p)) {
    console.error(`FATAL: ${PRIMARY} names shard "${name}" which is missing. Refusing to rewrite a partial index.`)
    process.exit(1)
  }
  files.set(p, JSON.parse(readFileSync(p, 'utf8')))
}

/** Every job, with a back-pointer to the file it must be written back into. */
const all = []
for (const [file, obj] of files) for (const job of obj.jobs ?? []) all.push({ file, job })
console.log(`Loaded ${all.length.toLocaleString('en-US')} postings from ${files.size} file(s).`)

/* ------------------------------ measure ----------------------------------- */

const US_STATE_CODES = new Set(
  ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
   'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR').split(' '),
)
const NON_PLACE_CITY = new Set([
  'remote', 'anywhere', 'worldwide', 'various', 'multiple', 'n/a', 'na', 'tbd',
  'unknown', 'other', 'global', 'virtual', 'nationwide', 'europe', 'emea', 'apac',
])

/** Is this row's location structurally broken, whatever the raw string said? */
function defects(j) {
  const out = []
  const city = typeof j.city === 'string' ? j.city.trim() : ''
  const country = typeof j.country === 'string' ? j.country.trim() : ''
  if (city) {
    const up = city.toUpperCase()
    if (/^[A-Z]{2,3}$/.test(up) && city === up) out.push(US_STATE_CODES.has(up) ? 'cityIsStateCode' : 'cityIsCountryCode')
    if (NON_PLACE_CITY.has(city.toLowerCase())) out.push('cityIsNonPlace')
  }
  if (country && /^[A-Z]{2,3}$/.test(country) && country === country.toUpperCase()) out.push('countryIsCode')
  if (!country && j.locationRaw && !j.remote) out.push('noCountry')
  if (!city && j.locationRaw && !j.remote) out.push('noCity')
  return out
}

const before = {}
for (const { job } of all) for (const d of defects(job)) before[d] = (before[d] ?? 0) + 1

/* ------------------------------ re-parse ---------------------------------- */

/**
 * Accept the new parse only when it is actually better.
 *
 * "Better" is: it fixes a defect, or it fills a field that was empty, and it
 * does not blank a field that previously held a real value. That last clause is
 * what makes this safe to re-run and safe against a future parser regression --
 * a change that started returning null for everything would rewrite nothing.
 */
function isImprovement(oldJob, next) {
  const oldDefects = defects(oldJob).length
  const nextDefects = defects({
    city: next.city, country: next.country, locationRaw: oldJob.locationRaw, remote: oldJob.remote,
  }).length
  if (nextDefects > oldDefects) return false

  const lost =
    (oldJob.city && !next.city && !oldDefects) ||
    (oldJob.country && !next.country && !defects(oldJob).includes('countryIsCode'))
  if (lost) return false

  /**
   * A pure CANONICALISATION also counts as an improvement.
   *
   * "Tokyo-to" -> "Tokyo" fixes no defect and fills no empty field, so the
   * rules above rejected it -- and the city facet stayed split across "Tokyo"
   * (1,584), "Tokyo-to" (64) and "JP - Tokyo" (24), meaning a filter on any one
   * of them missed the other two. Same for "Hiroshima - Fab 15" (220) reading
   * as a different city from "Hiroshima" (34).
   *
   * Narrow on purpose: accepted ONLY when the new value is exactly what
   * canonicalJapaneseCity() derives from the old one. That cannot admit an
   * arbitrary rewrite -- it is the identity check for a rename this codebase
   * already decided is correct.
   */
  const canonicalised =
    oldJob.city &&
    next.city &&
    oldJob.city !== next.city &&
    canonicalJapaneseCity(oldJob.city) === next.city

  const gained =
    nextDefects < oldDefects ||
    (!oldJob.city && next.city) ||
    (!oldJob.country && next.country) ||
    canonicalised ||
    (oldJob.city !== next.city && nextDefects < oldDefects)
  return Boolean(gained) || nextDefects < oldDefects
}

let reparsed = 0, changed = 0, remoteGained = 0, rejected = 0
const parsedRows = []

for (const entry of all) {
  const { job } = entry
  const raw = typeof job.locationRaw === 'string' ? job.locationRaw : ''
  if (!raw.trim()) { parsedRows.push({ entry, next: null }); continue }

  const p = parseLocation(raw)
  reparsed++
  parsedRows.push({ entry, next: p })
}

/* ---- corpus pass: settle the codes a single row cannot (DE, CA, IN ...) --- */
// Mirrors lib/pipeline/orchestrator.ts, so the backfilled index matches what a
// full re-ingest would produce rather than diverging from it.
/**
 * The resolver is fed the FRESH parse only, never the index's existing values.
 *
 * Seeding it with `?? entry.job.country` looked conservative and was the
 * opposite: a row that already carried a country was not an orphan, so the
 * evidence pass skipped it -- including every row whose old country was the
 * wrong one. It saw 16,079 orphans instead of the ~20,000 actually present and
 * filled 643 of them.
 *
 * Losing a good old value is prevented downstream instead, by isImprovement(),
 * which refuses any rewrite that blanks a field that held a real value.
 */
const forResolver = parsedRows.map(({ entry, next }) => {
  const city = next?.city ?? null
  const state = next?.region ?? null
  const country = next?.country ?? null
  const disp = [city, state && state !== city ? state : null, country].filter(Boolean).join(', ')
  // `locations` is part of the CanonicalJob shape the resolver rewrites in
  // place; omitting it made it throw on the first ambiguous row.
  return {
    city, state, country,
    locationDisplay: disp,
    locations: [{ city, state, country, display: disp }],
    locationAmbiguous: next?.ambiguousCode ?? null,
  }
})
const { jobs: resolved, report: resolution } = resolveAmbiguousLocations(forResolver)

/* ------------------------------- apply ------------------------------------ */

const display = (city, region, country, isRemote, raw) =>
  [city, region && region !== city ? region : null, country].filter(Boolean).join(', ') ||
  (isRemote ? 'Remote' : raw || 'Not specified')

for (let i = 0; i < parsedRows.length; i++) {
  const { entry, next } = parsedRows[i]
  if (!next) continue
  const job = entry.job

  // The resolver both settles ambiguous codes AND fills missing countries from
  // corpus evidence, so its output is the authority for city/country here.
  const candidate = {
    city: resolved[i].city ?? null,
    region: resolved[i].state ?? next.region ?? null,
    country: resolved[i].country ?? null,
  }

  if (!isImprovement(job, candidate)) { rejected++; continue }

  job.city = candidate.city
  job.state = candidate.region
  job.country = candidate.country
  // The parser is the authority on remoteness of the raw string, but never
  // downgrade a row the crawler positively flagged remote from other evidence.
  if (next.isRemote && !job.remote) { job.remote = true; remoteGained++ }
  job.locationDisplay = display(job.city, job.state, job.country, job.remote, job.locationRaw)
  changed++
}

const after = {}
for (const { job } of all) for (const d of defects(job)) after[d] = (after[d] ?? 0) + 1

/* ------------------------------- report ----------------------------------- */

const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
console.log(`\nRe-parsed ${reparsed.toLocaleString('en-US')} rows; ${changed.toLocaleString('en-US')} improved.`)
console.log(`Corpus resolver: ${resolution.resolvedRows} ambiguous rows settled, ${resolution.decisions.length} city decisions.`)
console.log(`  orphanRows=${resolution.orphanRows} filledAsCityState=${resolution.filledAsCityState} ` +
  `filledFromEvidence=${resolution.filledFromEvidence} orphansLeftUnfilled=${resolution.orphansLeftUnfilled} ` +
  `citiesCleaned=${resolution.citiesCleaned}`)
console.log(`  rejectedAsNotAnImprovement=${rejected}`)
if (remoteGained) console.log(`${remoteGained.toLocaleString('en-US')} rows newly recognised as remote.`)

console.log('\nDEFECTS'.padEnd(30) + 'before'.padStart(10) + 'after'.padStart(10) + 'delta'.padStart(10))
for (const k of keys) {
  const b = before[k] ?? 0, a = after[k] ?? 0
  console.log(`  ${k.padEnd(26)}${String(b).padStart(10)}${String(a).padStart(10)}${String(a - b).padStart(10)}`)
}
const totalBefore = Object.values(before).reduce((s, v) => s + v, 0)
const totalAfter = Object.values(after).reduce((s, v) => s + v, 0)
console.log(`  ${'TOTAL'.padEnd(26)}${String(totalBefore).padStart(10)}${String(totalAfter).padStart(10)}${String(totalAfter - totalBefore).padStart(10)}`)

if (resolution.decisions.length) {
  console.log('\nCITY DECISIONS (corpus evidence overruled the default reading)')
  for (const d of resolution.decisions.slice(0, 12)) {
    console.log(`  ${d.city}: ${d.from} -> ${d.to}  (${d.evidence} vs ${d.against})`)
  }
}

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write to apply.')
  process.exit(0)
}

/* -------------------------------- write ----------------------------------- */
// Temp file then rename: a crash mid-write must not leave a half-written index,
// because the loader would serve it and it would look fine.
for (const [file, obj] of files) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, file)
  console.log(`wrote ${file} (${(statSync(file).size / 1048576).toFixed(1)}MB)`)
}
console.log('\nDone. Re-run scripts/data-quality.mjs to confirm.')
