/**
 * Probe many employers across every provider at once.
 *
 *   node scripts/bulk-probe.mjs candidates.json
 *
 * Input is [{ name, tokens: { greenhouse: [...], ashby: [...], workday: ["host|site"], ... } }].
 * Output names, for each employer, the FIRST board that answered with live
 * postings -- and stays silent about the rest, because a token that 404s tells
 * you nothing except that this guess was wrong.
 *
 * This exists because guessing is cheap and wrong often enough to matter:
 * measured across this registry, the obvious token was wrong for DoorDash
 * (`doordashusa`), CrowdStrike (`crowdstrikecareers`), Bank of America (`ghr`),
 * NatWest (`rbs`), Standard Chartered (`peopleplus`) and Mistral (`mistral.ai`,
 * with the dot). A board only enters the registry once it has answered.
 */

import { readFileSync } from 'fs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT = 15_000
const CONCURRENCY = 8

async function get(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        // Node's fetch decodes only the first zstd frame, which silently
        // truncates large bodies to ~1KB behind a 200.
        'Accept-Encoding': 'gzip, deflate, br',
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(t)
  }
}

const PROBES = {
  async greenhouse(token) {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`)
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.jobs ?? []
    return jobs.length ? { count: jobs.length, sample: jobs[0]?.title } : null
  },
  async lever(token) {
    const r = await get(`https://api.lever.co/v0/postings/${token}?mode=json`)
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) && d.length ? { count: d.length, sample: d[0]?.text } : null
  },
  async ashby(token) {
    const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.jobs ?? []
    return jobs.length ? { count: jobs.length, sample: jobs[0]?.title } : null
  },
  async smartrecruiters(token) {
    const r = await get(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`)
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.content ?? []
    return jobs.length ? { count: d.totalFound ?? jobs.length, sample: jobs[0]?.name } : null
  },
  async recruitee(token) {
    const r = await get(`https://${token}.recruitee.com/api/offers/`)
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.offers ?? []
    return jobs.length ? { count: jobs.length, sample: jobs[0]?.title } : null
  },
  async workable(token) {
    const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`)
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.jobs ?? []
    return jobs.length ? { count: jobs.length, sample: jobs[0]?.title } : null
  },
  /** token is "host|site". */
  async workday(token) {
    const [host, site] = token.split('|')
    if (!host || !site) return null
    const tenant = host.split('.')[0]
    const r = await get(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    })
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.jobPostings ?? []
    return jobs.length ? { count: d.total ?? jobs.length, sample: jobs[0]?.title } : null
  },
  /** token is "host|domain". */
  async eightfold(token) {
    const [host, domain] = token.split('|')
    if (!host || !domain) return null
    const r = await get(
      `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&start=0&num=10`
    )
    if (!r.ok) return null
    const d = await r.json()
    const jobs = d.positions ?? []
    return jobs.length ? { count: d.count ?? jobs.length, sample: jobs[0]?.name } : null
  },
  /** token is "host|siteNumber" for Oracle Recruiting Cloud. */
  async oracle(token) {
    const [host, site] = token.split('|')
    if (!host || !site) return null
    const r = await get(
      `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${site},limit=10,offset=0`
    )
    if (!r.ok) return null
    const d = await r.json()
    const item = d.items?.[0]
    const rows = item?.requisitionList ?? []
    return rows.length
      ? { count: item?.TotalJobsCount ?? rows.length, sample: rows[0]?.Title }
      : null
  },
}

const candidates = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Flatten to one task per (employer, provider, token).
const tasks = []
for (const c of candidates) {
  for (const [provider, tokens] of Object.entries(c.tokens ?? {})) {
    for (const token of tokens) tasks.push({ name: c.name, provider, token })
  }
}
console.log(`${candidates.length} employers, ${tasks.length} token guesses\n`)

const found = new Map()
let done = 0

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (tasks.length) {
      const t = tasks.shift()
      done++
      // Once an employer is resolved, skip its remaining guesses.
      if (found.has(t.name)) continue
      try {
        const res = await PROBES[t.provider]?.(t.token)
        if (res && !found.has(t.name)) {
          found.set(t.name, { ...t, ...res })
          console.log(
            `LIVE  ${t.name.padEnd(22)} ${t.provider.padEnd(16)} ${String(res.count).padStart(6)} jobs  ` +
              `${t.token.slice(0, 46)}`
          )
        }
      } catch {
        // A timeout is not information; stay quiet.
      }
    }
  })
)

const missing = candidates.map((c) => c.name).filter((n) => !found.has(n))
console.log(`\n${found.size}/${candidates.length} resolved`)
if (missing.length) console.log(`\nunresolved: ${missing.join(', ')}`)

console.log('\n--- registry lines ---')
for (const [, f] of found) {
  const [a, b] = f.token.split('|')
  const board =
    f.provider === 'workday'
      ? `{ provider: 'workday', token: '${a.split('.')[0]}', site: '${b}', host: '${a}' }`
      : f.provider === 'eightfold'
        ? `{ provider: 'eightfold', token: '${a.split('.')[0]}', host: '${a}' }`
        : f.provider === 'oracle'
          ? `{ provider: 'custom', token: '${b}', host: '${a}' }`
          : `{ provider: '${f.provider}', token: '${f.token}' }`
  console.log(`  // ${f.name}: ${f.count} jobs, verified`)
  console.log(`  boards: [${board}] },`)
}
