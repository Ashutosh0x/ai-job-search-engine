/**
 * Verify harvested boards against their live API, then merge the survivors
 * into the board list the ingest pipeline actually reads.
 *
 *   node scripts/verify-cc-boards.mjs --providers greenhouse,ashby,workable
 *   node scripts/verify-cc-boards.mjs --providers all --concurrency 8
 *
 * WHY THIS IS A SEPARATE STEP FROM HARVESTING
 * ------------------------------------------
 * cc-harvest.mjs reads the Common Crawl URL index, which proves a board URL
 * existed when the crawl ran -- not that the board exists now. Companies churn
 * off ATS platforms, rename tenants and close boards constantly: in the runs
 * behind this script roughly one candidate in six was already dead. Writing
 * crawl-era tokens straight into the registry is how an index ends up serving
 * employers that stopped hiring a year ago.
 *
 * So every candidate is called here, now, and only boards that answer with at
 * least one open role are written out. `openRoles` is recorded so the next
 * reader can see the evidence rather than trust the entry.
 *
 * OUTPUT
 * ------
 * Merged into scripts/discovered-boards.json, which is what ingest-v2.mjs and
 * refresh.mjs read. Existing entries are preserved: this file is the product
 * of several discovery passes and a run that only verified two providers must
 * not delete the rest.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const IN = val('in', 'scripts/cc-boards.json')
const OUT = val('out', 'scripts/discovered-boards.json')
const CONCURRENCY = Number(val('concurrency', 10))
const LIMIT = Number(val('limit', 0))

/** Only providers the pipeline has an adapter for -- see lib/sources/adapters. */
const SUPPORTED = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'recruitee', 'teamtailor', 'workable', 'workday', 'keka']
const PROVIDERS = (val('providers', 'greenhouse,ashby,workable') === 'all'
  ? SUPPORTED
  : val('providers', 'greenhouse,ashby,workable').split(',').map((s) => s.trim())
).filter((p) => {
  if (SUPPORTED.includes(p)) return true
  console.error(`skipping "${p}": no adapter in lib/sources/adapters, so the pipeline cannot ingest it`)
  return false
})

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

async function req(url, opts = {}, tries = 3, timeoutMs = 25000) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) } })
      if (r.status === 404 || r.status === 403 || r.status === 401 || r.status === 410) return null
      if (r.status === 429 || r.status >= 500) throw new Error(`http ${r.status}`)
      if (!r.ok) return null
      const text = await r.text()
      try { return JSON.parse(text) } catch { /* not JSON -- fall through */ }
      /**
       * A JSON API answering with HTML is a refusal wearing a success code.
       *
       * Workday serves "Workday is currently unavailable" as a 31KB HTML page
       * with HTTP 200 and no Retry-After, on the whole shard, when it decides
       * it has had enough requests. Returning that body to the caller made it
       * a truthy non-object, so `if (!n)` passed and every throttled tenant was
       * recorded as LIVE with the entire HTML page stored as its `openRoles`.
       * One run wrote 2,605 such entries and grew this script's output file
       * from 827KB to 274MB, while the progress line printed a role count that
       * was really a megabyte of concatenated markup.
       *
       * Throwing sends it back through the retry/backoff loop and, if the page
       * persists, out as `undefined` -- "unreachable", which is what it is. A
       * board is never added on the strength of a page we could not parse.
       */
      throw new Error('non-JSON body: maintenance or challenge page')
    } catch {
      if (i === tries - 1) return undefined
      await new Promise((res) => setTimeout(res, 1500 * (i + 1) + Math.random() * 1000))
    } finally { clearTimeout(t) }
  }
}

