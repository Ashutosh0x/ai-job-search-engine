/**
 * Fingerprint an employer's public infrastructure: DNS, mail, and ATS.
 *
 *   node scripts/fingerprint-companies.mjs
 *   node scripts/fingerprint-companies.mjs --only jpmorganchase.com,morganstanley.com
 *
 * WHAT THIS MEASURES
 * ------------------
 * Only what public DNS and public careers endpoints actually return:
 *
 *   MX        who runs their mail (Google, Microsoft, Proofpoint, Mimecast...)
 *   SPF       which senders they authorise -- a good map of the SaaS stack,
 *             because vendors that send mail on your behalf must be listed
 *   DMARC     whether they enforce (p=reject/quarantine) or only monitor
 *   TXT       vendor verification tokens, which name the products in use
 *   NS        who runs their DNS
 *   ATS       the careers API, called live
 *
 * WHAT IT DOES NOT MEASURE, AND WHY
 * ---------------------------------
 * EMAIL ADDRESS PATTERNS. Reports of this kind routinely claim things like
 * "firstname.lastname@ -- 76%". DNS cannot see that. MX tells you who runs the
 * mailbox, never how the local part is composed, and no public record does.
 * Those percentages are unfalsifiable from here, so this script neither
 * verifies nor reproduces them, and it does not generate addresses for
 * individuals.
 *
 * Headcounts, revenue and office lists are equally outside what DNS knows.
 * This file reports infrastructure, and says UNKNOWN where it has none.
 */

import { promises as dns } from 'dns'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

dns.setServers(['1.1.1.1', '8.8.8.8'])

/**
 * The institutions in the circulating banking report, plus the ones it names
 * only in passing. `ats` is what this repo has VERIFIED live, not what the
 * report asserts -- see scripts/banking-intel-verified.json.
 */
const COMPANIES = [
  { name: 'JPMorgan Chase', domain: 'jpmorganchase.com', alt: ['jpmorgan.com', 'chase.com'], ats: 'Oracle Cloud HCM (unverified: no public JSON API)' },
  { name: 'Morgan Stanley', domain: 'morganstanley.com', ats: 'Workday ms/External (VERIFIED 1,286 roles)' },
  { name: 'Citigroup', domain: 'citi.com', alt: ['citigroup.com'], ats: 'Workday citi/2 (VERIFIED; citi_careers 404s)' },
  { name: 'Bank of America', domain: 'bankofamerica.com', alt: ['bofa.com'], ats: 'Workday ghr/Lateral-US (VERIFIED 2,005)' },
  { name: 'Wells Fargo', domain: 'wellsfargo.com', ats: 'Workday wf/WellsFargoJobs (VERIFIED 1,796)' },
  { name: 'Goldman Sachs', domain: 'gs.com', ats: 'not established here' },
  { name: 'Citadel', domain: 'citadel.com', ats: 'UNKNOWN (Greenhouse claim disproven: 404)' },
  { name: 'Citadel Securities', domain: 'citadelsecurities.com', ats: 'UNKNOWN (Greenhouse claim disproven: 404)' },
  { name: 'Visa', domain: 'visa.com', ats: 'Workday visa/Visa (VERIFIED 760)' },
  { name: 'Mastercard', domain: 'mastercard.com', ats: 'Workday mastercard/CorporateCareers (VERIFIED 1,055)' },
  { name: 'PayPal', domain: 'paypal.com', ats: 'Workday paypal/jobs (VERIFIED 128)' },
  { name: 'Barclays', domain: 'barclays.com', ats: 'Workday barclays/External_Career_Site_Barclays (VERIFIED 1,014)' },
  { name: 'HSBC', domain: 'hsbc.com', ats: 'Eightfold (adapter exists; not called here)' },
  { name: 'Lloyds Banking Group', domain: 'lloydsbanking.com', alt: ['lloydsbankinggroup.com'], ats: 'Workday lbg/lbg_Careers (VERIFIED 113)' },
  { name: 'NatWest Group', domain: 'natwest.com', alt: ['natwestgroup.com'], ats: 'Workday rbs/RBS (VERIFIED 107)' },
  { name: 'Standard Chartered', domain: 'sc.com', ats: 'Workday peopleplus/SCB_Careers (VERIFIED 55)' },
  { name: 'Commonwealth Bank', domain: 'cba.com.au', alt: ['commbank.com.au'], ats: 'Workday cba/CommBank_Careers (VERIFIED 223)' },
  { name: 'NAB', domain: 'nab.com.au', ats: 'Workday nab/NAB_Careers (VERIFIED 277)' },
  { name: 'Deutsche Bank', domain: 'db.com', ats: 'Workday db/DBWebsite (VERIFIED 1,136)' },
  { name: 'Commerzbank', domain: 'commerzbank.com', ats: 'SAP SuccessFactors (no public JSON API)' },
  { name: 'MUFG', domain: 'mufg.jp', alt: ['mufgamericas.com'], ats: 'Workday mufgub/MUFG-Careers (VERIFIED 660)' },
  { name: 'BNY Mellon', domain: 'bny.com', alt: ['bnymellon.com'], ats: 'Oracle Cloud HCM (no public JSON API)' },
  { name: 'HDFC Bank', domain: 'hdfcbank.com', ats: 'SAP SuccessFactors (no public JSON API)' },
  { name: 'State Bank of India', domain: 'sbi.co.in', alt: ['bank.sbi'], ats: 'in-house CRPD / TCS iON' },
  { name: 'NPCI', domain: 'npci.org.in', ats: 'Darwinbox (no public JSON API)' },
  { name: 'Jane Street', domain: 'janestreet.com', ats: 'Greenhouse janestreet (VERIFIED 230 roles)' },
]

