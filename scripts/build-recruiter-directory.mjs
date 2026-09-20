/**
 * Build the public recruiter directory.
 *
 *   npx tsx scripts/build-recruiter-directory.mjs
 *   npx tsx scripts/build-recruiter-directory.mjs --budget-minutes 40 --concurrency 8
 *   npx tsx scripts/build-recruiter-directory.mjs --only stripe.com,google.com --force
 *
 * Produces public/data/recruiter-directory.json: for every company in the
 * registry, how to reach its recruiting function and who publicly works in it.
 *
 * WHAT THIS DOES AND DOES NOT PUBLISH
 * -----------------------------------
 * Five independent kinds of evidence, never blended:
 *
 *   A. Named recruiters      real people, from data/recruiter-evidence via
 *                            public/data/recruiting-intelligence.json. Each
 *                            carries source URLs. NO address is ever attached
 *                            to a person here.
 *   B. Published addresses   role mailboxes the employer printed on its own
 *                            careers/contact pages (careers@, talent@).
 *   C. Observed pattern      how the company forms addresses, inferred from
 *                            commit authors in its VERIFIED GitHub org. A
 *                            pattern is a shape, not a mailbox.
 *   D. Mail posture          MX/SPF/DMARC, a property of the DOMAIN.
 *   E. Public records        security.txt / DMARC rua / SOA RNAME / RDAP —
 *                            addresses the domain owner publishes in documented
 *                            standards. These are security and DNS mailboxes,
 *                            NOT recruiting contacts, and are kept in their own
 *                            tier so they can never be presented as a route to
 *                            a hiring team.
 *
 * Nothing is generated. If a company yields no evidence it is published with
 * empty evidence and `atsOnly: true`, because "apply through their board" is
 * the true answer and a guessed address is not.
 *
 * INCREMENTAL BY DESIGN
 * ---------------------
 * A full pass over the registry takes ~20 minutes of live requests. The daily
 * run re-crawls the STALEST companies first and stops at `--budget-minutes`,
 * carrying every untouched entry forward from the previous build. That keeps a
 * scheduled run bounded as the registry grows, and means a partial run degrades
 * into older data rather than into missing data.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { promises as dns } from 'dns'
import { scrapeCareersPage } from '../lib/contacts/scraper.ts'
import { verifyDomain } from '../lib/contacts/verify.ts'
import { discoverPatterns } from '../lib/contacts/email-patterns.ts'
import { collectPublicRecords } from '../lib/contacts/sources/public-records.ts'
import { parseRobots, robotsDecision } from '../lib/sources/robots.ts'
import { parseRegistry } from './lib/parse-registry.mjs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const has = (n) => args.includes(`--${n}`)

const OUT = val('out', 'public/data/recruiter-directory.json')
const CONCURRENCY = Number(val('concurrency', '6'))
const BUDGET_MS = Number(val('budget-minutes', '45')) * 60_000
const ONLY = val('only', '')
const FORCE = has('force')
const SKIP_GITHUB = has('skip-github')
const STALE_AFTER_DAYS = Number(val('stale-after-days', '7'))
/** Hard per-company deadline. See withDeadline(). */
const PER_COMPANY_MS = Number(val('per-company-seconds', '90')) * 1000
const UA = 'AIJobSearchBot'

const started = Date.now()
const budgetLeft = () => BUDGET_MS - (Date.now() - started)

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

