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
import { getBankingSlugs } from '../lib/companies/banking-intelligence.ts'
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

/**
 * A company with no board is a legitimate registry entry.
 *
 * NPCI is recorded because the employer matters, but its ATS (Darwinbox) has
 * no adapter, so it carries `boards: []`. This test used to read `boards[0]`
 * unconditionally and died on the first such entry with a TypeError, taking
 * the whole suite down with it -- a normalisation test failing because of a
 * company it was never testing. There is nothing to normalise without a
 * board, so those entries are skipped.
 */
const withBoards = COMPANIES.filter((c) => c.boards?.length)

/* ---- every curated company keeps its registry slug through normalisation -- */
{
  const wrong = []
  for (const c of withBoards) {
    const job = normalizeJob(rawFor(c), { companySlug: c.slug, companyName: c.name })
    if (job.companySlug !== c.slug) wrong.push({ want: c.slug, got: job.companySlug })
  }
  t(`all ${withBoards.length} curated slugs survive normalisation`, wrong.length === 0, wrong.slice(0, 5))
}

/* ---- no two entries claim the same slug ---------------------------------- */
{
  // COMPANY_BY_SLUG is a Map built from this array, so a duplicate slug does
  // not error -- the last entry silently wins and the earlier one, with
  // whatever curation it carried, is gone. A pasted research document once
  // added 13 banks this registry already held, replacing curated entries with
  // thinner copies and dropping a board in the process. Nothing detected it.
  const seen = new Map()
  const dupes = []
  for (const c of COMPANIES) {
    if (seen.has(c.slug)) dupes.push(c.slug)
    seen.set(c.slug, c)
  }
  t('no duplicate company slugs', dupes.length === 0, dupes)
}

/* ---- the intelligence layer joins to real companies ---------------------- */
{
  /**
   * `hasBankingIntelligence(job.companySlug)` decides a ranking boost, and a
   * slug no company carries simply never matches. There is no error and no
   * missing profile -- the boost quietly never fires, and the entry is dead
   * weight that still reads as coverage.
   *
   * Three of the fifteen entries were orphaned this way when the layer landed:
   * 'citigroup' and 'natwest-group' against registry slugs 'citi' and
   * 'natwest', and 'citadel' against no company at all.
   */
  const orphans = getBankingSlugs().filter((s) => !COMPANY_BY_SLUG.get(s))
  t(`all ${getBankingSlugs().length} intelligence profiles join a registry company`,
    orphans.length === 0, orphans)
}

/* ---- no two companies claim the same board ------------------------------- */
{
  const seen = new Map()
  const shared = []
  for (const c of COMPANIES) {
    for (const b of c.boards ?? []) {
      // Case-folded: Workday site paths are case-insensitive, so
      // `AccentureCareers` and `accenturecareers` are the same board. Keying on
      // raw casing let both into the crawl list and duplicated 27% of the
      // Workday corpus before anything noticed.
      const key = `${b.provider}|${String(b.token).toLowerCase()}|${String(b.site ?? '').toLowerCase()}`
      if (seen.has(key) && seen.get(key) !== c.slug) shared.push({ board: key, a: seen.get(key), b: c.slug })
      seen.set(key, c.slug)
    }
  }
  t('no board is claimed by two companies', shared.length === 0, shared.slice(0, 5))
}

/* ---- and every resulting slug joins back to the registry ------------------ */
{
  const orphans = []
  for (const c of withBoards) {
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

/* ------------------------- one employer, one entry ------------------------ */
//
// Unique slugs are not enough. A bulk import renamed "Sierra AI" to `sierra-ai`
// to dodge a collision with the existing `sierra` slug -- and so created a
// SECOND entry for the same company: same domain, same Ashby board. The slug
// check passed, the duplicate crawled nothing (the first entry already owned
// the board), and it showed up only as an employer with zero jobs.
{
  const byDomain = new Map()
  for (const c of COMPANIES) {
    const d = c.domain.toLowerCase()
    if (!byDomain.has(d)) byDomain.set(d, [])
    byDomain.get(d).push(c.slug)
  }
  const shared = [...byDomain].filter(([, slugs]) => slugs.length > 1)
  t('no two entries claim the same domain', shared.length === 0,
    shared.map(([d, s]) => `${d}: ${s.join(', ')}`))
}

/* ---------------------- board keys must identify a board ------------------ */
//
// `boardKeyOf` in lib/pipeline/merge.ts is `source|token`, and a job id is
// `source:token:sourceId`. Neither carries the host. So two employers sharing a
// provider+token on DIFFERENT hosts share a merge key, and their job ids
// collide outright if a requisition number ever repeats across them.
//
// Dell and Oracle are both `custom` + `CX_1` on different Oracle Recruiting
// hosts. Measured today: 467 and 2,170 postings, zero id collisions -- their
// requisition numbers happen not to overlap. That is luck, not a guarantee, and
// the failure would be silent: one employer's roles filed under the other.
//
// Same-host repeats are fine and expected (Lloyds runs two Workday sites on one
// tenant), which is why this only flags differing hosts.
{
  const byKey = new Map()
  for (const c of COMPANIES) {
    for (const b of c.boards) {
      const key = `${b.provider}|${b.token}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push({ slug: c.slug, host: b.host ?? '' })
    }
  }
  const collisions = [...byKey].filter(([, rows]) =>
    rows.length > 1 && new Set(rows.map((r) => r.host)).size > 1
  )
  t('no provider+token is shared across different hosts',
    collisions.length === 0,
    collisions.map(([k, rows]) => `${k}: ${rows.map((r) => `${r.slug}@${r.host}`).join(' vs ')}`))
}

/* ---- Every company is reachable by the crawlers ---- */
{
  // Three crawl scripts each carried this regex:
  //   /slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*domain:\s*'([^']+)'/g
  // It requires a SINGLE-quoted name, and 114 of the registry's 387 entries
  // are written `name: "Ramp"`. Those companies — Ramp, Plaid, CoreWeave,
  // Vanta, Sentry, Mercury among them — were skipped by every crawl, and the
  // scripts cheerfully reported success over the 273 they could see.
  const { parseRegistry } = await import('./lib/parse-registry.mjs')
  const { companies, declared, missed } = parseRegistry()

  t('the shared registry parser matches every declared company',
    missed === 0,
    `${companies.length} parsed vs ${declared} declared (${missed} missed)`)

  t('the registry parser accepts double-quoted names',
    companies.some((c) => c.slug === 'ramp'),
    'Ramp is declared with name: "Ramp" and must be parsed')

  const dupes = companies.length - new Set(companies.map((c) => c.slug)).size
  t('the parser returns no duplicate slugs', dupes === 0, `${dupes} duplicates`)

  const badDomain = companies.filter((c) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.domain))
  t('every parsed domain is well formed',
    badDomain.length === 0,
    badDomain.slice(0, 5).map((c) => `${c.slug}=${c.domain}`).join(', '))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