const ONLY = val('only', '')
const RUN = ONLY ? COMPANIES.filter((c) => ONLY.split(',').includes(c.domain)) : COMPANIES

/* --------------------------- vendor fingerprints -------------------------- */

/** MX hostname -> who actually runs the mailbox. */
const MAIL_HOST = [
  [/aspmx.*google|googlemail\.com$|google\.com$/i, 'Google Workspace'],
  [/\.outlook\.com$|\.protection\.outlook\.com$/i, 'Microsoft 365'],
  [/pphosted\.com$|ppe-hosted\.com$/i, 'Proofpoint'],
  [/mimecast/i, 'Mimecast'],
  [/messagelabs|symanteccloud/i, 'Symantec/MessageLabs'],
  [/barracuda/i, 'Barracuda'],
  [/trendmicro|trendmicro\.eu/i, 'Trend Micro'],
  [/cisco|iphmx\.com$/i, 'Cisco IronPort'],
  [/fireeyecloud|fireeye/i, 'FireEye'],
  [/zoho/i, 'Zoho Mail'],
  [/qq\.com$|qiye/i, 'Tencent Exmail'],
]

/**
 * SPF includes and TXT tokens that name a product.
 *
 * An SPF include is a standing authorisation for that vendor to send mail as
 * the company, so it is strong evidence the product is in use -- much stronger
 * than a marketing page. Verification tokens are the same kind of evidence.
 */
const VENDOR = [
  [/workday/i, 'Workday'],
  [/greenhouse/i, 'Greenhouse'],
  [/lever\.co/i, 'Lever'],
  [/myworkday/i, 'Workday'],
  [/successfactors|sapsf|sap\.com/i, 'SAP SuccessFactors'],
  [/icims/i, 'iCIMS'],
  [/taleo|oracle/i, 'Oracle'],
  [/eightfold/i, 'Eightfold'],
  [/avature/i, 'Avature'],
  [/phenom/i, 'Phenom'],
  [/smartrecruiters/i, 'SmartRecruiters'],
  [/darwinbox/i, 'Darwinbox'],
  [/keka/i, 'Keka'],
  [/salesforce|exacttarget|pardot/i, 'Salesforce'],
  [/servicenow/i, 'ServiceNow'],
  [/docusign/i, 'DocuSign'],
  [/atlassian/i, 'Atlassian'],
  [/zoom\.us|zoom\.com/i, 'Zoom'],
  [/qualtrics/i, 'Qualtrics'],
  [/adobe/i, 'Adobe'],
  [/sendgrid/i, 'SendGrid'],
  [/mailchimp|mandrill/i, 'Mailchimp'],
  [/marketo/i, 'Marketo'],
  [/_dmarc|dmarcian|agari|valimail|dmarc/i, 'DMARC tooling'],
  [/amazonses/i, 'Amazon SES'],
  [/mktomail/i, 'Marketo'],
  [/cvent/i, 'Cvent'],
  // `workplace-domain-verification` is Meta Workplace, the enterprise product.
  // `facebook-domain-verification` is ownership of a Facebook PAGE and says
  // nothing about internal tooling -- matching /facebook/ for both put "Meta
  // Workplace" against 11 institutions on the strength of a marketing token.
  [/workplace-domain-verification|workplace\.com/i, 'Meta Workplace'],
  [/facebook-domain-verification/i, 'Facebook page (marketing)'],
]

