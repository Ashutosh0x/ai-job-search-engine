/**
 * Workday posting identity: what makes one posting distinct from another.
 *
 * THE FAILURE THIS GUARDS
 * -----------------------
 * The adapter took the requisition id from `bulletFields[0]`. That is not the
 * requisition id -- it is whatever the tenant chose to put first, and tenants
 * configure the bullet list freely:
 *
 *   NVIDIA   ["JR2017846"]                                            index 0
 *   Thales   ["Regular Employee", "R0334962", "20 - SOFTWARE", ...]   index 1
 *
 * `sourceId` came from the same field, and the canonical job id is
 * `source:token:sourceId`. So every Thales posting was `workday:thales:Regular
 * Employee`, and 740 postings collapsed onto 8 ids -- one per employment type.
 * Thales entered the index as an employer with 8 openings. Nothing errored.
 *
 * Measured across the crawled corpus, 253,114 postings (40% of it) carried a
 * "requisition id" that was really an employment type, a city or a country:
 * "Regular Employee", "Texas", "Contrat à durée indéterminée".
 *
 * The id lives in `externalPath`, which Workday ends with `_{REQ}` and suffixes
 * with `-N` when the same requisition is posted again.
 */

import { WorkdayAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

const target = { source: 'workday', token: 'x', site: 'Site', host: 'x.wd3.myworkdayjobs.com' }

/** A tenant returning exactly the postings given. */
function tenant(postings) {
  class Fake extends WorkdayAdapter {
    postJson = async (_url, body) => ({
      total: postings.length,
      jobPostings: body.offset === 0 ? postings : [],
      facets: [],
    })
  }
  return new Fake()
}

const read = async (postings) => (await tenant(postings).fetchJobs(target, {})).jobs

/* ------------- the id is read from the path, not from bullet[0] ----------- */
{
  // Thales' real shape: employment type first, requisition second.
  const [j] = await read([{
    title: 'Software Developer',
    externalPath: '/job/Athens/Software-Developer_R0334962',
    bulletFields: ['Regular Employee', 'R0334962', '20 - SOFTWARE', 'Thales Hellas'],
  }])
  t('the requisition is R0334962, not "Regular Employee"', j.requisitionId === 'R0334962', j.requisitionId)
  t('sourceId is not the employment type', j.sourceId === 'R0334962', j.sourceId)
}

{
  // NVIDIA's shape must keep working -- the single-element case is the one
  // the old code got right.
  const [j] = await read([{
    title: 'Software Engineer',
    externalPath: '/job/US-CA/Software-Engineer_JR2017846',
    bulletFields: ['JR2017846'],
  }])
  t('a single-bullet tenant still resolves correctly', j.requisitionId === 'JR2017846', j.requisitionId)
}

/* --------------- postings of one requisition stay distinct ---------------- */
{
  // The -N suffix marks a re-post of the SAME opening. The postings must not
  // collapse onto one id, and the requisition must not gain the suffix.
  const jobs = await read([
    { title: 'Applied AI Engineer', externalPath: '/job/CA/Applied-AI-Engineer_JR2018178', bulletFields: ['JR2018178'] },
    { title: 'Applied AI Engineer', externalPath: '/job/TX/Applied-AI-Engineer_JR2018178-3', bulletFields: ['JR2018178'] },
  ])
  t('two postings of one requisition keep separate sourceIds',
    new Set(jobs.map((j) => j.sourceId)).size === 2, jobs.map((j) => j.sourceId))
  t('both report the same requisition',
    jobs.every((j) => j.requisitionId === 'JR2018178'), jobs.map((j) => j.requisitionId))
}

/* ----------------- a whole board does not collapse onto one id ------------ */
{
  // The exact bug: same bulletFields[0] across every posting.
  const postings = Array.from({ length: 50 }, (_, i) => ({
    title: `Role ${i}`,
    externalPath: `/job/Athens/Role-${i}_R${100000 + i}`,
    bulletFields: ['Regular Employee', `R${100000 + i}`],
  }))
  const jobs = await read(postings)
  t('50 postings sharing a bullet[0] yield 50 distinct ids',
    new Set(jobs.map((j) => j.sourceId)).size === 50,
    new Set(jobs.map((j) => j.sourceId)).size)
}

/* ------------------------- shapes with no id in the path ------------------ */
{
  // Fall back to a bullet field that is SHAPED like an id: has a digit, no
  // spaces. "Regular Employee" and "20 - SOFTWARE" must both be rejected.
  const [j] = await read([{
    title: 'No id in path',
    externalPath: '/job/Athens/Software-Developer',
    bulletFields: ['Regular Employee', '20 - SOFTWARE', 'REQ-4471'],
  }])
  t('an id-shaped bullet field is preferred over a wordy one',
    j.requisitionId === 'REQ-4471', j.requisitionId)
}

{
  // Nothing id-shaped anywhere: the path keeps postings distinct even though
  // the requisition is unknowable. Losing the requisition is recoverable;
  // collapsing postings onto one id is not.
  const jobs = await read([
    { title: 'A', externalPath: '/job/Athens/A', bulletFields: ['Regular Employee'] },
    { title: 'B', externalPath: '/job/Athens/B', bulletFields: ['Regular Employee'] },
  ])
  t('with no id anywhere, postings still get distinct ids',
    new Set(jobs.map((j) => j.sourceId)).size === 2, jobs.map((j) => j.sourceId))
  t('an unknowable requisition is null, not a guess',
    jobs.every((j) => j.requisitionId === null), jobs.map((j) => j.requisitionId))
}

/* ------------- a real id ending in digits is not mistaken for a repost ---- */
{
  // `REQ-4471` is the whole id, not `REQ` re-posted 4471 times. The repost
  // rule only strips when what remains still looks like an id.
  const [j] = await read([{
    title: 'Numeric-suffix id',
    externalPath: '/job/Athens/Analyst_REQ-4471',
    bulletFields: [],
  }])
  t('a base with no digits means the suffix WAS the id',
    j.requisitionId === 'REQ-4471', j.requisitionId)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
