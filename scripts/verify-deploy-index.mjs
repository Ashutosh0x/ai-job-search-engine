/**
 * Gate a deploy index before it is committed.
 *
 *   node scripts/verify-deploy-index.mjs --file public/data/jobs-deploy.json
 *   node scripts/verify-deploy-index.mjs --file new.json --floor-against old.json
 *
 * WHY THIS EXISTS
 * ---------------
 * The daily publish job rebuilds the bounded index from a full index restored
 * from the Actions cache. A cache miss does not throw — it just leaves a
 * smaller base to build from, and the build succeeds. Without a floor, one
 * missed cache would commit a near-empty index over a 101,496-job one and the
 * site would serve a fraction of the market while looking perfectly healthy.
 * That is the exact failure this repo already documents for silent shard loss.
 *
 * So: a rebuild that is materially smaller than what is already committed is
 * treated as a failed run, not as new data.
 *
 * Also enforces GitHub's hard 100 MiB per-file limit. The index has crossed it
 * before (the reason it is sharded at all). A push that trips it is rejected by
 * the server AFTER the crawl has run, which wastes the run and leaves the
 * branch untouched with no obvious cause.
 */
import { openSync, readSync, closeSync, statSync, existsSync } from 'fs'
import { dirname, join, basename, resolve } from 'path'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const FILE = val('file', 'public/data/jobs-deploy.json')
const FLOOR_AGAINST = val('floor-against', null)
/** How much smaller than the previous index is tolerable before it reads as breakage. */
const MIN_RATIO = Number(val('min-ratio', 0.8))
/** GitHub rejects any blob over 100 MiB. Leave headroom for the push itself. */
const MAX_FILE_MB = Number(val('max-file-mb', 95))

/**
 * Read `jobCount` without parsing the whole file.
 *
 * The index is tens of megabytes and exceeds Node's string cap when shards are
 * combined, but the metadata head is the first few hundred bytes, so a bounded
 * read is enough and costs nothing.
 */
export function readIndexHead(path, bytes = 4096) {
  // Genuinely bounded: open, read `bytes`, close. `readFileSync` would pull the
  // whole 62 MB file into a string first and defeat the point — and combined
  // shards can exceed Node's ~512 MB string cap outright.
  const fd = openSync(path, 'r')
  let text
  try {
    const buf = Buffer.alloc(bytes)
    const read = readSync(fd, buf, 0, bytes, 0)
    text = buf.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }

  const jobCount = /"jobCount"\s*:\s*(\d+)/.exec(text)
  const corpusTotal = /"corpusTotal"\s*:\s*(\d+)/.exec(text)
  const generatedAt = /"generatedAt"\s*:\s*"([^"]+)"/.exec(text)

  // `shards` names the files this index needs to serve its jobCount. It sits
  // in the head alongside the counters, so the same bounded read reaches it.
  // `shardsFound` distinguishes "declares an empty list" from "the field was
  // not in the bytes we read" — treating those the same would let a truncated
  // read look like an unsharded index.
  const shardsMatch = /"shards"\s*:\s*\[([^\]]*)\]/.exec(text)
  const shards = shardsMatch
    ? Array.from(shardsMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
    : []

  return {
    jobCount: jobCount ? Number(jobCount[1]) : null,
    corpusTotal: corpusTotal ? Number(corpusTotal[1]) : null,
    generatedAt: generatedAt ? generatedAt[1] : null,
    shards,
    shardsFound: Boolean(shardsMatch),
  }
}

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exit(1) }
const ok = (msg) => console.log(`ok    ${msg}`)

/**
 * Only gate when run as a command.
 *
 * `readIndexHead` is exported and worth testing directly, but importing this
 * file used to execute the whole gate as a side effect — so a test that merely
 * imported the helper ran the checks against the repo's real index and exited
 * the test process on the first failure.
 */
