/**
 * Find the recruiting contact an employer PUBLISHES, and check the domain.
 *
 *   node scripts/find-careers-contacts.mjs
 *   node scripts/find-careers-contacts.mjs --only visa.com,db.com
 *
 * WHAT THIS COLLECTS
 * ------------------
 * Role-based addresses an employer prints on its own careers pages --
 * `careers@`, `recruitment@`, `graduates@`, `accessibility@`. A company puts
 * those there so candidates will use them. They belong to a function, survive
 * staff turnover, and are the correct destination for an application question.
 *
 * WHAT IT REFUSES TO COLLECT, AND WHY
 * -----------------------------------
 * Addresses belonging to identifiable people. Any local part shaped like a
 * name -- `jane.smith`, `jsmith`, `smithj` -- is dropped even when it appears
 * on a public page, and no address is ever CONSTRUCTED from a person's name.
 *
 * The distinction is not squeamishness, it is what the data can support:
 *
 *   1. A pattern like "firstname.lastname@ -- 76%" cannot be verified from any
 *      public record. MX names the mail host; it says nothing about which
 *      mailboxes exist. The only way to test one address is an SMTP RCPT TO
 *      probe against a live server, which is mailbox enumeration.
 *   2. A list of named recruiters with working addresses at twenty banks is a
 *      spearphishing asset whatever it was built for, and most of these
 *      employers are UK/EU/AU, where those people are data subjects.
 *
 * So: MX is checked at the DOMAIN level -- "mail to this domain is
 * deliverable" -- and never per mailbox.
 */

import { promises as dns } from 'dns'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

dns.setServers(['1.1.1.1', '8.8.8.8'])
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

const FP = 'data/company-fingerprint.json'
if (!existsSync(FP)) {
  console.error(`run scripts/fingerprint-companies.mjs first -- ${FP} missing`)
  process.exit(1)
}
const companies = JSON.parse(readFileSync(FP, 'utf8')).results
const ONLY = val('only', '')
const RUN = ONLY ? companies.filter((c) => ONLY.split(',').includes(c.domain)) : companies

/** Local parts that name a FUNCTION. Only these are kept. */
const ROLE_LOCAL = /^(careers?|recruit(ing|ment)?|jobs?|hiring|talent|hr|humanresources|people|campus|graduates?|internships?|apprenticeships?|earlycareers?|resourcing|staffing|applications?|candidate|jobapplications?|accessibility|accommodations?|workplaceadjustments?)([._-][a-z0-9]+)?$/i

/**
 * Local parts shaped like a person. Dropped even when published.
 * Covers first.last, first_last, flast, lastf, and bare given names.
 */
const PERSONAL_LOCAL = /^[a-z]+[._-][a-z]+$|^[a-z]\.?[a-z]{3,}$|^[a-z]{3,}\.?[a-z]$/i

const NOISE = /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|legal|press|media|investor|sales|info|support|help|contact|admin|security|dmarc|dpo|example|your|name|email|user|test)/i

async function get(url, timeoutMs = 25_000) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

/** Pages an employer would print a recruiting contact on. */
const PATHS = ['/careers', '/careers/contact', '/careers/contact-us', '/jobs', '/contact', '/contact-us', '/careers/faq', '/careers/help']

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

async function forCompany(c) {
  const found = new Map()   // address -> Set(source urls)
  const rejectedPersonal = new Set()

  const hosts = [`https://www.${c.domain}`, `https://${c.domain}`]
  const tried = []
  for (const base of hosts) {
    for (const p of PATHS) {
      const url = base + p
      const html = await get(url)
      if (!html) continue
      tried.push(url)
      for (const raw of html.match(EMAIL_RE) ?? []) {
        const addr = raw.toLowerCase()
        const [local, domain] = addr.split('@')
        if (!local || !domain) continue
        // Only addresses on the company's own domain or a subdomain of it.
        if (!(domain === c.domain || domain.endsWith('.' + c.domain))) continue
        if (NOISE.test(local)) continue
        if (PERSONAL_LOCAL.test(local) && !ROLE_LOCAL.test(local)) { rejectedPersonal.add(domain); continue }
        if (!ROLE_LOCAL.test(local)) continue
        if (!found.has(addr)) found.set(addr, new Set())
        found.get(addr).add(url)
      }
      if (found.size >= 6) break
    }
    if (found.size) break
  }

  // Domain-level deliverability only. Never per mailbox.
  const byDomain = new Map()
  for (const addr of found.keys()) {
    const d = addr.split('@')[1]
    if (!byDomain.has(d)) {
      const mx = await dns.resolveMx(d).catch(() => null)
      byDomain.set(d, {
        hasMx: Boolean(mx?.length),
        mx: (mx ?? []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange).slice(0, 2),
      })
    }
  }

  return {
    company: c.name,
    domain: c.domain,
    ats: c.ats,
    pagesRead: tried.length,
    contacts: [...found].map(([address, srcs]) => ({
      address,
      kind: 'role-based',
      evidence: [...srcs][0],
      domainHasMx: byDomain.get(address.split('@')[1])?.hasMx ?? null,
      mx: byDomain.get(address.split('@')[1])?.mx ?? [],
      mailboxVerified: null, // never tested: that requires SMTP probing
    })),
    personalAddressesSeenAndDropped: rejectedPersonal.size > 0,
  }
}

const out = []
for (const c of RUN) {
  const r = await forCompany(c)
  out.push(r)
  console.log(
    `  ${r.company.padEnd(22)} pages=${String(r.pagesRead).padStart(2)}  contacts=${r.contacts.length}` +
    (r.contacts.length ? `  ${r.contacts.map((x) => x.address).slice(0, 3).join(', ')}` : '')
  )
}

writeFileSync('data/careers-contacts.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: 'role-based addresses published on the employer\'s own careers/contact pages; MX checked at domain level only',
  notCollected: [
    'addresses belonging to identifiable individuals',
    'addresses constructed from a person\'s name',
    'per-mailbox existence (would require SMTP RCPT TO probing)',
  ],
  results: out,
}, null, 2))

const withContacts = out.filter((r) => r.contacts.length)
console.log('')
console.log(`companies with a published role-based contact: ${withContacts.length}/${out.length}`)
console.log('wrote data/careers-contacts.json')
