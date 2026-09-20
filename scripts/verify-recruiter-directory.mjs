/**
 * Gate the recruiter directory before it can be committed or deployed.
 *
 *   node scripts/verify-recruiter-directory.mjs --file public/data/recruiter-directory.json
 *   node scripts/verify-recruiter-directory.mjs --file new.json --floor-against previous.json
 *
 * Prints a one-line summary on success and exits non-zero on any violation, so
 * a scheduled run cannot publish a directory that is empty, that shrank, or
 * that contains data nobody can point at a source for.
 *
 * The integrity rules below are the reason this file exists. A directory of
 * recruiting contacts is exactly the artefact where a plausible invented
 * address does real damage: someone sends a real application to it.
 */

import { readFileSync, existsSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const FILE = val('file', 'public/data/recruiter-directory.json')
const FLOOR = val('floor-against', '')

const failures = []
const warnings = []

function fail(msg) { failures.push(msg) }
function warn(msg) { warnings.push(msg) }

if (!existsSync(FILE)) {
  console.error(`✗ ${FILE} does not exist`)
  process.exit(1)
}

let doc
try {
  doc = JSON.parse(readFileSync(FILE, 'utf8'))
} catch (err) {
  console.error(`✗ ${FILE} is not valid JSON: ${err.message}`)
  process.exit(1)
}

const entries = Object.values(doc.companies ?? {})

/* ---- Structure ---- */

if (!doc.generatedAt || Number.isNaN(Date.parse(doc.generatedAt))) {
  fail('generatedAt is missing or unparseable')
}
if (entries.length === 0) {
  fail('directory contains no companies')
}

/* ---- Integrity: nothing published without a source ---- */

const ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
const ARTEFACT_RE = /^(%[0-9a-f]{2}|u00[0-9a-f]{2}|amp|quot|lt|gt|nbsp)/i

/** Mirrors lib/contacts/scraper.ts: file names shaped exactly like addresses. */
const ASSET_RE =
  /(@\d+(\.\d+)?x(\.|$)|\.(webp|jpe?g|png|gif|svg|avif|ico|bmp|tiff?|css|js|mjs|json|html?|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz)$)/i

/** Mirrors lib/contacts/scraper.ts. Kept in step deliberately. */
const RECRUITING_LOCAL =
  /^(careers?|recruit(ing|ment)?|hiring|talent|jobs?|campus|apply|applications?|university|graduate|grad|internships?|hr|employment|employee[._-]?verification)/i

const VENDOR_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workday.com', 'myworkday.com',
  'icims.com', 'smartrecruiters.com', 'workable.com', 'recruitee.com',
  'teamtailor.com', 'jobvite.com', 'bamboohr.com', 'successfactors.com',
  'taleo.net', 'oraclecloud.com', 'eightfold.ai', 'phenompeople.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com',
]

