/**
 * Pin the recruiter crawler's precision rules.
 *
 *   npx tsx scripts/test-recruiter-crawler.mjs
 *
 * No network: URL scoring, email extraction, name extraction and recruiter
 * classification are all decidable from strings, and those are where a false
 * positive is born. A wrong answer here is invisible downstream — it looks
 * exactly like a real recruiter contact.
 *
 * Every case marked OBSERVED came out of a live crawl during development.
 */

import {
  scoreUrl, extractEmails, extractPersonName,
  scoreRecruiterRelevance, deobfuscate,
} from '../lib/contacts/recruiter-crawler.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/* ---- URL prioritisation ---- */
console.log('\n🔗 URL scoring:')

t('a recruiting contact page outranks a blog post',
  scoreUrl('https://x.com/careers/contact') > scoreUrl('https://x.com/blog/2019/01/post'))
t('an asset URL is heavily penalised', scoreUrl('https://x.com/img/logo.png') < -50)
t('a legal page scores below a careers page',
  scoreUrl('https://x.com/legal/privacy') < scoreUrl('https://x.com/careers'))
t('university recruiting scores highly', scoreUrl('https://x.com/university-recruiting') >= 8)

/* ---- Obfuscation ---- */
console.log('\n🔓 Deobfuscation:')
t('[at] / [dot] form', deobfuscate('jobs [at] acme [dot] com').includes('jobs@acme.com'))
t('(at) / (dot) form', deobfuscate('jobs (at) acme (dot) com').includes('jobs@acme.com'))
t('HTML entity @', deobfuscate('jobs&#64;acme.com').includes('jobs@acme.com'))

/* ---- Name extraction: the false-positive surface ---- */
console.log('\n👤 Name extraction (null beats a guess):')

t('a real name is extracted',
  JSON.stringify(extractPersonName('Jane Smith\nSenior Technical Recruiter\n')) ===
  JSON.stringify({ first: 'Jane', last: 'Smith' }))
t('the closest name wins when several appear',
  extractPersonName('Alan Older\nsome text\nBeth Newer\nRecruiter\n')?.first === 'Beth')

// Careers pages are full of capitalised word pairs. Each of these would
// otherwise become a "recruiter" who does not exist, attached to a real
// address.
for (const phrase of [
  'Equal Opportunity', 'Privacy Policy', 'United States', 'San Francisco',
  'Talent Acquisition', 'Human Resources', 'Learn More', 'Apply Now',
  'Contact Us', 'Job Description', 'Full Time', 'All Rights', 'Email Address',
]) {
  t(`"${phrase}" is not read as a person`, extractPersonName(`${phrase} `) === null)
}
t('no capitalised pair yields null', extractPersonName('please write to us at ') === null)

/* ---- Extraction with context ---- */
console.log('\n📧 Contextual extraction:')
{
  const html = `
    <div><h3>Jane Smith</h3><p>Senior Technical Recruiter</p>
    <a href="mailto:jane.smith@acme.com">Email Jane</a></div>
    <footer>For security issues contact <a href="mailto:security@acme.com">security@acme.com</a></footer>`
  const found = extractEmails(html, 'https://acme.com/careers/team')

  const jane = found.find((e) => e.email === 'jane.smith@acme.com')
  t('the recruiter address is extracted', Boolean(jane))
  t('her title is captured', /recruiter/i.test(jane?.personTitle ?? ''))
  t('her first name is captured', jane?.firstName === 'Jane')
  t('her last name is captured', jane?.lastName === 'Smith')
  t('mailto is recorded as the source type', jane?.sourceType === 'mailto')
  t('the security address is also extracted (classification decides, not extraction)',
    found.some((e) => e.email === 'security@acme.com'))
}

/* ---- Classification ---- */
console.log('\n🎯 Recruiter classification:')

const ev = (over = {}) => ({
  email: 'careers@acme.com', sourceUrl: 'https://acme.com/careers',
  sourceType: 'mailto', context: '', ...over,
})

t('careers@ on the company domain is recruiting',
  scoreRecruiterRelevance(ev(), 'acme.com').isRecruiting)
t('a named recruiter with a title is recruiting',
  scoreRecruiterRelevance(ev({
    email: 'jane.smith@acme.com', personName: 'Jane Smith',
    firstName: 'Jane', lastName: 'Smith', personTitle: 'Senior Technical Recruiter',
  }), 'acme.com').isRecruiting)

// Generic mailboxes. OBSERVED on datadoghq.com during the benchmark.
for (const local of ['security', 'press', 'info', 'legal', 'privacy', 'support', 'sales', 'noreply']) {
  const r = scoreRecruiterRelevance(ev({ email: `${local}@acme.com` }), 'acme.com')
  t(`${local}@ is rejected`, !r.isRecruiting)
}

// OBSERVED: accepted as a recruiter before the precision gate existed. It is a
// disability-accommodation contact, not a recruiting mailbox.
{
  const r = scoreRecruiterRelevance(ev({
    email: 'candidate_accessibility@elastic.co',
    sourceUrl: 'https://elastic.co/careers',
    context: 'recruiting team talent acquisition hiring',
  }), 'elastic.co')
  t('candidate_accessibility@ is rejected as candidate support', !r.isRecruiting)
  t('and says why', /candidate support/i.test(r.reasons.join(' ')), r.reasons.join('; '))
}
t('accommodations@ is rejected',
  !scoreRecruiterRelevance(ev({ email: 'accommodations@acme.com' }), 'acme.com').isRecruiting)

// THE precision gate: recruiting words on the page may corroborate, never admit.
{
  const r = scoreRecruiterRelevance(ev({
    email: 'dashinfo@acme.com',
    sourceUrl: 'https://acme.com/careers/talent-acquisition',
    context: 'our recruiting team talent acquisition hiring campus recruiter',
  }), 'acme.com')
  t('page context alone cannot admit an address', !r.isRecruiting, r.reasons.join('; '))
}

// An off-domain address is not the company's.
t('an address on another domain is rejected',
  !scoreRecruiterRelevance(ev({ email: 'careers@someoneelse.com' }), 'acme.com').isRecruiting)

/* ---- Reasons are always present ---- */
console.log('\n📋 Evidence:')
for (const email of ['careers@acme.com', 'security@acme.com', 'candidate_accessibility@acme.com']) {
  const r = scoreRecruiterRelevance(ev({ email }), 'acme.com')
  t(`${email} carries a reason for its verdict`, r.reasons.length > 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
