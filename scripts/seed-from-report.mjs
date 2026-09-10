/**
 * Turn a company list from an external report into verified, crawlable boards.
 *
 * WHY THE REPORT IS A SEED, NOT A SOURCE
 * --------------------------------------
 * A spreadsheet of job URLs is a claim about the past. Checking the 21 job URLs
 * in this particular report found 6 already dead (29% rot) -- postings expire,
 * requisitions close, and a report is stale the day after it is written.
 *
 * What does NOT rot is the company list: an employer's careers page and their
 * ATS tenant outlive any single posting. So this script keeps the durable half
 * (who is hiring, and where their board lives) and discards the perishable half
 * (individual job URLs), then re-derives live postings from the ATS API.
 *
 * Pipeline:
 *   company + URL -> detect ATS -> extract board token -> verify against the
 *   live API -> emit a target the ingest pipeline can crawl.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'

const { detectFromUrl, detectAts } = await import('../lib/sources/detector.ts')
const { getAdapter } = await import('../lib/sources/registry.ts')

const IN = process.argv[2] || 'report-companies.json'
const OUT = process.argv[3] || 'scripts/report-boards.json'

if (!existsSync(IN)) {
  console.error(`missing ${IN}`)
  process.exit(1)
}

const companies = JSON.parse(readFileSync(IN, 'utf8'))
console.log(`Seeding from ${companies.length} companies in ${IN}\n`)

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Postings that betray a demo/sandbox tenant rather than a real employer.
 *
 * Probing `recruitee/google` returns a board whose only posting is
 * "Senior Marketer (Sample)" -- a Recruitee demo account, not Google. Without
 * this check the probe would attribute sample data to a real company, which is
 * a fabrication with a company name attached to it.
 */
const DEMO_MARKERS = /\((sample|demo|example|test)\)|(sample|demo|dummy|placeholder)\s+(job|posting|vacancy|position)|^test/i

/**
 * Confirm a detected board serves real postings right now.
 *
 * `strict` is used for slug-probed boards, where we guessed the token and must
 * prove the board belongs to the company we think it does.
 */
async function verifyBoard(target, { strict = false, companyName = '' } = {}) {
  const adapter = getAdapter(target.source)
  if (!adapter) return null
  try {
    const res = await adapter.fetchJobs(target, { maxPages: 1 })
    const jobs = res.jobs
    if (jobs.length === 0) return null

    if (strict) {
      // Reject a board where demo postings are a meaningful share of the board.
      const demo = jobs.filter((j) => DEMO_MARKERS.test(j.title)).length
      if (demo > 0 && demo / jobs.length >= 0.25) return null

      // A household-name employer with a two-posting board is far more likely
      // to be a squatted or sandbox tenant than the real thing. Require either
      // a plausible volume or corroboration from the posting's own company
      // field.
      const claimsName = jobs.some((j) => {
        const c = (j.company ?? '').toLowerCase()
        const want = companyName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)[0]
        return want ? c.includes(want) : false
      })
      if (jobs.length < 5 && !claimsName) return null
    }

    return jobs.length
  } catch {
    return null
  }
}

