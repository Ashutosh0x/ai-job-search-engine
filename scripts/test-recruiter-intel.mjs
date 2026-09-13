/**
 * Assertions for the recruiter-intelligence layer.
 *
 *   npx tsx scripts/test-recruiter-intel.mjs
 *
 * Covers the invariants the spec calls out: identity/dedup, email handling
 * (published accepted, guessed rejected, MX never upgrades confidence, role
 * email classified separately), source/evidence rules, and that the generated
 * dataset is well-formed.
 */
import {
  normalizeName, isFullName, canonicalLinkedin, classifyPersonEmail,
  scoreIdentity, independentSourceCount, validateRecord, deduplicateRecruiters,
  finalizeRecord, isRecruitingTitle, roleFamily,
} from '../lib/companies/recruiter-intel-core.mjs'
import { readFileSync, existsSync } from 'fs'

let pass = 0, fail = 0
const t = (n, c, g) => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (g !== undefined ? '  got: ' + JSON.stringify(g) : '')) } }

const co = { slug: 'example-bank', name: 'Example Bank', domain: 'example.com' }
const NOW = '2026-09-12T00:00:00.000Z'

console.log('\nidentity / normalisation')
t('normalizeName strips diacritics/punct', normalizeName('José  Peña-García!') === 'jose pena garcia', normalizeName('José  Peña-García!'))
t('isFullName rejects truncated surname', isFullName('Sandra S.') === false)
t('isFullName accepts real full name', isFullName('Jane Doe') === true)
t('canonicalLinkedin normalises url', canonicalLinkedin('https://www.LinkedIn.com/in/Jane-Doe-123/?trk=x') === 'linkedin.com/in/jane-doe-123')
t('canonicalLinkedin rejects non-profile', canonicalLinkedin('https://example.com/in/x') === null)
t('isRecruitingTitle true for Technical Recruiter', isRecruitingTitle('Technical Recruiter') === true)
t('isRecruitingTitle false for Software Engineer', isRecruitingTitle('Software Engineer') === false)
t('roleFamily technology', roleFamily('Senior Technical Recruiter') === 'technology', roleFamily('Senior Technical Recruiter'))
t('roleFamily campus', roleFamily('University Recruiter') === 'campus', roleFamily('University Recruiter'))

console.log('\nconfidence engine')
t('confirmed needs 2 independent sources', scoreIdentity({ companyConfirmed: true, roleConfirmed: true, fullName: true, independentSources: 2 }).identityStatus === 'confirmed')
t('one source => corroborated/medium', JSON.stringify(scoreIdentity({ companyConfirmed: true, roleConfirmed: true, fullName: true, independentSources: 1 })) === JSON.stringify({ identityStatus: 'corroborated', confidence: 'medium' }))
t('no role => uncertain/low', scoreIdentity({ companyConfirmed: true, roleConfirmed: false, fullName: true, independentSources: 3 }).confidence === 'low')
t('truncated name never confirmed', scoreIdentity({ companyConfirmed: true, roleConfirmed: true, fullName: false, independentSources: 5 }).identityStatus === 'uncertain')
t('independentSourceCount counts hosts not urls', independentSourceCount(['https://x.com/a', 'https://x.com/b', 'https://y.com/c']) === 2, independentSourceCount(['https://x.com/a', 'https://x.com/b', 'https://y.com/c']))

console.log('\nMX does NOT upgrade confidence')
{
  // Two records identical except one "has MX" info attached; confidence must be equal.
  const base = { companyConfirmed: true, roleConfirmed: true, fullName: true, independentSources: 1 }
  const a = scoreIdentity(base)
  const b = scoreIdentity({ ...base, mxPresent: true, hasMx: true, dmarc: 'reject' }) // extra fields ignored
  t('mx/spf/dmarc fields ignored by scorer', JSON.stringify(a) === JSON.stringify(b))
}

