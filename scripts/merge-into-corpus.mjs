/**
 * Append the jobs from a scoped ingest into the main corpus.
 *
 *   node scripts/merge-into-corpus.mjs \
 *     --corpus public/data/jobs-v2.json \
 *     --add    public/data/jobs-v2.ms-ey.json
 *
 * WHY THIS EXISTS
 * ===============
 * `scripts/ingest-v2.mjs --only <slugs>` writes an index containing ONLY the
 * boards it crawled. Pointing its `--out` at the main corpus would therefore
 * replace 495,871 jobs with a couple of thousand -- a total data loss that
 * looks like a successful run. So a scoped ingest writes to its own file and
 * this merges the result in.
 *
 * WHY BYTES AND NOT JSON
 * ======================
 * The corpus is 2.15GB. `JSON.parse` cannot hold it (V8's string cap is far
 * below that) and even a streaming parse would rebuild half a million objects
 * to change nothing about them. The file's shape is known and fixed --
 * `writeJsonStream` emits `{<head>,"jobs":[<rows>]}` -- so the body is copied
 * verbatim and only the head and the tail are rewritten.
 *
 * WHAT IT REFUSES TO DO
 * =====================
 * This APPENDS. It does not de-duplicate against the corpus, because scanning
 * 495k records for id collisions on every merge is the expensive half of a
 * full rebuild. Instead it asserts up front that no job from the additions'
 * companies is already present, and aborts if any is. Use it to add an
 * employer the corpus does not yet carry; use a full `npm run ingest` to
 * refresh one it does.
 */

import { openSync, readSync, writeSync, closeSync, statSync, renameSync, existsSync, unlinkSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const CORPUS = resolve(ROOT, val('corpus', 'public/data/jobs-v2.json'))
const ADD = resolve(ROOT, val('add', ''))
const DRY = has('dry-run')

if (!ADD) { console.error('need --add <file>'); process.exit(1) }
if (!existsSync(CORPUS)) { console.error(`corpus not found: ${CORPUS}`); process.exit(1) }
if (!existsSync(ADD)) { console.error(`additions not found: ${ADD}`); process.exit(1) }

const CHUNK = 64 * 1024 * 1024

/**
 * Locate `"jobs":[` at the top level of the object.
 *
 * Not the first textual occurrence: the head embeds an ingest report, and a
 * nested key could match. Depth is tracked so only the array that is a direct
 * member of the root object is accepted.
 */
function findJobsArray(fd, size) {
  const probe = Buffer.alloc(Math.min(CHUNK, size))
  const n = readSync(fd, probe, 0, probe.length, 0)
  const text = probe.toString('utf8', 0, n)

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\') { escaped = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{' || c === '[') {
      // A `[` opening at depth 1 right after the key "jobs" is the array.
      // `"jobs":` is SEVEN characters; the byte before it is the comma that
      // separates it from the last head entry, and headEnd points at that
      // comma so the head slice stops cleanly before it.
      if (c === '[' && depth === 1 && text.slice(Math.max(0, i - 7), i) === '"jobs":') {
        return { headEnd: i - 8, arrayStart: i + 1 }
      }
      depth++
      continue
    }
    if (c === '}' || c === ']') { depth--; continue }
  }
  return null
}

/* ------------------------------- read heads ------------------------------- */

const corpusSize = statSync(CORPUS).size
const fdCorpus = openSync(CORPUS, 'r')
const located = findJobsArray(fdCorpus, corpusSize)
if (!located) { closeSync(fdCorpus); console.error('could not find the top-level "jobs" array in the corpus'); process.exit(1) }

// The head, as an object: everything before `,"jobs":[`, closed off.
const headBuf = Buffer.alloc(located.headEnd)
readSync(fdCorpus, headBuf, 0, located.headEnd, 0)
let headText = headBuf.toString('utf8')
if (headText.endsWith(',')) headText = headText.slice(0, -1)
const head = JSON.parse(headText + '}')

// The tail must be exactly `]}` -- anything else means the file is not the
// shape this script is allowed to edit.
const tailBuf = Buffer.alloc(2)
readSync(fdCorpus, tailBuf, 0, 2, corpusSize - 2)
if (tailBuf.toString('utf8') !== ']}') {
  closeSync(fdCorpus)
  console.error(`corpus does not end with "]}" (found ${JSON.stringify(tailBuf.toString('utf8'))}) -- refusing to edit`)
  process.exit(1)
}

/* ---- the additions are small enough to parse normally ---- */
const { readFileSync } = await import('fs')
const addData = JSON.parse(readFileSync(ADD, 'utf8'))
const addJobs = addData.jobs ?? addData.roles ?? []
if (!addJobs.length) { closeSync(fdCorpus); console.error('additions file holds no jobs'); process.exit(1) }

const addSlugs = [...new Set(addJobs.map((j) => j.companySlug).filter(Boolean))]

