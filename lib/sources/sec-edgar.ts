/**
 * SEC EDGAR Financial Intelligence Adapter
 *
 * Extracts company financial data from the SEC's public EDGAR system.
 * All data is from mandatory public filings — 10-K (annual), 10-Q (quarterly),
 * 8-K (material events), and DEF 14A (proxy / executive compensation).
 *
 * DATA AVAILABLE
 * --------------
 *   - Revenue, net income, total assets, total debt, cash & equivalents
 *   - Executive compensation (from proxy statements)
 *   - Banking relationships (from credit facility exhibits)
 *   - Credit ratings (from filing text)
 *   - Employee counts (from 10-K Item 1)
 *
 * RATE LIMITS
 * -----------
 * SEC asks for a descriptive User-Agent with contact email and limits to
 * 10 requests/second. We respect both.
 *
 * LEGAL BASIS
 * -----------
 * All SEC filings are public domain (17 CFR § 202.5). EDGAR's EFTS and
 * full-text search APIs are explicitly provided for programmatic access.
 */

const SEC_BASE = 'https://efts.sec.gov/LATEST'
/** Structured JSON APIs: submissions, companyfacts. */
const SEC_COMPANY = 'https://data.sec.gov'
/**
 * Static files and filing archives. NOT the same host as the JSON APIs --
 * company_tickers.json lives here and 404s on data.sec.gov, which silently
 * disabled every ticker lookup until it was probed against the live service.
 */
const SEC_WWW = 'https://www.sec.gov'

const USER_AGENT = 'JobSparkAI/1.0 (contact@jobspark.ai)'

/** Respect SEC's 10 req/sec guideline. */
let lastRequest = 0
async function throttle(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequest
  if (elapsed < 110) {
    await new Promise((r) => setTimeout(r, 110 - elapsed))
  }
  lastRequest = Date.now()
}

async function secFetch(url: string): Promise<Response> {
  await throttle()
  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SECCompanyMatch {
  cik: string         // Central Index Key — the SEC's unique company ID
  name: string
  ticker?: string
  exchange?: string
  sic?: string        // Standard Industrial Classification code
  sicDescription?: string
  stateOfIncorporation?: string
  fiscalYearEnd?: string
}

export interface SECFiling {
  accessionNumber: string
  filingDate: string
  reportDate?: string
  form: string         // e.g. '10-K', '10-Q', '8-K', 'DEF 14A'
  primaryDocument?: string
  fileUrl?: string
}

export interface CompanyFinancials {
  cik: string
  companyName: string
  ticker?: string
  /** Most recent fiscal year data */
  revenue?: number           // USD
  /** Which XBRL concept the revenue figure came from — provenance, not decoration. */
  revenueConcept?: string
  /** Period end of the fiscal year the revenue covers. */
  fiscalPeriodEnd?: string
  netIncome?: number
  totalAssets?: number
  totalDebt?: number
  cashAndEquivalents?: number
  employeeCount?: number
  marketCap?: number
  revenuePerEmployee?: number
  /** Banking / credit relationships extracted from filings */
  bankingRelationships: BankingRelationship[]
  /** Source filing metadata */
  filingDate?: string
  filingForm?: string
  dataSource: 'sec_edgar'
  retrievedAt: string
}

export interface BankingRelationship {
  bankName: string
  role: string          // e.g. 'Administrative Agent', 'Lender', 'Bookrunner'
  facilityType?: string // e.g. 'Revolving Credit', 'Term Loan'
  facilitySize?: string // e.g. '$2.0 billion'
  maturityDate?: string
  /** URL of the exact filing document the claim was read from. */
  sourceExhibit?: string
  /** The sentence the claim was read from, so it can be checked. */
  evidence?: string
  confidence: 'high' | 'medium' | 'low'
}

// ─── Company Lookup ───────────────────────────────────────────────────────────

/**
 * Search for a company by name or ticker in SEC EDGAR.
 * Returns the best CIK match.
 */
export async function findCompanyCIK(query: string): Promise<SECCompanyMatch | null> {
  try {
    // First try the company tickers JSON (fastest, most reliable)
    const tickerRes = await secFetch(`${SEC_WWW}/files/company_tickers.json`)
    if (tickerRes.ok) {
      const tickers = await tickerRes.json()
      const normalizedQuery = query.toLowerCase().trim()

      // Search by ticker first (exact)
      for (const key of Object.keys(tickers)) {
        const entry = tickers[key]
        if (entry.ticker?.toLowerCase() === normalizedQuery) {
          return {
            cik: String(entry.cik_str).padStart(10, '0'),
            name: entry.title,
            ticker: entry.ticker,
          }
        }
      }

      // Then by company name. First-match-wins is wrong here: the file is in
      // no useful order, so "Apple" would return whichever of "APPLE INC" and
      // "APPLE HOSPITALITY REIT" happens to appear first. Score every
      // candidate and take the closest, preferring an exact name.
      const candidates: Array<{ entry: any; score: number }> = []
      for (const key of Object.keys(tickers)) {
        const entry = tickers[key]
        const title = entry.title?.toLowerCase()
        if (!title) continue

        let score = 0
        if (title === normalizedQuery) score = 1000
        else if (title.startsWith(normalizedQuery + ' ')) score = 500 - title.length
        else if (title.includes(normalizedQuery)) score = 200 - title.length
        else continue

        candidates.push({ entry, score })
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score)
        const best = candidates[0].entry
        return {
          cik: String(best.cik_str).padStart(10, '0'),
          name: best.title,
          ticker: best.ticker,
        }
      }
    }

    // Fallback: EFTS full-text search
    const searchRes = await secFetch(
      `${SEC_BASE}/search-index?q=%22${encodeURIComponent(query)}%22&dateRange=custom&startdt=2024-01-01&forms=10-K`
    )
    if (searchRes.ok) {
      const data = await searchRes.json()
      if (data.hits?.hits?.length > 0) {
        const hit = data.hits.hits[0]._source
        return {
          cik: String(hit.entity_id).padStart(10, '0'),
          name: hit.entity_name,
        }
      }
    }

    return null
  } catch (e) {
    console.error('[SEC EDGAR] Company lookup failed:', e)
    return null
  }
}

