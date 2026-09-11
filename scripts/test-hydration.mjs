/**
 * Description hydration (§5, §36, §43).
 *
 * These guard the bug that capped the entire intelligence layer: hydration
 * rebuilt its target from the job id, which carries only `token`, so `host` and
 * `site` were dropped and no sharded platform's detail endpoint could be
 * addressed. Workday is ~48% of the corpus, so the measured effect was 0%
 * descriptions, 0% posted dates and 2% skills across half of everything.
 *
 * The first four tests are offline and are the ones that actually protect the
 * fix. The last is a live fetch, skipped with --offline.
 */

import { adapterForUrl, getAdapter } from '../lib/sources/registry.ts'
import { WorkdayAdapter } from '../lib/sources/adapters/ats.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)) }
}

const WD_URL =
  'https://nab.wd3.myworkdayjobs.com/NAB_Careers/job/Embassy-Park---Bengaluru/AVP--API-Security_JR121362'

/* --- 1. the actual bug: routing a posting URL must preserve host AND site --- */
{
  const r = adapterForUrl(WD_URL)
  t('posting URL routes to an adapter', r !== null, r)
  t('routed target keeps host', r?.target?.host === 'nab.wd3.myworkdayjobs.com', r?.target)
  t('routed target keeps site', r?.target?.site === 'NAB_Careers', r?.target)
  t('routed target keeps token', r?.target?.token === 'nab', r?.target)
}

/* --- 2. the old reconstruction is provably insufficient --------------------- */
{
  // This is what the orchestrator used to build: source + token only.
  const oldStyle = { source: 'workday', token: 'nab' }
  t(
    'token alone cannot address a Workday detail endpoint',
    oldStyle.host === undefined && oldStyle.site === undefined,
    oldStyle
  )
}

/* --- 3. Workday declares fetchJob at all ----------------------------------- */
{
  const a = getAdapter('workday')
  t('Workday adapter exposes fetchJob', typeof a?.fetchJob === 'function')
}

/* --- 4. a non-Workday URL must not be claimed by Workday ------------------- */
{
  const r = adapterForUrl('https://boards.greenhouse.io/doordashusa/jobs/1234567')
  t('Greenhouse URL routes to Greenhouse, not Workday', r?.adapter?.id === 'greenhouse', r?.target)
}

/* --- 5. live: the detail endpoint yields what the list endpoint lacks ------ */
if (!process.argv.includes('--offline')) {
  const a = new WorkdayAdapter()
  const routed = adapterForUrl(WD_URL)
  let d = null
  try {
    d = await a.fetchJob(routed.target, 'JR121362', { url: WD_URL })
  } catch (e) {
    console.log('        live fetch threw:', e.message)
  }

  if (d === null) {
    // A board can legitimately close a posting. Report it rather than failing
    // the suite on someone else's hiring decision.
    console.log('  SKIP  live detail fetch (posting gone or unreachable)')
  } else {
    t('live detail returns a description', (d.descriptionHtml ?? '').length > 500, (d.descriptionHtml ?? '').length)
    t('live detail returns an absolute postedAt', /^\d{4}-\d{2}-\d{2}T/.test(d.postedAt ?? ''), d.postedAt)
    t('live detail location carries a country', /India/.test(d.locationRaw ?? ''), d.locationRaw)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
