/**
 * Search recall tests: keyword + structured filter must not lose results.
 *
 * THE BUG
 * -------
 * Retrieval truncates by relevance and the structured filters run afterwards,
 * over whatever survived. A broad keyword plus a narrow filter therefore lost
 * almost everything: the filter could only choose from the top N by BM25, so a
 * London posting ranked 12,000th for "engineer" was discarded before the
 * location filter ever saw it.
 *
 * MEASURED, 2026-09-15, over the 113,416-posting served index:
 *
 *   q=engineer&location=London   34 results before, 644 after
 *
 * Nothing on the page said the answer was a fraction of the truth -- 34 reads
 * as a complete result set for a perfectly reasonable search.
 *
 * These tests build an index whose shape reproduces it: a large block of
 * postings that match the keyword strongly and rank above a small block that
 * matches the keyword AND the filter. If the filter runs against a truncated
 * candidate list, the small block disappears.
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

function job(i, { title, city, country, remote = false, dept = 'Engineering' }) {
  return {
    id: `greenhouse:acme:${i}`,
    source: 'greenhouse',
    company: 'Acme',
    companySlug: 'acme',
    companyDomain: 'acme.com',
    title,
    description: 'Build and operate systems.',
    locationRaw: [city, country].filter(Boolean).join(', '),
    locationDisplay: city ?? country,
    city,
    state: null,
    country,
    remote,
    employmentType: 'Full-time',
    seniority: 'mid',
    department: dept,
    salaryMin: null, salaryMax: null, salaryCurrency: null,
    skills: [],
    postedAt: '2026-09-01T00:00:00.000Z',
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    applicationUrl: `https://acme.com/jobs/${i}`,
    isDirectApplication: true,
  }
}

/**
 * 20,000 Berlin "engineer" postings, then 300 London ones.
 *
 * The London titles are longer, so BM25's length normalisation ranks them
 * BELOW the short Berlin titles -- which is exactly the situation that made
 * the truncation lossy in production.
 */
const JOBS = [
  ...Array.from({ length: 20000 }, (_, i) => job(i, { title: 'Engineer', city: 'Berlin', country: 'Germany' })),
  ...Array.from({ length: 300 }, (_, i) =>
    job(100000 + i, {
      title: 'Engineer of Distributed Systems and Platform Reliability Group',
      city: 'London',
      country: 'United Kingdom',
    })),
]

const dir = await mkdtemp(join(tmpdir(), 'recall-'))
await mkdir(join(dir, 'public', 'data'), { recursive: true })
await writeFile(
  join(dir, 'public', 'data', 'jobs-deploy.json'),
  JSON.stringify({ generatedAt: '2026-09-14T20:00:00.000Z', jobCount: JOBS.length, jobs: JOBS }),
)

const cwd = process.cwd()
process.chdir(dir)
const info = console.info
console.info = () => {}

try {
  const { searchJobs } = await import(`../lib/job-index.ts?recall=${Math.random()}`)

  /* -------------------- keyword + location ------------------------------- */
  {
    const r = await searchJobs({ q: 'engineer', location: 'London', pageSize: 5 })
    t('every London match is found, not just those inside the truncation',
      r.total === 300, r.total)
    t('retrieval reports it was NOT truncated', r.retrieval?.truncated === false, r.retrieval)
    t('and the rows really are London',
      r.jobs.every((j) => j.city === 'London'), r.jobs.slice(0, 2).map((j) => j.city))
  }

  /* -------------------- keyword + country -------------------------------- */
  {
    const r = await searchJobs({ q: 'engineer', countries: ['United Kingdom'], pageSize: 1 })
    t('country filter sees the whole match set', r.total === 300, r.total)
  }

  /* -------------------- the unfiltered case is unchanged ----------------- */
  // Without a filter the top of the ranking is all anyone pages through, so the
  // cheaper depth still applies and truncation is still reported honestly.
  {
    const r = await searchJobs({ q: 'engineer', pageSize: 1 })
    t('an unfiltered keyword query still uses the cheaper depth',
      r.retrieval?.examined === 10000, r.retrieval)
    t('and says so rather than implying it is the whole corpus',
      r.retrieval?.truncated === true, r.retrieval)
    t('while reporting the true corpus-wide match count',
      r.retrieval?.matchedInCorpus === 20300, r.retrieval)
  }

  /* -------------------- filters still actually filter -------------------- */
  {
    const berlin = await searchJobs({ q: 'engineer', location: 'Berlin', pageSize: 1 })
    t('the large block is found too', berlin.total === 20000, berlin.total)

    const none = await searchJobs({ q: 'engineer', location: 'Reykjavik', pageSize: 1 })
    t('a location with no matches returns zero, not everything', none.total === 0, none.total)

    const remote = await searchJobs({ q: 'engineer', remote: true, pageSize: 1 })
    t('remote filter narrows to nothing when no row is remote', remote.total === 0, remote.total)
  }

  /* -------------------- combining filters narrows monotonically ---------- */
  {
    const a = await searchJobs({ q: 'engineer', pageSize: 1 })
    const b = await searchJobs({ q: 'engineer', location: 'London', pageSize: 1 })
    const c = await searchJobs({ q: 'engineer', location: 'London', departments: ['Engineering'], pageSize: 1 })
    const d = await searchJobs({ q: 'engineer', location: 'London', departments: ['Sales'], pageSize: 1 })
    t('adding a filter never widens the result set', b.total <= a.retrieval.matchedInCorpus, [a.total, b.total])
    t('a matching second filter keeps the set', c.total === b.total, [b.total, c.total])
    t('a non-matching second filter empties it', d.total === 0, d.total)
  }

  /* -------------------- paging covers the recovered rows ----------------- */
  {
    const page1 = await searchJobs({ q: 'engineer', location: 'London', page: 1, pageSize: 100 })
    const page3 = await searchJobs({ q: 'engineer', location: 'London', page: 3, pageSize: 100 })
    t('page 3 of the recovered set is reachable', page3.jobs.length === 100, page3.jobs.length)
    t('and holds different rows from page 1',
      page3.jobs[0].externalId !== page1.jobs[0].externalId)
    t('totalPages reflects the true total', page1.totalPages === 3, page1.totalPages)
  }
} finally {
  console.info = info
  process.chdir(cwd)
  await cleanup(dir)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
