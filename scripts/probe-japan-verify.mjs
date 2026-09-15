/**
 * Verify the ATS tokens claimed in the Japan expansion report.
 *
 *   node scripts/probe-japan-verify.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * A market report listed ~24 Japanese employers as being on Greenhouse,
 * Workable or Workday, each marked with a tick. The tokens in it were
 * acknowledged further down as "educated guesses based on naming conventions".
 * A guess with a tick next to it is indistinguishable from a verified fact once
 * it reaches a registry, and a wrong token there is worse than a missing
 * company: the crawl records a source failure for an employer that was never
 * on that platform, and the failure looks like an outage rather than a mistake.
 *
 * So every token gets a live request, and only a board that RETURNS POSTINGS
 * counts. A 200 holding zero jobs is an endpoint that exists, not an employer
 * that is hiring.
 *
 * This also covers the two providers the earlier probe missed -- Workday and
 * SmartRecruiters -- which is where Rakuten and several enterprises actually are.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT = 15_000

async function req(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json', ...(init.headers || {}) },
      signal: ctl.signal,
      ...init,
    })
    return { ok: r.ok, status: r.status, text: await r.text() }
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.cause?.code ?? e.message }
  } finally {
    clearTimeout(t)
  }
}

const count = (r, pick) => {
  if (!r.ok) return null
  try {
    return pick(JSON.parse(r.text))
  } catch {
    return null
  }
}

const PROVIDERS = {
  greenhouse: async (t) =>
    count(await req(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=false`), (j) =>
      Array.isArray(j.jobs) ? j.jobs.length : null,
    ),
  lever: async (t) =>
    count(await req(`https://api.lever.co/v0/postings/${t}?mode=json`), (j) =>
      Array.isArray(j) ? j.length : null,
    ),
  ashby: async (t) =>
    count(await req(`https://api.ashbyhq.com/posting-api/job-board/${t}`), (j) =>
      Array.isArray(j.jobs) ? j.jobs.length : null,
    ),
  workable: async (t) =>
    count(await req(`https://apply.workable.com/api/v1/widget/accounts/${t}`), (j) =>
      Array.isArray(j.jobs) ? j.jobs.length : null,
    ),
  recruitee: async (t) =>
    count(await req(`https://${t}.recruitee.com/api/offers/`), (j) =>
      Array.isArray(j.offers) ? j.offers.length : null,
    ),
  smartrecruiters: async (t) =>
    count(await req(`https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=100`), (j) =>
      typeof j.totalFound === 'number' ? j.totalFound : Array.isArray(j.content) ? j.content.length : null,
    ),
  /**
   * Workday is a POST with a JSON body, and the tenant lives in the HOSTNAME --
   * which is why a bare token cannot be probed the way the others can. The pod
   * number (wd1/wd3/wd5/wd103...) is not derivable from the company name, so
   * each plausible pod is tried.
   */
  workday: async (t) => {
    for (const pod of ['wd1', 'wd3', 'wd5', 'wd103', 'wd12']) {
      for (const site of ['External', 'External_Career_Site', 'Careers', 'careers']) {
        const r = await req(`https://${t}.${pod}.myworkdayjobs.com/wday/cxs/${t}/${site}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
        })
        const n = count(r, (j) => (typeof j.total === 'number' ? j.total : null))
        if (n !== null && n > 0) return { n, detail: `${t}.${pod}.myworkdayjobs.com/${site}` }
      }
    }
    return null
  },
}

/**
 * Every claim from the report, as written, plus the employers it said were
 * unreachable. `claimed` is what the report asserted so the output can say
 * whether it held.
 */
const CLAIMS = [
  { name: 'Rakuten', claimed: 'workday:rakuten', try: { workday: ['rakuten'] } },
  { name: 'Mercari', claimed: 'workable:mercari', try: { workable: ['mercari'], greenhouse: ['Mercari', 'mercari'] } },
  { name: 'SmartNews', claimed: 'greenhouse:smartnews', try: { greenhouse: ['smartnews'], workable: ['smartnews'] } },
  { name: 'Money Forward', claimed: 'greenhouse:moneyforward', try: { greenhouse: ['moneyforward', 'money-forward', 'moneyforwardgroup'], workable: ['moneyforward'], lever: ['moneyforward'] } },
  { name: 'freee', claimed: 'greenhouse:freee', try: { greenhouse: ['freee'], workable: ['freee'], lever: ['freee'] } },
  { name: 'Sansan', claimed: 'greenhouse:sansan', try: { greenhouse: ['sansan'], workable: ['sansan'], lever: ['sansan'] } },
  { name: 'Ubie', claimed: 'greenhouse:ubie', try: { greenhouse: ['ubie'], workable: ['ubie'], lever: ['ubie'], ashby: ['ubie'] } },
  { name: 'Preferred Networks', claimed: 'greenhouse:preferrednetworks', try: { greenhouse: ['preferrednetworks', 'preferred-networks', 'pfn'], workable: ['preferrednetworks'] } },
  { name: 'Timee', claimed: 'greenhouse:timee', try: { greenhouse: ['timee'], workable: ['timee'], lever: ['timee'], ashby: ['timee'] } },
  { name: 'IVRy', claimed: 'greenhouse:ivry', try: { greenhouse: ['ivry'], workable: ['ivry'], lever: ['ivry'] } },
  { name: 'Woven by Toyota', claimed: 'greenhouse:woven', try: { greenhouse: ['woven', 'wovenplanet', 'woventoyota'], workday: ['woven'], smartrecruiters: ['WovenbyToyota'] } },
  { name: 'Kyash', claimed: 'greenhouse:kyash', try: { greenhouse: ['kyash'], workable: ['kyash'], lever: ['kyash'] } },
  { name: 'Treasure Data', claimed: 'greenhouse:treasuredata', try: { greenhouse: ['treasuredata', 'treasure-data'], lever: ['treasuredata'] } },
  { name: 'SODA', claimed: 'workable:soda', try: { workable: ['soda', 'sodainc'], greenhouse: ['soda'] } },
  { name: 'Cybozu', claimed: 'custom (none)', try: { greenhouse: ['cybozu'], workable: ['cybozu'], lever: ['cybozu'] } },
  { name: 'HashiCorp', claimed: 'greenhouse:hashicorp', try: { greenhouse: ['hashicorp'], ashby: ['hashicorp'], smartrecruiters: ['HashiCorp'] } },
  { name: 'Indeed', claimed: 'greenhouse:indeed', try: { greenhouse: ['indeed'], smartrecruiters: ['Indeed'], workday: ['indeed'] } },
  { name: 'Microsoft', claimed: 'workday:microsoft', try: { workday: ['microsoft'], smartrecruiters: ['Microsoft'] } },
  { name: 'Oracle Japan', claimed: 'oracle recruiting', try: { greenhouse: ['oracle'], smartrecruiters: ['Oracle'] } },
  { name: 'LINE Yahoo', claimed: 'custom/HRMOS (none)', try: { greenhouse: ['lycorp', 'lineyahoo'], workable: ['lycorp'] } },
  { name: 'CyberAgent', claimed: 'custom (none)', try: { greenhouse: ['cyberagent'], workable: ['cyberagent'] } },
  { name: 'DeNA', claimed: 'custom (none)', try: { greenhouse: ['dena'], workable: ['dena'] } },
]

const held = []
const broke = []

for (const c of CLAIMS) {
  let hit = null
  outer: for (const [provider, tokens] of Object.entries(c.try)) {
    for (const token of tokens) {
      const res = await PROVIDERS[provider](token)
      const n = typeof res === 'object' && res !== null ? res.n : res
      if (n !== null && n > 0) {
        hit = { provider, token, n, detail: res?.detail }
        break outer
      }
    }
  }

  if (hit) {
    const actual = `${hit.provider}:${hit.token}`
    const matches = c.claimed.toLowerCase().startsWith(hit.provider) && c.claimed.toLowerCase().includes(hit.token.toLowerCase())
    held.push({ ...c, ...hit, matches })
    console.log(
      `  LIVE  ${c.name.padEnd(20)} ${actual.padEnd(28)} ${String(hit.n).padStart(6)} jobs  ` +
        (matches ? '(report was right)' : `(report said ${c.claimed})`),
    )
  } else {
    broke.push(c)
    console.log(`  none  ${c.name.padEnd(20)} claimed ${c.claimed} -- nothing live found`)
  }
}

console.log(`\n${held.length}/${CLAIMS.length} reachable.`)
const wrong = held.filter((h) => !h.matches).length
console.log(`Of the reachable, ${wrong} were on a DIFFERENT platform than the report claimed.`)
console.log(`${broke.length} could not be reached on any supported platform.`)