console.log('\nemail handling')
t('published accepted when sourced', classifyPersonEmail('jane@example.com', true) === 'published')
t('guessed (no source) rejected -> not_found', classifyPersonEmail('jane.doe@example.com', false) === 'not_found')
t('role email classified separately', classifyPersonEmail('careers@example.com', true) === 'company_published')
t('malformed email -> not_found', classifyPersonEmail('not-an-email', true) === 'not_found')
{
  // finalizeRecord must never surface a guessed address as the record email.
  const r = finalizeRecord({ fullName: 'Jane Doe', currentTitle: 'Recruiter', email: 'jane.doe@example.com', sourceUrls: ['https://theorg.com/x'] }, co, NOW)
  t('finalize drops guessed email', r.email === undefined && r.emailStatus === 'not_found', { email: r.email, status: r.emailStatus })
}
{
  const r = finalizeRecord({ fullName: 'Jane Doe', currentTitle: 'Recruiter', email: 'jane@example.com', emailSourceUrl: 'https://conf.example/bio', sourceUrls: ['https://conf.example/bio'] }, co, NOW)
  t('finalize keeps published email w/ source', r.email === 'jane@example.com' && r.emailStatus === 'published', { email: r.email, status: r.emailStatus })
}

console.log('\nsource / evidence validation')
t('record without source URLs is invalid', validateRecord({ fullName: 'Jane Doe', companySlug: 'x', sourceUrls: [], evidence: [], identityStatus: 'corroborated', confidence: 'medium' }).ok === false)
t('confirmed without evidence is invalid', validateRecord({ fullName: 'Jane Doe', companySlug: 'x', sourceUrls: ['https://x.com/a'], evidence: [], identityStatus: 'confirmed', confidence: 'high' }).ok === false)
t('broken source URL flagged', validateRecord({ fullName: 'Jane Doe', companySlug: 'x', sourceUrls: ['not a url'], evidence: ['e'], identityStatus: 'corroborated', confidence: 'medium' }).errors.some((e) => /malformed URL/.test(e)))
t('valid corroborated record passes', validateRecord({ fullName: 'Jane Doe', companySlug: 'x', sourceUrls: ['https://x.com/a'], evidence: ['seen on x'], identityStatus: 'corroborated', confidence: 'medium' }).ok === true)

console.log('\ndeduplication')
{
  const recs = [
    { fullName: 'Jane Doe', companySlug: 'x', currentTitle: 'Recruiter', linkedinUrl: 'https://linkedin.com/in/jane-doe', sourceUrls: ['https://a.com/1'], evidence: ['a'] },
    { fullName: 'Jane Doe', companySlug: 'x', currentTitle: 'Senior Recruiter', linkedinUrl: 'https://www.linkedin.com/in/jane-doe/', sourceUrls: ['https://b.com/2'], evidence: ['b'] },
  ]
  const { records, merged } = deduplicateRecruiters(recs)
  t('same recruiter (same LinkedIn) merges', records.length === 1 && merged === 1, { len: records.length, merged })
  t('merge unions sources', records[0].sourceUrls.length === 2, records[0]?.sourceUrls)
}
{
  const recs = [
    { fullName: 'Jane Doe', companySlug: 'x', currentTitle: 'Recruiter', sourceUrls: ['https://a.com/1'], evidence: ['a'] },
    { fullName: 'Jane Doe', companySlug: 'x', currentTitle: 'Campus Recruiter', sourceUrls: ['https://b.com/2'], evidence: ['b'] },
  ]
  const { records } = deduplicateRecruiters(recs)
  t('same name, different title, no LinkedIn => kept separate', records.length === 2, records.length)
}

console.log('\ngenerated dataset (if present)')
if (existsSync('public/data/recruiting-intelligence.json')) {
  const data = JSON.parse(readFileSync('public/data/recruiting-intelligence.json', 'utf8'))
  const all = Object.values(data.records).flatMap((r) => r.recruiters)
  t('dataset non-empty', all.length > 0, all.length)
  t('every record has >=1 source URL', all.every((r) => r.sourceUrls.length >= 1))
  t('no record labelled high without confirmed identity', all.every((r) => r.confidence !== 'high' || r.identityStatus === 'confirmed'))
  t('no guessed personal email present', all.every((r) => !r.email || r.emailStatus === 'published'))
  t('every recruiter has evidence text', all.every((r) => (r.evidence || []).length >= 1))
} else {
  console.log('  (skip: run scripts/build-recruiting-intelligence.mjs first)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