/** Each returns a role count, or null (dead) / undefined (never answered). */
const COUNT = {
  greenhouse: async (b) => {
    const d = await req(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.token)}/jobs`)
    return d && typeof d === 'object' ? (d.jobs || []).length : d
  },
  lever: async (b) => {
    const d = await req(`https://api.lever.co/v0/postings/${encodeURIComponent(b.token)}?mode=json`)
    return Array.isArray(d) ? d.length : d
  },
  ashby: async (b) => {
    const d = await req(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.token)}`, {}, 3, 40000)
    return d && typeof d === 'object' ? (d.jobs || []).length : d
  },
  smartrecruiters: async (b) => {
    const d = await req(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.token)}/postings?limit=1`)
    return d && typeof d === 'object' ? (d.totalFound ?? (d.content || []).length) : d
  },
  recruitee: async (b) => {
    const d = await req(`https://${encodeURIComponent(b.token)}.recruitee.com/api/offers/`)
    return d && typeof d === 'object' ? (d.offers || []).length : d
  },
  teamtailor: async (b) => {
    const d = await req(`https://${encodeURIComponent(b.token)}.teamtailor.com/jobs.json`)
    return d && typeof d === 'object' ? (d.items || []).length : d
  },
  workable: async (b) => {
    const d = await req(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.token)}?details=true`)
    return d && typeof d === 'object' ? (d.jobs || []).length : d
  },
  keka: async (b) => {
    // The portal segment is 'default', not the tenant name -- the tenant name
    // answers 200 with an empty array, which would record every live board as
    // an employer with nothing open. See scripts/test-keka.mjs.
    const host = b.host || `${b.token}.keka.com`
    const portal = b.site || 'default'
    const d = await req(`https://${host}/careers/api/jobs/${encodeURIComponent(portal)}/active`)
    return Array.isArray(d) ? d.length : d
  },
  workday: async (b) => {
    if (!b.host || !b.site) return null
    const d = await req(`https://${b.host}/wday/cxs/${b.token}/${b.site}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
    }, 3, 40000)
    return d && typeof d === 'object' ? (d.total ?? (d.jobPostings || []).length) : d
  },
}

const candidates = JSON.parse(readFileSync(IN, 'utf8')).boards
const verified = []
const stats = {}

for (const provider of PROVIDERS) {
  let list = candidates.filter((b) => b.provider === provider)
  // Most-linked boards first, so a bounded run verifies the boards the web
  // actually points at rather than an arbitrary slice.
  list.sort((a, b) => (b.hits || 0) - (a.hits || 0))
  if (LIMIT) list = list.slice(0, LIMIT)

  let done = 0, live = 0, dead = 0, unreachable = 0, empty = 0, roles = 0
  const queue = [...list]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const b = queue.shift()
      const raw = await COUNT[provider](b)
      done++
      /**
       * A role count is a number or it is not a count.
       *
       * The adapters above return whatever `req` handed them, so a shape this
       * loop did not expect used to fall into the final `else` and be written
       * out as a live board. Anything that is not a finite number is treated as
       * unreachable here -- the second line of defence behind the throw in
       * `req`, and the one that makes "a board was added on evidence we could
       * not read" unrepresentable rather than merely unlikely.
       */
      const n = raw === null ? null
        : (typeof raw === 'number' && Number.isFinite(raw)) ? raw
        : undefined
      if (n === undefined) unreachable++
      else if (n === null) dead++
      else if (!n) empty++
      else { live++; roles += n; verified.push({ ...b, openRoles: n }) }
      if (done % 100 === 0 || done === list.length) {
        process.stdout.write(`  ${provider}: ${done}/${list.length}  ${live} live, ${empty} empty, ${dead} gone, ${unreachable} unreachable, ${roles.toLocaleString()} roles\r`)
      }
    }
  }))
  process.stdout.write('\n')
  stats[provider] = { candidates: list.length, live, empty, dead, unreachable, roles }
}

/* ------------------------------ merge + write ----------------------------- */

// Site case is folded: Workday treats the site path case-insensitively, so
// `AccentureCareers` and `accenturecareers` are ONE board. Keying on the raw
// casing let both into the board list and both were then crawled, duplicating
// 27% of the Workday corpus. Verified against the live API.
const key = (b) => `${b.provider}|${String(b.token).toLowerCase()}|${String(b.site ?? '').toLowerCase()}`
const merged = new Map()
let carried = 0
if (existsSync(OUT)) {
  try {
    for (const b of JSON.parse(readFileSync(OUT, 'utf8')).boards || []) { merged.set(key(b), b); carried++ }
  } catch (e) { console.error(`could not read existing ${OUT}: ${e.message}`) }
}
let added = 0
for (const b of verified) {
  if (!merged.has(key(b))) added++
  merged.set(key(b), b) // fresher openRoles wins
}

const boards = [...merged.values()]
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  verifiedProviders: PROVIDERS,
  stats,
  totalBoards: boards.length,
  totalOpenRoles: boards.reduce((s, b) => s + (b.openRoles || 0), 0),
  boards,
}, null, 2))

console.log('')
for (const [p, s] of Object.entries(stats)) {
  console.log(`${p.padEnd(16)} ${String(s.live).padStart(5)} live of ${String(s.candidates).padStart(5)}  (${s.empty} empty, ${s.dead} gone, ${s.unreachable} unreachable)  ${s.roles.toLocaleString()} roles`)
}
console.log(`\n${carried} boards carried forward, ${added} new -> ${boards.length} in ${OUT}`)