// Shared parser, which throws rather than silently under-matching. Its own
// regex used to live here and skipped every double-quoted name — 114 of 387
// companies, including Ramp, Plaid, CoreWeave and Vanta, absent from the
// directory with nothing reporting it.
let companies
try {
  ({ companies } = parseRegistry())
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

/** Named recruiters, already evidence-gated by the recruiting-intelligence build. */
let intel = {}
try {
  intel = JSON.parse(readFileSync('public/data/recruiting-intelligence.json', 'utf8')).records ?? {}
} catch {
  console.warn('No recruiting-intelligence.json — publishing without named recruiters.')
}

/** Previous build, so an untouched company keeps its last known evidence. */
let previous = { companies: {} }
if (existsSync(OUT)) {
  try {
    previous = JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    console.warn(`${OUT} is unreadable — rebuilding from scratch.`)
  }
}

/* ------------------------------------------------------------------ */
/* Crawl helpers                                                       */
/* ------------------------------------------------------------------ */

async function robotsAllows(domain, path) {
  for (const host of [`https://www.${domain}`, `https://${domain}`]) {
    try {
      const res = await fetch(`${host}/robots.txt`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      return robotsDecision(parseRobots(await res.text(), UA), `${host}${path}`).allowed
    } catch { continue }
  }
  return null // no stated policy
}

/**
 * Hard deadline for one company.
 *
 * Node's `dns.resolve*` calls take no timeout and can hang indefinitely on a
 * misbehaving resolver. A full run once stopped at 272/273 with "Detected
 * unsettled top-level await": a single domain wedged one worker forever, so
 * the build never wrote its output and the scheduled job would have burned its
 * whole timeout for nothing. One slow company must cost one company.
 */
function withDeadline(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** Crawl one company. Every field defaults to "nothing observed". */
async function crawl(company) {
  const { domain } = company

  const evidence = {
    domainResolves: false,
    mailPosture: null,
    robotsAllowsCareers: null,
    publishedContacts: [],
    otherAddresses: [],
    publicRecords: [],
    emailPattern: null,
    githubOrg: null,
    crawledAt: new Date().toISOString(),
    error: null,
  }

  try {
    await dns.resolve4(domain)
    evidence.domainResolves = true
  } catch {
    return evidence
  }

  try {
    const posture = await verifyDomain(domain)
    evidence.mailPosture = {
      hasMx: posture.hasMx,
      mx: posture.mxRecords.slice(0, 3),
      hasSpf: posture.hasSpf,
      dmarcPolicy: posture.dmarcPolicy ?? null,
    }
  } catch (err) {
    evidence.error = `mail: ${err.message}`
  }

  // Records the domain owner publishes about themselves, in documented
  // standards. Not recruiting addresses — kept in their own tier so they can
  // never be presented as a way to reach a hiring team.
  try {
    evidence.publicRecords = await collectPublicRecords(domain)
  } catch (err) {
    evidence.error = `${evidence.error ? evidence.error + '; ' : ''}records: ${err.message}`
  }

  evidence.robotsAllowsCareers = await robotsAllows(domain, '/careers')
  if (evidence.robotsAllowsCareers !== false) {
    try {
      const found = await scrapeCareersPage(domain)
      evidence.publishedContacts = found
        .filter((f) => f.source === 'careers-role')
        .map((f) => ({
          address: f.email,
          kind: 'recruiting',
          // Recorded, not inferred: an address on a corporate alternate domain
          // (jobs@wdc.com on westerndigital.com) is still the employer's, but
          // the reader should be able to see that it is not the main domain.
          onCompanyDomain: f.onCompanyDomain,
          evidence: `Published on ${domain} careers/contact pages`,
        }))
      evidence.otherAddresses = found.filter((f) => f.source !== 'careers-role').map((f) => f.email)
    } catch (err) {
      evidence.error = `${evidence.error ? evidence.error + '; ' : ''}careers: ${err.message}`
    }
  }

  if (!SKIP_GITHUB) {
    try {
      const patterns = await discoverPatterns(domain)
      if (patterns.length > 0) {
        evidence.emailPattern = {
          domain,
          patterns: patterns.map((p) => ({
            pattern: p.pattern,
            share: Number(p.confidence.toFixed(3)),
            sampleSize: p.sampleSize,
          })),
          observedFrom: 'github-org-commits',
        }
        evidence.githubOrg = patterns[0].sources[0] ?? null
      }
    } catch (err) {
      evidence.error = `${evidence.error ? evidence.error + '; ' : ''}github: ${err.message}`
    }
  }

  return evidence
}

/* ------------------------------------------------------------------ */
/* Assemble one directory entry                                        */
/* ------------------------------------------------------------------ */

/**
 * How reachable this company's recruiting function is, from evidence alone.
 *
 * `direct`      a published recruiting mailbox exists
 * `named`       public recruiters are identified, but no address is published
 * `pattern`     only the domain's address shape is known
 * `ats-only`    nothing but the applicant tracking system
 */
function reachability(entry) {
  if (entry.publishedContacts.length > 0) return 'direct'
  if (entry.recruiters.length > 0) return 'named'
  if (entry.emailPattern) return 'pattern'
  return 'ats-only'
}

function assemble(company, evidence) {
  const record = intel[company.slug] ?? null

  const recruiters = (record?.recruiters ?? []).map((r) => ({
    fullName: r.fullName,
    title: r.currentTitle ?? null,
    department: r.department ?? null,
    identityStatus: r.identityStatus ?? 'uncertain',
    // Carried through exactly as the evidence build left it. The directory
    // never attaches an address to a person, so this stays informational.
    emailStatus: r.emailStatus ?? 'not_found',
    linkedinUrl: r.linkedinUrl ?? null,
    sourceUrls: r.sourceUrls ?? [],
  }))

  const entry = {
    slug: company.slug,
    name: company.name,
    domain: company.domain,
    logoUrl: `https://www.google.com/s2/favicons?domain=${company.domain}&sz=128`,
    recruiters,
    recruiterCount: recruiters.length,
    publishedContacts: evidence.publishedContacts,
    emailPattern: evidence.emailPattern,
    mailPosture: evidence.mailPosture,
    otherAddressCount: evidence.otherAddresses.length,
    publicRecords: evidence.publicRecords ?? [],
    robotsAllowsCareers: evidence.robotsAllowsCareers,
    crawledAt: evidence.crawledAt,
    error: evidence.error,
  }

  entry.reachability = reachability(entry)
  entry.atsOnly = entry.reachability === 'ats-only'
  return entry
}

/* ------------------------------------------------------------------ */
/* Choose what to crawl this run                                       */
/* ------------------------------------------------------------------ */

const onlyList = ONLY ? ONLY.split(',').map((s) => s.trim().toLowerCase()) : null

const staleCutoff = Date.now() - STALE_AFTER_DAYS * 86_400_000
const queue = companies
  .filter((c) => !onlyList || onlyList.includes(c.domain) || onlyList.includes(c.slug))
  .map((c) => {
    const prior = previous.companies?.[c.slug]
    const crawledAt = prior?.crawledAt ? Date.parse(prior.crawledAt) : 0
    return { ...c, crawledAt }
  })
  // Oldest first: a budget-limited run always spends its time on the data
  // that has decayed most, instead of re-crawling whatever sorts first.
  .sort((a, b) => a.crawledAt - b.crawledAt)
  .filter((c) => FORCE || onlyList || c.crawledAt < staleCutoff)

console.log(
  `Registry: ${companies.length} companies. ` +
  `Queued for crawl: ${queue.length} (stale > ${STALE_AFTER_DAYS}d${FORCE ? ', forced' : ''}). ` +
  `Budget: ${Math.round(BUDGET_MS / 60000)} min, concurrency ${CONCURRENCY}.\n`
)

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const crawled = new Map()
let done = 0
let skippedForBudget = 0

async function worker(q) {
  while (q.length) {
    if (budgetLeft() <= 0) {
      skippedForBudget += q.length
      q.length = 0
      return
    }
    const company = q.shift()
    let evidence
    try {
      evidence = await withDeadline(crawl(company), PER_COMPANY_MS, company.domain)
    } catch (err) {
      // A timed-out company is published as "nothing observed, with an error",
      // never dropped, so the directory still lists it and says what happened.
      evidence = {
        domainResolves: false,
        mailPosture: null,
        robotsAllowsCareers: null,
        publishedContacts: [],
        otherAddresses: [],
        publicRecords: [],
        emailPattern: null,
        githubOrg: null,
        crawledAt: new Date().toISOString(),
        error: err.message,
      }
    }
    crawled.set(company.slug, evidence)
    done++

    const bits = [
      `contacts:${evidence.publishedContacts.length}`,
      evidence.emailPattern ? 'pattern✓' : 'pattern✗',
      evidence.mailPosture?.hasMx ? 'mx✓' : 'mx✗',
    ]
    console.log(`[${String(done).padStart(4)}/${queue.length}] ${company.domain.padEnd(28)} ${bits.join(' ')}`)
  }
}

const work = [...queue]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(work)))

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

const out = {}
let carriedForward = 0

for (const company of companies) {
  const evidence = crawled.get(company.slug)

  if (evidence) {
    out[company.slug] = assemble(company, evidence)
    continue
  }

  const prior = previous.companies?.[company.slug]
  if (prior) {
    // Recruiters come from the evidence store, which is rebuilt independently,
    // so refresh that half even when this entry was not re-crawled.
    out[company.slug] = assemble(company, {
      publishedContacts: prior.publishedContacts ?? [],
      otherAddresses: new Array(prior.otherAddressCount ?? 0),
      publicRecords: prior.publicRecords ?? [],
      emailPattern: prior.emailPattern ?? null,
      mailPosture: prior.mailPosture ?? null,
      robotsAllowsCareers: prior.robotsAllowsCareers ?? null,
      crawledAt: prior.crawledAt,
      error: prior.error ?? null,
    })
    carriedForward++
    continue
  }

  // Never crawled and nothing prior: publish it as unknown rather than omit it,
  // so the page can say "not yet crawled" instead of silently dropping employers.
  out[company.slug] = assemble(company, {
    publishedContacts: [],
    otherAddresses: [],
    emailPattern: null,
    mailPosture: null,
    robotsAllowsCareers: null,
    crawledAt: null,
    error: null,
  })
}

const entries = Object.values(out)
const summary = {
  companies: entries.length,
  crawledThisRun: crawled.size,
  carriedForward,
  skippedForBudget,
  neverCrawled: entries.filter((e) => !e.crawledAt).length,
  withPublishedContacts: entries.filter((e) => e.publishedContacts.length > 0).length,
  publishedContactTotal: entries.reduce((a, e) => a + e.publishedContacts.length, 0),
  withNamedRecruiters: entries.filter((e) => e.recruiterCount > 0).length,
  namedRecruiterTotal: entries.reduce((a, e) => a + e.recruiterCount, 0),
  withEmailPattern: entries.filter((e) => e.emailPattern).length,
  atsOnly: entries.filter((e) => e.atsOnly).length,
  byReachability: entries.reduce((acc, e) => {
    acc[e.reachability] = (acc[e.reachability] ?? 0) + 1
    return acc
  }, {}),
}

const payload = {
  generatedAt: new Date().toISOString(),
  method:
    'Role addresses published on employers\' own careers/contact pages; address patterns inferred ' +
    'from commit authors in a VERIFIED GitHub organisation; MX/SPF/DMARC checked at domain level. ' +
    'Named recruiters carry public source URLs and never carry an address.',
  notCollected: [
    'addresses belonging to identifiable individuals',
    'addresses constructed from a person\'s name',
    'per-mailbox existence (would require SMTP RCPT TO probing)',
  ],
  summary,
  companies: out,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2))

console.log(`\n${'='.repeat(64)}`)
console.log('RECRUITER DIRECTORY')
console.log('='.repeat(64))
for (const [k, v] of Object.entries(summary)) {
  console.log(`  ${k.padEnd(24)} ${typeof v === 'object' ? JSON.stringify(v) : v}`)
}
console.log('='.repeat(64))
console.log(`Wrote ${OUT} in ${((Date.now() - started) / 1000).toFixed(0)}s`)
