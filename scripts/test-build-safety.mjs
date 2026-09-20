/**
 * No module-level service client may exist anywhere in the app.
 *
 *   npx tsx scripts/test-build-safety.mjs
 *
 * `createClient()` throws "supabaseUrl is required" when the env is missing,
 * and a call at module scope runs at IMPORT time. During `next build` that is
 * the "Collecting page data" phase, which has no env vars in CI or on a fresh
 * Vercel project -- so one top-level client fails the ENTIRE build, not one
 * request. It shipped exactly once and broke CI and the production deploy:
 *
 *   Error: supabaseUrl is required.
 *   Failed to collect page data for /api/contacts/bulk-discover
 *
 * The repo already had the right pattern (lib/supabase.ts resolves lazily).
 * This makes the rule enforceable instead of remembered.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const files = [...walk('app'), ...walk('lib'), ...walk('components')]
console.log(`\n🏗️  Scanning ${files.length} source files for build-time client construction:\n`)

/**
 * A `createClient(...)` assigned at column 0 — i.e. not indented inside a
 * function body. Indentation is the signal because every in-function call in
 * this codebase is indented, and a top-level one never is.
 */
const MODULE_LEVEL = /^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*createClient\s*\(/m

const offenders = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('createClient')) continue
  if (MODULE_LEVEL.test(src)) offenders.push(relative(process.cwd(), file).replace(/\\/g, '/'))
}

t('no file constructs a Supabase client at module scope', offenders.length === 0,
  offenders.join(', '))

// lib/supabase.ts is the sanctioned home for lazy accessors.
const supabaseLib = readFileSync('lib/supabase.ts', 'utf8')
t('lib/supabase.ts still exposes a lazy accessor', /export function getSupabaseClient\b/.test(supabaseLib))
t('lib/supabase.ts reports whether it is configured', /export function isSupabaseConfigured\b/.test(supabaseLib))

// The two files that actually broke the build.
for (const route of ['lib/contacts/enricher.ts', 'app/api/linkedin-insight/route.ts']) {
  const src = readFileSync(route, 'utf8')
  t(`${route} resolves its client inside a function`,
    /function getServiceClient\s*\(/.test(src) && !MODULE_LEVEL.test(src))
  t(`${route} returns null rather than throwing when unconfigured`, /return null/.test(src))
}

// A route that needs storage must fail closed and say so. Returning an empty
// list would read as "this user has saved nothing", which is a different claim.
const insight = readFileSync('app/api/linkedin-insight/route.ts', 'utf8')
t('the insight GET answers 503 when storage is unconfigured', /status:\s*503/.test(insight))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
