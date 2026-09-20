/**
 * Extract every distinct ATS board token from the Common Crawl index on disk.
 *
 *   npx tsx scripts/extract-board-universe.mjs
 *   npx tsx scripts/extract-board-universe.mjs --out data/board-universe.json
 *
 * This is what "crawl the whole web for jobs" actually means in practice.
 * Nobody crawls the web to find employers — Common Crawl already did, and
 * .cc/ holds its URL index for ten ATS providers across three 2026 snapshots
 * (~700k URLs). Reading that index locally finds every company whose board was
 * publicly linked anywhere on the web, at no cost to the providers.
 *
 * WHAT THIS DOES AND DOES NOT ESTABLISH
 * -------------------------------------
 * A token in the index proves a board URL EXISTED when that snapshot ran. It
 * does not prove the company still uses that ATS, that the tenant still
 * resolves, or that anything is posted today. Companies churn off platforms
 * and rename tenants constantly.
 *
 * So this script only produces CANDIDATES. scripts/discover-boards.mjs is what
 * calls each provider's live API and admits only boards that answer with real
 * postings. Skipping that step is exactly how aggregators come to list dead
 * companies and ghost jobs.
 */

import { createReadStream, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { createInterface } from 'readline'
import { dirname, join } from 'path'
import { parseRegistry } from './lib/parse-registry.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const CC_DIR = val('dir', '.cc')
const OUT = val('out', 'data/board-universe.json')

/**
 * How to read a company token out of a board URL, per provider.
 *
 * Each pattern is anchored on the provider's own host so a URL that merely
 * mentions another provider cannot be misattributed.
 */
const PROVIDERS = [
  { id: 'greenhouse',     re: /(?:job-)?boards\.greenhouse\.io\/([^/?#]+)/i },
  { id: 'lever',          re: /jobs\.lever\.co\/([^/?#]+)/i },
  { id: 'ashby',          re: /jobs\.ashbyhq\.com\/([^/?#]+)/i },
  { id: 'workable',       re: /apply\.workable\.com\/([^/?#]+)/i },
  { id: 'smartrecruiters',re: /jobs\.smartrecruiters\.com\/([^/?#]+)/i },
  { id: 'recruitee',      re: /([a-z0-9-]+)\.recruitee\.com/i },
  { id: 'teamtailor',     re: /([a-z0-9-]+)\.teamtailor\.com/i },
  { id: 'breezy',         re: /([a-z0-9-]+)\.breezy\.hr/i },
  { id: 'workday',        re: /([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com/i },
  { id: 'keka',           re: /([a-z0-9-]+)\.keka\.com/i },
  { id: 'darwinbox',      re: /([a-z0-9-]+)\.darwinbox\.(?:com|in)/i },
  { id: 'zohorecruit',    re: /([a-z0-9-]+)\.zohorecruit\.com/i },
  { id: 'peoplestrong',   re: /([a-z0-9-]+)\.peoplestrong\.com/i },
  { id: 'pinpoint',       re: /([a-z0-9-]+)\.pinpointhq\.com/i },
  { id: 'jobtrain',       re: /([a-z0-9-]+)\.jobtrain\.co\.uk/i },
]

/**
 * Path segments that are the ATS's own pages, not a company tenant.
 * Without this, "embed", "api" and "search" become phantom employers.
 */
const NOT_A_TENANT = new Set([
  'embed', 'api', 'apis', 'search', 'jobs', 'job', 'careers', 'static',
  'assets', 'images', 'img', 'css', 'js', 'favicon.ico', 'robots.txt',
  'sitemap.xml', 'www', 'app', 'login', 'signup', 'about', 'blog', 'help',
  'privacy', 'terms', 'widget', 'account', 'accounts', 'boards', 'index.html',
])

const byProvider = new Map(PROVIDERS.map((p) => [p.id, new Set()]))

const files = readdirSync(CC_DIR).filter((f) => f.endsWith('.jsonl'))
if (files.length === 0) {
  console.error(`No .jsonl index files in ${CC_DIR}/`)
  process.exit(1)
}

console.log(`Reading ${files.length} Common Crawl index files from ${CC_DIR}/ …\n`)

let lines = 0
for (const file of files) {
  const stream = createInterface({
    input: createReadStream(join(CC_DIR, file)),
    crlfDelay: Infinity,
  })

  for await (const line of stream) {
    lines++
    if (!line) continue

    let url
    try {
      url = JSON.parse(line).url
    } catch {
      continue // a truncated or malformed index line
    }
    if (!url) continue

    for (const { id, re } of PROVIDERS) {
      const m = url.match(re)
      if (!m) continue

      const token = m[1].toLowerCase().trim()
      if (!token || token.length < 2 || token.length > 64) break
      if (NOT_A_TENANT.has(token)) break
      // A token with a dot is a filename or a deeper host, not a tenant.
      if (token.includes('.') && !token.endsWith('-inc')) break

      byProvider.get(id).add(token)
      break
    }
  }
  process.stdout.write(`  ${file.padEnd(48)} ${lines.toLocaleString('en-US')} lines read\r`)
}

console.log(`\n\nRead ${lines.toLocaleString('en-US')} index lines.\n`)

/* ---------- Compare against what is already registered ---------- */

const { companies } = parseRegistry()
const registrySrc = (await import('fs')).readFileSync('lib/companies/registry.ts', 'utf8')
const registeredTokens = new Set()
for (const m of registrySrc.matchAll(/provider:\s*'([^']+)'\s*,\s*token:\s*'([^']+)'/g)) {
  registeredTokens.add(`${m[1]}:${m[2].toLowerCase()}`)
}

const universe = {}
let totalCandidates = 0
let totalNew = 0

console.log('provider          candidates      new (not registered)')
console.log('-'.repeat(56))

for (const { id } of PROVIDERS) {
  const tokens = [...byProvider.get(id)].sort()
  if (tokens.length === 0) continue

  const fresh = tokens.filter((t) => !registeredTokens.has(`${id}:${t}`))
  universe[id] = fresh

  totalCandidates += tokens.length
  totalNew += fresh.length

  console.log(
    `${id.padEnd(18)}${String(tokens.length).padStart(10)}${String(fresh.length).padStart(24)}`
  )
}

console.log('-'.repeat(56))
console.log(`${'TOTAL'.padEnd(18)}${String(totalCandidates).padStart(10)}${String(totalNew).padStart(24)}`)
console.log(`\nAlready registered: ${companies.length} companies, ${registeredTokens.size} boards.`)
console.log('These are CANDIDATES. Verify with scripts/discover-boards.mjs before admitting any.')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  extractedAt: new Date().toISOString(),
  source: `${CC_DIR}/ (Common Crawl URL index)`,
  indexLinesRead: lines,
  registeredCompanies: companies.length,
  registeredBoards: registeredTokens.size,
  totalCandidates,
  totalNew,
  caveat: 'A token proves a board URL existed at crawl time. It does not prove the board is live or has postings — verify against the provider API before use.',
  candidates: universe,
}, null, 2))

console.log(`\nWrote ${OUT}`)
