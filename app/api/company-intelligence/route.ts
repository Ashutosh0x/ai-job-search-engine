import { type NextRequest, NextResponse } from 'next/server'
import {
  getBankingIntelligence,
  getBankingSlugs,
  hasBankingIntelligence,
  BANKING_INTELLIGENCE,
} from '@/lib/companies/banking-intelligence'

export const runtime = 'nodejs'

/**
 * Company Intelligence API.
 *
 * Surfaces the intelligence layer that turns a job posting into a company
 * dossier. This is the data that no other job board exposes: ATS endpoints,
 * developer API portals, email patterns, leadership, office locations,
 * hiring intelligence, and tech focus.
 *
 * GET /api/company-intelligence?slug=visa        → single company
 * GET /api/company-intelligence                   → all available slugs
 * GET /api/company-intelligence?slug=visa&field=emailPatterns → single field
 */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams
  const slug = sp.get('slug')
  const field = sp.get('field')

  // List mode: return all available slugs with summary metadata
  if (!slug) {
    const summaries = BANKING_INTELLIGENCE.map((b) => ({
      slug: b.slug,
      legalName: b.legalName,
      ticker: b.ticker ?? null,
      employees: b.employees,
      atsPlatform: b.atsPlatform,
      atsType: b.atsType,
      emailDomain: b.emailDomain,
      officeCountries: [
        ...new Set([
          ...(b.officesIndia.length ? ['India'] : []),
          ...(b.officesUk.length ? ['UK'] : []),
          ...(b.officesGermany.length ? ['Germany'] : []),
          ...(b.officesOther ?? []).map((o) => o.country),
        ]),
      ],
      leadershipCount: b.leadership.length,
      apiCount: (b.keyApis?.length ?? 0) + b.developerPortals.length,
      techFocus: b.techFocus,
    }))

    return NextResponse.json({
      success: true,
      count: summaries.length,
      institutions: summaries,
    })
  }

  // Single company lookup
  const intel = getBankingIntelligence(slug)
  if (!intel) {
    return NextResponse.json(
      {
        success: false,
        error: `No intelligence data for slug: ${slug}`,
        available: getBankingSlugs(),
      },
      { status: 404 }
    )
  }

  // Field projection: return only a specific section
  if (field) {
    const value = (intel as unknown as Record<string, unknown>)[field]
    if (value === undefined) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown field: ${field}`,
          availableFields: Object.keys(intel),
        },
        { status: 400 }
      )
    }
    return NextResponse.json({ success: true, slug, field, data: value })
  }

  return NextResponse.json({ success: true, data: intel })
}
