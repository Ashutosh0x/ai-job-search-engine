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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