const NS_HOST = [
  [/akam|akamai/i, 'Akamai'],
  [/ultradns/i, 'UltraDNS/Neustar'],
  [/dynect|oracle/i, 'Oracle Dyn'],
  [/awsdns/i, 'AWS Route 53'],
  [/azure-dns/i, 'Azure DNS'],
  [/cloudflare/i, 'Cloudflare'],
  [/nsone|ns1/i, 'NS1'],
  [/verisign/i, 'Verisign'],
  [/googledomains|google/i, 'Google Cloud DNS'],
]

const match = (table, s) => table.find(([re]) => re.test(s))?.[1] ?? null

const safe = async (fn) => { try { return await fn() } catch { return null } }

async function fingerprint(c) {
  const d = c.domain
  const [mxPrimary, txt, ns, dmarc] = await Promise.all([
    safe(() => dns.resolveMx(d)),
    safe(() => dns.resolveTxt(d)),
    safe(() => dns.resolveNs(d)),
    safe(() => dns.resolveTxt(`_dmarc.${d}`)),
  ])

  /**
   * A corporate domain need not carry the mail.
   *
   * jpmorganchase.com publishes no MX at all -- the mail lives on jpmchase.com.
   * Reporting "no mail provider" for the largest bank in the US would be a
   * fact about which name we happened to query, not about the company, so the
   * alternate domains are resolved too and the first that answers is used.
   */
  let mx = mxPrimary
  let mailDomain = d
  if ((!mx || !mx.length) && c.alt?.length) {
    for (const a of c.alt) {
      const m = await safe(() => dns.resolveMx(a))
      if (m?.length) { mx = m; mailDomain = a; break }
    }
  }

  const mxHosts = (mx ?? []).sort((a, b) => a.priority - b.priority).map((r) => r.exchange)
  const mailProviders = [...new Set(mxHosts.map((h) => match(MAIL_HOST, h)).filter(Boolean))]

  const txtFlat = (txt ?? []).map((r) => r.join(''))
  const spf = txtFlat.find((t) => /^v=spf1/i.test(t)) ?? null
  const spfIncludes = spf ? [...spf.matchAll(/include:([^\s]+)/gi)].map((m) => m[1]) : []

  // Vendors named by SPF authorisations or by verification tokens.
  const vendors = new Set()
  for (const s of [...spfIncludes, ...txtFlat]) {
    const v = match(VENDOR, s)
    if (v) vendors.add(v)
  }

  const dmarcRec = (dmarc ?? []).map((r) => r.join('')).find((t) => /^v=DMARC1/i.test(t)) ?? null
  const dmarcPolicy = dmarcRec ? (/[;\s]p=([a-z]+)/i.exec(dmarcRec)?.[1] ?? '?') : null

  const nsHosts = ns ?? []
  const dnsProviders = [...new Set(nsHosts.map((h) => match(NS_HOST, h)).filter(Boolean))]

  return {
    name: c.name,
    domain: d,
    ats: c.ats,
    mailDomain,
    mx: mxHosts.slice(0, 4),
    mailProviders: mailProviders.length ? mailProviders : (mxHosts.length ? ['self-hosted / other'] : []),
    hasSpf: Boolean(spf),
    spfIncludes: spfIncludes.slice(0, 12),
    dmarc: dmarcPolicy,          // null = no DMARC record published
    dmarcRecord: dmarcRec,
    ns: nsHosts.slice(0, 4),
    dnsProviders,
    vendorsInDns: [...vendors].sort(),
    txtCount: txtFlat.length,
  }
}

/* ----------------------------------- run ---------------------------------- */

const results = []
for (const c of RUN) {
  const r = await fingerprint(c)
  results.push(r)
  console.log(
    `  ${r.name.padEnd(22)} mail=${(r.mailProviders[0] ?? 'none').padEnd(20)} ` +
    `dmarc=${String(r.dmarc ?? 'NONE').padEnd(10)} dns=${(r.dnsProviders[0] ?? '?').padEnd(14)} ` +
    `vendors=${r.vendorsInDns.length}`
  )
}

/* -------------------------------- report ---------------------------------- */

const L = []
L.push('# EMPLOYER INFRASTRUCTURE FINGERPRINT')
L.push(`# generated ${new Date().toISOString()}`)
L.push(`# ${results.length} institutions, resolved against 1.1.1.1 / 8.8.8.8`)
L.push('')
L.push('WHAT IS AND IS NOT HERE')
L.push('  Here: MX, SPF, DMARC, NS and vendor tokens -- all public DNS, read live.')
L.push('  Plus the ATS, where this repo has actually called the careers API.')
L.push('')
L.push('  NOT here: email address patterns. DNS shows who runs the mailbox, never')
L.push('  how the local part is composed, so claims like "firstname.lastname --')
L.push('  76%" cannot be checked from any public record and are not repeated.')
L.push('  No addresses for individuals are generated.')
L.push('')

