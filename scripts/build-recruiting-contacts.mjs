/**
 * Build the DB record that powers the "Recruiting Contacts" panel on a company
 * page. This assembles ONLY facts a job seeker can legitimately act on:
 *
 *   1. The official application channel (the ATS board the employer runs).
 *   2. Role-based addresses the employer PUBLISHES itself (careers@, ...),
 *      carried over from data/careers-contacts.json.
 *   3. Domain-level mail posture: does the mail domain accept mail (MX), and
 *      what DMARC/SPF policy does it advertise. Checked at the DOMAIN level.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO (see scripts/find-careers-contacts.mjs):
 *   - It never names an individual recruiter and pairs them with an address.
 *   - It never constructs an address from a person's name.
 *   - It never probes a mailbox (no SMTP RCPT TO). MX proves the DOMAIN takes
 *     mail; it says nothing about which mailboxes exist, and enumerating them
 *     is exactly the mail-server abuse this project refuses to build.
 *
 * Aggregate email PATTERNS (e.g. "firstname.lastname@ -- 68%") and public
 * talent-org leadership names are added at read time from
 * lib/companies/banking-intelligence.ts -- they are patterns and public
 * corporate record, not validated individual addresses.
 *
 *   node scripts/build-recruiting-contacts.mjs
 */

import { promises as dns } from 'dns'
import { readFileSync, writeFileSync, existsSync } from 'fs'

dns.setServers(['1.1.1.1', '8.8.8.8'])

// slug <- domain map, parsed straight out of the registry so it stays in sync.
const registry = readFileSync('lib/companies/registry.ts', 'utf8')
const slugByDomain = new Map()
for (const m of registry.matchAll(
  /slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*domain:\s*'([^']+)'/g
)) {
  slugByDomain.set(m[3].toLowerCase(), { slug: m[1], name: m[2] })
}

const careers = existsSync('data/careers-contacts.json')
  ? JSON.parse(readFileSync('data/careers-contacts.json', 'utf8')).results
  : []
const fingerprint = existsSync('data/company-fingerprint.json')
  ? JSON.parse(readFileSync('data/company-fingerprint.json', 'utf8')).results
  : []

const fpByDomain = new Map(fingerprint.map((f) => [f.domain.toLowerCase(), f]))

/** Domain-level mail posture. No mailbox is ever contacted. */
async function mailPosture(domain) {
  if (!domain) return null
  const mx = await dns.resolveMx(domain).catch(() => null)
  const txt = await dns.resolveTxt(domain).catch(() => [])
  const flat = txt.map((r) => r.join(''))
  const spf = flat.find((t) => /^v=spf1/i.test(t)) ?? null
  const dmarcTxt = await dns
    .resolveTxt(`_dmarc.${domain}`)
    .catch(() => [])
  const dmarc = dmarcTxt.map((r) => r.join('')).find((t) => /^v=DMARC1/i.test(t)) ?? null
  const policy = dmarc?.match(/\bp=([a-z]+)/i)?.[1] ?? null
  return {
    domain,
    hasMx: Boolean(mx?.length),
    mx: (mx ?? [])
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange)
      .slice(0, 3),
    hasSpf: Boolean(spf),
    dmarcPolicy: policy, // reject | quarantine | none | null
  }
}

const out = {}
for (const c of careers) {
  const reg = slugByDomain.get(c.domain.toLowerCase())
  if (!reg) continue // only curated companies get a page
  const fp = fpByDomain.get(c.domain.toLowerCase())
  const mailDomain = fp?.mailDomain ?? c.domain
  const posture = await mailPosture(mailDomain)

  out[reg.slug] = {
    slug: reg.slug,
    name: reg.name,
    domain: c.domain,
    ats: c.ats,
    // Addresses the employer prints on its own careers pages. Role-based only.
    publishedContacts: (c.contacts ?? []).map((x) => ({
      address: x.address,
      kind: x.kind,
      evidence: x.evidence,
      domainHasMx: x.domainHasMx,
    })),
    mailPosture: posture,
    checkedAt: new Date().toISOString(),
  }
  console.log(
    `  ${reg.name.padEnd(24)} mail=${mailDomain.padEnd(22)} mx=${posture?.hasMx ? 'yes' : 'NO '} dmarc=${posture?.dmarcPolicy ?? '-'} published=${out[reg.slug].publishedContacts.length}`
  )
}

writeFileSync(
  'public/data/recruiting-contacts.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      method:
        'Official ATS application channel + employer-published role-based addresses + DOMAIN-level MX/SPF/DMARC. No individual is named or addressed; no mailbox is probed.',
      records: out,
    },
    null,
    2
  )
)
console.log(`\nwrote public/data/recruiting-contacts.json (${Object.keys(out).length} companies)`)
