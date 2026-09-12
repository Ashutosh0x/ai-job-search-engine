/**
 * Harvest every ATS board token the open web index knows about.
 *
 *   node scripts/cc-harvest.mjs                    # latest crawl
 *   node scripts/cc-harvest.mjs --crawls 3         # last 3 monthly crawls
 *
 * WHY NOT GOOGLE DORKS
 * --------------------
 * Same reasoning as lib/discovery/common-crawl.ts: Google returns a ranked
 * sample of ten and forbids automated querying; Common Crawl returns the set
 * and is published for exactly this. The difference from the existing
 * discover-boards.mjs is scope -- that script was run bounded (`--pages 3
 * --top 150`), which is why the repo knows 340 Workday tenants while the
 * August 2026 index alone carries 1,332. This pulls every index page for
 * every provider pattern and does no truncation.
 *
 * Output is candidates, not verified boards: a URL in a crawl proves a board
 * existed when the crawl ran. hunt-role.mjs calls each board's live API and
 * reports which ones actually answered.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const CRAWLS = Number(val('crawls', 1))
const OUT = val('out', 'scripts/cc-boards.json')
const CACHE = '.cc'
const UA = 'JobSparkAI/1.0 (+https://jobspark.ai; board discovery)'

if (!existsSync(CACHE)) mkdirSync(CACHE)

/** URL shapes that identify each ATS, and how to pull the board id out. */
const PATTERNS = [
  {
    provider: 'workday',
    // Host-only. The wildcard-host-plus-path form makes the index scan every
    // path under every subdomain and it answers 502; the tenant is in the
    // hostname anyway.
    url: '*.myworkdayjobs.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/i)
      if (!m) return null
      const site = m[3]
      if (/^(robots\.txt|sitemap|favicon|assets|static|wday|index)/i.test(site)) return null
      return { token: m[1].toLowerCase(), site, host: `${m[1].toLowerCase()}.${m[2].toLowerCase()}.myworkdayjobs.com` }
    },
  },
  {
    provider: 'greenhouse',
    url: 'boards.greenhouse.io/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(embed|api|assets|favicon|robots\.txt|blog)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'greenhouse',
    url: 'job-boards.greenhouse.io/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/job-boards\.greenhouse\.io\/([a-z0-9_-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(embed|api|assets|favicon|robots\.txt)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'lever',
    url: 'jobs.lever.co/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/jobs\.lever\.co\/([a-z0-9_.-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(favicon\.ico|robots\.txt)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'ashby',
    url: 'jobs.ashbyhq.com/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(api|assets|favicon\.ico|robots\.txt|_next)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'smartrecruiters',
    url: 'jobs.smartrecruiters.com/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/jobs\.smartrecruiters\.com\/([A-Za-z0-9_.-]+)/)
      if (!m) return null
      const token = m[1]
      if (/^(oneclick-ui|api|assets|favicon\.ico|robots\.txt|sitemap)/i.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'recruitee',
    url: '*.recruitee.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9-]+)\.recruitee\.com/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(www|app|api|jobs|help|status|blog)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'workable',
    url: 'apply.workable.com/*',
    extract: (u) => {
      const m = u.match(/^https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(api|assets|favicon\.ico|robots\.txt|j)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'teamtailor',
    url: '*.teamtailor.com',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9-]+)\.teamtailor\.com/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(www|app|api|assets|cdn|status|blog|support)$/.test(token)) return null
      return { token }
    },
  },
  {
    provider: 'breezy',
    url: '*.breezy.hr',
    extract: (u) => {
      const m = u.match(/^https?:\/\/([a-z0-9-]+)\.breezy\.hr/i)
      if (!m) return null
      const token = m[1].toLowerCase()
      if (/^(www|app|api|assets|cdn|blog|support)$/.test(token)) return null
      return { token }
    },
  },
]

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 300000)
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal })
      if (r.status === 404) return ''            // no captures for this pattern
      if (!r.ok) throw new Error(`http ${r.status}`)
      return await r.text()
    } catch (e) {
      if (i === tries - 1) { console.error(`    ! ${e.message}`); return null }
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)))
    } finally { clearTimeout(t) }
  }
}

const collinfo = await get('https://index.commoncrawl.org/collinfo.json')
const crawls = JSON.parse(collinfo).slice(0, CRAWLS).map((c) => c.id)
console.log(`crawls: ${crawls.join(', ')}\n`)

/** provider -> token -> record */
const boards = new Map()
const stats = []

for (const crawl of crawls) {
  for (const p of PATTERNS) {
    const key = `${crawl}__${p.url.replace(/[^a-z0-9]/gi, '_')}`
    const cacheFile = `${CACHE}/${key}.jsonl`
    let text

    if (existsSync(cacheFile)) {
      text = readFileSync(cacheFile, 'utf8')
      console.log(`${crawl} ${p.url} (cached)`)
    } else {
      const base = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(p.url)}&output=json`
      const meta = await get(`${base}&showNumPages=true`)
      if (!meta) { console.log(`${crawl} ${p.url} -> index unavailable`); continue }
      let pages = 1
      try { pages = JSON.parse(meta).pages ?? 1 } catch { pages = 1 }
      console.log(`${crawl} ${p.url} -> ${pages} page(s)`)
      const parts = []
      for (let i = 0; i < pages; i++) {
        const body = await get(`${base}&page=${i}`)
        if (body) parts.push(body)
        process.stdout.write(`  page ${i + 1}/${pages}\r`)
      }
      text = parts.join('\n')
      writeFileSync(cacheFile, text)
    }

    let rows = 0
    let found = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      rows++
      let url
      try { url = JSON.parse(line).url } catch { continue }
      if (!url) continue
      const e = p.extract(url)
      if (!e) continue
      if (!boards.has(p.provider)) boards.set(p.provider, new Map())
      const bucket = boards.get(p.provider)
      const id = p.provider === 'workday' ? `${e.host}|${e.site}` : e.token
      const prev = bucket.get(id)
      if (prev) prev.hits++
      else { bucket.set(id, { provider: p.provider, ...e, hits: 1 }); found++ }
    }
    stats.push({ crawl, pattern: p.url, rows, newBoards: found })
    console.log(`  ${rows} urls -> ${found} new ${p.provider} boards`)
  }
}

const out = { generatedAt: new Date().toISOString(), crawls, stats, boards: [] }
for (const [provider, bucket] of boards) {
  for (const b of bucket.values()) out.boards.push(b)
  console.log(`${provider.padEnd(16)} ${bucket.size}`)
}
out.boardCount = out.boards.length
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\n${out.boards.length} candidate boards -> ${OUT}`)
