/**
 * Official government sponsor registers.
 *
 * WHY THIS EXISTS
 * Everything else in the visa layer is INFERENCE: it reads the posting's prose
 * and decides how likely sponsorship looks. That is genuinely useful, but it
 * can only ever be as good as what the employer chose to write, and 88% of the
 * corpus has no description at all.
 *
 * These registers are different in kind. A government publishes the list of
 * employers it has licensed to sponsor foreign workers. "Barclays Bank PLC
 * holds a Skilled Worker licence" is a FACT with a named source and a date,
 * not a guess about wording. So it is stored separately from the inferred
 * status and never collapsed into it -- a licence means the employer *can*
 * sponsor, which is not the same as this particular role *being* sponsored.
 *
 * Sources:
 *   UK  Home Office, "Register of licensed sponsors: workers" (CSV, monthly).
 *       The CSV URL carries a date and changes every release, so it is
 *       discovered through the GOV.UK content API rather than hardcoded.
 *   NL  IND, "Public Register of Recognised Sponsors -- Labour" (HTML table,
 *       monthly). No CSV is published; the table is parsed from the page.
 *
 * MATCHING IS THE DANGEROUS PART
 * Claiming an employer is licensed when it is not is a confident, specific,
 * wrong answer that could cost somebody an application. The register contains
 * 143,000 organisations, so loose matching finds a "hit" for almost any string:
 * "Circle" matches "Circle Health Group Limited", "Apple" matches "Apple Tree
 * Day Nursery". The matcher below therefore accepts only two shapes and
 * records the matched legal name as evidence so a wrong match is visible.
 */

export type SponsorCountry = 'UK' | 'NL' | 'US'

export interface SponsorRow {
  name: string
  /** UK only. */
  town?: string | null
  county?: string | null
  rating?: string | null
  route?: string | null
  /** NL only: Chamber of Commerce number. */
  kvk?: string | null
  /** US only: H-1B petition outcomes for the fiscal year (see fetchUsRegister). */
  initialApprovals?: number
  initialDenials?: number
  continuingApprovals?: number
  continuingDenials?: number
  state?: string | null
  city?: string | null
  naics?: string | null
  fiscalYear?: number
}

export interface SponsorRegister {
  country: SponsorCountry
  sourceUrl: string
  /** When the publisher last updated it, not when we fetched it. */
  publishedAt: string | null
  fetchedAt: string
  rows: SponsorRow[]
  /**
   * How stale the source itself is, in the publisher's own terms. The US hub
   * lags by years; the UK register is monthly. A consumer must be able to tell
   * the difference without knowing each source's release cadence.
   */
  coverageNote?: string
}

export interface SponsorMatch {
  country: SponsorCountry
  /** The legal name as it appears in the register -- the evidence. */
  matchedName: string
  /** 'exact' or 'qualified' (company name plus corporate qualifiers only). */
  matchKind: 'exact' | 'qualified'
  routes: string[]
  ratings: string[]
  locations: string[]
  sourceUrl: string
  publishedAt: string | null
  /**
   * Does this licence cover skilled employment, as opposed to religious,
   * charity, seasonal or creative routes?
   *
   * This matters because it catches wrong matches that nothing else can. The
   * register contains an organisation literally named "WISE" holding Religious
   * Worker and Tier 2 Minister of Religion routes -- plainly not Wise the
   * payments company, but an exact string match all the same. A licence that
   * covers no skilled route is either the wrong entity or useless to an
   * engineer, and either way must not be presented as "this employer can
   * sponsor you".
   */
  coversSkilledWork: boolean
  /** Set when the match should not be trusted, with the reason why. */
  lowConfidence?: string
  /**
   * US only. Petition OUTCOMES, which is a different kind of fact from a UK/NL
   * licence: the UK register says an employer *may* sponsor, while this says an
   * employer *did* -- for a fiscal year that has already closed. Both are facts;
   * neither is a statement about today.
   */
  h1b?: {
    fiscalYear: number
    initialApprovals: number
    initialDenials: number
    continuingApprovals: number
    continuingDenials: number
  }
}

/**
 * Routes that permit skilled employment. Anything outside this set is a
 * different immigration purpose entirely.
 */
const SKILLED_ROUTES = [
  /skilled\s*worker/i,
  /global\s*business\s*mobility/i,
  /senior\s*or\s*specialist/i,
  /scale-?up/i,
  /high\s*potential/i,
  /international\s*agreement/i,
  /government\s*authorised\s*exchange/i,
  /tier\s*2\s*(general|ict)/i,
  /intra-?company/i,
  /graduate\s*trainee/i,
  /service\s*supplier/i,
  /secondment/i,
  /expansion\s*worker/i,
]

