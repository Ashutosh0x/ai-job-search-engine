/**
 * Search invariants: the properties that must hold for EVERY query.
 *
 * These are not examples, they are laws. A ranking change, a new filter or a
 * retrieval tweak can all satisfy a hand-picked example while breaking one of
 * these, and a job board that breaks them is untrustworthy in a way users
 * notice before any test does:
 *
 *   - adding a filter that returns MORE results
 *   - page 2 repeating a job from page 1
 *   - the same search returning a different order each time
 *   - a job that exists being unreachable because retrieval truncated before
 *     the filter ran
 *
 * Runs against a synthetic corpus with known contents, so every expected number
 * is derived from the fixture rather than from whatever the real index happens
 * to hold today.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

async function cleanup(dir) {
  try { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) }
  catch { /* the OS will reap it */ }
}

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/* ---------------------------- the fixture --------------------------------- */

const COMPANIES = ['acme', 'globex', 'initech', 'umbrella', 'hooli']
const CITIES = [
  { city: 'London', country: 'United Kingdom' },
  { city: 'Berlin', country: 'Germany' },
  { city: 'Bangalore', country: 'India' },
  { city: 'Austin', country: 'United States' },
]
const TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Backend Engineer',
  'Frontend Engineer', 'Machine Learning Engineer', 'Data Analyst',
  'Product Manager', 'Engineering Manager',
]
const TYPES = ['Full-time', 'Contract', 'Internship']

function corpus() {
  const jobs = []
  let n = 0
  for (const company of COMPANIES) {
    for (const loc of CITIES) {
      for (const title of TITLES) {
        // A deliberately lumpy distribution so quotas and ties get exercised.
        const copies = company === 'acme' && title === 'Software Engineer' ? 40 : 2
        for (let c = 0; c < copies; c++) {
          const i = n++
          jobs.push({
            id: `greenhouse:${company}:${i}`,
            source: 'greenhouse',
            company: company[0].toUpperCase() + company.slice(1),
            companySlug: company,
            companyDomain: `${company}.com`,
            title,
            description: `We are hiring a ${title.toLowerCase()} to build and operate systems at scale.`,
            locationRaw: `${loc.city}, ${loc.country}`,
            locationDisplay: loc.city,
            city: loc.city,
            state: null,
            country: loc.country,
            remote: i % 7 === 0,
            employmentType: TYPES[i % TYPES.length],
            seniority: title.startsWith('Senior') ? 'senior' : 'mid',
            department: title.includes('Engineer') ? 'Engineering' : 'Business',
            salaryMin: i % 5 === 0 ? 60000 + (i % 10) * 10000 : null,
            salaryMax: i % 5 === 0 ? 90000 + (i % 10) * 10000 : null,
            salaryCurrency: i % 5 === 0 ? 'USD' : null,
            skills: title.includes('Machine') ? ['python', 'pytorch'] : ['typescript'],
            postedAt: i % 3 === 0 ? new Date(Date.UTC(2026, 8, 1 + (i % 14))).toISOString() : null,
            firstSeenAt: '2026-09-01T00:00:00.000Z',
            applicationUrl: `https://${company}.com/jobs/${i}`,
            isDirectApplication: true,
            earlyCareer: title === 'Software Engineer' && i % 11 === 0 ? 'graduate' : null,
          })
        }
      }
    }
  }
  return { generatedAt: '2026-09-14T00:00:00.000Z', jobCount: jobs.length, jobs }
}

const dir = await mkdtemp(join(tmpdir(), 'inv-'))
await mkdir(join(dir, 'public', 'data'), { recursive: true })
const FIXTURE = corpus()
await writeFile(join(dir, 'public', 'data', 'jobs-deploy.json'), JSON.stringify(FIXTURE))

const cwd = process.cwd()
process.chdir(dir)
const info = console.info
console.info = () => {}

