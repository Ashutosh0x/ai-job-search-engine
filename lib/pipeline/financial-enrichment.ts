/**
 * Financial Enrichment Pipeline
 *
 * Connects job postings to company financial intelligence by:
 * 1. Matching company names from job data to SEC CIK numbers / CH company numbers
 * 2. Fetching and caching financial data (quarterly refresh cadence)
 * 3. Merging financial intelligence with existing company registry data
 * 4. Exposing a unified CompanyIntelligence object for the API layer
 *
 * CACHING STRATEGY
 * ----------------
 * Financial data changes quarterly (10-K/10-Q filings). We cache results in
 * Supabase with a 90-day TTL. Real-time stock data (if needed) uses a 1-day TTL.
 *
 * MATCHING STRATEGY
 * -----------------
 * Company names from ATS data are messy. We use a tiered approach:
 *   1. Exact ticker match (fastest, most reliable)
 *   2. Domain-to-company mapping from our registry
 *   3. Fuzzy name search against SEC EDGAR / Companies House
 */

import {
  getCompanyFinancialIntelligence,
  type CompanyFinancials,
  type BankingRelationship,
} from '../sources/sec-edgar'

import {
  getCompanyIntelligence as getCHIntelligence,
  type CHCompanyIntelligence,
} from '../sources/companies-house'

