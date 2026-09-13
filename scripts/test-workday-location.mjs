/**
 * Workday postings whose location lives only in the URL.
 *
 * THE FAILURE THIS GUARDS
 * -----------------------
 * `locationsText` is optional and its absence is silent. A tenant that omits
 * it encodes the place in `externalPath` instead, so reading only
 * `locationsText` yields a posting with no location and no error to notice.
 *
 * Measured over a full crawl of every known tenant: 47,435 of 152,651 postings
 * (31%) had no location, 42,528 of them Accenture alone -- the largest Workday
 * board in the corpus. Location is the primary filter in this product, so
 * those postings were effectively unfindable.
 *
 * The slug writes a separator as a triple dash and spaces as single dashes.
 * Both must be decoded, and the order matters: collapsing single dashes first
 * destroys the evidence of which dashes were separators.
 */

import { WorkdayAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)) }
}

const target = {
  source: 'workday', token: 'accenture', site: 'AccentureCareers',
  host: 'accenture.wd103.myworkdayjobs.com',
}

/** A tenant that returns exactly the fields the real one does. */
function fakeTenant(postings) {
  class Fake extends WorkdayAdapter {
    postJson = async (_url, body) => ({
      total: postings.length,
      jobPostings: body.offset === 0 ? postings : [],
      facets: [],
    })
  }
  return new Fake()
}

const locationOf = async (posting) => {
  const r = await fakeTenant([posting]).fetchJobs(target, {})
  return r.jobs[0]?.locationRaw ?? null
}

/* --------------- the place is recovered when the field is absent ---------- */
{
  // Accenture's real shape: no locationsText at all.
  const loc = await locationOf({
    title: 'Pessoa Analista e Consultora SAP',
    externalPath: '/job/Pernambuco---Recife/Pessoa-Analista-e-Consultora--SAP-PP-PM-QM_R00253057',
    bulletFields: ['R00253057'],
  })
  t('a triple dash is read as a separator', loc === 'Pernambuco - Recife', loc)
}

{
  const loc = await locationOf({
    title: 'Analista Contabil Junior',
    externalPath: '/job/Nova-Lima-Shopping-Alta-Vila/Analista-Contbil-Junior_R00323158',
    bulletFields: ['R00323158'],
  })
  // The bug this pins: expanding every dash to " - " gives
  // "Nova - Lima - Shopping - Alta - Vila".
  t('single dashes are spaces, not separators',
    loc === 'Nova Lima Shopping Alta Vila', loc)
}

{
  const loc = await locationOf({
    title: 'Winter Sous Chef',
    externalPath: '/job/Copper-Mountain-CO/Winter-26-27--Sous-Chef_JR7144',
    bulletFields: ['JR7144'],
  })
  t('a plain city slug survives intact', loc === 'Copper Mountain CO', loc)
}

/* ----------------- an explicit location always wins ----------------------- */
{
  const loc = await locationOf({
    title: 'Forward Deployed Engineer',
    locationsText: 'Australia - Sydney',
    externalPath: '/job/Australia---Sydney/Forward-Deployed-Engineer_JR359868',
    bulletFields: ['JR359868'],
  })
  t('locationsText is preferred over the path', loc === 'Australia - Sydney', loc)
}

{
  // An empty string is not an answer. `??` would keep it and report no
  // location for a posting whose path names one.
  const loc = await locationOf({
    title: 'Store Supervisor',
    locationsText: '',
    externalPath: '/job/Stuttgart/Store-Supervisor_0000038128',
    bulletFields: ['0000038128'],
  })
  t('an empty locationsText falls through to the path', loc === 'Stuttgart', loc)
}

/* ------------------------- shapes that must not crash --------------------- */
{
  const loc = await locationOf({
    title: 'Locale-prefixed',
    externalPath: '/en-US/job/Dublin/Analyst_JR1',
    bulletFields: ['JR1'],
  })
  t('a locale prefix does not shift the location segment', loc === 'Dublin', loc)
}

{
  const loc = await locationOf({
    title: 'No path location',
    externalPath: '/job',
    bulletFields: ['JR2'],
  })
  t('a path with no location segment yields null, not a crash', loc === null, loc)
}

{
  // "Boston" must not become "Bo ton": an earlier revision collapsed /s+/
  // rather than /\s+/ and ate the letter.
  const loc = await locationOf({
    title: 'Letters are not whitespace',
    externalPath: '/job/Boston-Massachusetts/Analyst_JR3',
    bulletFields: ['JR3'],
  })
  t('letters in the slug are left alone', loc === 'Boston Massachusetts', loc)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
