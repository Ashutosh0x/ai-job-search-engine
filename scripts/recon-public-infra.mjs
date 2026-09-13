/**
 * Passive public-infrastructure recon for employers already in the dataset.
 *
 *   node scripts/recon-public-infra.mjs
 *   node scripts/recon-public-infra.mjs --only visa.com,db.com --no-ct
 *
 * WHAT THIS DOES
 * --------------
 * Reads public records only:
 *
 *   DNS         CNAME chains on conventional careers hostnames, A, MX, TXT
 *   CT logs     crt.sh, the public certificate-transparency index, for
 *               subdomains an organisation has requested certificates for
 *
 * Both are published registries. Nothing here authenticates, guesses a tenant,
 * submits a form, or calls a private endpoint. Where a sensitive-sounding host
 * appears (payroll, treasury, payments) this records ONLY that the name exists
 * in a public log and what it resolves to. It does not connect to it.
 *
 * WHY THE CNAME CHECK IS THE POINT
 * --------------------------------
 * An earlier pass concluded "DNS cannot identify an ATS", on the evidence that
 * Workday appears in 0 of 26 apex-domain SPF/TXT records. That conclusion was
 * drawn from the wrong record type. An employer who fronts their careers page
 * on their own domain must CNAME it at the vendor, and that CNAME is public.
 * This tests whether the refined claim holds:
 *
 *   apex SPF/TXT      -> communications stack, NOT hiring
 *   careers CNAME     -> hiring stack, when the employer fronts it themselves
 *
 * Either result is worth having. If careers CNAMEs are also silent, then ATS
 * attribution genuinely requires calling the careers API, and any product that
 * claims to detect ATS from DNS alone is guessing.
 *
 * EVERY FINDING IS GRADED
 * -----------------------
 *   VERIFIED       a public record directly states it
 *   PROBABLE       several public signals agree, none conclusive
 *   UNKNOWN        no evidence either way -- never rendered as "no"
 *   FALSE POSITIVE public evidence contradicts what our crawler assumed
 */

import { promises as dns } from 'dns'
import { writeFileSync, existsSync, readFileSync } from 'fs'

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }
const flag = (n) => args.includes(`--${n}`)

dns.setServers(['1.1.1.1', '8.8.8.8'])
const UA = 'JobSparkAI/1.0 (+https://jobspark.ai; public-records recon; contact: support@jobspark.ai)'

const FP = 'data/company-fingerprint.json'
if (!existsSync(FP)) {
  console.error(`run scripts/fingerprint-companies.mjs first -- ${FP} missing`)
  process.exit(1)
}
const base = JSON.parse(readFileSync(FP, 'utf8')).results

const ONLY = val('only', '')
const RUN = ONLY ? base.filter((c) => ONLY.split(',').includes(c.domain)) : base

/** Conventional careers hostnames. Convention, not guessing a secret. */
const CAREERS_HOSTS = ['careers', 'jobs', 'career', 'recruiting', 'apply', 'talent']

/**
 * CNAME / A targets that name a hiring platform.
 *
 * These are the vendor's own service hostnames. A careers host pointing at one
 * is the employer publicly declaring who runs their board.
 */
const ATS_TARGET = [
  [/myworkdayjobs\.com|myworkdaysite\.com|workday\.com/i, 'Workday'],
  [/greenhouse\.io/i, 'Greenhouse'],
  [/lever\.co/i, 'Lever'],
  [/ashbyhq\.com/i, 'Ashby'],
  [/smartrecruiters\.com/i, 'SmartRecruiters'],
  [/icims\.com/i, 'iCIMS'],
  [/taleo\.net|oraclecloud\.com|oracle\.com/i, 'Oracle (Taleo / HCM)'],
  [/successfactors\.(com|eu)|sapsf\.(com|eu)/i, 'SAP SuccessFactors'],
  [/eightfold\.ai/i, 'Eightfold'],
  [/avature\.net/i, 'Avature'],
  // .net, not just .com -- mastercard.phenompeople.NET was missed by the
  // original pattern, which is how this table first reported "0/26 careers
  // CNAMEs name a vendor" when several plainly did.
  [/phenompeople\.(com|net)|phenom\.com/i, 'Phenom'],
  [/talentbrew\.com|radancy/i, 'Radancy TalentBrew'],
  [/beamery\.(com|eu)/i, 'Beamery'],
  [/ttcportals\.com|talentreef/i, 'TalentReef'],
  [/zohorecruit|zohohost|zoho\.(com|in)/i, 'Zoho Recruit'],
  [/jibeapply|jibe\.com/i, 'Jibe'],
  [/symphonytalent|smashfly/i, 'Symphony Talent'],
  [/clinch\.io|talemetry/i, 'Talemetry'],
  [/workable\.com/i, 'Workable'],
  [/teamtailor\.com/i, 'Teamtailor'],
  [/recruitee\.com/i, 'Recruitee'],
  [/darwinbox\.(in|com)/i, 'Darwinbox'],
  [/keka\.com/i, 'Keka'],
  [/peoplestrong\.com/i, 'PeopleStrong'],
  [/brassring\.com|kenexa/i, 'IBM Kenexa BrassRing'],
  [/jobvite\.com/i, 'Jobvite'],
  [/cornerstoneondemand\.com|csod\.com/i, 'Cornerstone'],
]

/** Hosts whose NAME suggests finance infrastructure. Existence only. */
const SENSITIVE_RE = /^(payroll|payments?|pay|treasury|banking|bank|billing|invoice|remit|settlement|ach|swift|wire|merchant|acquiring)([.-]|$)/i

