/**
 * Company identity: the registry slug must survive into the canonical job.
 *
 * normalizeJob falls back to slugifying the domain when no slug is supplied.
 * That fallback is correct for auto-discovered boards, which have no curated
 * entry -- and wrong for curated ones, where it silently diverged from the
 * registry key. Two consequences, both invisible at runtime:
 *
 *   1. `COMPANY_BY_SLUG.get(job.companySlug)` missed, so the employer lost its
 *      curated industry, HQ, and the valuation's SOURCE and AS-OF DATE.
 *   2. Employers sharing a domain stem were MERGED. figure.ai (humanoid
 *      robotics) and figure.com (lending) both derive to `figure`.
 */

import { COMPANIES, COMPANY_BY_SLUG } from '../lib/companies/registry.ts'
import { normalizeJob } from '../lib/pipeline/normalize.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 300)) }
}

const rawFor = (c) => ({
  source: c.boards[0].provider,
  target: {
    source: c.boards[0].provider,
    token: c.boards[0].token,
    companySlug: c.slug,
    companyName: c.name,
    companyDomain: c.domain,
  },
  sourceId: 'x1',
  title: 'Engineer',
  company: c.name,
  companyDomain: c.domain,
  applicationUrl: 'https://example.com/job/1',
})

/* ---- every curated company keeps its registry slug through normalisation -- */
{
  const wrong = []
  for (const c of COMPANIES) {
    const job = normalizeJob(rawFor(c), { companySlug: c.slug, companyName: c.name })
    if (job.companySlug !== c.slug) wrong.push({ want: c.slug, got: job.companySlug })
  }
  t(`all ${COMPANIES.length} curated slugs survive normalisation`, wrong.length === 0, wrong.slice(0, 5))
}

/* ---- and every resulting slug joins back to the registry ------------------ */
{
  const orphans = []
  for (const c of COMPANIES) {
    const job = normalizeJob(rawFor(c), { companySlug: c.slug, companyName: c.name })
    if (!COMPANY_BY_SLUG.get(job.companySlug)) orphans.push(job.companySlug)
  }
  t('every normalised job joins back to its curated record', orphans.length === 0, orphans.slice(0, 5))
}

/* ---- the specific collision that motivated this --------------------------- */
{
  const ai = COMPANIES.find((c) => c.slug === 'figure-ai')
  const fin = COMPANIES.find((c) => c.slug === 'figure-technologies')
  t('both Figure companies are registered', Boolean(ai && fin))

  if (ai && fin) {
    const a = normalizeJob(rawFor(ai), { companySlug: ai.slug, companyName: ai.name })
    const b = normalizeJob(rawFor(fin), { companySlug: fin.slug, companyName: fin.name })
    t('the two Figure companies do not collapse into one slug',
      a.companySlug !== b.companySlug, { a: a.companySlug, b: b.companySlug })
    t('each keeps its own identity',
      a.companySlug === 'figure-ai' && b.companySlug === 'figure-technologies',
      { a: a.companySlug, b: b.companySlug })
  }
}

/* ---- the fallback still works for uncurated (discovered) boards ----------- */
{
  const job = normalizeJob({
    source: 'greenhouse',
    target: { source: 'greenhouse', token: 'somestartup' },
    sourceId: 'x',
    title: 'Engineer',
    company: 'Some Startup',
    companyDomain: 'somestartup.com',
    applicationUrl: 'https://example.com/j/1',
  })
  t('a discovered board with no curated slug still gets one',
    typeof job.companySlug === 'string' && job.companySlug.length > 0, job.companySlug)
}

/* ---- registry slugs are unique ------------------------------------------- */
{
  const seen = new Map()
  const dupes = []
  for (const c of COMPANIES) {
    if (seen.has(c.slug)) dupes.push(c.slug)
    seen.set(c.slug, true)
  }
  t('registry slugs are unique', dupes.length === 0, dupes)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
