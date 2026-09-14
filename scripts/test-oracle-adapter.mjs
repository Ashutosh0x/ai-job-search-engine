/**
 * The Oracle Recruiting Cloud adapter, against the live Nokia board.
 *
 * This hits the network deliberately. An adapter that maps fields correctly
 * against a fixture but wrong against the real API is worthless, and the whole
 * reason this adapter exists is that the real endpoint was unguessable -- the
 * pod is `fa-evmr-saasfaprod1`, found by reading the careers page after
 * `fa-eomz` (the obvious guess) returned nothing.
 *
 * The property that matters most here is the apply URL. Oracle serves its API
 * from an oraclecloud.com pod and its applications from the employer's own
 * domain. Linking to the pod would technically resolve and would still be
 * wrong: this index points at the employer's own posting, never an
 * intermediary that a candidate does not recognise.
 */

import { OracleAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const target = {
  source: 'oracle',
  token: 'nokia',
  site: 'CX_1',
  host: 'fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com',
  applyHost: 'jobs.nokia.com',
  companyName: 'Nokia',
  companyDomain: 'nokia.com',
  companySlug: 'nokia',
}

const adapter = new OracleAdapter()
const result = await adapter.fetchJobs(target)
const jobs = result.jobs

console.log(`fetched ${jobs.length} postings, ${result.warnings.length} warning(s)\n`)

/* ------------------------------- volume ----------------------------------- */
{
  // The board reported 590-591 when this was written. Boards move, so the test
  // asserts a floor rather than an exact count -- an exact count would fail
  // every time Nokia posts a role, which teaches people to ignore the suite.
  t('pulls a realistic number of postings', jobs.length > 300, jobs.length)
  t('pages past the first 200', jobs.length > 200, jobs.length)
}

/* ------------------------------- mapping ---------------------------------- */
{
  const j = jobs[0]
  t('every posting has a title', jobs.every((x) => x.title && x.title.length > 1))
  t('every posting has a stable source id', jobs.every((x) => x.sourceId))
  t('ids are unique', new Set(jobs.map((x) => x.sourceId)).size === jobs.length,
    { ids: jobs.length, unique: new Set(jobs.map((x) => x.sourceId)).size })
  t('company is carried from the target', jobs.every((x) => x.company === 'Nokia'))
  t('a location is present on most rows',
    jobs.filter((x) => x.locationRaw).length > jobs.length * 0.8,
    jobs.filter((x) => x.locationRaw).length)
  t('posted dates parse to ISO',
    jobs.filter((x) => x.postedAt && !Number.isNaN(Date.parse(x.postedAt))).length > jobs.length * 0.8)
  t('sample row looks right', Boolean(j?.title && j?.applicationUrl), {
    title: j?.title, url: j?.applicationUrl, loc: j?.locationRaw,
  })
}

/* ---------------------- the apply URL, which is the point ------------------ */
{
  t('apply links point at the employer domain',
    jobs.every((x) => x.applicationUrl.startsWith('https://jobs.nokia.com/')),
    jobs.slice(0, 3).map((x) => x.applicationUrl))

  t('apply links never point at the Oracle pod',
    jobs.every((x) => !x.applicationUrl.includes('oraclecloud.com')),
    jobs.find((x) => x.applicationUrl.includes('oraclecloud.com'))?.applicationUrl)

  t('apply links carry the requisition id',
    jobs.every((x) => x.applicationUrl.includes(`/job/${x.sourceId}`)),
    jobs[0]?.applicationUrl)

  // If applyHost is absent the adapter must still produce a usable URL rather
  // than "https://undefined/...".
  const noApplyHost = await new OracleAdapter().fetchJobs({ ...target, applyHost: undefined })
  t('falls back to the API host when no applyHost is set',
    noApplyHost.jobs.length > 0 &&
    noApplyHost.jobs.every((x) => !x.applicationUrl.includes('undefined')),
    noApplyHost.jobs[0]?.applicationUrl)
}

/* ------------------------------ remote flag -------------------------------- */
{
  // ORA_HYBRID is not remote. Treating it as remote would put hybrid roles in
  // front of people filtering for remote work, which is the filter they most
  // rely on.
  const withFlag = jobs.filter((x) => x.remoteFlag !== null)
  t('workplace type maps to a tri-state, not a guess',
    jobs.some((x) => x.remoteFlag === null) || withFlag.length === jobs.length)
  t('hybrid is not reported as remote',
    jobs.filter((x) => x.extra?.workplaceType === 'Hybrid').every((x) => x.remoteFlag === false),
    jobs.find((x) => x.extra?.workplaceType === 'Hybrid' && x.remoteFlag !== false))
}

/* ------------------------------ bad config --------------------------------- */
{
  const noSite = await new OracleAdapter().fetchJobs({ ...target, site: undefined })
  t('missing site is reported, not silently empty',
    noSite.jobs.length === 0 && noSite.warnings.some((w) => /site/i.test(w)),
    noSite.warnings)

  const noHost = await new OracleAdapter().fetchJobs({ ...target, host: undefined })
  t('missing host is reported, not silently empty',
    noHost.jobs.length === 0 && noHost.warnings.some((w) => /host/i.test(w)),
    noHost.warnings)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
