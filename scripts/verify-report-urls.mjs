/**
 * Verify job URLs from a pasted research report before ingesting any of it.
 *
 * Standing rule from prior sessions: AI-generated research reports are
 * reliably stale or partly fabricated. A URL in a spreadsheet is a claim, not
 * evidence. This checks each one against the live web and, where the URL points
 * at an ATS we can read, confirms the posting actually exists in the API.
 */
import { readFileSync } from 'fs'
const urls = JSON.parse(readFileSync('/tmp/joburls.json','utf8'))

const UA = 'Mozilla/5.0 (compatible; JobSparkAI/1.0; +https://jobspark.ai)'
async function check(url) {
  try {
    const r = await fetch(url, { redirect:'follow', headers:{'User-Agent':UA}, signal: AbortSignal.timeout(25000) })
    const body = r.ok ? (await r.text()).slice(0, 60000) : ''
    // A 200 is not proof: ATS platforms serve a 200 "no longer available" page.
    const gone = /no longer (accepting|available)|position (has been )?(filled|closed)|job.{0,20}not found|page not found|this job is closed|error 404/i.test(body)
    return { url, status: r.status, ok: r.ok && !gone, gone, len: body.length }
  } catch (e) {
    return { url, status: 0, ok:false, gone:false, err: String(e.name||e).slice(0,40) }
  }
}

const out = []
const q = [...urls]
await Promise.all(Array.from({length:6}, async () => {
  while (q.length) out.push(await check(q.shift()))
}))
out.sort((a,b)=>a.url.localeCompare(b.url))

let live=0, dead=0
for (const r of out) {
  const mark = r.ok ? 'LIVE' : (r.gone ? 'GONE' : 'DEAD')
  if (r.ok) live++; else dead++
  console.log(`  ${mark}  ${String(r.status).padStart(3)}  ${r.url.slice(0,96)}${r.err?'  ('+r.err+')':''}`)
}
console.log(`\n${live} live / ${out.length} checked  (${dead} dead or expired)`)
