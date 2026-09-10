/**
 * Probe candidate ATS boards and report which are real and currently hiring.
 *
 * This is the genuineness gate: a company is admitted to the registry only if
 * its own ATS board answers with live postings. That is a far stronger signal
 * than anything harvested from an aggregator page, where ghost listings and
 * duplicates are the dominant quality problem.
 *
 *   node scripts/verify-ats-boards.mjs                 # probe the candidate list
 *   node scripts/verify-ats-boards.mjs --json out.json # write verified boards
 */

const TIMEOUT_MS = 20_000
const CONCURRENCY = 8

const CANDIDATES = [
  // provider, token, companySlug, [site], [host]
  ['greenhouse', 'stripe', 'stripe'],
  ['greenhouse', 'databricks', 'databricks'],
  ['greenhouse', 'airbnb', 'airbnb'],
  ['greenhouse', 'doordash', 'doordash'],
  ['greenhouse', 'robinhood', 'robinhood'],
  ['greenhouse', 'coinbase', 'coinbase'],
  ['greenhouse', 'dropbox', 'dropbox'],
  ['greenhouse', 'reddit', 'reddit'],
  ['greenhouse', 'figma', 'figma'],
  ['greenhouse', 'cloudflare', 'cloudflare'],
  ['greenhouse', 'gitlab', 'gitlab'],
  ['greenhouse', 'discord', 'discord'],
  ['greenhouse', 'instacart', 'instacart'],
  ['greenhouse', 'brex', 'brex'],
  ['greenhouse', 'plaid', 'plaid'],
  ['greenhouse', 'lyft', 'lyft'],
  ['greenhouse', 'pinterest', 'pinterest'],
  ['greenhouse', 'twilio', 'twilio'],
  ['greenhouse', 'asana', 'asana'],
  ['greenhouse', 'benchling', 'benchling'],
  ['greenhouse', 'ramp', 'ramp'],
  ['greenhouse', 'scaleai', 'scale-ai'],
  ['greenhouse', 'anthropic', 'anthropic'],
  ['greenhouse', 'affirm', 'affirm'],
  ['greenhouse', 'flexport', 'flexport'],
  ['greenhouse', 'samsara', 'samsara'],
  ['greenhouse', 'sofi', 'sofi'],
  ['greenhouse', 'wise', 'wise'],
  ['greenhouse', 'monzo', 'monzo'],
  ['greenhouse', 'deliveroo', 'deliveroo'],

  ['ashby', 'openai', 'openai'],
  ['ashby', 'ramp', 'ramp'],
  ['ashby', 'linear', 'linear'],
  ['ashby', 'vercel', 'vercel'],
  ['ashby', 'notion', 'notion'],
  ['ashby', 'replit', 'replit'],
  ['ashby', 'perplexity-ai', 'perplexity'],
  ['ashby', 'cohere', 'cohere'],
  ['ashby', 'deel', 'deel'],
  ['ashby', 'posthog', 'posthog'],
  ['ashby', 'supabase', 'supabase'],
  ['ashby', 'clickhouse', 'clickhouse'],
  ['ashby', 'anduril', 'anduril'],
  ['ashby', 'mistral', 'mistral-ai'],
  ['ashby', 'elevenlabs', 'elevenlabs'],

  ['lever', 'shopify', 'shopify'],
  ['lever', 'netflix', 'netflix'],
  ['lever', 'klarna', 'klarna'],
  ['lever', 'spotify', 'spotify'],
  ['lever', 'palantir', 'palantir'],
  ['lever', 'kraken', 'kraken'],
  ['lever', 'nagarro', 'nagarro'],
  ['lever', 'leverdemo', 'lever-demo'],
  ['lever', 'voleon', 'voleon'],
  ['lever', 'attentive', 'attentive'],

  ['smartrecruiters', 'Visa', 'visa'],
  ['smartrecruiters', 'Ubisoft', 'ubisoft'],
  ['smartrecruiters', 'Bosch', 'bosch'],
  ['smartrecruiters', 'IKEA', 'ikea'],
  ['smartrecruiters', 'Publicis', 'publicis'],
  ['smartrecruiters', 'AvisBudgetGroup', 'avis-budget'],
  ['smartrecruiters', 'Sanofi', 'sanofi'],
  ['smartrecruiters', 'LinkedIn', 'linkedin'],

  ['recruitee', 'recruitee', 'recruitee'],
  ['recruitee', 'catawiki', 'catawiki'],
  ['recruitee', 'framer', 'framer'],
  ['recruitee', 'mollie', 'mollie'],

  ['workday', 'nvidia', 'nvidia', 'External', 'nvidia.wd5.myworkdayjobs.com'],
  ['workday', 'salesforce', 'salesforce', 'External_Career_Site', 'salesforce.wd12.myworkdayjobs.com'],
  ['workday', 'adobe', 'adobe', 'external_experienced', 'adobe.wd5.myworkdayjobs.com'],
]

async function getJson(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'JobSparkAI/1.0 (+https://jobspark.ai; job aggregation)',
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) return { error: `${res.status}` }
    return { data: await res.json() }
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

async function probe([provider, token, slug, site, host]) {
  let r, count = 0
  switch (provider) {
    case 'greenhouse':
      r = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`)
      count = r.data?.jobs?.length ?? 0
      break
    case 'lever':
      r = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`)
      count = Array.isArray(r.data) ? r.data.length : 0
      break
    case 'ashby':
      r = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`)
      count = r.data?.jobs?.length ?? 0
      break
    case 'smartrecruiters':
      r = await getJson(`https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=1`)
      count = Number(r.data?.totalFound ?? 0)
      break
    case 'recruitee':
      r = await getJson(`https://${token}.recruitee.com/api/offers/`)
      count = r.data?.offers?.length ?? 0
      break
    case 'workday':
      r = await getJson(`https://${host}/wday/cxs/${token}/${site}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      })
      count = Number(r.data?.total ?? 0)
      break
  }
  return { provider, token, slug, site, host, count, error: r?.error ?? null }
}

async function main() {
  const results = []
  const queue = [...CANDIDATES]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const c = queue.shift()
        results.push(await probe(c))
      }
    })
  )

  results.sort((a, b) => (a.provider + a.token).localeCompare(b.provider + b.token))
  const live = results.filter((r) => !r.error && r.count > 0)
  const empty = results.filter((r) => !r.error && r.count === 0)
  const failed = results.filter((r) => r.error)

  console.log('\nLIVE (verified real board with open roles)')
  for (const r of live) console.log(`  ${String(r.count).padStart(5)}  ${r.provider}/${r.token}`)
  console.log(`\nREACHABLE BUT NO OPEN ROLES (${empty.length})`)
  for (const r of empty) console.log(`         ${r.provider}/${r.token}`)
  console.log(`\nNOT FOUND / ERROR (${failed.length})`)
  for (const r of failed) console.log(`         ${r.provider}/${r.token}  -> ${r.error}`)

  const totalJobs = live.reduce((s, r) => s + r.count, 0)
  console.log(`\n${live.length}/${results.length} boards verified, ${totalJobs} open roles reachable\n`)

  const jsonFlag = process.argv.indexOf('--json')
  if (jsonFlag !== -1) {
    const out = process.argv[jsonFlag + 1] || 'verified-boards.json'
    const { writeFileSync } = await import('fs')
    writeFileSync(
      out,
      JSON.stringify(
        live.map(({ provider, token, slug, site, host, count }) => ({
          provider, token, companySlug: slug, site, host, openRoles: count,
        })),
        null,
        2
      )
    )
    console.log(`wrote ${out}`)
  }
}

main()