for (const entry of entries) {
  const where = entry.slug ?? '(unnamed)'

  if (!entry.slug || !entry.name || !entry.domain) {
    fail(`${where}: missing slug, name or domain`)
    continue
  }

  for (const contact of entry.publishedContacts ?? []) {
    if (!ADDRESS_RE.test(contact.address)) {
      fail(`${where}: "${contact.address}" is not a well-formed address`)
    }
    if (ARTEFACT_RE.test(contact.address.split('@')[0])) {
      fail(`${where}: "${contact.address}" looks like an encoding artefact, not a mailbox`)
    }
    // A retina asset (`career-hero@2x.webp`) has the exact shape of an address
    // and begins with a recruiting word, so it reaches this point looking valid.
    if (ASSET_RE.test(contact.address)) {
      fail(`${where}: "${contact.address}" is a file name, not a mailbox`)
    }
    // A published address is either on the company's own domain, or on a
    // corporate alternate domain (westerndigital.com publishes jobs@wdc.com,
    // discord.com publishes jobs@discordapp.com). Off-domain is allowed only
    // for a recruiting local part on a non-vendor host — the same rule the
    // scraper applies — so an ATS address on the page is never attributed to
    // the employer.
    const host = (contact.address.split('@')[1] ?? '').replace(/^www\./, '')
    const local = contact.address.split('@')[0]
    const base = entry.domain.replace(/^www\./, '')
    // A subdomain is the company's own: Duolingo's recruiters write from
    // @recruiting.duolingo.com, and an exact-match test discards them.
    const onOwnDomain = host === base || host.endsWith(`.${base}`)

    if (!onOwnDomain) {
      if (!RECRUITING_LOCAL.test(local)) {
        fail(`${where}: "${contact.address}" is off-domain and not a recruiting mailbox`)
      }
      if (VENDOR_DOMAINS.some((v) => host === v || host.endsWith(`.${v}`))) {
        fail(`${where}: "${contact.address}" is an ATS vendor address, not ${entry.name}'s`)
      }
    }
    if (contact.onCompanyDomain !== undefined && contact.onCompanyDomain !== onOwnDomain) {
      fail(`${where}: "${contact.address}" records onCompanyDomain=${contact.onCompanyDomain} but is ${onOwnDomain ? 'on' : 'off'} ${entry.domain}`)
    }
    if (!contact.evidence) {
      fail(`${where}: "${contact.address}" has no evidence string`)
    }
  }

  // Public records are security/DNS mailboxes, never recruiting contacts.
  // Each must be on the company's own domain and name the standard it came
  // from, and none may be a recruiting address — if one ever looks like a
  // careers mailbox it belongs in publishedContacts with its real provenance.
  const RECORD_KINDS = new Set(['security-txt', 'dmarc', 'soa', 'rdap'])
  for (const record of entry.publicRecords ?? []) {
    if (!ADDRESS_RE.test(record.address)) {
      fail(`${where}: public record "${record.address}" is not a well-formed address`)
    }
    if (!RECORD_KINDS.has(record.kind)) {
      fail(`${where}: public record "${record.address}" has unknown kind "${record.kind}"`)
    }
    if (!record.evidence) {
      fail(`${where}: public record "${record.address}" has no evidence string`)
    }
    const recordHost = (record.address.split('@')[1] ?? '').replace(/^www\./, '')
    const base = entry.domain.replace(/^www\./, '')
    if (recordHost !== base && !recordHost.endsWith(`.${base}`)) {
      fail(`${where}: public record "${record.address}" is not on ${entry.domain}`)
    }
  }

  // THE rule: no person in this directory may carry an email address.
  // An address next to a named individual is a spearphishing asset, and a
  // pattern-derived one is not even real.
  for (const recruiter of entry.recruiters ?? []) {
    if (!recruiter.fullName) {
      fail(`${where}: a recruiter has no name`)
    }
    for (const [key, value] of Object.entries(recruiter)) {
      if (typeof value === 'string' && ADDRESS_RE.test(value)) {
        fail(`${where}: recruiter "${recruiter.fullName}" carries an address in "${key}"`)
      }
    }
    if ((recruiter.sourceUrls ?? []).length === 0) {
      fail(`${where}: recruiter "${recruiter.fullName}" has no source URL`)
    }
  }

  // A pattern is only publishable with observations behind it.
  if (entry.emailPattern) {
    const patterns = entry.emailPattern.patterns ?? []
    if (patterns.length === 0) {
      fail(`${where}: emailPattern is present but lists no patterns`)
    }
    for (const p of patterns) {
      if (!p.sampleSize || p.sampleSize < 1) {
        fail(`${where}: pattern "${p.pattern}" has no observed samples`)
      }
      if (typeof p.share !== 'number' || p.share <= 0 || p.share > 1) {
        fail(`${where}: pattern "${p.pattern}" has an implausible share (${p.share})`)
      }
    }
  }

  const expected = entry.publishedContacts?.length
    ? 'direct'
    : entry.recruiterCount > 0
      ? 'named'
      : entry.emailPattern
        ? 'pattern'
        : 'ats-only'
  if (entry.reachability !== expected) {
    fail(`${where}: reachability "${entry.reachability}" contradicts its evidence (expected "${expected}")`)
  }
}

/* ---- Floor: a rebuild must not silently lose data ---- */

if (FLOOR && existsSync(FLOOR)) {
  try {
    const prev = JSON.parse(readFileSync(FLOOR, 'utf8'))
    const prevEntries = Object.values(prev.companies ?? {})

    if (entries.length < prevEntries.length) {
      fail(`company count fell from ${prevEntries.length} to ${entries.length}`)
    }

    const prevContacts = prevEntries.reduce((a, e) => a + (e.publishedContacts?.length ?? 0), 0)
    const nowContacts = entries.reduce((a, e) => a + (e.publishedContacts?.length ?? 0), 0)

    // Sites change and addresses come down, so a small drop is normal. A large
    // one means the crawl broke, which is exactly what a cache miss looks like.
    if (prevContacts > 20 && nowContacts < prevContacts * 0.5) {
      fail(`published contacts halved: ${prevContacts} → ${nowContacts}`)
    } else if (nowContacts < prevContacts) {
      warn(`published contacts fell ${prevContacts} → ${nowContacts}`)
    }
  } catch (err) {
    warn(`could not compare against ${FLOOR}: ${err.message}`)
  }
}

/* ---- Staleness ---- */

const stale = entries.filter((e) => {
  if (!e.crawledAt) return false
  return Date.now() - Date.parse(e.crawledAt) > 30 * 86_400_000
})
if (stale.length > entries.length * 0.5) {
  warn(`${stale.length}/${entries.length} entries are over 30 days old`)
}

/* ---- Report ---- */

const s = doc.summary ?? {}
const summaryLine =
  `${entries.length} companies · ${s.publishedContactTotal ?? 0} published contacts · ` +
  `${s.namedRecruiterTotal ?? 0} named recruiters · ${s.withEmailPattern ?? 0} with an observed pattern · ` +
  `${s.atsOnly ?? 0} ATS-only`

for (const w of warnings) console.warn(`⚠ ${w}`)

if (failures.length) {
  console.error(`\n✗ Recruiter directory rejected — ${failures.length} problem(s):`)
  for (const f of failures.slice(0, 40)) console.error(`  · ${f}`)
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`)
  process.exit(1)
}

console.log(summaryLine)
