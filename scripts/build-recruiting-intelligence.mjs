/**
 * Build the recruiter-intelligence dataset.
 *
 *   node scripts/build-recruiting-intelligence.mjs
 *
 * Pipeline (spec section 16):
 *   1. load companies (registry) + ATS/application data (recruiting-contacts)
 *   2. reconcile recruiter records from the permitted public-source evidence
 *      store in data/recruiter-evidence/*.json
 *   3. deduplicate
 *   4. validate source consistency (reject malformed / evidence-less records)
 *   5. preserve source URLs
 *   6. classify confidence (deterministic)
 *   7. identify publicly published emails (never guessed)
 *   8. domain-level DNS posture checks (MX/SPF/DMARC) -- DOMAIN level only
 *   9. write normalized JSON -> public/data/recruiting-intelligence.json
 *  10. output a validation summary (numbers computed from the real run)
 *
 * Evidence is captured from public sources only: employer/team pages, public
 * professional-profile search results, conference/press pages, public
 * documents. No email is ever synthesised from a name, and no mailbox is
 * probed -- MX proves the DOMAIN takes mail, nothing about an individual.
 */

import { promises as dns } from 'dns'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import {
  finalizeRecord, deduplicateRecruiters, validateRecord, discoveryQueries,
} from '../lib/companies/recruiter-intel-core.mjs'

dns.setServers(['1.1.1.1', '8.8.8.8'])

/* slug -> {name, domain}, parsed from the registry so it can't drift. */
const registry = readFileSync('lib/companies/registry.ts', 'utf8')
const bySlug = new Map()
for (const m of registry.matchAll(/slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*domain:\s*'([^']+)'/g)) {
  bySlug.set(m[1], { slug: m[1], name: m[2], domain: m[3] })
}

const fingerprint = existsSync('data/company-fingerprint.json')
  ? JSON.parse(readFileSync('data/company-fingerprint.json', 'utf8')).results
  : []
const fpByDomain = new Map(fingerprint.map((f) => [f.domain.toLowerCase(), f]))

async function mailPosture(domain) {
  if (!domain) return null
  const mx = await dns.resolveMx(domain).catch(() => null)
  const txt = await dns.resolveTxt(domain).catch(() => [])
  const spf = txt.map((r) => r.join('')).some((t) => /^v=spf1/i.test(t))
  const dmarcTxt = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => [])
  const dmarc = dmarcTxt.map((r) => r.join('')).find((t) => /^v=DMARC1/i.test(t)) ?? null
  return {
    domain,
    hasMx: Boolean(mx?.length),
    hasSpf: spf,
    dmarcPolicy: dmarc?.match(/\bp=([a-z]+)/i)?.[1] ?? null,
  }
}

const EVID_DIR = 'data/recruiter-evidence'
const files = existsSync(EVID_DIR) ? readdirSync(EVID_DIR).filter((f) => f.endsWith('.json')) : []
const nowIso = new Date().toISOString()

const records = {}
const summary = {
  companies: 0, discovered: 0, confirmed: 0, corroborated: 0, uncertain: 0,
  publicDirectEmails: 0, companyRoleEmails: 0, noPublicEmail: 0,
  domainsChecked: 0, mxPresent: 0, spfPresent: 0, dmarcPresent: 0,
  duplicatesRemoved: 0, recordsRejected: 0,
}
const hardErrors = []

console.log('\nRecruiting Intelligence Build\n')

