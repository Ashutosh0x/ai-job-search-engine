/**
 * The Radancy adapter, against Boeing's live career site.
 *
 * Network test, excluded from `npm test` for the same reason as the Oracle one:
 * a merge gate must not depend on a third party's uptime.
 *
 * This adapter parses generated HTML rather than a JSON API, which is more
 * brittle than everything else in the pipeline. So the assertions here are
 * deliberately about the parse being RIGHT, not merely non-empty: a template
 * change that silently yields titles of "" or apply URLs pointing at the search
 * page would otherwise look like a healthy crawl.
 */

import { RadancyAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const target = {
  source: 'radancy',
  token: 'boeing',
  host: 'jobs.boeing.com',
  site: 'search-jobs',
  companyName: 'Boeing',
  companyDomain: 'boeing.com',
  companySlug: 'boeing',
}

const res = await new RadancyAdapter().fetchJobs(target)
const jobs = res.jobs
console.log(`fetched ${jobs.length} postings, ${res.warnings.length} warning(s)\n`)

/* -------------------------------- volume ---------------------------------- */
{
  t('pulls a realistic number of postings', jobs.length > 100, jobs.length)
  t('pages past the first page', jobs.length > 30, jobs.length)
  t('ids are unique across pages',
    new Set(jobs.map((j) => j.sourceId)).size === jobs.length,
    { total: jobs.length, unique: new Set(jobs.map((j) => j.sourceId)).size })
}

/* -------------------------------- parsing --------------------------------- */
{
  t('every posting has a non-empty title',
    jobs.every((j) => j.title && j.title.trim().length > 2),
    jobs.filter((j) => !j.title || j.title.trim().length <= 2).slice(0, 3))

  // A title containing markup means the extraction grabbed the wrong span.
  t('titles contain no HTML',
    jobs.every((j) => !/[<>]/.test(j.title)),
    jobs.find((j) => /[<>]/.test(j.title))?.title)

  t('entities are decoded',
    jobs.every((j) => !/&(amp|quot|#0?39|nbsp);/.test(j.title)),
    jobs.find((j) => /&(amp|quot|#0?39|nbsp);/.test(j.title))?.title)

  t('most postings carry a location',
    jobs.filter((j) => j.locationRaw).length > jobs.length * 0.8,
    jobs.filter((j) => j.locationRaw).length)

  t('company comes from the target', jobs.every((j) => j.company === 'Boeing'))
  t('ids are numeric and stable-looking', jobs.every((j) => /^\d{6,}$/.test(j.sourceId)),
    jobs.find((j) => !/^\d{6,}$/.test(j.sourceId))?.sourceId)
}

/* ------------------------------- apply URLs -------------------------------- */
{
  t('apply URLs are absolute',
    jobs.every((j) => j.applicationUrl.startsWith('https://')),
    jobs.find((j) => !j.applicationUrl.startsWith('https://'))?.applicationUrl)

  t('apply URLs point at the employer host',
    jobs.every((j) => j.applicationUrl.includes('jobs.boeing.com')),
    jobs.find((j) => !j.applicationUrl.includes('jobs.boeing.com'))?.applicationUrl)

  // The failure that would look fine in aggregate: every row pointing at the
  // search page instead of its own posting.
  t('apply URLs are per-job, not the search page',
    new Set(jobs.map((j) => j.applicationUrl)).size === jobs.length,
    { unique: new Set(jobs.map((j) => j.applicationUrl)).size, total: jobs.length })

  t('apply URLs look like job detail paths',
    jobs.filter((j) => /\/job\//.test(j.applicationUrl)).length > jobs.length * 0.9)

  // Prove one resolves rather than assuming the shape is right.
  const sample = jobs[0].applicationUrl
  const r = await fetch(sample, { headers: { 'user-agent': 'Mozilla/5.0' } }).catch(() => null)
  t(`a real apply URL resolves (${sample.slice(0, 58)})`, Boolean(r && r.ok), r?.status)
}

/* --------------------------------- dates ----------------------------------- */
{
  const dated = jobs.filter((j) => j.postedAt)
  t('most postings carry a parseable date', dated.length > jobs.length * 0.8, dated.length)
  t('dates parse to valid ISO',
    dated.every((j) => !Number.isNaN(Date.parse(j.postedAt))),
    dated.find((j) => Number.isNaN(Date.parse(j.postedAt)))?.postedAt)
}

/* ------------------------------ bad config --------------------------------- */
{
  const bogus = await new RadancyAdapter().fetchJobs({
    ...target, host: 'jobs.this-employer-does-not-exist-xyz.com',
  })
  t('an unreachable host reports a warning rather than silent success',
    bogus.jobs.length === 0 && bogus.warnings.length > 0, bogus.warnings)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
