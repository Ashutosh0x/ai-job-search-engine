/**
 * Data-quality report for the recruiter-intelligence dataset.
 *
 *   node scripts/recruiting-intel-quality.mjs
 *
 * Reports (spec section 19):
 *   - recruiters without sources
 *   - recruiters without company/role confirmation (uncertain)
 *   - duplicate identities
 *   - stale records
 *   - malformed URLs
 *   - malformed public emails
 *   - email records without evidence
 *   - companies with zero recruiter records
 *   - companies with zero published recruiting contacts
 *
 * FAILS (exit 1) if a supposedly verified record (confirmed identity, or a
 * "published" email) has no evidence -- the one invariant we will not ship.
 */
import { readFileSync, existsSync } from 'fs'
import { canonicalLinkedin, isValidUrl, isValidEmail, validateRecord } from '../lib/companies/recruiter-intel-core.mjs'

const INTEL = 'public/data/recruiting-intelligence.json'
const CONTACTS = 'public/data/recruiting-contacts.json'
const STALE_DAYS = 180

if (!existsSync(INTEL)) {
  console.error(`${INTEL} missing -- run: node scripts/build-recruiting-intelligence.mjs`)
  process.exit(1)
}
const intel = JSON.parse(readFileSync(INTEL, 'utf8'))
const contacts = existsSync(CONTACTS) ? JSON.parse(readFileSync(CONTACTS, 'utf8')).records : {}

const report = {
  noSources: [], uncertain: [], duplicates: [], stale: [],
  malformedUrls: [], malformedEmails: [], emailNoEvidence: [],
  companiesNoRecruiters: [], companiesNoPublishedContacts: [],
}
const hard = []
const now = Date.now()

for (const [slug, rec] of Object.entries(intel.records)) {
  const recruiters = rec.recruiters || []
  if (recruiters.length === 0) report.companiesNoRecruiters.push(slug)

  const pub = contacts[slug]?.publishedContacts ?? []
  if (pub.length === 0) report.companiesNoPublishedContacts.push(slug)

  const seen = new Map()
  for (const r of recruiters) {
    const who = `${slug}/${r.fullName}`
    if ((r.sourceUrls || []).length === 0) report.noSources.push(who)
    if (r.identityStatus === 'uncertain') report.uncertain.push(who)

    // duplicate detection (post-hoc): canonical linkedin OR name+company+title
    const key = canonicalLinkedin(r.linkedinUrl) || `${r.fullName.toLowerCase()}|${slug}|${(r.currentTitle || '').toLowerCase()}`
    if (seen.has(key)) report.duplicates.push(`${who} == ${seen.get(key)}`)
    else seen.set(key, who)

    if (r.lastVerifiedAt && now - new Date(r.lastVerifiedAt).getTime() > STALE_DAYS * 86400000) {
      report.stale.push(`${who} (${r.lastVerifiedAt})`)
    }
    for (const u of [...(r.sourceUrls || []), r.linkedinUrl, r.officialCompanyProfileUrl].filter(Boolean)) {
      if (!isValidUrl(u)) report.malformedUrls.push(`${who}: ${u}`)
    }
    if (r.email && !isValidEmail(r.email)) report.malformedEmails.push(`${who}: ${r.email}`)
    if (r.emailStatus === 'published' && (r.evidence || []).length === 0) report.emailNoEvidence.push(who)

    // hard invariant
    const { ok, errors } = validateRecord({ ...r, companySlug: slug })
    if (!ok && (errors.includes('confirmed record has no evidence') || errors.includes('published email has no source') || errors.includes('high confidence without confirmed identity'))) {
      hard.push(`${who}: ${errors.join('; ')}`)
    }
  }
}

const line = (label, arr) => console.log(`  ${label.padEnd(38)} ${arr.length}${arr.length ? '  ' + arr.slice(0, 5).join(', ') + (arr.length > 5 ? ' ...' : '') : ''}`)

console.log('\nRecruiting Intelligence -- Data Quality Report\n')
line('recruiters without sources', report.noSources)
line('uncertain (no company/role corrob.)', report.uncertain)
line('duplicate identities', report.duplicates)
line('stale records (>' + STALE_DAYS + 'd)', report.stale)
line('malformed URLs', report.malformedUrls)
line('malformed public emails', report.malformedEmails)
line('published emails without evidence', report.emailNoEvidence)
line('companies with 0 recruiter records', report.companiesNoRecruiters)
line('companies with 0 published contacts', report.companiesNoPublishedContacts)

if (hard.length) {
  console.error('\nQUALITY GATE FAILED -- verified records with no backing:')
  for (const h of hard) console.error(`  x ${h}`)
  process.exit(1)
}
console.log('\nQuality gate passed: every confirmed identity and published email has evidence.')