const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (!invokedDirectly) {
  // Imported for its helpers; the caller runs its own checks.
} else {

if (!existsSync(FILE)) fail(`${FILE} does not exist — nothing was built`)

const head = readIndexHead(FILE)
if (head.jobCount === null) fail(`${FILE} has no jobCount in its head — not a deploy index`)
if (head.jobCount === 0) fail(`${FILE} contains 0 jobs`)
ok(`${FILE}: ${head.jobCount.toLocaleString()} jobs of ${(head.corpusTotal ?? 0).toLocaleString()} corpus (built ${head.generatedAt})`)

// The index NAMES its own shards. Trust that list, not a guessed sequence.
//
// This used to probe `.2.json` … `.10.json` and keep whichever happened to
// exist. A shard the index declares but that is missing from disk therefore
// passed silently: the local checkout had `shards: ["jobs-deploy.2.json",
// "jobs-deploy.3.json"]` and `jobCount: 130,863`, but only 51,920 jobs were
// loadable because shard 3 was absent — and the gate reported "2 shard(s)"
// and accepted it. An index that cannot serve the jobs it claims is exactly
// what this script exists to stop.
const shardDir = dirname(FILE)
const declaredPaths = head.shards.map((s) => join(shardDir, String(s)))

for (const shardPath of declaredPaths) {
  if (!existsSync(shardPath)) {
    fail(`${basename(FILE)} declares shard "${basename(shardPath)}" but it is missing from disk. ` +
         `The index claims ${head.jobCount.toLocaleString()} jobs it cannot serve.`)
  }
}

// A shard on disk the index does NOT declare is an orphan from an older build.
// Only checked when we actually read a `shards` field: without that, every
// shard would look stray and the gate would reject a healthy index.
if (head.shardsFound) {
  // Compare RESOLVED paths. `join()` yields "public\data\x.json" on Windows
  // while the probe below builds "public/data/x.json", so a raw string
  // comparison reports every declared shard as a stray on Windows only.
  const declaredResolved = new Set(declaredPaths.map((p) => resolve(p)))
  const strays = Array.from({ length: 9 }, (_, i) => FILE.replace(/\.json$/, `.${i + 2}.json`))
    .filter((p) => existsSync(p) && !declaredResolved.has(resolve(p)))
  for (const stray of strays) {
    fail(`${basename(stray)} is on disk but ${basename(FILE)} does not declare it in "shards" — ` +
         `a stale orphan from an earlier build, or the index is under-reporting itself.`)
  }
}

// Every shard counts against the per-file limit independently.
const shards = [FILE, ...declaredPaths].filter((p) => existsSync(p))

let totalMb = 0
for (const shard of shards) {
  const mb = statSync(shard).size / (1024 * 1024)
  totalMb += mb
  if (mb > MAX_FILE_MB) {
    fail(`${shard} is ${mb.toFixed(1)} MB — over the ${MAX_FILE_MB} MB ceiling. ` +
         `GitHub rejects blobs above 100 MiB; lower --budget-mb or add a shard.`)
  }
  ok(`${shard}: ${mb.toFixed(1)} MB`)
}
ok(`${shards.length} shard(s), ${totalMb.toFixed(1)} MB total`)

if (FLOOR_AGAINST) {
  if (!existsSync(FLOOR_AGAINST)) {
    ok(`no baseline at ${FLOOR_AGAINST} — first publish, floor check skipped`)
  } else {
    const prev = readIndexHead(FLOOR_AGAINST)
    if (prev.jobCount === null) {
      ok(`baseline has no jobCount — floor check skipped`)
    } else {
      const ratio = head.jobCount / prev.jobCount
      const line = `${head.jobCount.toLocaleString()} vs previous ${prev.jobCount.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`
      if (ratio < MIN_RATIO) {
        fail(`index shrank to ${line} — below the ${(MIN_RATIO * 100).toFixed(0)}% floor. ` +
             `This is what a cache miss looks like; refusing to publish a partial index over a good one.`)
      }
      ok(`size floor: ${line}`)
    }
  }
}

console.log('\ndeploy index accepted')

}
