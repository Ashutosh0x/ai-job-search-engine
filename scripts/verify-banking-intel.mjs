/**
 * Check a pasted "banking intelligence" report against the live APIs.
 *
 *   node scripts/verify-banking-intel.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * A research document asserting that 23 institutions use particular ATS
 * platforms at particular endpoints is a set of claims, not data. Every one of
 * those claims is cheap to test -- the endpoints are public and unauthenticated
 * -- and writing untested tokens into the registry is how an index ends up
 * serving employers that never had a board at that address.
 *
 * Only the machine-checkable claims are tested here: does this endpoint exist,
 * does it answer, and how many roles does it hold. Headcounts, leadership names
 * and office addresses in such a report are not checkable from here and are not
 * treated as verified by this script's output.
 *
 * WHAT THE VERDICTS MEAN
 * ----------------------
 *   LIVE       answered with parseable job data     -- claim stands
 *   EMPTY      answered correctly, zero open roles  -- endpoint right, board bare
 *   WRONG      404/400, or JSON with no job array   -- the claim is wrong
 *   THROTTLED  HTTP 200 carrying an HTML maintenance page. NOT a disproof:
 *              Workday serves this shard-wide when it is refusing traffic, so
 *              the claim is simply untested and must be retried.
 *   UNTESTABLE the platform has no public JSON API (Oracle HCM, Eightfold,
 *              SuccessFactors, Darwinbox all need a browser). Recorded as
 *              unknown rather than quietly counted as true.
 */

import { writeFileSync } from 'fs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

/** Exactly as asserted in the pasted report. Nothing here is assumed true. */
const CLAIMS = [
  { name: 'Citigroup',            type: 'workday', tenant: 'citi',       shard: 'wd5', site: 'citi_careers' },
  { name: 'Visa',                 type: 'workday', tenant: 'visa',       shard: 'wd5', site: 'Visa' },
  { name: 'Morgan Stanley',       type: 'workday', tenant: 'ms',         shard: 'wd5', site: 'External' },
  { name: 'Bank of America',      type: 'workday', tenant: 'ghr',        shard: 'wd1', site: 'Lateral-US' },
  { name: 'Wells Fargo',          type: 'workday', tenant: 'wf',         shard: 'wd1', site: 'WellsFargoJobs' },
  { name: 'Mastercard',           type: 'workday', tenant: 'mastercard', shard: 'wd1', site: 'CorporateCareers' },
  { name: 'PayPal',               type: 'workday', tenant: 'paypal',     shard: 'wd1', site: 'jobs' },
  { name: 'Barclays',             type: 'workday', tenant: 'barclays',   shard: 'wd3', site: 'External_Career_Site_Barclays' },
  { name: 'Commonwealth Bank',    type: 'workday', tenant: 'cba',        shard: 'wd3', site: 'CommBank_Careers' },
  { name: 'CommBank India',       type: 'workday', tenant: 'cba',        shard: 'wd3', site: 'CommBank_India' },
  { name: 'Deutsche Bank',        type: 'workday', tenant: 'db',         shard: 'wd3', site: 'DBWebsite' },
  { name: 'Lloyds Banking Group', type: 'workday', tenant: 'lbg',        shard: 'wd3', site: 'lbg_Careers' },
  { name: 'NatWest Group',        type: 'workday', tenant: 'rbs',        shard: 'wd3', site: 'RBS' },
  { name: 'Standard Chartered',   type: 'workday', tenant: 'peopleplus', shard: 'wd3', site: 'SCB_Careers' },
  { name: 'NAB',                  type: 'workday', tenant: 'nab',        shard: 'wd3', site: 'NAB_Careers' },
  { name: 'MUFG',                 type: 'workday', tenant: 'mufgub',     shard: 'wd3', site: 'MUFG-Careers' },

  { name: 'Citadel',            type: 'greenhouse', token: 'citadel' },
  { name: 'Citadel Securities', type: 'greenhouse', token: 'citadelsecurities' },
  { name: 'Jane Street',        type: 'greenhouse', token: 'janestreet' },

  { name: 'JPMorgan Chase', type: 'untestable', platform: 'Oracle Cloud HCM',    url: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/' },
  { name: 'BNY Mellon',     type: 'untestable', platform: 'Oracle Cloud HCM',    url: 'https://eofe.fa.us2.oraclecloud.com' },
  { name: 'HSBC',           type: 'untestable', platform: 'Eightfold AI',        url: 'https://hsbc.eightfold.ai' },
  { name: 'HDFC Bank',      type: 'untestable', platform: 'SAP SuccessFactors',  url: 'https://www.hdfcbank.com/personal/about-us/careers' },
  { name: 'Commerzbank',    type: 'untestable', platform: 'SAP SuccessFactors',  url: 'https://jobs.commerzbank.com' },
  { name: 'State Bank of India', type: 'untestable', platform: 'SBI HRMS / TCS iON', url: 'https://sbi.co.in/web/careers' },
  { name: 'NPCI',           type: 'untestable', platform: 'Darwinbox',           url: 'https://www.npci.org.in/who-we-are/careers' },
]

const isMarkup = (b) => {
  const h = b.slice(0, 200).trimStart().toLowerCase()
  return h.startsWith('<!doctype html') || h.startsWith('<html')
}

async function checkWorkday(c) {
  const host = `${c.tenant}.${c.shard}.myworkdayjobs.com`
  const url = `https://${host}/wday/cxs/${c.tenant}/${c.site}/jobs`
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await r.text()
    if (r.status === 404 || r.status === 400) return { verdict: 'WRONG', detail: `http ${r.status}`, url }
    if (isMarkup(body)) return { verdict: 'THROTTLED', detail: `http ${r.status}, maintenance page`, url }
    let j
    try { j = JSON.parse(body) } catch { return { verdict: 'WRONG', detail: 'unparseable body', url } }
    if (!Array.isArray(j.jobPostings)) return { verdict: 'WRONG', detail: 'no jobPostings array', url }
    const total = Number(j.total ?? 0)
    return { verdict: total > 0 ? 'LIVE' : 'EMPTY', detail: `total=${total}`, total, url }
  } catch (e) {
    return { verdict: 'UNREACHABLE', detail: e.name, url }
  }
}