export function isSkilledRoute(route: string): boolean {
  return SKILLED_ROUTES.some((re) => re.test(route))
}

/* -------------------------------- fetching -------------------------------- */

const UA = 'JobSparkAI/1.0 (job search index; contact: support@jobspark.ai)'

/**
 * Minimal RFC-4180 CSV reader: handles quoted fields, embedded commas and
 * doubled quotes. The register contains all three.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim().length))
}

/** Discover the current UK CSV through the GOV.UK content API, then read it. */
export async function fetchUkRegister(): Promise<SponsorRegister> {
  const apiUrl =
    'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers'
  const meta = await fetch(apiUrl, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!meta.ok) throw new Error(`GOV.UK content API: ${meta.status}`)
  const doc: any = await meta.json()

  const attachments: any[] = doc?.details?.attachments ?? []
  const csv = attachments.find((a) => /csv/i.test(a?.content_type ?? '') || /\.csv$/i.test(a?.url ?? ''))
  if (!csv?.url) throw new Error('GOV.UK publication has no CSV attachment')

  const res = await fetch(csv.url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`UK register CSV: ${res.status}`)
  const table = parseCsv(await res.text())

  // Header: Organisation Name, Town/City, County, Type & Rating, Route
  const [header, ...body] = table
  const col = (want: string) =>
    header.findIndex((h) => h.trim().toLowerCase().startsWith(want))
  const iName = col('organisation')
  const iTown = col('town')
  const iCounty = col('county')
  const iRating = col('type')
  const iRoute = col('route')

  const rows: SponsorRow[] = body
    .map((r) => ({
      name: (r[iName] ?? '').trim(),
      town: (r[iTown] ?? '').trim() || null,
      county: (r[iCounty] ?? '').trim() || null,
      rating: (r[iRating] ?? '').trim() || null,
      route: (r[iRoute] ?? '').trim() || null,
    }))
    .filter((r) => r.name.length > 1)

  return {
    country: 'UK',
    sourceUrl: csv.url,
    publishedAt: doc?.public_updated_at ?? null,
    fetchedAt: new Date().toISOString(),
    rows,
  }
}

/**
 * The IND publishes no CSV, so the register is read from the page's table.
 * Each row is [organisation name, KvK number].
 */
export async function fetchNlRegister(): Promise<SponsorRegister> {
  const url = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work'
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`IND register: ${res.status}`)
  const html = await res.text()

  const rows: SponsorRow[] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m: RegExpExecArray | null
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    )
    if (cells.length < 1) continue
    // The export wraps some names in doubled quotes: ""Aa-Dee"" Machinefabriek.
    const name = cells[0].replace(/^"+|"+$/g, '').trim()
    if (!name || /organisation|organisatie/i.test(name)) continue
    rows.push({ name, kvk: cells[1] || null })
  }

  return {
    country: 'NL',
    sourceUrl: url,
    publishedAt: null, // the page states a date in prose only, so do not assert one
    fetchedAt: new Date().toISOString(),
    rows,
  }
}

/**
 * USCIS H-1B Employer Data Hub.
 *
 * A DIFFERENT KIND OF FACT FROM UK/NL
 * -----------------------------------
 * The UK and Dutch registers are licences: the government has authorised this
 * employer to sponsor, so the fact is about PERMISSION and is current.
 *
 * The US publishes no equivalent licence list, because H-1B sponsorship needs
 * no standing licence -- any employer can file a petition. What USCIS publishes
 * instead is OUTCOMES: which employers actually had petitions approved or
 * denied, per fiscal year. So the fact here is about HISTORY.
 *
 * That distinction has to survive into the UI. "Amazon had 4,062 H-1B approvals
 * in FY2023" is true and useful. "Amazon sponsors H-1B" is an extrapolation
 * from it, and "this role is sponsored" is a further extrapolation again. The
 * data supports only the first.
 *
 * STALENESS IS STRUCTURAL, NOT A BUG
 * ----------------------------------
 * USCIS publishes a fiscal year well after it closes. Measured 11 Sep 2026:
 * FY2024, FY2025 and FY2026 all 404; FY2023 is the newest file that exists.
 * So this source is inherently ~2-3 years behind, and the fiscal year travels
 * with every row so a consumer can weigh it. The fetcher discovers the newest
 * available year rather than hardcoding one, because that changes annually.
 *
 * One row per employer per work location, so an employer appears many times;
 * rows are aggregated by employer name.
 */