const results = []
const queue = [...companies]
const CONCURRENCY = 5

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const c = queue.shift()
      const urls = [c.careersUrl, c.website].filter(Boolean)
      let record = {
        company: c.name,
        slug: slugify(c.name),
        domain: domainOf(c.website) || domainOf(c.careersUrl),
        source: null,
        token: null,
        confidence: 0,
        openRoles: null,
        detectedFrom: null,
        note: null,
      }

      // 1. Cheap: does the URL alone identify an ATS and a board token?
      for (const url of urls) {
        const d = detectFromUrl(url)
        if (d.target?.token) {
          record = { ...record, source: d.source, token: d.target.token, confidence: d.confidence, detectedFrom: 'url' }
          break
        }
      }

      // 2. Expensive: fetch the careers page and look for an embedded ATS.
      //    This is what catches employers on their own domain (scale.com/careers,
      //    careers.snowflake.com) where the host reveals nothing.
      if (!record.token) {
        for (const url of urls) {
          try {
            const d = await detectAts(url)
            if (d.target?.token) {
              record = { ...record, source: d.source, token: d.target.token, confidence: d.confidence, detectedFrom: 'page-content' }
              break
            }
            if (d.source !== 'unknown' && !record.source) {
              record.source = d.source
              record.confidence = d.confidence
              record.detectedFrom = 'page-content (no token)'
            }
          } catch { /* keep going */ }
        }
      }

      // 3. Fallback: probe candidate tokens derived from the company name.
      //
      //    Many employers front their ATS with a JS-rendered page on their own
      //    domain (stripe.com/jobs, vercel.com/careers), so neither the URL nor
      //    the served HTML names the platform. But board tokens are
      //    overwhelmingly the company name in some form.
      //
      //    Guessing is only acceptable because every candidate is then VERIFIED
      //    against the live API below -- a guess that does not return postings
      //    is discarded, so nothing unverified enters the registry.
      if (!record.token) {
        const base = slugify(c.name)
          .replace(/-(inc|llc|ltd|corp|technologies|industries|ai|io|com)$/g, '')
        const bare = base.replace(/-/g, '')
        const fromDomain = (record.domain || '').split('.')[0]
        const candidates = [...new Set([base, bare, fromDomain].filter(Boolean))]

        outer: for (const token of candidates) {
          for (const provider of ['greenhouse', 'ashby', 'lever', 'smartrecruiters', 'workable', 'recruitee']) {
            const n = await verifyBoard(
              { source: provider, token, companyName: c.name, companyDomain: record.domain },
              { strict: true, companyName: c.name }
            )
            if (n) {
              record = {
                ...record, source: provider, token,
                confidence: 0.85, detectedFrom: 'slug-probe (API verified)',
                openRoles: n,
              }
              break outer
            }
          }
        }
      }

      // 4. Verify against the live API. Detection without verification is just
      //    a better guess.
      if (record.token && record.source && record.openRoles == null) {
        const count = await verifyBoard({
          source: record.source,
          token: record.token,
          companyName: c.name,
          companyDomain: record.domain,
        })
        record.openRoles = count
        if (count === null) record.note = 'board detected but API returned nothing'
      } else if (!record.source) {
        record.note = 'no ATS identified'
      }

      results.push(record)
      process.stdout.write(`  ${results.length}/${companies.length}\r`)
    }
  })
)

results.sort((a, b) => (b.openRoles ?? -1) - (a.openRoles ?? -1))

const verified = results.filter((r) => r.openRoles > 0)
const detectedOnly = results.filter((r) => r.token && !(r.openRoles > 0))
const undetected = results.filter((r) => !r.token)

console.log(`\n\nVERIFIED BOARDS (${verified.length})`)
for (const r of verified) {
  console.log(`  ${String(r.openRoles).padStart(5)}  ${r.company.padEnd(22)} ${r.source}/${r.token}  [${r.detectedFrom}]`)
}

console.log(`\nDETECTED BUT NOT SERVING (${detectedOnly.length})`)
for (const r of detectedOnly) console.log(`         ${r.company.padEnd(22)} ${r.source}/${r.token}  -- ${r.note}`)

console.log(`\nNO ATS IDENTIFIED (${undetected.length})`)
for (const r of undetected) console.log(`         ${r.company.padEnd(22)} ${r.source ?? '-'}  ${r.note ?? ''}`)

const bySource = {}
for (const r of verified) bySource[r.source] = (bySource[r.source] ?? 0) + 1

writeFileSync(
  OUT,
  JSON.stringify(
    {
      seededAt: new Date().toISOString(),
      sourceFile: IN,
      companiesIn: companies.length,
      verified: verified.length,
      totalOpenRoles: verified.reduce((s, r) => s + r.openRoles, 0),
      bySource,
      boards: verified.map((r) => ({
        provider: r.source,
        token: r.token,
        companySlug: r.slug,
        companyName: r.company,
        companyDomain: r.domain,
        openRoles: r.openRoles,
        discoveredVia: `report:${r.detectedFrom}`,
      })),
    },
    null,
    2
  )
)

console.log(`\n${verified.length}/${companies.length} companies resolved to a live board`)
console.log(`by platform: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(`wrote ${OUT}`)