try {
  const { searchJobs } = await import(`../lib/job-index.ts?inv=${Math.random()}`)
  const search = (q) => searchJobs({ pageSize: 20, ...q })
  const totalOf = async (q) => (await search({ ...q, pageSize: 1 })).total

  console.log(`  (fixture: ${FIXTURE.jobs.length} postings, ${COMPANIES.length} employers, ${CITIES.length} cities)`)

  /* ===================== 1. MONOTONICITY ================================= */
  // Adding a restrictive filter must never increase the result count.
  {
    const base = await totalOf({ q: 'engineer' })
    const narrowings = [
      ['location', { q: 'engineer', location: 'London' }],
      ['country', { q: 'engineer', countries: ['Germany'] }],
      ['city', { q: 'engineer', cities: ['Berlin'] }],
      ['remote', { q: 'engineer', remote: true }],
      ['employmentType', { q: 'engineer', employmentTypes: ['Contract'] }],
      ['department', { q: 'engineer', departments: ['Engineering'] }],
      ['company', { q: 'engineer', companies: ['acme'] }],
      ['provider', { q: 'engineer', providers: ['greenhouse'] }],
      ['earlyCareer', { q: 'engineer', earlyCareer: ['any'] }],
      ['minSalary', { q: 'engineer', minSalary: 100000 }],
      ['postedWithinDays', { q: 'engineer', postedWithinDays: 7 }],
    ]
    for (const [label, q] of narrowings) {
      const n = await totalOf(q)
      t(`adding ${label} never increases the count`, n <= base, { base, n })
    }

    // And each further filter narrows again.
    const a = await totalOf({ q: 'engineer', location: 'London' })
    const b = await totalOf({ q: 'engineer', location: 'London', departments: ['Engineering'] })
    const c = await totalOf({ q: 'engineer', location: 'London', departments: ['Engineering'], companies: ['acme'] })
    t('filters compose monotonically', a >= b && b >= c, { a, b, c })

    // A filter that matches nothing empties the set rather than being ignored.
    t('an unmatched filter empties the set',
      (await totalOf({ q: 'engineer', cities: ['Atlantis'] })) === 0)
    t('an unmatched company empties the set',
      (await totalOf({ q: 'engineer', companies: ['nosuchco'] })) === 0)
  }

  /* ===================== 2. REMOVING A FILTER WIDENS ====================== */
  {
    const withFilter = await totalOf({ q: 'engineer', remote: true })
    const without = await totalOf({ q: 'engineer' })
    t('removing a filter never decreases the universe', without >= withFilter, { without, withFilter })

    const noQuery = await totalOf({})
    t('dropping the keyword widens to the whole corpus', noQuery === FIXTURE.jobs.length, noQuery)
  }

  /* ===================== 3. PAGINATION =================================== */
  {
    const pageSize = 20
    const first = await search({ q: 'engineer', pageSize })
    const pages = Math.min(8, first.totalPages)
    const seen = new Set()
    let duplicates = 0, rows = 0
    for (let p = 1; p <= pages; p++) {
      const r = await search({ q: 'engineer', page: p, pageSize })
      t(`page ${p} reports its own number`, r.page === p, r.page)
      for (const j of r.jobs) {
        rows++
        if (seen.has(j.externalId)) duplicates++
        seen.add(j.externalId)
      }
    }
    t('no job appears on two pages', duplicates === 0, duplicates)
    t('every page is full up to the last', rows === pages * pageSize, { rows, expected: pages * pageSize })
    t('totalPages matches total/pageSize',
      first.totalPages === Math.ceil(first.total / pageSize), { totalPages: first.totalPages, total: first.total })

    // Past the end is empty, not an error and not a wrap-around.
    const beyond = await search({ q: 'engineer', page: first.totalPages + 5, pageSize })
    t('a page past the end is empty', beyond.jobs.length === 0, beyond.jobs.length)
    t('and still reports the true total', beyond.total === first.total)

    // Page size is honoured and clamped.
    t('pageSize is honoured', (await search({ q: 'engineer', pageSize: 7 })).jobs.length === 7)
    t('pageSize is clamped at 100', (await search({ q: 'engineer', pageSize: 5000 })).pageSize === 100)
    t('pageSize below 1 is clamped up', (await search({ q: 'engineer', pageSize: 0 })).pageSize === 1)
    t('page below 1 is clamped up', (await search({ q: 'engineer', page: -3 })).page === 1)
  }

  /* ===================== 4. DETERMINISM ================================== */
  {
    const ids = async (q) => (await search(q)).jobs.map((j) => j.externalId)
    for (const q of [
      { q: 'engineer' },
      { q: 'engineer', location: 'London' },
      { sort: 'recent' },
      { sort: 'salary' },
      { q: 'software engineer', sort: 'relevance' },
    ]) {
      const a = await ids(q), b = await ids(q)
      t(`repeated search is identical: ${JSON.stringify(q)}`,
        JSON.stringify(a) === JSON.stringify(b))
    }

    // Ties must not be resolved arbitrarily. 2/3 of the fixture has no date, so
    // "recent" is almost entirely ties.
    const r1 = await ids({ sort: 'recent', pageSize: 50 })
    const r2 = await ids({ sort: 'recent', pageSize: 50 })
    t('a sort that is almost all ties is still stable', JSON.stringify(r1) === JSON.stringify(r2))
  }

  /* ===================== 5. SORTING ====================================== */
  {
    const recent = await search({ sort: 'recent', pageSize: 40 })
    const dates = recent.jobs.map((j) => (j.postedAt ? Date.parse(j.postedAt) : 0))
    t('recent sorts newest first', dates.every((d, i) => i === 0 || dates[i - 1] >= d), dates.slice(0, 5))

    const salary = await search({ sort: 'salary', pageSize: 40 })
    const pays = salary.jobs.map((j) => j.salaryMax ?? j.salaryMin ?? 0)
    t('salary sorts highest first', pays.every((v, i) => i === 0 || pays[i - 1] >= v), pays.slice(0, 5))

    const rel = await search({ q: 'machine learning engineer', sort: 'relevance', pageSize: 10 })
    t('relevance puts the matching title first',
      rel.jobs[0].title === 'Machine Learning Engineer', rel.jobs[0]?.title)

    // Sorting changes order, never membership.
    const asRecent = new Set((await search({ q: 'engineer', sort: 'recent', pageSize: 100 })).jobs.map((j) => j.externalId))
    const asSalary = new Set((await search({ q: 'engineer', sort: 'salary', pageSize: 100 })).jobs.map((j) => j.externalId))
    t('every sort has the same total',
      (await totalOf({ q: 'engineer', sort: 'recent' })) === (await totalOf({ q: 'engineer', sort: 'salary' })))
    t('and the same page-1 membership size', asRecent.size === asSalary.size)
  }

  /* ===================== 6. RECALL UNDER FILTERS ========================== */
  /**
   * The bug this guards: retrieval truncates by relevance and the structured
   * filters run afterwards, so a broad keyword plus a narrow filter used to
   * lose most matches -- q=engineer&location=London returned 34 of 644.
   *
   * The expected counts are derived by asking the ENGINE for the unfiltered
   * result set and counting it, rather than by re-implementing tokenisation
   * here with a regex. A substring test disagrees with the tokeniser by
   * construction ("engineer" vs "Engineering Manager"), so a test written that
   * way measures the test, not the search.
   */
  {
    const idsOf = async (q) => {
      const ids = new Set()
      const first = await search({ ...q, pageSize: 100 })
      for (let p = 1; p <= first.totalPages; p++) {
        for (const j of (await search({ ...q, page: p, pageSize: 100 })).jobs) ids.add(j.externalId)
      }
      return ids
    }

    const all = await idsOf({ q: 'engineer' })
    const inBerlin = new Set(
      [...all].filter((id) => FIXTURE.jobs.find((j) => j.id === id)?.city === 'Berlin'),
    )
    const got = await totalOf({ q: 'engineer', cities: ['Berlin'] })
    t('keyword + city finds every matching posting', got === inBerlin.size, { got, expected: inBerlin.size })

    const remoteExpected = [...all].filter((id) => FIXTURE.jobs.find((j) => j.id === id)?.remote).length
    t('keyword + remote finds every matching posting',
      (await totalOf({ q: 'engineer', remote: true })) === remoteExpected)

    const acmeAll = await idsOf({ q: 'software engineer' })
    const acmeExpected = [...acmeAll].filter(
      (id) => FIXTURE.jobs.find((j) => j.id === id)?.companySlug === 'acme',
    ).length
    t('a dominant employer is fully reachable',
      (await totalOf({ q: 'software engineer', companies: ['acme'] })) === acmeExpected)
    t('and it really is the dominant one', acmeExpected > acmeAll.size / 2, { acmeExpected, all: acmeAll.size })
  }

  /* ===================== 7. DIVERSIFICATION =============================== */
  // acme holds 40 "Software Engineer" rows per city by construction, which is
  // exactly the shape that made real pages show one job twenty times.
  {
    const r = await search({ q: 'software engineer', pageSize: 20 })
    const counts = new Map()
    for (const j of r.jobs) counts.set(j.companySlug, (counts.get(j.companySlug) ?? 0) + 1)
    const max = Math.max(...counts.values())
    /**
     * acme holds far more than its quota's share of these matches, so the quota
     * cannot hold exactly -- capping it would mean DROPPING results, which is
     * never the right trade. What must hold is that page 1 is not owned by one
     * employer and the minority employers reach it. The exact-quota case is
     * pinned separately in test-diversify.mjs, where the supply allows it.
     */
    t('no employer owns even half of page 1', max <= 10, [...counts])
    t('and the page shows several employers', counts.size >= 4, counts.size)
    t('every other employer reaches page 1',
      COMPANIES.filter((c) => (counts.get(c) ?? 0) > 0).length >= 4, [...counts])

    /**
     * Diversification is a reordering, so the set of results must be identical.
     * Checked by paging the whole result set and comparing the union to
     * `total` -- that proves nothing was added, dropped or repeated, without
     * this test needing to know how the ranking tokenises anything.
     */
    const seen = new Set()
    let dup = 0
    for (let p = 1; p <= r.totalPages; p++) {
      for (const j of (await search({ q: 'software engineer', page: p, pageSize: 100 })).jobs) {
        if (seen.has(j.externalId)) dup++
        seen.add(j.externalId)
      }
    }
    t('diversified pagination has no duplicates', dup === 0, dup)
    t('the paged union is exactly the reported total', seen.size === r.total, { union: seen.size, total: r.total })

    // A search that legitimately matches one employer must still fill the page
    // rather than being capped at the quota.
    const single = await search({ q: 'software engineer', companies: ['acme'], cities: ['London'], pageSize: 20 })
    t('a single-employer result set still fills the page', single.jobs.length === 20, single.jobs.length)
  }

  /* ===================== 8. FACETS ======================================= */
  {
    const r = await search({ q: 'engineer' })
    const facetTotal = r.facets.countries.reduce((s, f) => s + f.count, 0)
    t('country facet counts sum to the filtered total', facetTotal === r.total, { facetTotal, total: r.total })
    t('remote facet never exceeds the total', r.facets.remote <= r.total)

    // A facet must describe the set you would actually get.
    const berlin = r.facets.cities.find((f) => f.value === 'Berlin')
    t('a city facet count matches filtering by it',
      berlin && (await totalOf({ q: 'engineer', cities: ['Berlin'] })) === berlin.count,
      berlin)

    const co = r.facets.companies.find((f) => f.value === 'acme')
    t('a company facet count matches filtering by it',
      co && (await totalOf({ q: 'engineer', companies: ['acme'] })) === co.count, co)
  }

  /* ===================== 9. EMPTY AND DEGENERATE ========================== */
  {
    t('a nonsense keyword returns zero, not everything',
      (await totalOf({ q: 'zzzzqqqxyzzy' })) === 0)
    t('an empty keyword is not a filter', (await totalOf({ q: '   ' })) === FIXTURE.jobs.length)
    t('a zero result still reports facets', Array.isArray((await search({ q: 'zzzzqqqxyzzy' })).facets.countries))
    t('a zero result reports totalPages of at least 1',
      (await search({ q: 'zzzzqqqxyzzy' })).totalPages === 1)
    t('minSalary above every salary empties the set',
      (await totalOf({ minSalary: 99_000_000 })) === 0)
    t('postedWithinDays excludes undated rows rather than assuming them fresh',
      (await totalOf({ postedWithinDays: 3650 })) === FIXTURE.jobs.filter((j) => j.postedAt).length)
  }

  /* ===================== 10. MULTI-FILTER COMBINATIONS ==================== */
  {
    const combos = [
      { q: 'engineer', location: 'London', remote: true },
      { q: 'engineer', countries: ['India'], employmentTypes: ['Contract'] },
      { q: 'software engineer', cities: ['Austin'], departments: ['Engineering'], sort: 'recent' },
      { q: 'engineer', companies: ['acme', 'globex'], minSalary: 60000 },
      { countries: ['Germany'], remote: true, sort: 'salary' },
      { q: 'engineer', earlyCareer: ['any'], countries: ['United Kingdom'] },
    ]
    for (const q of combos) {
      const r = await search({ ...q, pageSize: 25 })
      const label = JSON.stringify(q)
      // Every returned row must actually satisfy every filter.
      const ok = r.jobs.every((j) => {
        if (q.remote && !j.isRemote) return false
        if (q.countries && !q.countries.includes(j.country)) return false
        if (q.cities && !q.cities.includes(j.city)) return false
        if (q.companies && !q.companies.includes(j.companySlug)) return false
        if (q.employmentTypes && !q.employmentTypes.includes(j.employmentType)) return false
        if (q.departments && !q.departments.includes(j.department)) return false
        if (q.earlyCareer && !j.earlyCareer) return false
        if (q.minSalary && (j.salaryMax ?? j.salaryMin ?? 0) < q.minSalary) return false
        return true
      })
      t(`every row satisfies all filters: ${label}`, ok,
        r.jobs.slice(0, 2).map((j) => ({ c: j.country, city: j.city, remote: j.isRemote })))
    }
  }
} finally {
  console.info = info
  process.chdir(cwd)
  await cleanup(dir)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