export async function fetchUsRegister(opts: { maxYearsBack?: number } = {}): Promise<SponsorRegister> {
  const base = 'https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-'
  const thisYear = new Date().getFullYear()
  const maxBack = opts.maxYearsBack ?? 4

  let text: string | null = null
  let sourceUrl = ''
  let fiscalYear = 0

  // Walk back from the current year to the newest file that actually exists.
  for (let y = thisYear; y > thisYear - maxBack; y--) {
    const url = `${base}${y}.csv`
    const res = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null)
    // USCIS serves its 404 page with a 404 status but a non-trivial body, so
    // check the status rather than the payload size.
    if (!res?.ok) continue
    const body = await res.text()
    // Guard against a soft-404 that returns HTML with a 200.
    if (!/^\s*"?Fiscal Year"?\s*,/i.test(body)) continue
    text = body
    sourceUrl = url
    fiscalYear = y
    break
  }

  if (!text) {
    throw new Error(
      `No H-1B data hub file found for ${thisYear - maxBack + 1}-${thisYear}. ` +
        'USCIS may have changed the URL pattern.'
    )
  }

  const table = parseCsv(text)
  const [header, ...body] = table
  const col = (want: string) =>
    header.findIndex((h) => h.trim().toLowerCase().replace(/^"|"$/g, '').startsWith(want))

  const iEmployer = col('employer')
  const iIA = col('initial approval')
  const iID = col('initial denial')
  const iCA = col('continuing approval')
  const iCD = col('continuing denial')
  const iState = col('state')
  const iCity = col('city')
  const iNaics = col('naics')

  const num = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(/[",]/g, '').trim())
    return Number.isFinite(n) ? n : 0
  }

  // Aggregate: one row per employer, summing across its work locations.
  const byEmployer = new Map<string, SponsorRow>()
  for (const r of body) {
    const name = (r[iEmployer] ?? '').trim()
    // The file genuinely contains rows with a blank employer (suppressed for
    // privacy when counts are tiny). They cannot be matched to anything.
    if (name.length < 2) continue

    const key = name.toUpperCase()
    const prev = byEmployer.get(key)
    const row: SponsorRow = prev ?? {
      name,
      state: (r[iState] ?? '').trim() || null,
      city: (r[iCity] ?? '').trim() || null,
      naics: (r[iNaics] ?? '').trim() || null,
      fiscalYear,
      initialApprovals: 0,
      initialDenials: 0,
      continuingApprovals: 0,
      continuingDenials: 0,
    }
    row.initialApprovals! += num(r[iIA])
    row.initialDenials! += num(r[iID])
    row.continuingApprovals! += num(r[iCA])
    row.continuingDenials! += num(r[iCD])
    byEmployer.set(key, row)
  }

  // An employer with zero approvals and zero denials carries no signal.
  const rows = [...byEmployer.values()].filter(
    (r) => (r.initialApprovals! + r.continuingApprovals! + r.initialDenials! + r.continuingDenials!) > 0
  )

  return {
    country: 'US',
    sourceUrl,
    // The fiscal year is the publisher's own period. USCIS states no file date,
    // so do not invent one -- the year IS the provenance.
    publishedAt: null,
    fetchedAt: new Date().toISOString(),
    rows,
    coverageNote:
      `USCIS publishes H-1B outcomes only after a fiscal year closes; FY${fiscalYear} is the ` +
      'newest file available. These are petitions an employer actually filed in that year, ' +
      'not a current licence and not a statement about any specific role.',
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

/* -------------------------------- matching -------------------------------- */

/**
 * Tokens that qualify a company name without changing which company it is.
 * "Amazon UK Services Ltd" is Amazon; "Circle Health Group Limited" is not
 * Circle, because `health` is not in this set.
 */
const QUALIFIERS = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'llc', 'inc', 'incorporated', 'corp',
  'corporation', 'co', 'company', 'group', 'holdings', 'holding', 'international',
  'uk', 'gb', 'britain', 'british', 'england', 'europe', 'european', 'emea',
  'services', 'service', 'technologies', 'technology', 'tech', 'solutions',
  'systems', 'global', 'worldwide', 'bv', 'b', 'v', 'nv', 'n', 'ag', 'gmbh',
  'sa', 'se', 'and', 'the', 'of', 'nederland', 'netherlands', 'benelux',
  'operations', 'enterprises', 'partners', 'management', 'consulting',
])

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeOrgName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Drop trailing qualifier tokens: "amazon uk services ltd" -> "amazon". */
function stripQualifiers(norm: string): string {
  const parts = norm.split(' ')
  while (parts.length > 1 && QUALIFIERS.has(parts[parts.length - 1])) parts.pop()
  return parts.join(' ')
}

export interface SponsorIndex {
  register: SponsorRegister
  /** stripped-name -> rows sharing it. */
  byCore: Map<string, SponsorRow[]>
}