// ─── Filings Retrieval ────────────────────────────────────────────────────────

/**
 * Get recent filings for a company by CIK.
 */
export async function getFilings(
  cik: string,
  forms: string[] = ['10-K', '10-Q'],
  limit = 5
): Promise<SECFiling[]> {
  try {
    const res = await secFetch(
      `${SEC_COMPANY}/submissions/CIK${cik}.json`
    )
    if (!res.ok) return []
    const data = await res.json()

    const recent = data.filings?.recent
    if (!recent?.form) return []

    const filings: SECFiling[] = []
    for (let i = 0; i < recent.form.length && filings.length < limit; i++) {
      const form = recent.form[i]
      if (forms.includes(form)) {
        const accNum = recent.accessionNumber[i]?.replace(/-/g, '')
        filings.push({
          accessionNumber: recent.accessionNumber[i],
          filingDate: recent.filingDate[i],
          reportDate: recent.reportDate?.[i],
          form,
          primaryDocument: recent.primaryDocument?.[i],
          fileUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNum}/${recent.primaryDocument?.[i]}`,
        })
      }
    }

    return filings
  } catch (e) {
    console.error('[SEC EDGAR] Filings retrieval failed:', e)
    return []
  }
}

// ─── XBRL Fact Selection (pure — unit tested without network) ─────────────────

/**
 * One XBRL fact as companyfacts returns it.
 *
 * `start`/`end` bound the period a duration fact covers; instant facts (balance
 * sheet items) carry only `end`. `fp` is the fiscal period — "FY" for the
 * annual figure, "Q1".."Q4" for quarters.
 */
export interface XbrlFact {
  val: number
  end: string
  start?: string
  fy?: number
  fp?: string
  form: string
  filed?: string
  frame?: string
}

/**
 * Revenue candidate concepts, in no particular order of preference.
 *
 * ORDER DELIBERATELY DOES NOT MATTER. Preference order is the trap: Microsoft
 * reports BOTH `Revenues` (which stops at FY2010, $62.5B) and
 * `RevenueFromContractWithCustomerExcludingAssessedTax` (current, FY2026
 * $331.8B). Taking the first concept that returns anything yields a sixteen-
 * year-old number that looks completely ordinary. The concept is chosen by
 * which one has the most RECENT annual period.
 */
export const REVENUE_CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'RevenuesNetOfInterestExpense',
]

const DAY_MS = 86_400_000

/** Days a duration fact spans. */
export function factSpanDays(fact: XbrlFact): number | null {
  if (!fact.start) return null
  return Math.round((Date.parse(fact.end) - Date.parse(fact.start)) / DAY_MS)
}

/**
 * Is this the full-year figure, rather than a quarter?
 *
 * A 10-K carries Q4 alongside FY, and both are tagged `form: "10-K"`. Filtering
 * on the form alone and taking the last entry is how a quarterly number ends up
 * presented as annual revenue — for Microsoft that was $16.0B against an actual
 * $62.5B. Both the fiscal-period marker and the period length have to agree.
 */
export function isFullYearFact(fact: XbrlFact): boolean {
  if (fact.val === undefined || fact.val === null) return false
  if (fact.fp !== 'FY') return false
  const span = factSpanDays(fact)
  return span !== null && span >= 300 && span <= 400
}

/** Annual-report forms. 10-K/20-F/40-F are the annual filings; 10-K/A amends one. */
const ANNUAL_FORMS = /^(10-K|20-F|40-F)(\/A)?$/

/**
 * Pick the most recent full-year fact across a set of candidate concepts.
 *
 * Returns which concept won, so the caller can record provenance rather than
 * presenting a number whose origin is unknowable.
 */
export function selectLatestAnnual(
  usgaap: Record<string, any>,
  concepts: string[],
  unit = 'USD'
): { concept: string; fact: XbrlFact } | null {
  let best: { concept: string; fact: XbrlFact } | null = null

  for (const concept of concepts) {
    const facts: XbrlFact[] = usgaap[concept]?.units?.[unit] || []
    for (const fact of facts) {
      if (!ANNUAL_FORMS.test(fact.form)) continue
      if (!isFullYearFact(fact)) continue
      if (!best || Date.parse(fact.end) > Date.parse(best.fact.end)) {
        best = { concept, fact }
      }
    }
  }

  return best
}

/**
 * Pick the most recent instant (balance-sheet) fact across candidate concepts.
 *
 * Instant facts have no `start`, so the full-year test does not apply — but the
 * same stale-concept trap does, hence latest-`end`-wins across all candidates.
 */
export function selectLatestInstant(
  usgaap: Record<string, any>,
  concepts: string[],
  unit = 'USD'
): { concept: string; fact: XbrlFact } | null {
  let best: { concept: string; fact: XbrlFact } | null = null

  for (const concept of concepts) {
    const facts: XbrlFact[] = usgaap[concept]?.units?.[unit] || []
    for (const fact of facts) {
      if (fact.val === undefined || fact.val === null) continue
      if (!ANNUAL_FORMS.test(fact.form)) continue
      if (fact.start) continue // duration fact — not a balance-sheet instant
      if (!best || Date.parse(fact.end) > Date.parse(best.fact.end)) {
        best = { concept, fact }
      }
    }
  }

  return best
}

// ─── XBRL Financial Data ──────────────────────────────────────────────────────

/**
 * Fetch structured XBRL financial facts for a company.
 * This is the richest data source — returns tagged financial line items
 * from every filing the company has ever made.
 */
export async function getCompanyFacts(cik: string): Promise<CompanyFinancials | null> {
  try {
    const res = await secFetch(
      `${SEC_COMPANY}/api/xbrl/companyfacts/CIK${cik}.json`
    )
    if (!res.ok) return null

    const data = await res.json()
    const usgaap: Record<string, any> = data.facts?.['us-gaap'] || {}

    const revenueFact = selectLatestAnnual(usgaap, REVENUE_CONCEPTS)
    const netIncomeFact = selectLatestAnnual(usgaap, ['NetIncomeLoss', 'ProfitLoss'])
    const assetsFact = selectLatestInstant(usgaap, ['Assets'])
    const debtFact = selectLatestInstant(usgaap, [
      'LongTermDebt',
      'LongTermDebtNoncurrent',
      'DebtLongtermAndShorttermCombinedAmount',
    ])
    const cashFact = selectLatestInstant(usgaap, [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      'Cash',
    ])

    const revenue = revenueFact?.fact.val

    return {
      cik,
      companyName: data.entityName || '',
      ticker: undefined, // filled by caller
      revenue,
      revenueConcept: revenueFact?.concept,
      fiscalPeriodEnd: revenueFact?.fact.end,
      netIncome: netIncomeFact?.fact.val,
      totalAssets: assetsFact?.fact.val,
      totalDebt: debtFact?.fact.val,
      cashAndEquivalents: cashFact?.fact.val,
      // Employee counts are NOT in companyfacts. Neither us-gaap:NumberOfEmployees
      // nor dei:EntityNumberOfEmployees exists for the companies checked, so the
      // previous lookups silently returned undefined every time. The figure lives
      // in 10-K Item 1 prose; until that is parsed, this stays honestly absent
      // rather than being derived from something that is not a headcount.
      employeeCount: undefined,
      revenuePerEmployee: undefined,
      bankingRelationships: [], // filled by banking relationship extractor
      filingDate: revenueFact?.fact.filed,
      filingForm: revenueFact?.fact.form,
      dataSource: 'sec_edgar',
      retrievedAt: new Date().toISOString(),
    }
  } catch (e) {
    console.error('[SEC EDGAR] XBRL facts retrieval failed:', e)
    return null
  }
}

// ─── Banking Relationship Extraction ──────────────────────────────────────────

const BANK_NAMES = [
  'JPMorgan Chase', 'JP Morgan', 'Goldman Sachs', 'Morgan Stanley',
  'Bank of America', 'Citibank', 'Citigroup', 'Wells Fargo',
  'Barclays', 'Deutsche Bank', 'HSBC', 'BNP Paribas',
  'Credit Suisse', 'UBS', 'Royal Bank of Canada', 'TD Securities',
  'MUFG', 'Mizuho', 'Sumitomo Mitsui', 'Standard Chartered',
  'Société Générale', 'ING', 'Commerzbank', 'UniCredit',
  'NatWest', 'Lloyds', 'Santander', 'BBVA',
]

const ROLE_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
  { pattern: /administrative agent/i, role: 'Administrative Agent' },
  { pattern: /lead arranger/i, role: 'Lead Arranger' },
  { pattern: /bookrunner/i, role: 'Bookrunner' },
  { pattern: /syndication agent/i, role: 'Syndication Agent' },
  { pattern: /co-lead/i, role: 'Co-Lead Arranger' },
  { pattern: /managing agent/i, role: 'Managing Agent' },
  { pattern: /lender/i, role: 'Lender' },
]

/** How far from a bank's name a role may be stated and still describe it. */
const ROLE_WINDOW = 250

/**
 * One institution, many spellings.
 *
 * BANK_NAMES lists the spellings that appear in filings; this collapses them to
 * one identity. Without it JPMorgan's own 10-K yields both "JPMorgan Chase" and
 * "JP Morgan" as separate lenders, which reads as two banks in a syndicate when
 * it is one.
 */
const BANK_ALIASES: Record<string, string> = {
  'JP Morgan': 'JPMorgan Chase',
  Citibank: 'Citigroup',
  'Sumitomo Mitsui': 'SMBC',
}

/** The name an institution is reported under, regardless of how it was spelled. */
export function canonicalBankName(name: string): string {
  return BANK_ALIASES[name] || name
}

/**
 * Cache the SOURCE, not the RegExp.
 *
 * A cached global regex carries `lastIndex` between uses, so a second `.test()`
 * on the same object resumes from where the first stopped and returns false for
 * a string that plainly matches. Handing out a fresh object each call keeps the
 * compile cheap without sharing that state.
 */
const patternCache = new Map<string, string>()

/**
 * Match a bank name in filing prose.
 *
 * Two things a plain `indexOf` gets wrong, both found by the test suite:
 *
 *   - "ING" appears inside "revolv-ING", "lend-ING", "bank-ING". Without word
 *     boundaries, nearly every credit-facility sentence "mentions" ING.
 *   - Filings write "J.P. Morgan Securities", not "JP Morgan". Initials carry
 *     periods, so short all-caps tokens have to tolerate them.
 */
export function bankNamePattern(bankName: string): RegExp {
  const cached = patternCache.get(bankName)
  if (cached) return new RegExp(cached, 'gi')

  const body = bankName
    .split(/\s+/)
    .map((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Short all-caps tokens are initialisms: allow "J.P." as well as "JP".
      if (token.length <= 2 && token === token.toUpperCase()) {
        return token.split('').map((ch) => `${ch}\\.?`).join('')
      }
      return escaped
    })
    .join('\\s+')

  const source = `\\b${body}\\b`
  patternCache.set(bankName, source)
  return new RegExp(source, 'gi')
}

/** Strip markup to plain text so bank names and roles can be located in prose. */
export function filingHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull banking relationships out of real filing text.
 *
 * WHY THIS IS STRICTER THAN IT LOOKS
 * ----------------------------------
 * The previous implementation read `hit._source.file_description` — which is an
 * exhibit label like "EX-13.1", never filing prose — and fell back to
 * `display_date_filed`, a field that does not exist in the EFTS response at all.
 * So it matched bank names against a label or an empty string. When that did
 * hit, it emitted a relationship with an invented role at `confidence: 'high'`.
 *
 * It also searched EFTS unscoped, so a query naming one company returned other
 * filers' documents — a search for Microsoft's credit facility returns Barnes &
 * Noble as the top hit. Combining those two faults could attribute another
 * company's lending syndicate to the company on screen.
 *
 * This version requires a bank name and a role term to appear within the SAME
 * window of real text, and stores the sentence it found plus the document URL,
 * so every claim can be checked against the filing it came from.
 */
export function extractBankingEvidence(
  text: string,
  sourceUrl: string
): BankingRelationship[] {
  const found: BankingRelationship[] = []
  const seen = new Set<string>()

  for (const spelling of BANK_NAMES) {
    const pattern = bankNamePattern(spelling)
    const bankName = canonicalBankName(spelling)

    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0

      // A role has to be stated NEAR the name. Without one, a mention is just a
      // mention -- a bank named as an underwriter, a competitor or an index
      // constituent is not a banking relationship.
      const windowStart = Math.max(0, at - ROLE_WINDOW)
      const window = text.slice(windowStart, at + ROLE_WINDOW)
      const bankAtInWindow = at - windowStart

      // Nearest role wins, not the first one listed. Two facilities described in
      // adjacent sentences otherwise both take whichever role heads the table,
      // which silently promotes a syndication agent to administrative agent.
      let role: { role: string; distance: number } | null = null
      for (const rp of ROLE_PATTERNS) {
        for (const rm of window.matchAll(new RegExp(rp.pattern.source, 'gi'))) {
          const distance = Math.abs((rm.index ?? 0) - bankAtInWindow)
          if (!role || distance < role.distance) role = { role: rp.role, distance }
        }
      }
      if (!role) continue

      const key = `${bankName}::${role.role}`
      if (seen.has(key)) continue
      seen.add(key)

      const sizeMatch = window.match(/\$\s?([\d,.]+)\s*(billion|million)/i)
      let facilityType: string | undefined
      if (/revolving/i.test(window)) facilityType = 'Revolving Credit Facility'
      else if (/term loan/i.test(window)) facilityType = 'Term Loan'
      else if (/unsecured/i.test(window)) facilityType = 'Unsecured Credit Facility'

      found.push({
        bankName,
        role: role.role,
        facilityType,
        facilitySize: sizeMatch ? `$${sizeMatch[1]} ${sizeMatch[2].toLowerCase()}` : undefined,
        sourceExhibit: sourceUrl,
        evidence: window.trim(),
        // "high" is reserved for the agent role, which names the bank that runs
        // the facility and is the least ambiguous statement in the document.
        confidence: role.role === 'Administrative Agent' ? 'high' : 'medium',
      })
    }
  }

  return found
}

/**
 * Search a company's OWN filings for banking relationships.
 *
 * Scoped by CIK, then the matching document is fetched and read. Returns an
 * empty array when nothing can be confirmed -- never a guess.
 */
export async function extractBankingRelationships(
  companyName: string,
  cik?: string
): Promise<BankingRelationship[]> {
  if (!cik) {
    // Unscoped search returns other companies' filings, so without a CIK there
    // is no way to attribute a result correctly. Nothing is better than wrong.
    console.warn('[SEC EDGAR] Banking extraction needs a CIK; skipping', companyName)
    return []
  }

  const relationships: BankingRelationship[] = []
  const seenBankRole = new Set<string>()
  const seenDocs = new Set<string>()

  try {
    for (const q of ['"administrative agent"', '"revolving credit facility"']) {
      const res = await secFetch(
        `${SEC_BASE}/search-index?q=${encodeURIComponent(q)}&ciks=${cik}&forms=10-K,10-Q,8-K`
      )
      if (!res.ok) continue

      const data = await res.json()
      const hits = data.hits?.hits || []

      for (const hit of hits.slice(0, 3)) {
        // `_id` is "<accession>:<filename>" — the only reliable way to build
        // the archive URL for the exact document that matched.
        const [adsh, filename] = String(hit._id || '').split(':')
        if (!adsh || !filename) continue

        const numericCik = String(parseInt(cik, 10))
        const docUrl = `${SEC_WWW}/Archives/edgar/data/${numericCik}/${adsh.replace(/-/g, '')}/${filename}`
        if (seenDocs.has(docUrl)) continue
        seenDocs.add(docUrl)

        const docRes = await secFetch(docUrl)
        if (!docRes.ok) continue

        const text = filingHtmlToText(await docRes.text())
        for (const rel of extractBankingEvidence(text, docUrl)) {
          const key = `${rel.bankName}::${rel.role}`
          if (seenBankRole.has(key)) continue
          seenBankRole.add(key)
          relationships.push(rel)
        }
      }
    }
  } catch (e) {
    console.error('[SEC EDGAR] Banking relationship extraction failed:', e)
  }

  return relationships
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full financial intelligence lookup for a company.
 * Combines XBRL facts with banking relationship extraction.
 */
export async function getCompanyFinancialIntelligence(
  companyNameOrTicker: string
): Promise<CompanyFinancials | null> {
  // Step 1: Find the company in SEC EDGAR
  const match = await findCompanyCIK(companyNameOrTicker)
  if (!match) {
    console.log(`[SEC EDGAR] No match found for "${companyNameOrTicker}"`)
    return null
  }

  console.log(`[SEC EDGAR] Found ${match.name} (CIK: ${match.cik}, ticker: ${match.ticker || 'N/A'})`)

  // Step 2: Get structured XBRL financial facts
  const financials = await getCompanyFacts(match.cik)
  if (!financials) {
    console.log(`[SEC EDGAR] No XBRL facts for CIK ${match.cik}`)
    return null
  }

  financials.companyName = match.name
  financials.ticker = match.ticker

  // Step 3: Extract banking relationships from filing text
  const bankingRels = await extractBankingRelationships(match.name, match.cik)
  financials.bankingRelationships = bankingRels

  console.log(`[SEC EDGAR] ${match.name}: revenue=${financials.revenue}, assets=${financials.totalAssets}, banking_rels=${bankingRels.length}`)

  return financials
}

/**
 * Batch lookup for multiple companies.
 * Respects SEC rate limits (10 req/sec).
 */
export async function batchFinancialLookup(
  companies: string[]
): Promise<Map<string, CompanyFinancials>> {
  const results = new Map<string, CompanyFinancials>()

  for (const company of companies) {
    try {
      const intel = await getCompanyFinancialIntelligence(company)
      if (intel) {
        results.set(company, intel)
      }
    } catch (e) {
      console.error(`[SEC EDGAR] Failed for "${company}":`, e)
    }
    // Extra delay between companies to be a good citizen
    await new Promise((r) => setTimeout(r, 200))
  }

  return results
}
