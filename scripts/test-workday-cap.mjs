/**
 * Workday's 2,000-result ceiling.
 *
 * THE FAILURE THIS GUARDS
 * -----------------------
 * Workday's CxS search will not page past 2,000 results. It does not error, it
 * does not return a short page -- it clamps the offset and serves the SAME page
 * forever. So an employer with more openings comes back as exactly 2,000 and
 * looks complete.
 *
 * NVIDIA's facet counts sum to 2,636. We indexed 2,000 of them, on every crawl,
 * for as long as the board had been in the registry. Four other employers sat
 * at exactly 2,000: Citi, Applied Materials, ABB, Circle K.
 *
 * The fix partitions by `jobFamilyGroup`. These tests drive the adapter against
 * a fake Workday so the behaviour is pinned without touching the network.
 */

import { WorkdayAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const CAP = 2000

/**
 * A fake Workday tenant.
 *
 * `families` maps a jobFamilyGroup id to how many postings it holds. The
 * unfiltered search clamps at CAP exactly as the real API does.
 */
function fakeWorkday({ families, reportUnfilteredTotal }) {
  const all = []
  for (const [fam, count] of Object.entries(families)) {
    for (let i = 0; i < count; i++) all.push({ fam, path: `/job/${fam}-${i}` })
  }

  class Fake extends WorkdayAdapter {
    calls = 0
    postJson = async (_url, body) => {
      this.calls++
      const fam = body.appliedFacets?.jobFamilyGroup?.[0]
      const pool = fam ? all.filter((j) => j.fam === fam) : all

      // The cap applies to EVERY search, filtered or not -- it is a limit on
      // how deep the offset may go, not a property of the unfiltered query.
      const total = Math.min(pool.length, fam ? CAP : (reportUnfilteredTotal ?? CAP))

      // THE CLAMP: an offset past the cap returns the cap's page, forever.
      const offset = Math.min(body.offset, Math.max(0, CAP - body.limit))
      const page = pool.slice(offset, offset + body.limit)

      return {
        total,
        jobPostings: page.map((j) => ({
          title: `Role ${j.path}`,
          externalPath: j.path,
          locationsText: 'US, CA, Santa Clara',
          bulletFields: [j.path],
        })),
        facets: [{
          facetParameter: 'jobFamilyGroup',
          values: Object.entries(families).map(([id, count]) => ({ id, descriptor: id, count })),
        }],
      }
    }
  }
  return new Fake()
}

const target = {
  source: 'workday', token: 'nvidia', site: 'Site', host: 'x.wd5.myworkdayjobs.com',
  companySlug: 'nvidia', companyName: 'NVIDIA', companyDomain: 'nvidia.com',
}

/* ------------------- a board over the cap is read in full ------------------ */
{
  // 2,636 across families, mirroring NVIDIA's real shape.
  const a = fakeWorkday({ families: { Engineering: 1740, Sales: 330, Operations: 138, Marketing: 428 } })
  const r = await a.fetchJobs(target, {})

  t('every posting past the 2,000 cap is fetched', r.jobs.length === 2636, r.jobs.length)
  t('no posting is duplicated across partitions',
    new Set(r.jobs.map((j) => j.applicationUrl)).size === 2636,
    new Set(r.jobs.map((j) => j.applicationUrl)).size)
  t('a complete read reports no warning', r.warnings.length === 0, r.warnings)
}

/* ---------------- a board under the cap does not partition ---------------- */
{
  const a = fakeWorkday({ families: { Engineering: 300 }, reportUnfilteredTotal: 300 })
  const r = await a.fetchJobs(target, {})
  const callsForOnePass = Math.ceil(300 / 20)

  t('a small board is read completely', r.jobs.length === 300, r.jobs.length)
  // Partitioning costs a facet probe plus a pass per family. Staying at the
  // single-pass call count proves the expensive path did not run.
  t('a board under the cap does not pay for partitioning',
    a.calls <= callsForOnePass + 1, a.calls)
}

/* ------------- a partition still over the cap is reported, not hidden ------ */
{
  // One family alone exceeds the cap, so splitting by family is not enough.
  const a = fakeWorkday({ families: { Engineering: 2400, Sales: 100 } })
  const r = await a.fetchJobs(target, {})

  t('an oversized partition is flagged rather than silently truncated',
    r.warnings.some((w) => /still truncated/i.test(w)), r.warnings)
  t('the shortfall against the facet total is stated',
    r.warnings.some((w) => /facets report 2500/.test(w)), r.warnings)
}

/* -------------------- no facets to partition by is loud ------------------- */
{
  class NoFacets extends WorkdayAdapter {
    postJson = async (_url, body) => ({
      total: CAP,
      jobPostings: body.offset >= CAP ? [] : Array.from({ length: body.limit }, (_, i) => ({
        title: 'Role', externalPath: `/job/${body.offset + i}`, bulletFields: [`${body.offset + i}`],
      })),
      facets: [],
    })
  }
  const r = await new NoFacets().fetchJobs(target, {})
  t('a capped board with no usable facet says it is truncated',
    r.warnings.some((w) => /truncated/i.test(w)), r.warnings)
}

/* ------------- a partition over the cap is split again, not given up ------- */

/**
 * A tenant whose postings carry TWO independent facets.
 *
 * This is the shape that broke the single-split version. Measured live:
 * Accenture's largest jobFamilyGroup holds 20,730 postings, so splitting once
 * still leaves a slice ten times over the cap, and 13 tenants finished a full
 * crawl truncated for exactly this reason. Citi is the counter-example that
 * shows the way out -- it exposes Country_and_Jurisdiction and
 * State_or_Province next to jobFamilyGroup, and splitting on a second facet
 * took the real read from 2,000 to 3,244.
 */
function twoFacetTenant({ cells }) {
  // cells: { [family]: { [country]: count } }
  const all = []
  for (const [fam, byCountry] of Object.entries(cells)) {
    for (const [country, n] of Object.entries(byCountry)) {
      for (let i = 0; i < n; i++) all.push({ fam, country, path: `/job/${fam}-${country}-${i}` })
    }
  }
  const facetValues = (pool, key) => {
    const counts = new Map()
    for (const j of pool) counts.set(j[key], (counts.get(j[key]) ?? 0) + 1)
    return [...counts].map(([id, count]) => ({ id, descriptor: id, count }))
  }

  class Fake extends WorkdayAdapter {
    calls = 0
    postJson = async (_url, body) => {
      this.calls++
      const fam = body.appliedFacets?.jobFamilyGroup?.[0]
      const country = body.appliedFacets?.Country_and_Jurisdiction?.[0]
      let pool = all
      if (fam) pool = pool.filter((j) => j.fam === fam)
      if (country) pool = pool.filter((j) => j.country === country)

      // The cap applies to every search, however deeply filtered.
      const total = Math.min(pool.length, CAP)
      const offset = Math.min(body.offset, Math.max(0, CAP - body.limit))
      const page = pool.slice(offset, offset + body.limit)

      return {
        total,
        jobPostings: page.map((j) => ({
          title: `Role ${j.path}`, externalPath: j.path, locationsText: j.country, bulletFields: [j.path],
        })),
        // Facet counts are reported for the CURRENT filter, exactly as the
        // real API does -- that is what lets the next split be chosen well.
        facets: [
          { facetParameter: 'jobFamilyGroup', values: facetValues(pool, 'fam') },
          { facetParameter: 'Country_and_Jurisdiction', values: facetValues(pool, 'country') },
          // Present on real tenants and useless: every count is zero. Choosing
          // this would split into nothing and lose the board.
          { facetParameter: 'locationMainGroup', values: [{ id: 'all', descriptor: 'all', count: 0 }] },
        ],
      }
    }
  }
  return new Fake()
}

{
  // Engineering alone is 3,000 -- over the cap even after the first split --
  // but no single (family, country) cell is.
  const cells = {
    Engineering: { US: 1500, India: 1500 },
    Sales: { US: 400 },
  }
  const a = twoFacetTenant({ cells })
  const r = await a.fetchJobs(target, { maxPages: 2000 })

  t('a slice still over the cap is split by a second facet',
    r.jobs.length === 3400, r.jobs.length)
  t('a two-level split reports no truncation',
    !r.warnings.some((w) => /truncated/i.test(w)), r.warnings)
  t('nothing is double-counted across the two facets',
    new Set(r.jobs.map((j) => j.applicationUrl)).size === 3400,
    new Set(r.jobs.map((j) => j.applicationUrl)).size)
}

{
  // A cell that cannot be divided any further must still be reported, not
  // presented as a complete board.
  const a = twoFacetTenant({ cells: { Engineering: { US: 2500 } } })
  const r = await a.fetchJobs(target, { maxPages: 2000 })
  t('an indivisible oversized cell is still flagged',
    r.warnings.some((w) => /truncated/i.test(w)), r.warnings)
  t('the shortfall is stated numerically',
    r.warnings.some((w) => /facets report 2500 postings, read 2000/.test(w)), r.warnings)
}

/* ------------------------ the request budget is honoured ------------------ */
{
  const a = twoFacetTenant({ cells: { Engineering: { US: 1500, India: 1500 }, Sales: { US: 400 } } })
  const r = await a.fetchJobs(target, { maxRequests: 3 })
  t('a tiny budget stops the read and says so',
    r.warnings.some((w) => /request budget/i.test(w)), r.warnings)
  t('a budgeted read still returns what it managed to fetch',
    r.jobs.length > 0 && r.jobs.length < 3400, r.jobs.length)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
