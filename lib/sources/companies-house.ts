/**
 * Companies House (UK) Intelligence Adapter
 *
 * Extracts company data from the UK Companies House free API:
 *   - Company profile (status, incorporation date, SIC codes, addresses)
 *   - Officers (directors, secretaries — public leadership intelligence)
 *   - Filing history (accounts, confirmation statements)
 *   - Charges (mortgages/liens — reveals banking relationships)
 *
 * RATE LIMITS: Free API key required, 600 requests per 5 minutes.
 * LEGAL BASIS: All data is public record under the Companies Act 2006.
 *
 * Register for a free API key at: https://developer.company-information.service.gov.uk/
 */

const CH_BASE = 'https://api.company-information.service.gov.uk'

function getApiKey(): string | null {
  return process.env.COMPANIES_HOUSE_API_KEY || null
}

async function chFetch(path: string): Promise<Response | null> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[Companies House] No API key configured (COMPANIES_HOUSE_API_KEY)')
    return null
  }

  const auth = Buffer.from(`${apiKey}:`).toString('base64')
  return fetch(`${CH_BASE}${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CHCompany {
  companyNumber: string
  companyName: string
  companyStatus: string           // 'active', 'dissolved', etc.
  type: string                    // 'ltd', 'plc', 'llp', etc.
  dateOfCreation?: string
  sicCodes?: string[]
  registeredOffice?: {
    addressLine1?: string
    addressLine2?: string
    locality?: string
    region?: string
    postalCode?: string
    country?: string
  }
  hasCharges?: boolean            // true = has banking/mortgage records
  hasInsolvencyHistory?: boolean
  lastAccountsDate?: string
  confirmationStatementDate?: string
}

export interface CHOfficer {
  name: string
  role: string                    // 'director', 'secretary', 'llp-member'
  appointedOn?: string
  resignedOn?: string
  nationality?: string
  occupation?: string
  countryOfResidence?: string
}

export interface CHCharge {
  /** A charge = a mortgage, lien, or security interest — reveals the lending bank */
  chargeNumber: number
  status: string                  // 'outstanding', 'satisfied', 'part-satisfied'
  personsEntitled: string[]       // THE BANK(S) holding the charge
  classification?: string
  createdOn?: string
  deliveredOn?: string
  particulars?: string            // Description of the charge
}

export interface CHCompanyIntelligence {
  company: CHCompany
  officers: CHOfficer[]
  charges: CHCharge[]
  bankingRelationships: string[]  // Extracted from charges → personsEntitled
  dataSource: 'companies_house'
  retrievedAt: string
}

// ─── Company Search ───────────────────────────────────────────────────────────

export async function searchCompany(query: string): Promise<CHCompany | null> {
  try {
    const res = await chFetch(`/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`)
    if (!res || !res.ok) return null

    const data = await res.json()
    const items = data.items || []
    if (items.length === 0) return null

    // Pick the best match (active, closest name)
    const active = items.filter((i: any) => i.company_status === 'active')
    const best = active.length > 0 ? active[0] : items[0]

    return mapCompany(best)
  } catch (e) {
    console.error('[Companies House] Search failed:', e)
    return null
  }
}

export async function getCompanyProfile(companyNumber: string): Promise<CHCompany | null> {
  try {
    const res = await chFetch(`/company/${companyNumber}`)
    if (!res || !res.ok) return null
    const data = await res.json()
    return mapCompany(data)
  } catch (e) {
    console.error('[Companies House] Profile fetch failed:', e)
    return null
  }
}

function mapCompany(raw: any): CHCompany {
  return {
    companyNumber: raw.company_number,
    companyName: raw.company_name || raw.title,
    companyStatus: raw.company_status,
    type: raw.type || raw.company_type,
    dateOfCreation: raw.date_of_creation,
    sicCodes: raw.sic_codes,
    registeredOffice: raw.registered_office_address ? {
      addressLine1: raw.registered_office_address.address_line_1,
      addressLine2: raw.registered_office_address.address_line_2,
      locality: raw.registered_office_address.locality,
      region: raw.registered_office_address.region,
      postalCode: raw.registered_office_address.postal_code,
      country: raw.registered_office_address.country,
    } : undefined,
    hasCharges: raw.has_charges,
    hasInsolvencyHistory: raw.has_insolvency_history,
    lastAccountsDate: raw.accounts?.last_accounts?.made_up_to,
    confirmationStatementDate: raw.confirmation_statement?.last_made_up_to,
  }
}

// ─── Officers (Leadership) ────────────────────────────────────────────────────

export async function getOfficers(companyNumber: string): Promise<CHOfficer[]> {
  try {
    const res = await chFetch(`/company/${companyNumber}/officers?items_per_page=50`)
    if (!res || !res.ok) return []

    const data = await res.json()
    return (data.items || [])
      .filter((o: any) => !o.resigned_on) // Only current officers
      .map((o: any): CHOfficer => ({
        name: o.name,
        role: o.officer_role,
        appointedOn: o.appointed_on,
        resignedOn: o.resigned_on,
        nationality: o.nationality,
        occupation: o.occupation,
        countryOfResidence: o.country_of_residence,
      }))
  } catch (e) {
    console.error('[Companies House] Officers fetch failed:', e)
    return []
  }
}

// ─── Charges (Banking Relationships) ──────────────────────────────────────────

/**
 * Charges are mortgages, liens, and security interests registered against
 * a company. The `persons_entitled` field reveals which bank(s) hold the
 * charge — this is the most reliable public source of banking relationships
 * for UK companies.
 */
export async function getCharges(companyNumber: string): Promise<CHCharge[]> {
  try {
    const res = await chFetch(`/company/${companyNumber}/charges?items_per_page=50`)
    if (!res || !res.ok) return []

    const data = await res.json()
    return (data.items || []).map((c: any): CHCharge => ({
      chargeNumber: c.charge_number,
      status: c.status,
      personsEntitled: (c.persons_entitled || []).map((p: any) => p.name),
      classification: c.classification?.description,
      createdOn: c.created_on,
      deliveredOn: c.delivered_on,
      particulars: c.particulars?.description,
    }))
  } catch (e) {
    console.error('[Companies House] Charges fetch failed:', e)
    return []
  }
}

// ─── Full Intelligence ────────────────────────────────────────────────────────

/**
 * Full company intelligence from Companies House.
 * Combines company profile, officers (leadership), and charges (banking).
 */
export async function getCompanyIntelligence(
  companyNameOrNumber: string
): Promise<CHCompanyIntelligence | null> {
  // Determine if it's a company number (digits) or a name
  const isNumber = /^\d{6,8}$/.test(companyNameOrNumber.trim())

  let company: CHCompany | null
  if (isNumber) {
    company = await getCompanyProfile(companyNameOrNumber.trim().padStart(8, '0'))
  } else {
    company = await searchCompany(companyNameOrNumber)
  }

  if (!company) {
    console.log(`[Companies House] No match for "${companyNameOrNumber}"`)
    return null
  }

  console.log(`[Companies House] Found: ${company.companyName} (${company.companyNumber})`)

  // Fetch officers and charges in parallel
  const [officers, charges] = await Promise.all([
    getOfficers(company.companyNumber),
    company.hasCharges ? getCharges(company.companyNumber) : Promise.resolve([]),
  ])

  // Extract unique banking relationships from charges
  const bankingRelationships = [
    ...new Set(
      charges
        .filter((c) => c.status === 'outstanding' || c.status === 'part-satisfied')
        .flatMap((c) => c.personsEntitled)
        .filter(Boolean)
    ),
  ]

  console.log(`[Companies House] ${company.companyName}: ${officers.length} officers, ${charges.length} charges, ${bankingRelationships.length} banking rels`)

  return {
    company,
    officers,
    charges,
    bankingRelationships,
    dataSource: 'companies_house',
    retrievedAt: new Date().toISOString(),
  }
}