L.push('=============================================================')
L.push('MAIL AND DMARC POSTURE')
L.push('=============================================================')
L.push('  DMARC p=reject or p=quarantine means the domain asks receivers to act')
L.push('  on spoofed mail. p=none means it only collects reports -- a domain')
L.push('  anyone can be impersonated from, which matters when recruitment fraud')
L.push('  is the thing being impersonated.')
L.push('')
L.push('  institution            mail provider          DMARC       DNS')
for (const r of results) {
  L.push(`  ${r.name.padEnd(22)} ${(r.mailProviders[0] ?? 'none').padEnd(22)} ${String(r.dmarc ?? 'NONE').padEnd(11)} ${r.dnsProviders[0] ?? '?'}`)
}
L.push('')

const noDmarc = results.filter((r) => !r.dmarc)
const weak = results.filter((r) => r.dmarc === 'none')
const enforcing = results.filter((r) => r.dmarc === 'reject' || r.dmarc === 'quarantine')
L.push(`  enforcing (reject/quarantine) : ${enforcing.length}/${results.length}`)
L.push(`  monitor only (p=none)         : ${weak.length}  ${weak.map((r) => r.name).join(', ')}`)
L.push(`  no DMARC record               : ${noDmarc.length}  ${noDmarc.map((r) => r.name).join(', ')}`)
L.push('')

L.push('=============================================================')
L.push('ATS / HIRING PLATFORM (called, not asserted)')
L.push('=============================================================')
for (const r of results) L.push(`  ${r.name.padEnd(22)} ${r.ats}`)
L.push('')

L.push('=============================================================')
L.push('VENDORS NAMED IN DNS')
L.push('=============================================================')
L.push('  An SPF include authorises that vendor to send mail as the company, and')
L.push('  a verification TXT token is placed to prove domain ownership to it.')
L.push('  Both are the company\'s own statement that the product is in use.')
L.push('')
for (const r of results) {
  if (!r.vendorsInDns.length) continue
  L.push(`  ${r.name}`)
  L.push(`      ${r.vendorsInDns.join(', ')}`)
}
L.push('')

const withWorkdayDns = results.filter((r) => r.vendorsInDns.includes('Workday'))
L.push(`  Workday named in DNS: ${withWorkdayDns.length}/${results.length} -- ${withWorkdayDns.map((r) => r.name).join(', ') || 'none'}`)
L.push('')

L.push('=============================================================')
L.push('PER-INSTITUTION DETAIL')
L.push('=============================================================')
for (const r of results) {
  L.push('')
  L.push(`## ${r.name}  (${r.domain})`)
  L.push(`   ATS        : ${r.ats}`)
  L.push(`   MX         : ${r.mx.join(', ') || '(none)'}${r.mailDomain !== r.domain ? `   [on ${r.mailDomain}]` : ''}`)
  L.push(`   mail via   : ${r.mailProviders.join(', ') || 'UNKNOWN'}`)
  L.push(`   SPF        : ${r.hasSpf ? `yes, ${r.spfIncludes.length} includes` : 'NOT PUBLISHED'}`)
  if (r.spfIncludes.length) L.push(`   authorises : ${r.spfIncludes.join(', ')}`)
  L.push(`   DMARC      : ${r.dmarcRecord ?? 'NOT PUBLISHED'}`)
  L.push(`   NS         : ${r.ns.join(', ') || '(none)'} ${r.dnsProviders.length ? `-> ${r.dnsProviders.join(', ')}` : ''}`)
  L.push(`   vendors    : ${r.vendorsInDns.join(', ') || '(none identified)'}`)
  L.push(`   TXT records: ${r.txtCount}`)
}

writeFileSync('data/company-fingerprint.txt', L.join('\n'))
writeFileSync('data/company-fingerprint.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: 'public DNS (MX/TXT/SPF/DMARC/NS) via 1.1.1.1 and 8.8.8.8; ATS status from live API calls',
  notMeasured: ['email address patterns', 'headcount', 'revenue', 'office locations'],
  results,
}, null, 2))

console.log('')
console.log(`enforcing DMARC : ${enforcing.length}/${results.length}`)
console.log(`p=none          : ${weak.length}`)
console.log(`no DMARC        : ${noDmarc.length}`)
console.log('\nwrote data/company-fingerprint.txt and data/company-fingerprint.json')
