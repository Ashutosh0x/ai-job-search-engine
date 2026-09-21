/**
 * Pin the SuccessFactors adapter and the registry contract it exposed.
 *
 *   npx tsx scripts/test-successfactors.mjs
 *
 * No network: the two bugs this suite exists for are both decidable offline,
 * and both fail SILENTLY in production.
 */

import { getAdapter, adapterIds, allAdapters } from '../lib/sources/registry.ts'
import { COMPANIES } from '../lib/companies/registry.ts'
import { DEFAULT_SOURCE_CONFIDENCE } from '../lib/sources/types.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/* ---- Every registered provider must resolve to an adapter ---- */
console.log('\n🔌 Provider/adapter contract:')

// `successfactors` carried a SourceId and a 0.95 confidence for a long time
// with NO adapter behind it. That does not error: the registry has nothing to
// dispatch to, so a company registered under it ingests zero jobs and reports
// success. EY's 8,519 roles were missing for exactly that reason.
const providersInUse = new Set()
for (const c of COMPANIES) for (const b of c.boards ?? []) providersInUse.add(b.provider)

const ids = new Set(adapterIds())
const orphans = [...providersInUse].filter((p) => !ids.has(p))
t('every provider used by a registered company has an adapter', orphans.length === 0,
  orphans.length ? `no adapter for: ${orphans.join(', ')}` : '')

t('successfactors resolves to an adapter', Boolean(getAdapter('successfactors')))
t('successfactors has a confidence weight',
  typeof DEFAULT_SOURCE_CONFIDENCE.successfactors === 'number')

// A confidence weight without an adapter is not itself a failure — the weight
// can be declared ahead of the adapter. It becomes a failure only when a
// company is registered against it, which the assertion above covers. Report
// the gap so it stays visible rather than being rediscovered the way
// `successfactors` was: by noticing a company silently ingesting nothing.
const weighted = Object.keys(DEFAULT_SOURCE_CONFIDENCE)
  .filter((k) => !['company', 'aggregator', 'unknown', 'search'].includes(k))
const weightedOrphans = weighted.filter((k) => !ids.has(k))
if (weightedOrphans.length) {
  console.log(`  NOTE  ${weightedOrphans.length} providers are weighted but have no adapter yet:`)
  console.log(`        ${weightedOrphans.join(', ')}`)
  console.log(`        Registering a company against any of these ingests nothing and reports success.`)
}
t('no company is registered against an unimplemented provider', orphans.length === 0)

t('adapters all declare an id and a display name',
  allAdapters().every((a) => a.id && a.displayName))

/* ---- EY ---- */
console.log('\n🏢 EY registration:')
{
  const ey = COMPANIES.find((c) => c.slug === 'ey')
  t('EY is registered', Boolean(ey))
  const board = ey?.boards?.[0]
  t('EY uses the successfactors provider', board?.provider === 'successfactors')
  t('EY carries its board host', board?.host === 'careers.ey.com')
  // `site` is a PATH PREFIX here, not a Workday-style site id: EY serves
  // search at /ey/search/, not /search/.
  t('EY carries its path prefix', board?.site === 'ey')
  t('EY resolves to the SuccessFactors adapter',
    getAdapter(board?.provider, board?.token, board?.host)?.id === 'successfactors')
}

/* ---- The stated-total parser ---- */
console.log('\n🔢 Stated total (a wrong small total truncates silently):')
{
  // Reproduces the adapter's private regex. The real string from EY's board.
  const statedTotal = (html) => {
    for (const re of [
      /Results?\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i,
      /Results?\s+\d+\s*[–-]\s*\d+\s+of\s+([\d,]+)/i,
    ]) {
      const m = html.match(re)
      if (m) {
        const n = Number(m[1].replace(/,/g, ''))
        if (Number.isFinite(n) && n > 0) return n
      }
    }
    return null
  }

  const ey = 'aria-label="Search results for . Page 1 of 343, Results 1 to 25 of 8556"'
  t('reads the TOTAL, not the page count', statedTotal(ey) === 8556, String(statedTotal(ey)))
  t('the page count 343 is not mistaken for the total', statedTotal(ey) !== 343)

  t('handles a comma-separated total',
    statedTotal('Results 1 to 25 of 12,345') === 12345)
  t('handles an en-dash range', statedTotal('Results 1 – 25 of 900') === 900)
  t('returns null when no total is stated', statedTotal('<html>no counts here</html>') === null)

  // A loose `of ([\d,]+)` matches "of 343," first — this is the bug.
  const loose = /\bof\s+([\d,]+)/i.exec(ey)
  t('a loose pattern really would have captured the page count',
    Number(String(loose?.[1]).replace(/,/g, '')) === 343)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
