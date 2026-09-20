/**
 * Refresh email patterns for all companies — monthly cron job.
 *
 *   node scripts/refresh-patterns.mjs
 *   node scripts/refresh-patterns.mjs --stale-days 30 --concurrency 3
 *
 * Re-verifies MX records, re-mines GitHub for new commits, and updates
 * confidence scores. Only refreshes patterns older than --stale-days.
 */
import { createClient } from '@supabase/supabase-js'
import { promises as dns } from 'dns'
import { config } from 'dotenv'

config({ path: '.env.local' })

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const STALE_DAYS = Number(val('stale-days', '30'))
const CONCURRENCY = Number(val('concurrency', '3'))
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const UA = 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0)'

dns.setServers(['1.1.1.1', '8.8.8.8'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/* ---------- Helpers ---------- */

async function checkMx(domain) {
  try {
    const records = await dns.resolveMx(domain)
    return records && records.length > 0
  } catch { return false }
}

async function mineGitHub(domain) {
  const headers = { 'Accept': 'application/vnd.github.cloak-preview+json', 'User-Agent': UA }
  if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`
  const found = []
  try {
    const url = `https://api.github.com/search/commits?q=author-email:@${domain}&per_page=30&sort=author-date&order=desc`
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return found
    const data = await r.json()
    for (const item of (data.items || [])) {
      const author = item.commit?.author
      if (!author?.email || !author?.name) continue
      if (author.email.includes('noreply')) continue
      if (!author.email.toLowerCase().endsWith(`@${domain}`)) continue
      found.push({ email: author.email.toLowerCase(), name: author.name })
    }
  } catch { /* ignore */ }
  return found
}

const TEMPLATES = [
  '{first}.{last}', '{first}{last}', '{f}{last}', '{first}',
  '{first}_{last}', '{last}.{first}', '{last}{first}',
  '{f}.{last}', '{first}.{l}', '{f}{l}',
]

function applyPattern(pattern, first, last) {
  return pattern
    .replace('{first}', first.toLowerCase())
    .replace('{last}', last.toLowerCase())
    .replace('{f}', first[0]?.toLowerCase() || '')
    .replace('{l}', last[0]?.toLowerCase() || '')
}

function inferPattern(email, firstName, lastName) {
  const local = email.split('@')[0].toLowerCase()
  for (const t of TEMPLATES) {
    if (applyPattern(t, firstName, lastName) === local) return t
  }
  return null
}

/* ---------- Refresh one domain ---------- */

async function refreshDomain(domain, existingPatterns) {
  const t0 = Date.now()

  // 1. Check MX is still valid
  const hasMx = await checkMx(domain)
  if (!hasMx) {
    console.log(`  ⚠ ${domain}: MX records gone, marking low confidence`)
    await supabase
      .from('email_patterns')
      .update({ confidence: 0.1, updated_at: new Date().toISOString() })
      .eq('domain', domain)
    return { domain, status: 'mx-gone', ms: Date.now() - t0 }
  }

  // 2. Mine fresh GitHub emails
  const ghEmails = await mineGitHub(domain)

  // 3. Re-tally patterns from new data
  const tally = new Map()
  const samples = new Map()
  for (const { email, name } of ghEmails) {
    const parts = name.split(/\s+/)
    if (parts.length < 2) continue
    const first = parts[0], last = parts[parts.length - 1]
    const pattern = inferPattern(email, first, last)
    if (pattern) {
      tally.set(pattern, (tally.get(pattern) || 0) + 1)
      if (!samples.has(pattern)) samples.set(pattern, [])
      if (samples.get(pattern).length < 5) samples.get(pattern).push(email)
    }
  }

  // 4. Update existing patterns with new data
  const total = [...tally.values()].reduce((a, b) => a + b, 0) || 1
  let updated = 0

  for (const ep of existingPatterns) {
    const newCount = tally.get(ep.pattern) || 0
    const mergedSampleSize = ep.sample_size + newCount
    const newConfidence = newCount > 0
      ? Math.min((ep.confidence * 0.7) + (newCount / total * 0.3), 0.99)
      : Math.max(ep.confidence * 0.9, 0.1) // decay if no new evidence

    const newSamples = [...new Set([...(ep.sample_emails || []), ...(samples.get(ep.pattern) || [])])].slice(0, 10)

    await supabase
      .from('email_patterns')
      .update({
        confidence: newConfidence,
        sample_size: mergedSampleSize,
        sample_emails: newSamples,
        sources: [...new Set([...(ep.sources || []), ...(newCount > 0 ? ['github'] : [])])],
        updated_at: new Date().toISOString(),
      })
      .eq('id', ep.id)
    updated++
  }

  // 5. Insert any new patterns not previously seen
  for (const [pattern, count] of tally.entries()) {
    if (!existingPatterns.find(ep => ep.pattern === pattern)) {
      await supabase
        .from('email_patterns')
        .upsert({
          domain,
          pattern,
          confidence: Math.min(count / total, 0.99),
          sample_size: count,
          sample_emails: samples.get(pattern) || [],
          sources: ['github'],
        }, { onConflict: 'domain,pattern' })
      updated++
    }
  }

  return { domain, status: 'refreshed', updated, newEmails: ghEmails.length, ms: Date.now() - t0 }
}

/* ---------- Main ---------- */

async function run() {
  // Fetch all domains with stale patterns
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()

  const { data: stalePatterns, error } = await supabase
    .from('email_patterns')
    .select('*')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch patterns:', error.message)
    process.exit(1)
  }

  // Group by domain
  const byDomain = new Map()
  for (const p of (stalePatterns || [])) {
    if (!byDomain.has(p.domain)) byDomain.set(p.domain, [])
    byDomain.get(p.domain).push(p)
  }

  const domains = [...byDomain.keys()]
  console.log(`Found ${domains.length} domains with patterns older than ${STALE_DAYS} days\n`)

  if (domains.length === 0) {
    console.log('Nothing to refresh.')
    return
  }

  // Process with concurrency
  let done = 0
  const results = []

  async function worker(queue) {
    while (queue.length > 0) {
      const domain = queue.shift()
      const result = await refreshDomain(domain, byDomain.get(domain))
      done++
      const pct = ((done / domains.length) * 100).toFixed(0)
      console.log(`[${pct}%] ${result.domain}: ${result.status} (${result.ms}ms)`)
      results.push(result)
    }
  }

  const queue = [...domains]
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
  await Promise.all(workers)

  // Summary
  const refreshed = results.filter(r => r.status === 'refreshed').length
  const mxGone = results.filter(r => r.status === 'mx-gone').length
  console.log(`\n✅ Done: ${refreshed} refreshed, ${mxGone} MX-gone out of ${domains.length} domains`)
}

run().catch(console.error)
