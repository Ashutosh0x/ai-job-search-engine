/**
 * Find Japanese employers on the ATS platforms this codebase already crawls.
 *
 *   node scripts/probe-japan-boards.mjs
 *
 * WHY THIS AND NOT AN AGGREGATOR
 * ------------------------------
 * Japan coverage is thin (2,393 of 130,863 postings) and the obvious shortcut is
 * to scrape a job board. That breaks the one promise this product makes -- every
 * listing links to the employer's own application page -- and republishes
 * someone else's database. So instead: find the employers' OWN boards.
 *
 * Most Japanese companies use domestic ATS platforms, but a large minority of
 * the globally-minded ones are on Greenhouse, Lever, Workable or Ashby, which
 * are already supported. Mercari, for instance, is on Workable. Those are free
 * wins that need no new adapter.
 *
 * Reports only. Nothing enters the registry until an endpoint has returned live
 * postings, and the count is printed so a human can sanity-check it.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const TIMEOUT = 15_000

/** Employers worth trying, with the tokens they plausibly use. */
const CANDIDATES = [
  { name: 'Mercari', domain: 'mercari.com', tokens: ['mercari'] },
  { name: 'PayPay', domain: 'paypay.ne.jp', tokens: ['paypay'] },
  { name: 'Tanium', domain: 'tanium.com', tokens: ['tanium'] },
  { name: 'Autify', domain: 'autify.com', tokens: ['Autify', 'autify'] },
  { name: 'SmartNews', domain: 'smartnews.com', tokens: ['smartnews'] },
  { name: 'Woven by Toyota', domain: 'woven.toyota', tokens: ['woven', 'wovenplanet', 'woventoyota'] },
  { name: 'Rakuten', domain: 'rakuten.com', tokens: ['rakuten'] },
  { name: 'LINE Yahoo', domain: 'lycorp.co.jp', tokens: ['lycorp', 'lineyahoo', 'linecorp'] },
  { name: 'Money Forward', domain: 'moneyforward.com', tokens: ['moneyforward'] },
  { name: 'freee', domain: 'freee.co.jp', tokens: ['freee'] },
  { name: 'Sansan', domain: 'sansan.com', tokens: ['sansan'] },
  { name: 'Preferred Networks', domain: 'preferred.jp', tokens: ['preferrednetworks', 'preferred'] },
  { name: 'Ubie', domain: 'ubie.life', tokens: ['ubie'] },
  { name: 'Kyash', domain: 'kyash.co', tokens: ['kyash'] },
  { name: 'Timee', domain: 'timee.co.jp', tokens: ['timee'] },
  { name: 'SODA', domain: 'soda-inc.jp', tokens: ['soda', 'sodainc'] },
  { name: 'Cybozu', domain: 'cybozu.co.jp', tokens: ['cybozu'] },
  { name: 'Treasure Data', domain: 'treasuredata.com', tokens: ['treasuredata'] },
  { name: 'Indeed Japan', domain: 'indeed.com', tokens: ['indeed'] },
  { name: 'Fastly Japan', domain: 'fastly.com', tokens: ['fastly'] },
  { name: 'Datadog Japan', domain: 'datadoghq.com', tokens: ['datadog'] },
  { name: 'Elastic Japan', domain: 'elastic.co', tokens: ['elastic'] },
  { name: 'HashiCorp Japan', domain: 'hashicorp.com', tokens: ['hashicorp'] },
  { name: 'MongoDB Japan', domain: 'mongodb.com', tokens: ['mongodb'] },
  { name: 'Snowflake Japan', domain: 'snowflake.com', tokens: ['snowflakecomputing', 'snowflake'] },
  { name: 'Cloudflare Japan', domain: 'cloudflare.com', tokens: ['cloudflare'] },
  { name: 'Stripe Japan', domain: 'stripe.com', tokens: ['stripe'] },
  { name: 'Canva Japan', domain: 'canva.com', tokens: ['canva'] },
  { name: 'Wise Japan', domain: 'wise.com', tokens: ['wise', 'transferwise'] },
  { name: 'Agoda Japan', domain: 'agoda.com', tokens: ['agoda'] },
]

async function get(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctl.signal,
    })
    const text = await r.text()
    return { ok: r.ok, status: r.status, text }
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.cause?.code ?? e.message }
  } finally {
    clearTimeout(t)
  }
}

/**
 * One probe per provider. Each returns the live job count, or null.
 *
 * The count is the verification: a 200 from a board that holds zero postings is
 * an endpoint that exists, not an employer that is hiring, and admitting it to
 * the registry would add a company page with nothing on it.
 */
const PROVIDERS = {
  async greenhouse(token) {
    const r = await get(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`)
    if (!r.ok) return null
    try {
      const j = JSON.parse(r.text)
      return Array.isArray(j.jobs) ? j.jobs.length : null
    } catch {
      return null
    }
  },
  async lever(token) {
    const r = await get(`https://api.lever.co/v0/postings/${token}?mode=json`)
    if (!r.ok) return null
    try {
      const j = JSON.parse(r.text)
      return Array.isArray(j) ? j.length : null
    } catch {
      return null
    }
  },
  async ashby(token) {
    const r = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
    if (!r.ok) return null
    try {
      const j = JSON.parse(r.text)
      return Array.isArray(j.jobs) ? j.jobs.length : null
    } catch {
      return null
    }
  },
  async workable(token) {
    const r = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}`)
    if (!r.ok) return null
    try {
      const j = JSON.parse(r.text)
      return Array.isArray(j.jobs) ? j.jobs.length : null
    } catch {
      return null
    }
  },
  async recruitee(token) {
    const r = await get(`https://${token}.recruitee.com/api/offers/`)
    if (!r.ok) return null
    try {
      const j = JSON.parse(r.text)
      return Array.isArray(j.offers) ? j.offers.length : null
    } catch {
      return null
    }
  },
}

const found = []
const missed = []

for (const c of CANDIDATES) {
  let hit = null
  outer: for (const token of c.tokens) {
    for (const [provider, probe] of Object.entries(PROVIDERS)) {
      const count = await probe(token)
      if (count !== null && count > 0) {
        hit = { provider, token, count }
        break outer
      }
    }
  }
  if (hit) {
    found.push({ ...c, ...hit })
    console.log(`  OK  ${c.name.padEnd(22)} ${hit.provider.padEnd(12)} ${String(hit.count).padStart(5)} jobs  ${hit.token}`)
  } else {
    missed.push(c)
    console.log(`  --  ${c.name.padEnd(22)} no supported board found`)
  }
}

console.log(`\n${found.length}/${CANDIDATES.length} on an already-supported ATS`)

if (found.length) {
  console.log('\n--- registry entries ---')
  for (const f of found) {
    const slug = f.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    console.log(
      `  // ${f.name}: ${f.count} jobs, verified ${new Date().toISOString().slice(0, 10)}\n` +
        `  { slug: '${slug}', name: '${f.name}', domain: '${f.domain}', valuationKind: 'unknown',\n` +
        `    boards: [{ provider: '${f.provider}', token: '${f.token}' }] },`,
    )
  }
}

if (missed.length) {
  console.log('\n--- not on a supported ATS (likely a domestic Japanese platform) ---')
  for (const m of missed) console.log(`  ${m.name}`)
}