console.log(`corpus     ${CORPUS.split(/[\\/]/).pop()}  ${(corpusSize / 1e9).toFixed(2)}GB  head.jobCount=${head.jobCount}`)
console.log(`additions  ${ADD.split(/[\\/]/).pop()}  ${addJobs.length} jobs  companies: ${addSlugs.join(', ')}`)

/* --------------------- refuse to create duplicate employers --------------- */
//
// Scanning half a million records for id collisions costs as much as a
// rebuild. Employer presence is the cheap proxy and the stronger guarantee:
// if the corpus already carries ANY job for these companies, appending would
// double them, so stop and let a full ingest handle the refresh.
console.log('scanning the corpus for these employers...')
const counts = Object.fromEntries(addSlugs.map((s) => [s, 0]))
{
  const buf = Buffer.alloc(CHUNK)
  let pos = 0
  let carry = ''
  while (pos < corpusSize) {
    const n = readSync(fdCorpus, buf, 0, Math.min(CHUNK, corpusSize - pos), pos)
    if (n <= 0) break
    pos += n
    const text = carry + buf.toString('utf8', 0, n)
    for (const s of addSlugs) counts[s] += text.split(`"companySlug":"${s}"`).length - 1
    carry = text.slice(-64)
  }
}
for (const [slug, n] of Object.entries(counts)) console.log(`  ${slug.padEnd(12)} already in corpus: ${n}`)

const collisions = Object.entries(counts).filter(([, n]) => n > 0)
if (collisions.length) {
  closeSync(fdCorpus)
  console.error('')
  console.error(`REFUSING TO MERGE: ${collisions.map(([s, n]) => `${s} (${n} jobs)`).join(', ')} already in the corpus.`)
  console.error('Appending would duplicate them. Run a full `npm run ingest` to refresh instead.')
  process.exit(1)
}

if (DRY) { closeSync(fdCorpus); console.log('\ndry run -- nothing written'); process.exit(0) }

/* --------------------------------- merge ---------------------------------- */

const newHead = {
  ...head,
  jobCount: (head.jobCount ?? 0) + addJobs.length,
  mergedAt: new Date().toISOString(),
  // A record of what was grafted on and when, so a corpus that is part full
  // rebuild and part scoped merge can still explain itself.
  merges: [
    ...(head.merges ?? []),
    { at: new Date().toISOString(), source: ADD.split(/[\\/]/).pop(), jobs: addJobs.length, companies: addSlugs },
  ],
}

const TMP = `${CORPUS}.merge-tmp`
if (existsSync(TMP)) unlinkSync(TMP)
const out = openSync(TMP, 'w')

let written = 0
const w = (s) => { const b = Buffer.from(s, 'utf8'); writeSync(out, b); written += b.length }

// head
const headParts = Object.entries(newHead).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
w(`{${headParts.join(',')},"jobs":[`)

// body, copied verbatim between the array bracket and the closing `]}`
{
  const buf = Buffer.alloc(CHUNK)
  let pos = located.arrayStart
  const end = corpusSize - 2
  let lastPct = -1
  while (pos < end) {
    const want = Math.min(CHUNK, end - pos)
    const n = readSync(fdCorpus, buf, 0, want, pos)
    if (n <= 0) break
    writeSync(out, buf, 0, n)
    written += n
    pos += n
    const pct = Math.floor(((pos - located.arrayStart) / (end - located.arrayStart)) * 100)
    if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`  copying body ${pct}%\r`) }
  }
  process.stdout.write('  copying body 100%\n')
}
closeSync(fdCorpus)

// additions
let buffer = ''
for (const job of addJobs) {
  buffer += ',' + JSON.stringify(job)
  if (buffer.length > 4_000_000) { w(buffer); buffer = '' }
}
if (buffer) w(buffer)
w(']}')
closeSync(out)

/* -------------------------------- verify ---------------------------------- */

const tmpSize = statSync(TMP).size
const check = openSync(TMP, 'r')
const vTail = Buffer.alloc(2)
readSync(check, vTail, 0, 2, tmpSize - 2)
const vLoc = findJobsArray(check, tmpSize)
closeSync(check)

if (vTail.toString('utf8') !== ']}' || !vLoc) {
  console.error('merged file failed its shape check -- leaving it at .merge-tmp and NOT replacing the corpus')
  process.exit(1)
}

renameSync(TMP, CORPUS)

console.log('')
console.log(`merged  ${head.jobCount} + ${addJobs.length} = ${newHead.jobCount} jobs`)
console.log(`wrote   ${CORPUS}  ${(tmpSize / 1e9).toFixed(2)}GB`)
console.log('')
console.log('Next: rebuild the served index and verify the new employers are in it:')
console.log('  node --max-old-space-size=12288 scripts/build-deploy-index.mjs')