for (const file of files) {
  const raw = JSON.parse(readFileSync(`${EVID_DIR}/${file}`, 'utf8'))
  const company = bySlug.get(raw.companySlug)
  if (!company) {
    console.log(`  ! skip ${file}: slug '${raw.companySlug}' not in registry`)
    continue
  }
  summary.companies++

  // 2+6+7: finalize (score, classify) every raw evidence record.
  const finalized = (raw.records || []).map((r) => finalizeRecord(r, company, nowIso))

  // 3: deduplicate.
  const { records: deduped, merged } = deduplicateRecruiters(finalized)
  summary.duplicatesRemoved += merged

  // 4: validate; drop malformed, hard-fail on an evidence-less "confirmed".
  const kept = []
  for (const rec of deduped) {
    const { ok, errors } = validateRecord(rec)
    if (!ok) {
      summary.recordsRejected++
      if (errors.includes('confirmed record has no evidence') ||
          errors.includes('high confidence without confirmed identity') ||
          errors.includes('published email has no source')) {
        hardErrors.push(`${company.slug}/${rec.fullName}: ${errors.join('; ')}`)
      } else {
        console.log(`    reject ${company.slug}/${rec.fullName}: ${errors.join('; ')}`)
      }
      continue
    }
    kept.push(rec)
  }

  // tallies
  for (const r of kept) {
    summary.discovered++
    summary[r.identityStatus]++
    if (r.emailStatus === 'published') summary.publicDirectEmails++
    else if (r.emailStatus === 'company_published') summary.companyRoleEmails++
    else summary.noPublicEmail++
  }

  // 8: domain-level DNS posture.
  const fp = fpByDomain.get(company.domain.toLowerCase())
  const posture = await mailPosture(fp?.mailDomain ?? company.domain)
  summary.domainsChecked++
  if (posture?.hasMx) summary.mxPresent++
  if (posture?.hasSpf) summary.spfPresent++
  if (posture?.dmarcPolicy) summary.dmarcPresent++

  records[company.slug] = {
    slug: company.slug,
    name: company.name,
    recruiters: kept.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 }
      return rank[a.confidence] - rank[b.confidence] || a.fullName.localeCompare(b.fullName)
    }),
    metadata: {
      generatedAt: nowIso,
      companySlug: company.slug,
      discoveredCount: kept.length,
      confirmed: kept.filter((r) => r.identityStatus === 'confirmed').length,
      corroborated: kept.filter((r) => r.identityStatus === 'corroborated').length,
      uncertain: kept.filter((r) => r.identityStatus === 'uncertain').length,
      publicDirectEmails: kept.filter((r) => r.emailStatus === 'published').length,
      duplicatesRemoved: merged,
      recordsRejected: deduped.length - kept.length,
      discoveryQueries: discoveryQueries(company.name, company.domain),
      sources: [...new Set(kept.flatMap((r) => r.sourceUrls))],
    },
  }
  console.log(`  ${company.name.padEnd(22)} kept=${String(kept.length).padStart(2)}  confirmed=${records[company.slug].metadata.confirmed} corrob=${records[company.slug].metadata.corroborated} uncertain=${records[company.slug].metadata.uncertain}  dedup-merged=${merged}`)
}

if (hardErrors.length) {
  console.error('\nBUILD FAILED -- integrity violations (a verified record with no backing):')
  for (const e of hardErrors) console.error(`  x ${e}`)
  process.exit(1)
}

writeFileSync(
  'public/data/recruiting-intelligence.json',
  JSON.stringify({ generatedAt: nowIso, method: 'Public-source recruiter identities; deterministic confidence; domain-level DNS only; no guessed emails; no mailbox probing.', records, summary }, null, 2)
)

console.log(`
Companies: ${summary.companies}
Recruiter records discovered: ${summary.discovered}
Confirmed: ${summary.confirmed}
Corroborated: ${summary.corroborated}
Uncertain: ${summary.uncertain}

Public direct emails: ${summary.publicDirectEmails}
Company role emails: ${summary.companyRoleEmails}
No public email: ${summary.noPublicEmail}

Domains checked: ${summary.domainsChecked}
MX present: ${summary.mxPresent}
SPF present: ${summary.spfPresent}
DMARC present: ${summary.dmarcPresent}

Duplicates removed: ${summary.duplicatesRemoved}
Records rejected: ${summary.recordsRejected}

wrote public/data/recruiting-intelligence.json`)