export function buildSponsorIndex(register: SponsorRegister): SponsorIndex {
  const byCore = new Map<string, SponsorRow[]>()
  for (const row of register.rows) {
    const core = stripQualifiers(normalizeOrgName(row.name))
    if (!core) continue
    const list = byCore.get(core) ?? []
    list.push(row)
    byCore.set(core, list)
  }
  return { register, byCore }
}

/**
 * Names too generic to match on their own. A single common word will collide
 * with unrelated businesses somewhere in a 143,000-row register, so these are
 * required to match the register entry exactly rather than by prefix.
 */
const GENERIC = new Set([
  'circle', 'remote', 'ripple', 'apple', 'block', 'stripe', 'figma', 'linear',
  'notion', 'discord', 'chime', 'gusto', 'carta', 'element', 'atlas', 'nexus',
  'origin', 'summit', 'vertex', 'apex', 'pinnacle', 'horizon', 'catalyst',
])

/**
 * Does this company hold a licence in this register?
 *
 * Accepts exactly two shapes:
 *   exact      the stripped register name equals the stripped company name.
 *   qualified  the register name is the company name followed only by
 *              qualifier tokens ("Amazon UK Services Ltd").
 *
 * Everything else is refused. A refusal is not evidence of absence -- the
 * employer may be licensed under a legal name we cannot connect -- so callers
 * must present "not found" as unknown, never as "does not sponsor".
 */
export function matchSponsor(
  companyName: string,
  index: SponsorIndex
): SponsorMatch | null {
  const core = stripQualifiers(normalizeOrgName(companyName))
  if (!core || core.length < 3) return null

  const hits = index.byCore.get(core)
  if (!hits?.length) return null

  // A single generic word must have matched a register entry whose own name is
  // no more than the same word plus qualifiers -- which byCore already
  // guarantees. Require the raw names to agree closely for these.
  if (GENERIC.has(core)) {
    const strict = hits.filter((h) => stripQualifiers(normalizeOrgName(h.name)) === core &&
      normalizeOrgName(h.name).split(' ').every((t) => t === core || QUALIFIERS.has(t)))
    if (!strict.length) return null
  }

  // 'exact' means the two names agree as written, not merely after qualifiers
  // are stripped -- so compare the full normalised forms, not the core.
  const wanted = normalizeOrgName(companyName)
  const exact = hits.some((h) => normalizeOrgName(h.name) === wanted)

  const routes = [...new Set(hits.map((h) => h.route).filter(Boolean) as string[])]
  // The NL register publishes no route column; recognised sponsorship there is
  // the labour scheme by definition, so treat it as covering skilled work.
  //
  // The US hub has no routes either, but for a different reason: H-1B is itself
  // a skilled-worker classification, so an approval IS evidence of skilled
  // sponsorship. Applying the UK's route test here would reject every US row.
  const coversSkilledWork =
    index.register.country === 'NL' || index.register.country === 'US'
      ? true
      : routes.some(isSkilledRoute)

  // Prefer the entity that actually holds a skilled-work route when several
  // share a name, so the evidence shown is the relevant one.
  const preferred =
    hits.find((h) => h.route && isSkilledRoute(h.route)) ?? hits[0]

  return {
    country: index.register.country,
    matchedName: preferred.name.trim(),
    matchKind: exact ? 'exact' : 'qualified',
    routes,
    ratings: [...new Set(hits.map((h) => h.rating).filter(Boolean) as string[])],
    locations: [...new Set(hits.map((h) => h.town).filter(Boolean) as string[])].slice(0, 6),
    sourceUrl: index.register.sourceUrl,
    publishedAt: index.register.publishedAt,
    coversSkilledWork,
    ...(coversSkilledWork ? {} : {
      lowConfidence:
        'Matched organisation holds no skilled-work route, so this is probably ' +
        'a different entity with the same name',
    }),
    // Petition counts, summed across every work location for this employer.
    // Carried through so the UI can state the measured fact rather than a
    // derived adjective: "4,062 approvals in FY2023", not "sponsors often".
    ...(index.register.country === 'US'
      ? {
          h1b: {
            fiscalYear: preferred.fiscalYear ?? 0,
            initialApprovals: hits.reduce((s, h) => s + (h.initialApprovals ?? 0), 0),
            initialDenials: hits.reduce((s, h) => s + (h.initialDenials ?? 0), 0),
            continuingApprovals: hits.reduce((s, h) => s + (h.continuingApprovals ?? 0), 0),
            continuingDenials: hits.reduce((s, h) => s + (h.continuingDenials ?? 0), 0),
          },
        }
      : {}),
  }
}
