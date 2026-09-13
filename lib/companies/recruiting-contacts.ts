import { readFile } from 'fs/promises'
import path from 'path'
import type { CompanyBoard } from './registry'
import { getBankingIntelligence } from './banking-intelligence'
import type { RecruitingContact, CompanyRecruitingMetadata } from './recruiter-intel-types'

/**
 * The data behind the "Recruiting Contacts" panel on a company page.
 *
 * This surface answers the only questions a job seeker can act on ethically:
 * where do I apply, is there a published address I can write to, and does this
 * employer's mail domain even accept mail. It NEVER names an individual and
 * pairs them with a guessed, mailbox-probed address -- that is a
 * spearphishing asset, not a job-search feature, and this project refuses to
 * build it (see scripts/find-careers-contacts.mjs and the build script).
 *
 * The aggregate email PATTERN and the talent-org leadership NAMES come from
 * lib/companies/banking-intelligence.ts: a pattern is not a person, and a
 * public CHRO's name is corporate record, carried here with no address.
 */

export interface ApplicationChannel {
  provider: string
  label: string
  url: string | null
}

export interface PublishedContact {
  address: string
  kind: string
  evidence: string
  domainHasMx: boolean | null
}

export interface MailPosture {
  domain: string
  hasMx: boolean
  mx: string[]
  hasSpf: boolean
  dmarcPolicy: string | null
}

export interface RecruitingContacts {
  slug: string
  applicationChannels: ApplicationChannel[]
  publishedContacts: PublishedContact[]
  /** Aggregate address pattern, e.g. "firstname.lastname@" -- NOT a person. */
  emailPattern: { domain: string; patterns: { pattern: string; share: number }[] } | null
  /** Same data as `emailPattern.patterns`, spec-named `emailPatterns`. */
  emailPatterns: { pattern: string; share: number }[]
  /** Public talent/HR leadership. Names only; never an address. */
  talentOrg: { role: string; name: string }[]
  /** Publicly-identified recruiting/talent professionals (see build script). */
  recruiters: RecruitingContact[]
  mailPosture: MailPosture | null
  /** True when we can only point at the ATS -- no writable address exists. */
  atsOnly: boolean
  checkedAt: string | null
  metadata: CompanyRecruitingMetadata | null
}

interface IntelFile {
  records: Record<string, { recruiters: RecruitingContact[]; metadata: CompanyRecruitingMetadata }>
}

let intelCache: { records: IntelFile['records']; loadedAt: number } | null = null

async function loadIntel(): Promise<IntelFile['records']> {
  if (intelCache && Date.now() - intelCache.loadedAt < TTL) return intelCache.records
  try {
    const file = path.join(process.cwd(), 'public', 'data', 'recruiting-intelligence.json')
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    intelCache = { records: parsed.records ?? {}, loadedAt: Date.now() }
    return intelCache.records
  } catch {
    intelCache = { records: {}, loadedAt: Date.now() }
    return {}
  }
}

interface FileRecord {
  slug: string
  name: string
  domain: string
  ats: string
  publishedContacts: PublishedContact[]
  mailPosture: MailPosture | null
  checkedAt: string
}

let cache: { records: Record<string, FileRecord>; loadedAt: number } | null = null
const TTL = 5 * 60 * 1000

async function load(): Promise<Record<string, FileRecord>> {
  if (cache && Date.now() - cache.loadedAt < TTL) return cache.records
  try {
    const file = path.join(process.cwd(), 'public', 'data', 'recruiting-contacts.json')
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    cache = { records: parsed.records ?? {}, loadedAt: Date.now() }
    return cache.records
  } catch {
    cache = { records: {}, loadedAt: Date.now() }
    return {}
  }
}

/** A candidate applies here. Build the real board URL from the board config. */
function channelForBoard(b: CompanyBoard): ApplicationChannel {
  const p = b.provider
  if (p === 'workday' && (b as any).host) {
    const site = b.site ?? ''
    return {
      provider: 'Workday',
      label: `Workday careers${site ? ` (${site})` : ''}`,
      url: `https://${(b as any).host}/en-US/${b.token}`,
    }
  }
  if (p === 'greenhouse') {
    return { provider: 'Greenhouse', label: 'Greenhouse careers', url: `https://boards.greenhouse.io/${b.token}` }
  }
  if (p === 'lever') {
    return { provider: 'Lever', label: 'Lever careers', url: `https://jobs.lever.co/${b.token}` }
  }
  if (p === 'ashby') {
    return { provider: 'Ashby', label: 'Ashby careers', url: `https://jobs.ashbyhq.com/${b.token}` }
  }
  // Oracle Cloud HCM and other custom/hosted boards: we can't reconstruct the
  // deep career-site path, but the board host itself is a usable landing page.
  const host = (b as any).host as string | undefined
  const isOracle = host?.includes('oraclecloud.com')
  return {
    provider: isOracle ? 'Oracle Recruiting' : p,
    label: isOracle ? 'Oracle careers site' : `${p} careers`,
    url: host ? `https://${host}` : null,
  }
}

const TALENT_ROLE = /chro|chief (human|people)|human resources|talent|people|recruit|hiring/i

export async function getRecruitingContacts(
  slug: string,
  boards: CompanyBoard[]
): Promise<RecruitingContacts> {
  const [records, intelRecords] = await Promise.all([load(), loadIntel()])
  const rec = records[slug]
  const intel = getBankingIntelligence(slug)
  const intelForCompany = intelRecords[slug]

  const applicationChannels = boards.map(channelForBoard)
  const publishedContacts = rec?.publishedContacts ?? []

  const emailPatterns =
    intel && intel.emailPatterns.length
      ? intel.emailPatterns.map((e) => ({ pattern: e.pattern, share: e.share }))
      : []
  const emailPattern =
    intel && emailPatterns.length ? { domain: intel.emailDomain, patterns: emailPatterns } : null

  const talentOrg = (intel?.leadership ?? []).filter((l) => TALENT_ROLE.test(l.role))

  return {
    slug,
    applicationChannels,
    publishedContacts,
    emailPattern,
    emailPatterns,
    talentOrg,
    recruiters: intelForCompany?.recruiters ?? [],
    mailPosture: rec?.mailPosture ?? null,
    atsOnly: publishedContacts.length === 0,
    checkedAt: rec?.checkedAt ?? null,
    metadata: intelForCompany?.metadata ?? null,
  }
}
