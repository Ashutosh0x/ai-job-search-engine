/**
 * Keka's public career-portal feed.
 *
 * THE FAILURE THIS GUARDS
 * -----------------------
 * The jobs endpoint is `/careers/api/jobs/{portal}/active`, and the portal
 * segment reads exactly like a tenant name. For scimplify.keka.com the obvious
 * guess -- `/careers/api/jobs/scimplify/active` -- answers HTTP 200 with `[]`.
 * Not a 404, not an error: an empty board. Every tenant would have been
 * indexed as an employer with nothing open, and the crawl would have reported
 * complete success. The literal string `default` returns the 76 real postings.
 *
 * So the adapter must send `default` unless a portal name was configured, and
 * that is the first thing tested here.
 */

import { KekaAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

/** A fake Keka tenant that only answers the `default` portal, as the real one does. */
function fakeKeka(rows, { portalThatWorks = 'default' } = {}) {
  class Fake extends KekaAdapter {
    urls = []
    json = async (url) => {
      this.urls.push(url)
      const m = /\/careers\/api\/jobs\/([^/]+)\/active/.exec(url)
      if (!m) return null
      return m[1] === portalThatWorks ? rows : []
    }
  }
  return new Fake()
}

const JOB = {
  id: 87857,
  title: 'Sr. Business Development Manager',
  description: '<div>About Us</div>',
  excerpt: 'Lead the BD team',
  departmentName: 'International Business',
  jobLocations: [
    { id: 1, name: 'Boston, Massachusetts', city: 'Boston', state: 'MA', countryCode: 'US', countryName: 'United States' },
    { id: 2, name: 'Remote - India', city: 'Pune', state: 'MH', countryCode: 'IN', countryName: 'India' },
  ],
  jobType: 2,
  experience: '4 - 7',
  salaryRange: { currency: 'INR', salaryPeriod: 0 },
  publishedOn: '2026-09-09T07:52:36.03Z',
  skillNames: ['Sales'],
}

const target = { source: 'keka', token: 'scimplify' }

/* -------------------- the portal segment is 'default' --------------------- */
{
  const a = fakeKeka([JOB])
  const r = await a.fetchJobs(target, {})
  t('the tenant is read through the default portal, not its own name',
    r.jobs.length === 1, { jobs: r.jobs.length, urls: a.urls })
  t('the request goes to /careers/api/jobs/default/active',
    a.urls.some((u) => u.endsWith('/careers/api/jobs/default/active')), a.urls)
}

{
  // Guessing the tenant name is the bug: it returns 200 with an empty array,
  // which is indistinguishable from a board with nothing open.
  const a = fakeKeka([JOB], { portalThatWorks: 'scimplify' })
  const r = await a.fetchJobs(target, {})
  t('a tenant-named portal is NOT what the adapter asks for', r.jobs.length === 0, r.jobs.length)
}

{
  // A tenant that renamed its portal can still be reached.
  const a = fakeKeka([JOB], { portalThatWorks: 'custom-portal' })
  const r = await a.fetchJobs({ ...target, site: 'custom-portal' }, {})
  t('an explicit portal name overrides the default', r.jobs.length === 1, r.jobs.length)
}

/* ------------------------------ field mapping ----------------------------- */
{
  const a = fakeKeka([JOB])
  const j = (await a.fetchJobs(target, {})).jobs[0]

  t('title is carried', j.title === 'Sr. Business Development Manager', j.title)
  t('the first location becomes locationRaw', j.locationRaw === 'Boston, Massachusetts', j.locationRaw)
  t('further locations are kept, not dropped',
    j.additionalLocations.length === 1 && j.additionalLocations[0] === 'Remote - India',
    j.additionalLocations)
  t('department is carried', j.department === 'International Business', j.department)
  t('jobType 2 maps to Full-Time', j.employmentType === 'Full-Time', j.employmentType)
  t('the HTML description is kept', j.descriptionHtml === '<div>About Us</div>', j.descriptionHtml)
  t('publishedOn becomes an ISO postedAt',
    typeof j.postedAt === 'string' && j.postedAt.startsWith('2026-09-09'), j.postedAt)
  t('the application URL points at the real posting',
    j.applicationUrl === 'https://scimplify.keka.com/careers/jobdetails/87857', j.applicationUrl)
  t('experience and skills are preserved for later mining',
    j.extra.experience === '4 - 7' && j.extra.skills[0] === 'Sales', j.extra)
  // salaryRange carries a currency but no amounts on every tenant measured.
  // Reporting a pay range from it would be inventing one.
  t('no salary is invented from a currency-only range',
    j.salaryMin == null && j.salaryMax == null, { min: j.salaryMin, max: j.salaryMax })
  t('a location naming remote sets the remote flag', j.remoteFlag === true, j.remoteFlag)
}

/* ---------------------- shapes that must not fabricate -------------------- */
{
  // An unseen jobType must not be guessed into a label.
  const a = fakeKeka([{ ...JOB, jobType: 99 }])
  const j = (await a.fetchJobs(target, {})).jobs[0]
  t('an unknown jobType yields null, not a guess', j.employmentType === null, j.employmentType)
}

{
  const a = fakeKeka([{ ...JOB, jobLocations: [] }])
  const j = (await a.fetchJobs(target, {})).jobs[0]
  t('a posting with no location yields null, not a crash', j.locationRaw === null, j.locationRaw)
}

{
  class Broken extends KekaAdapter { json = async () => null }
  const r = await new Broken().fetchJobs(target, {})
  t('an unreadable board reports a warning instead of throwing',
    r.jobs.length === 0 && r.warnings.length === 1, r.warnings)
}

{
  // One malformed row must not lose the board.
  const a = fakeKeka([JOB, { id: 2 /* no title */ }])
  const r = await a.fetchJobs(target, {})
  t('a malformed row is skipped and counted, not fatal',
    r.jobs.length === 1 && r.warnings.some((w) => /skipped 1/.test(w)), r.warnings)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
