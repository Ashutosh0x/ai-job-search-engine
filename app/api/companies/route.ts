import { NextResponse } from 'next/server'
import { listCompanies } from '@/lib/job-index'

export const runtime = 'nodejs'

/** All verified companies, richest first. */
export async function GET() {
  const companies = await listCompanies()
  if (!companies) {
    return NextResponse.json(
      {
        success: false,
        error: 'Company index is not available',
        hint: 'Run `npx tsx scripts/ingest-jobs.mjs` to build the index.',
      },
      { status: 503 }
    )
  }

  return NextResponse.json({
    success: true,
    total: companies.length,
    totalOpenRoles: companies.reduce((s, c) => s + (c.openRoles ?? 0), 0),
    companies: companies.map((c) => ({
      slug: c.slug,
      name: c.name,
      domain: c.domain,
      logoUrl: c.logoUrl,
      industry: c.industry ?? null,
      hqLocation: c.hqLocation ?? null,
      foundedYear: c.foundedYear ?? null,
      openRoles: c.openRoles ?? 0,
      valuationUsd: c.valuationUsd ?? null,
      valuationKind: c.valuationKind,
      valuationTier: c.valuationTier,
      valuationAsOf: c.valuationAsOf ?? null,
      valuationSource: c.valuationSource ?? null,
      ticker: c.ticker ?? null,
      atsProviders: c.boards.map((b) => b.provider),
    })),
  })
}