async function checkGreenhouse(c) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${c.token}/jobs`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (r.status === 404) return { verdict: 'WRONG', detail: 'http 404 -- no such board', url }
    const body = await r.text()
    let j
    try { j = JSON.parse(body) } catch { return { verdict: 'WRONG', detail: 'unparseable body', url } }
    const n = (j.jobs || []).length
    return { verdict: n > 0 ? 'LIVE' : 'EMPTY', detail: `${n} roles`, total: n, url }
  } catch (e) {
    return { verdict: 'UNREACHABLE', detail: e.name, url }
  }
}

const results = []
for (const c of CLAIMS) {
  let r
  if (c.type === 'workday') r = await checkWorkday(c)
  else if (c.type === 'greenhouse') r = await checkGreenhouse(c)
  else r = { verdict: 'UNTESTABLE', detail: `${c.platform} has no public JSON API`, url: c.url }
  results.push({ ...c, ...r })
  console.log(
    `  ${r.verdict.padEnd(10)} ${c.name.padEnd(24)} ${(c.type === 'workday' ? `${c.tenant}/${c.site}` : c.token || c.platform || '').padEnd(38)} ${r.detail}`
  )
}

const by = (v) => results.filter((r) => r.verdict === v)
console.log('')
console.log(`LIVE       ${by('LIVE').length}`)
console.log(`EMPTY      ${by('EMPTY').length}`)
console.log(`WRONG      ${by('WRONG').length}`)
console.log(`THROTTLED  ${by('THROTTLED').length}   (untested, retry -- not a disproof)`)
console.log(`UNTESTABLE ${by('UNTESTABLE').length}   (no public JSON API)`)
if (by('WRONG').length) {
  console.log('\nCLAIMS THAT ARE WRONG:')
  for (const r of by('WRONG')) console.log(`  ${r.name}: ${r.url} -- ${r.detail}`)
}
const live = by('LIVE')
if (live.length) {
  console.log('\nVERIFIED OPEN ROLES:')
  for (const r of live.sort((a, b) => b.total - a.total)) console.log(`  ${String(r.total).padStart(6)}  ${r.name}`)
}

writeFileSync('scripts/banking-intel-verified.json', JSON.stringify({
  checkedAt: new Date().toISOString(),
  note: 'Only endpoint existence and role counts are verified here. Headcounts, leadership and office claims in the source report are NOT verified by this file.',
  counts: {
    live: by('LIVE').length, empty: by('EMPTY').length, wrong: by('WRONG').length,
    throttled: by('THROTTLED').length, untestable: by('UNTESTABLE').length,
  },
  results,
}, null, 2))
console.log('\nwrote scripts/banking-intel-verified.json')