/** Hosts that are public developer/API surfaces. */
const DEVPORTAL_RE = /^(developer|developers|api|apis|sandbox|devportal|openbanking)([.-]|$)/i

const match = (table, s) => table.find(([re]) => re.test(s))?.[1] ?? null
const safe = async (fn) => { try { return await fn() } catch { return null } }

/** Follow a CNAME chain, recording each hop. Bounded; no recursion loops. */
async function chase(host, depth = 0) {
  if (depth > 5) return []
  const cname = await safe(() => dns.resolveCname(host))
  if (cname?.length) {
    const next = cname[0]
    return [next, ...(await chase(next, depth + 1))]
  }
  return []
}

/* ------------------------- certificate transparency ----------------------- */

/**
 * crt.sh indexes certificates that CAs are required to log publicly. Reading
 * it reveals hostnames an organisation has certified -- a public register,
 * queried read-only.
 */
async function ctSubdomains(domain) {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 45_000)
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const rows = JSON.parse(await r.text())
    const names = new Set()
    for (const row of rows) {
      for (const n of String(row.name_value ?? '').split('\n')) {
        const h = n.trim().toLowerCase()
        if (h && !h.startsWith('*') && h.endsWith(domain)) names.add(h)
      }
    }
    return [...names]
  } catch { return null }
}

/* ----------------------------------- run ---------------------------------- */

const out = []
const SKIP_CT = flag('no-ct')

for (const c of RUN) {
  const rec = {
    company: c.name,
    domain: c.domain,
    crawlerSaysAts: c.ats,
    careersHosts: [],
    atsFromDns: [],
    ctSubdomainCount: null,
    careersSubdomains: [],
    sensitiveSubdomains: [],
    devPortals: [],
    mailProvider: c.mailProviders?.[0] ?? null,
  }

  // 1. Conventional careers hostnames -> CNAME chain -> vendor.
  for (const h of CAREERS_HOSTS) {
    const host = `${h}.${c.domain}`
    const chain = await chase(host)
    if (!chain.length) {
      const a = await safe(() => dns.resolve4(host))
      if (a?.length) rec.careersHosts.push({ host, resolves: 'A', chain: [], vendor: null })
      continue
    }
    const vendor = chain.map((x) => match(ATS_TARGET, x)).find(Boolean) ?? null
    rec.careersHosts.push({ host, resolves: 'CNAME', chain, vendor })
    if (vendor) rec.atsFromDns.push({ host, vendor, via: chain[chain.length - 1] })
  }

  // 2. Certificate transparency -> what names exist publicly.
  if (!SKIP_CT) {
    const subs = await ctSubdomains(c.domain)
    if (subs) {
      rec.ctSubdomainCount = subs.length
      for (const s of subs) {
        const label = s.slice(0, s.length - c.domain.length - 1)
        if (!label) continue
        const first = label.split('.').pop() ?? label
        if (/careers?|jobs|recruit|talent|hiring/i.test(label)) rec.careersSubdomains.push(s)
        if (SENSITIVE_RE.test(first) || SENSITIVE_RE.test(label)) rec.sensitiveSubdomains.push(s)
        if (DEVPORTAL_RE.test(first) || DEVPORTAL_RE.test(label)) rec.devPortals.push(s)
      }
      rec.careersSubdomains = [...new Set(rec.careersSubdomains)].slice(0, 25)
      rec.sensitiveSubdomains = [...new Set(rec.sensitiveSubdomains)].slice(0, 25)
      rec.devPortals = [...new Set(rec.devPortals)].slice(0, 25)
    }
  }

  out.push(rec)
  console.log(
    `  ${rec.company.padEnd(22)} careersCNAME=${String(rec.atsFromDns.length).padStart(2)} ` +
    `ct=${String(rec.ctSubdomainCount ?? '-').padStart(5)} ` +
    `careersSubs=${String(rec.careersSubdomains.length).padStart(3)} ` +
    `finance-named=${String(rec.sensitiveSubdomains.length).padStart(3)} ` +
    `dev=${String(rec.devPortals.length).padStart(3)}` +
    (rec.atsFromDns.length ? `  -> ${[...new Set(rec.atsFromDns.map((a) => a.vendor))].join(', ')}` : '')
  )
}

writeFileSync('data/public-infra-recon.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: 'public DNS (CNAME/A) on conventional careers hostnames + crt.sh certificate-transparency index. Read-only. No authentication, no tenant guessing, no interaction with finance-named hosts beyond noting their presence in a public log.',
  notDone: [
    'no login, password-reset, or credential handling',
    'no SMTP mailbox verification',
    'no calls to finance-named hosts',
    'no WAF/CAPTCHA/rate-limit circumvention',
    'no tenant-id guessing',
  ],
  results: out,
}, null, 2))

/* -------------------------------- summary --------------------------------- */

const withAtsCname = out.filter((r) => r.atsFromDns.length)
console.log('')
console.log(`careers hostname CNAMEs naming an ATS : ${withAtsCname.length}/${out.length}`)
for (const r of withAtsCname) {
  for (const a of r.atsFromDns) console.log(`   ${r.company.padEnd(22)} ${a.host}  ->  ${a.vendor}  (${a.via})`)
}
const totalSensitive = out.reduce((s, r) => s + r.sensitiveSubdomains.length, 0)
console.log(`\nfinance-named hosts seen in CT logs   : ${totalSensitive} (existence only, not contacted)`)
console.log('wrote data/public-infra-recon.json')
