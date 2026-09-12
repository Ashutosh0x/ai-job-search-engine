/**
 * Crawl one employer's board and list every open role.
 *
 *   node scripts/crawl-board.mjs --provider greenhouse --token clearstreet \
 *     --out clearstreet-roles.txt
 *
 * Reads the employer's own ATS feed, not an aggregator's copy, so the list is
 * exactly what the company is advertising right now.
 */
import { writeFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const PROVIDER = val('provider', 'greenhouse')
const TOKEN = val('token', '')
const OUT = val('out', `${TOKEN}-roles.txt`)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

if (!TOKEN) { console.error('need --token'); process.exit(1) }

const strip = (html) => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim()

/** Pay ranges are written into the description, not a structured field. */
function salaryOf(text) {
  const m = text.match(/\$[\d,]{4,}(?:\s*(?:-|–|—|to)\s*\$[\d,]{4,})?/g)
  if (!m) return ''
  const big = m.filter((s) => Number(s.replace(/[^\d]/g, '')) >= 40000)
  return big.length ? [...new Set(big)].slice(0, 2).join(' – ') : ''
}

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) throw new Error(`http ${r.status} for ${url}`)
  return r.json()
}

const FETCH = {
  greenhouse: async () => {
    const d = await get(`https://boards-api.greenhouse.io/v1/boards/${TOKEN}/jobs?content=true`)
    return (d.jobs || []).map((j) => {
      const body = strip(j.content)
      return {
        title: j.title,
        location: j.location?.name || (j.offices || []).map((o) => o.location || o.name).join(' | '),
        department: (j.departments || []).map((x) => x.name).join(' / '),
        posted: (j.first_published || j.updated_at || '').slice(0, 10),
        updated: (j.updated_at || '').slice(0, 10),
        salary: salaryOf(body),
        url: j.absolute_url,
        id: j.id,
      }
    })
  },
  lever: async () => {
    const d = await get(`https://api.lever.co/v0/postings/${TOKEN}?mode=json`)
    return d.map((j) => ({
      title: j.text,
      location: j.categories?.location || '',
      department: [j.categories?.team, j.categories?.department].filter(Boolean).join(' / '),
      posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
      updated: '',
      salary: salaryOf(strip(j.descriptionPlain || j.description)),
      url: j.hostedUrl,
      id: j.id,
    }))
  },
  workday: async () => {
    // token = tenant, site = career-site path, host = the wdN shard.
    const host = val('host', `${TOKEN}.wd1.myworkdayjobs.com`)
    const site = val('site', '')
    if (!site) throw new Error('workday needs --site (e.g. --site synechroncareers)')
    const out = []
    // Paged rather than fetched whole: Workday serves 20 at a time and clamps
    // the offset at 2,000 without erroring, so a board past that cap returns
    // the same page forever. Stopping on a short page is the reliable end.
    for (let offset = 0; offset < 2000; offset += 20) {
      const r = await fetch(`https://${host}/wday/cxs/${TOKEN}/${site}/jobs`, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      })
      if (!r.ok) throw new Error(`http ${r.status}`)
      const d = await r.json()
      const posts = d.jobPostings || []
      for (const j of posts) {
        out.push({
          title: String(j.title || '').trim(),
          // locationsText is optional and its absence is silent; some tenants
          // put the place only in externalPath.
          location: String(j.locationsText || '').trim() ||
            String(j.externalPath || '').split('/').filter(Boolean)[1]?.replace(/-+/g, ' ') || '',
          department: '',
          posted: String(j.postedOn || '').trim(),
          updated: '',
          salary: '',
          url: `https://${host}/${site}${j.externalPath}`,
          id: (j.bulletFields || [])[0] || '',
        })
      }
      if (posts.length < 20) break
    }
    return out
  },
  ashby: async () => {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${TOKEN}?includeCompensation=true`)
    return (d.jobs || []).map((j) => ({
      title: j.title,
      location: j.location || '',
      department: [j.department, j.team].filter(Boolean).join(' / '),
      posted: (j.publishedAt || '').slice(0, 10),
      updated: (j.updatedAt || '').slice(0, 10),
      salary: j.compensation?.compensationTierSummary || '',
      url: j.jobUrl || j.applyUrl,
      id: j.id,
    }))
  },
}

if (!FETCH[PROVIDER]) { console.error(`no adapter for ${PROVIDER}`); process.exit(1) }

const roles = await FETCH[PROVIDER]()

/* group by department so a 30-role board reads as an org chart, not a list */
const byDept = new Map()
for (const r of roles) {
  const k = r.department || '(no department)'
  if (!byDept.has(k)) byDept.set(k, [])
  byDept.get(k).push(r)
}
const byLoc = new Map()
for (const r of roles) {
  const k = r.location || '(no location)'
  byLoc.set(k, (byLoc.get(k) || 0) + 1)
}

const lines = []
lines.push(`# ${TOKEN} -- all open roles`)
lines.push(`# source: ${PROVIDER} board api (the employer's own feed, not an aggregator)`)
lines.push(`# generated ${new Date().toISOString()}`)
lines.push(`# ${roles.length} open roles across ${byDept.size} departments and ${byLoc.size} locations`)
lines.push('')
lines.push('## BY LOCATION')
for (const [loc, n] of [...byLoc].sort((a, b) => b[1] - a[1])) lines.push(`   ${String(n).padStart(3)}  ${loc}`)
lines.push('')

for (const [dept, list] of [...byDept].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`## ${dept.toUpperCase()}  (${list.length})`)
  lines.push('')
  for (const r of list.sort((a, b) => a.title.localeCompare(b.title))) {
    lines.push(`  ${r.title}`)
    lines.push(`    location : ${r.location}`)
    if (r.salary) lines.push(`    pay      : ${r.salary}`)
    lines.push(`    posted   : ${r.posted}${r.updated && r.updated !== r.posted ? `   updated: ${r.updated}` : ''}`)
    lines.push(`    url      : ${r.url}`)
    lines.push('')
  }
}

writeFileSync(OUT, lines.join('\n'))
writeFileSync(OUT.replace(/\.txt$/, '.json'), JSON.stringify({ token: TOKEN, provider: PROVIDER, count: roles.length, roles }, null, 2))
console.log(`${roles.length} roles -> ${OUT}`)