import {
  type BankingIntelligence,
} from '../companies/banking-intelligence'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanyFinancialProfile {
  slug: string
  companyName: string
  ticker?: string

  // Financial metrics
  revenue?: number
  revenueFormatted?: string
  netIncome?: number
  netIncomeFormatted?: string
  totalAssets?: number
  totalDebt?: number
  cashAndEquivalents?: number
  cashFormatted?: string
  marketCap?: number
  marketCapFormatted?: string
  employeeCount?: number
  revenuePerEmployee?: number

  // Financial health signals
  debtToAssetsRatio?: number
  profitMargin?: number
  cashRunway?: string          // e.g. "18 months" for startups
  financialHealthScore?: number // 0-100

  // Banking intelligence
  bankingRelationships: BankingRelationship[]
  ukBankingPartners?: string[] // From Companies House charges

  // Leadership (from Companies House officers / SEC proxy)
  leadership?: Array<{
    name: string
    role: string
    source: 'companies_house' | 'sec_proxy' | 'curated'
  }>

  // Company registration details
  registrationCountry?: string
  incorporationDate?: string
  sicCodes?: string[]
  companyStatus?: string

  // Metadata
  dataSources: string[]
  lastUpdated: string
  confidence: 'high' | 'medium' | 'low'
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

function formatCurrency(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  const abs = Math.abs(value)
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`
  return `$${value}`
}

function calculateHealthScore(financials: CompanyFinancials): number {
  let score = 50 // Base score

  // Revenue present = +10
  if (financials.revenue && financials.revenue > 0) score += 10

  // Profitable = +15
  if (financials.netIncome && financials.netIncome > 0) score += 15

  // Good cash position = +10
  if (financials.cashAndEquivalents && financials.totalAssets) {
    const cashRatio = financials.cashAndEquivalents / financials.totalAssets
    if (cashRatio > 0.1) score += 10
  }

  // Low debt ratio = +10
  if (financials.totalDebt !== undefined && financials.totalAssets) {
    const debtRatio = financials.totalDebt / financials.totalAssets
    if (debtRatio < 0.5) score += 10
    else if (debtRatio > 0.8) score -= 10
  }

  // Growing workforce = +5
  if (financials.employeeCount && financials.employeeCount > 100) score += 5

  return Math.min(100, Math.max(0, score))
}

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, { data: CompanyFinancialProfile; expires: number }>()
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days for financial data

function getCached(key: string): CompanyFinancialProfile | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key: string, data: CompanyFinancialProfile): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS })
}

// ─── Main Enrichment Function ─────────────────────────────────────────────────

/**
 * Get full financial intelligence for a company.
 * Combines SEC EDGAR (US public companies) + Companies House (UK) + curated data.
 */
export async function enrichCompanyFinancials(
  companyName: string,
  options?: {
    slug?: string
    ticker?: string
    domain?: string
    country?: string
    existingBankingIntel?: BankingIntelligence
  }
): Promise<CompanyFinancialProfile | null> {
  const cacheKey = (options?.slug || companyName).toLowerCase()

  // Check cache first
  const cached = getCached(cacheKey)
  if (cached) return cached

  const slug = options?.slug || companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const dataSources: string[] = []
  let secData: CompanyFinancials | null = null
  let chData: CHCompanyIntelligence | null = null

  // ── SEC EDGAR (US public companies) ─────────────────────────────
  try {
    const query = options?.ticker || companyName
    secData = await getCompanyFinancialIntelligence(query)
    if (secData) dataSources.push('sec_edgar')
  } catch (e) {
    console.error(`[Enrichment] SEC EDGAR failed for "${companyName}":`, e)
  }

  // ── Companies House (UK companies) ──────────────────────────────
  // Only query CH if the company might be UK-based or we didn't find SEC data
  const isLikelyUK = options?.country?.toLowerCase().includes('uk') ||
                     options?.country?.toLowerCase().includes('united kingdom') ||
                     options?.country?.toLowerCase().includes('gb')

  if (isLikelyUK || !secData) {
    try {
      chData = await getCHIntelligence(companyName)
      if (chData) dataSources.push('companies_house')
    } catch (e) {
      console.error(`[Enrichment] Companies House failed for "${companyName}":`, e)
    }
  }

  // ── Merge curated banking intelligence ──────────────────────────
  if (options?.existingBankingIntel) {
    dataSources.push('curated_banking_intel')
  }

  // If we have no data at all, return null
  if (!secData && !chData && !options?.existingBankingIntel) {
    return null
  }

  // ── Build the unified profile ───────────────────────────────────

  const bankingRels: BankingRelationship[] = [
    ...(secData?.bankingRelationships || []),
  ]

  const profile: CompanyFinancialProfile = {
    slug,
    companyName: secData?.companyName || chData?.company.companyName || companyName,
    ticker: secData?.ticker || options?.ticker,

    // Financial metrics (from SEC EDGAR)
    revenue: secData?.revenue,
    revenueFormatted: formatCurrency(secData?.revenue),
    netIncome: secData?.netIncome,
    netIncomeFormatted: formatCurrency(secData?.netIncome),
    totalAssets: secData?.totalAssets,
    totalDebt: secData?.totalDebt,
    cashAndEquivalents: secData?.cashAndEquivalents,
    cashFormatted: formatCurrency(secData?.cashAndEquivalents),
    marketCap: secData?.marketCap,
    marketCapFormatted: formatCurrency(secData?.marketCap),
    employeeCount: secData?.employeeCount,
    revenuePerEmployee: secData?.revenuePerEmployee,

    // Financial health signals
    debtToAssetsRatio: (secData?.totalDebt && secData?.totalAssets)
      ? secData.totalDebt / secData.totalAssets
      : undefined,
    profitMargin: (secData?.netIncome && secData?.revenue)
      ? secData.netIncome / secData.revenue
      : undefined,
    financialHealthScore: secData ? calculateHealthScore(secData) : undefined,

    // Banking
    bankingRelationships: bankingRels,
    ukBankingPartners: chData?.bankingRelationships,

    // Leadership (from Companies House)
    leadership: chData?.officers
      .filter((o) => o.role === 'director' || o.role === 'llp-member')
      .slice(0, 10)
      .map((o) => ({
        name: o.name,
        role: o.role === 'director' ? 'Director' : 'Member',
        source: 'companies_house' as const,
      })),

    // Company details
    registrationCountry: chData ? 'United Kingdom' : (secData ? 'United States' : undefined),
    incorporationDate: chData?.company.dateOfCreation,
    sicCodes: chData?.company.sicCodes,
    companyStatus: chData?.company.companyStatus,

    // Metadata
    dataSources,
    lastUpdated: new Date().toISOString(),
    confidence: secData && chData ? 'high' : (secData || chData ? 'medium' : 'low'),
  }

  // Cache the result
  setCache(cacheKey, profile)

  return profile
}

/**
 * Batch enrichment for all companies discovered in the job corpus.
 * Designed to run as a background pipeline task.
 */
export async function enrichBatchFromRegistry(
  companies: Array<{ name: string; slug: string; ticker?: string; country?: string }>
): Promise<{ enriched: number; failed: number; skipped: number }> {
  let enriched = 0
  let failed = 0
  let skipped = 0

  for (const company of companies) {
    // Skip if already cached
    if (getCached(company.slug)) {
      skipped++
      continue
    }

    try {
      const result = await enrichCompanyFinancials(company.name, {
        slug: company.slug,
        ticker: company.ticker,
        country: company.country,
      })

      if (result) {
        enriched++
        console.log(`[Enrichment] ✓ ${company.name} — revenue=${result.revenueFormatted || 'N/A'}, health=${result.financialHealthScore || 'N/A'}`)
      } else {
        failed++
        console.log(`[Enrichment] ✗ ${company.name} — no data found`)
      }
    } catch (e) {
      failed++
      console.error(`[Enrichment] ✗ ${company.name} — error:`, e)
    }

    // Delay between companies (respecting API rate limits)
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`[Enrichment] Done: ${enriched} enriched, ${failed} failed, ${skipped} cached`)
  return { enriched, failed, skipped }
}
