/**
 * Batch-discover email patterns for all companies in the registry.
 *
 *   node scripts/discover-patterns.mjs
 *   node scripts/discover-patterns.mjs --concurrency 3 --only google.com,meta.com
 *
 * Seeds the `email_patterns` table in Supabase by mining GitHub commits
 * and careers pages for every company in lib/companies/registry.ts.
 * Run once to populate, then use refresh-patterns.mjs on a monthly cron.
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { parseRegistry } from './lib/parse-registry.mjs'
import { discoverPatterns } from '../lib/contacts/email-patterns.ts'

config({ path: '.env.local' })

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const CONCURRENCY = Number(val('concurrency', '3'))
const ONLY = val('only', '')
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const UA = 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0)'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ---------- Parse company registry ---------- */

const registryPath = 'lib/companies/registry.ts'
let registrySrc
try { registrySrc = readFileSync(registryPath, 'utf8') } catch {
  console.error(`Cannot read ${registryPath}. Run from project root.`)
  process.exit(1)
}

// Shared parser. The regex that used to live here required a single-quoted
// name and so skipped 114 of the registry's 387 companies without saying so.
const { companies } = parseRegistry(registryPath)

const targets = ONLY
  ? companies.filter(c => ONLY.split(',').map(s => s.trim()).includes(c.domain))
  : companies

console.log(`Discovering email patterns for ${targets.length} companies (concurrency: ${CONCURRENCY})...\n`)

/* ---------- Discovery (shared, corrected modules) ---------- */

// Pattern inference and GitHub mining both live in lib/contacts now. This
// script used to carry its own copies, which meant it kept the two bugs those
// modules have since had fixed:
//
//   * the query was `author-email:@<domain>`, which GitHub answers with
//     total_count 0 for every domain -- the qualifier matches a COMPLETE
//     address, never a suffix, and qualifier-only commit searches are
//     rejected outright. The source contributed nothing, silently.
//   * when mining found nothing it wrote `{first}.{last}` at 0.3 confidence
//     into email_patterns, indistinguishable downstream from a pattern with
//     real evidence behind it.
//
// Both are gone. `discoverPatterns` returns [] when nothing is observed.

/* ---------- Careers page email scraping ---------- */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const ROLE_LOCAL = /^(careers?|recruit|hiring|talent|hr|jobs?|people|campus|applications?)/i

async function scrapeCareers(domain) {
  const paths = ['/careers', '/jobs', '/contact', '/about/team']
  const found = []
  for (const path of paths) {
    try {
      const r = await fetch(`https://${domain}${path}`, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) continue
      const html = await r.text()
      for (const m of html.matchAll(EMAIL_RE)) {
        const addr = m[0].toLowerCase()
        if (addr.endsWith(`@${domain}`) && ROLE_LOCAL.test(addr.split('@')[0])) {
          found.push(addr)
        }
      }
    } catch { /* skip */ }
  }
  return [...new Set(found)]
}

/* ---------- Process one company ---------- */

async function processCompany(company) {
  const { domain, name, slug } = company
  const t0 = Date.now()

  // Check if patterns already exist
  const { data: existing } = await supabase
    .from('email_patterns')
    .select('id')
    .eq('domain', domain)
    .limit(1)

  if (existing?.length) {
    return { domain, status: 'cached', ms: Date.now() - t0 }
  }

  // Mine patterns via the shared module (verified GitHub org -> commit authors).
  const discovered = await discoverPatterns(domain)

  // Scrape careers pages
  const careersEmails = await scrapeCareers(domain)

  // Build patterns to insert
  const patterns = discovered.map((p) => ({
    domain,
    pattern: p.pattern,
    confidence: p.confidence,
    sample_size: p.sampleSize,
    sample_emails: p.sampleEmails,
    sources: p.sources,
  }))

  // No fabricated fallback. A company with no observed pattern gets no row,
  // so an absent pattern reads as absent rather than as a low-confidence one.
  if (patterns.length === 0) {
    return { domain, status: 'no-evidence', ms: Date.now() - t0 }
  }

  // Upsert to Supabase
  const { error } = await supabase
    .from('email_patterns')
    .upsert(patterns, { onConflict: 'domain,pattern' })

  if (error) {
    return { domain, status: 'error', error: error.message, ms: Date.now() - t0 }
  }

  return {
    domain,
    status: 'discovered',
    patterns: patterns.length,
    githubEmails: discovered.reduce((a, p) => a + p.sampleSize, 0),
    careersEmails: careersEmails.length,
    ms: Date.now() - t0,
  }
}

/* ---------- Run with concurrency ---------- */

async function run() {
  let done = 0
  const results = []

  async function worker(queue) {
    while (queue.length > 0) {
      const company = queue.shift()
      const result = await processCompany(company)
      done++
      const pct = ((done / targets.length) * 100).toFixed(0)
      console.log(`[${pct}%] ${result.domain}: ${result.status} (${result.ms}ms)${result.patterns ? ` — ${result.patterns} patterns, ${result.githubEmails} GH emails` : ''}`)
      results.push(result)
    }
  }

  const queue = [...targets]
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
  await Promise.all(workers)

  // Summary
  const discovered = results.filter(r => r.status === 'discovered').length
  const cached = results.filter(r => r.status === 'cached').length
  const errors = results.filter(r => r.status === 'error').length
  const noEvidence = results.filter(r => r.status === 'no-evidence').length
  console.log(`\n✅ Done: ${discovered} discovered, ${cached} cached, ${errors} errors out of ${targets.length} companies`)
}

run().catch(console.error)
