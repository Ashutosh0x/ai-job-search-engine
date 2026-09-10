/**
 * Probe candidate ATS tokens and report which ones actually answer.
 *
 * Guessing a company's board token from its name is right often enough to be
 * worth trying and wrong often enough that it must never be trusted -- so this
 * asks the ATS and reports what came back. A token is only worth adding to the
 * registry when the board answers with live postings.
 *
 *   node scripts/probe-tokens.mjs greenhouse janestreet citadel ...
 *   node scripts/probe-tokens.mjs --file candidates.json
 *
 * Output is deliberately blunt: token, HTTP status, job count, one sample title.
 */

const TIMEOUT = 20_000
const CONCURRENCY = 6

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

async function get(url, init = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        // Pin this: Node's fetch decodes only the first zstd frame, which
        // silently truncates large bodies to ~1KB with a 200 status.
        'Accept-Encoding': 'gzip, deflate, br',
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------- per provider ------------------------------ */

const PROBES = {
  async greenhouse(token) {
    const r = await get(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`
    )
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.jobs ?? []
    return { ok: jobs.length > 0, status: r.status, count: jobs.length, sample: jobs[0]?.title }
  },

  async lever(token) {
    const r = await get(`https://api.lever.co/v0/postings/${token}?mode=json`)
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = Array.isArray(d) ? d : []
    return { ok: jobs.length > 0, status: r.status, count: jobs.length, sample: jobs[0]?.text }
  },

  async ashby(token) {
    const r = await get('https://api.ashbyhq.com/posting-api/job-board/' + token, {})
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.jobs ?? []
    return { ok: jobs.length > 0, status: r.status, count: jobs.length, sample: jobs[0]?.title }
  },

  async smartrecruiters(token) {
    const r = await get(
      `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=100`
    )
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.content ?? []
    return { ok: jobs.length > 0, status: r.status, count: d.totalFound ?? jobs.length, sample: jobs[0]?.name }
  },

  async recruitee(token) {
    const r = await get(`https://${token}.recruitee.com/api/offers/`)
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.offers ?? []
    return { ok: jobs.length > 0, status: r.status, count: jobs.length, sample: jobs[0]?.title }
  },

  async workable(token) {
    const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`)
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.jobs ?? []
    return { ok: jobs.length > 0, status: r.status, count: jobs.length, sample: jobs[0]?.title }
  },

  /**
   * Eightfold. Token is "host|domain" -- the API needs the employer's own
   * domain as a parameter, which is not derivable from the host.
   */
  async eightfold(token) {
    const [host, domain] = token.split('|')
    if (!host || !domain) return { ok: false, status: 0, note: 'need host|domain' }
    const r = await get(
      `https://${host}/api/apply/v2/jobs?domain=${encodeURIComponent(domain)}&start=0&num=10`
    )
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.positions ?? d.jobs ?? []
    return { ok: jobs.length > 0, status: r.status, count: d.count ?? jobs.length, sample: jobs[0]?.name ?? jobs[0]?.title }
  },

  /**
   * Workday's CxS endpoint. Needs host + site, so the "token" here is
   * "host|site", e.g. "cba.wd3.myworkdayjobs.com|CommBank_Careers".
   */
  async workday(token) {
    const [host, site] = token.split('|')
    if (!host || !site) return { ok: false, status: 0, note: 'need host|site' }
    const tenant = host.split('.')[0]
    const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`
    const r = await get(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    })
    if (!r.ok) return { ok: false, status: r.status }
    const d = await r.json()
    const jobs = d.jobPostings ?? []
    return { ok: jobs.length > 0, status: r.status, count: d.total ?? jobs.length, sample: jobs[0]?.title }
  },
}

/* ---------------------------------- run ----------------------------------- */

async function pool(items, n, fn) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) out.push(await fn(items[i++]))
    })
  )
  return out
}

const args = process.argv.slice(2)
let candidates = []

if (args[0] === '--file') {
  const { readFileSync } = await import('fs')
  candidates = JSON.parse(readFileSync(args[1], 'utf8'))
} else {
  const provider = args[0]
  candidates = args.slice(1).map((t) => [provider, t])
}

if (!candidates.length) {
  console.error('usage: probe-tokens.mjs <provider> <token...>   |   --file candidates.json')
  process.exit(1)
}

const results = await pool(candidates, CONCURRENCY, async ([provider, token, label]) => {
  const probe = PROBES[provider]
  if (!probe) return { provider, token, label, ok: false, note: 'unknown provider' }
  try {
    const r = await probe(token)
    return { provider, token, label, ...r }
  } catch (e) {
    return { provider, token, label, ok: false, note: e.name === 'AbortError' ? 'timeout' : e.message }
  }
})

results.sort((a, b) => Number(b.ok) - Number(a.ok) || (b.count ?? 0) - (a.count ?? 0))

let live = 0
for (const r of results) {
  const mark = r.ok ? 'LIVE' : '    '
  const detail = r.ok
    ? `${String(r.count).padStart(6)} jobs  ${String(r.sample ?? '').slice(0, 54)}`
    : `${r.status ?? ''} ${r.note ?? ''}`
  console.log(`${mark} ${r.provider.padEnd(15)} ${String(r.token).slice(0, 46).padEnd(48)} ${detail}`)
  if (r.ok) live++
}
console.error(`\n${live}/${results.length} boards answered with live postings`)

if (process.env.OUT) {
  const { writeFileSync } = await import('fs')
  writeFileSync(process.env.OUT, JSON.stringify(results.filter((r) => r.ok), null, 2))
  console.error(`wrote ${process.env.OUT}`)
}
