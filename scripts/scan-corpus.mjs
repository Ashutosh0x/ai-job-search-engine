/**
 * Stream the 1GB jobs-v2.json and pull out jobs matching a title/place regex.
 *
 * The file is a single line, so it can be neither grepped usefully nor
 * JSON.parse'd (it is past V8's 512MB string limit). This walks it with a
 * depth counter that respects strings and escapes, and yields each top-level
 * object inside the "jobs" array.
 *
 *   node scripts/scan-corpus.mjs --title "recruit" --place "argentina" --out hits.json
 */
import { createReadStream, writeFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const FILE = val('file', 'public/data/jobs-v2.json')
const TITLE = new RegExp(val('title', 'recruit|talent acquisition|sourcer|talent partner'), 'i')
const PLACE = new RegExp(val('place', 'argentina|buenos aires'), 'i')
const OUT = val('out', '')

const BACKSLASH = String.fromCharCode(92)
const hits = []
let depth = 0
let inStr = false
let esc = false
let started = false
let buf = ''
let scanned = 0

const stream = createReadStream(FILE, { encoding: 'utf8', highWaterMark: 1 << 22 })

for await (const chunk of stream) {
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i]

    if (!started) {
      // Seek the opening of the jobs array; everything before it is metadata.
      buf += c
      if (buf.length > 4096) buf = buf.slice(-64)
      if (buf.endsWith('"jobs":[')) { started = true; buf = '' }
      continue
    }

    if (depth === 0) {
      if (c === '{') { depth = 1; buf = '{' }
      continue
    }

    buf += c

    if (inStr) {
      if (esc) esc = false
      else if (c === BACKSLASH) esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }

    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) {
        scanned++
        // Cheap pre-filter on the raw text before paying for a parse.
        if (TITLE.test(buf) && PLACE.test(buf)) {
          try {
            const j = JSON.parse(buf)
            const loc = [j.locationDisplay, j.locationRaw, j.city, j.state, j.country].filter(Boolean).join(' | ')
            if (TITLE.test(j.title || '') && PLACE.test(loc)) hits.push(j)
          } catch {}
        }
        buf = ''
      }
    }
  }
}

console.error(`scanned ${scanned} jobs, ${hits.length} matched`)
for (const j of hits) {
  console.log([j.company, j.title, j.locationDisplay || j.locationRaw, j.source, j.applicationUrl].join('\t'))
}
if (OUT) writeFileSync(OUT, JSON.stringify(hits, null, 2))
