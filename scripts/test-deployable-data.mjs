/**
 * Every data file a route reads at runtime must actually ship.
 *
 *   npx tsx scripts/test-deployable-data.mjs
 *
 * This Vercel project auto-deploys from GitHub, so a git-triggered build sees
 * only what is in the repository. A route that reads `public/data/x.json`
 * while `.gitignore` excludes it deploys perfectly and then fails at request
 * time -- the page renders, the API 503s, and nothing in the build log hints
 * at it.
 *
 * It has now happened twice:
 *
 *   jobs-deploy.json          search answered "Job index is not available"
 *   recruiter-directory.json  /recruiters rendered; /api/recruiters answered
 *                             503 "The recruiter directory has not been built
 *                             yet" -- the page shipped and its data did not
 *
 * The .gitignore comment documents the first at length. This turns that
 * documentation into a check, by reading the route source rather than a
 * hand-maintained list: any `public/data/...` path a route mentions must be
 * committable.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { execFileSync } from 'child_process'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** True when git would exclude this path. */
function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { stdio: 'ignore' })
    return true
  } catch {
    return false   // non-zero exit means "not ignored"
  }
}

// Only server code can read from disk; a client component importing a path
// string is not a runtime read.
const sources = [...walk('app'), ...walk('lib')]

// Matches a literal public/data/<file>.json in source, however it is joined.
const DATA_REF = /['"`]([\w./-]*public[/\\]data[/\\][\w.-]+\.json)['"`]|['"`]public['"`]\s*,\s*['"`]data['"`]\s*,\s*['"`]([\w.-]+\.json)['"`]/g

const referenced = new Map()
for (const file of sources) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(DATA_REF)) {
    // `??` only falls through on null/undefined, and an unmatched group split
    // to a basename yields "" -- which is falsy but not nullish, so the
    // fallback never fired and every path.join() form was skipped silently.
    const name = m[1] ? m[1].split(/[/\\]/).pop() : m[2]
    if (!name) continue
    const path = `public/data/${name}`
    if (!referenced.has(path)) referenced.set(path, [])
    referenced.get(path).push(relative(process.cwd(), file).replace(/\\/g, '/'))
  }
}

console.log(`\n📦 ${referenced.size} data file(s) referenced by server code:\n`)

for (const [path, readers] of [...referenced].sort()) {
  const where = readers[0] + (readers.length > 1 ? ` +${readers.length - 1}` : '')

  if (!existsSync(path)) {
    // Not on this machine is not automatically wrong -- it may be produced by
    // a workflow -- but it cannot be verified either, so say so plainly.
    console.log(`  SKIP  ${path} is not on disk here (read by ${where})`)
    continue
  }

  t(`${path} is committable (read by ${where})`, !isIgnored(path),
    'excluded by .gitignore, so a git-triggered deploy ships the route without its data')
}

// The two known cases, asserted by name so a future .gitignore edit that drops
// a negation fails here rather than in production.
for (const path of ['public/data/jobs-deploy.json', 'public/data/recruiter-directory.json']) {
  if (existsSync(path)) {
    t(`${path} is explicitly un-ignored`, !isIgnored(path))
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
