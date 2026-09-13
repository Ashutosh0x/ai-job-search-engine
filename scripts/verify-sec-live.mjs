/**
 * Live verification of the SEC EDGAR adapter against the real service.
 *
 *   npx tsx scripts/verify-sec-live.mjs
 *
 * Deliberately NOT in `npm test` — it makes network calls to sec.gov and its
 * results move as companies file. It exists so the adapter's numbers can be
 * checked against the filings a human can open, rather than only against
 * fixtures written from the same assumptions as the code.
 *
 * Sanity bounds are wide on purpose. The point is to catch order-of-magnitude
 * wrongness — a quarterly figure served as annual, a sixteen-year-old number
 * served as current — not to pin a value that legitimately changes.
 */
import { findCompanyCIK, getCompanyFacts, extractBankingRelationships } from '../lib/sources/sec-edgar.ts'

const CASES = [
  // company,       ticker, min revenue USD, max, earliest acceptable period end
  { q: 'MSFT', expectName: /MICROSOFT/i, minRev: 200e9, maxRev: 900e9, since: '2025-01-01' },
  { q: 'NVDA', expectName: /NVIDIA/i, minRev: 100e9, maxRev: 900e9, since: '2025-01-01' },
  { q: 'JPM', expectName: /JPMORGAN/i, minRev: 50e9, maxRev: 900e9, since: '2024-06-01' },
]

let pass = 0, fail = 0
const t = (n, c, g) => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (g !== undefined ? '  got: ' + JSON.stringify(g) : '')) } }
const b = (n) => n === undefined ? 'n/a' : '$' + (n / 1e9).toFixed(1) + 'B'

for (const c of CASES) {
  console.log(`\n=== ${c.q} ===`)

  const match = await findCompanyCIK(c.q)
  t('ticker resolves to a CIK', !!match?.cik, match)
  if (!match) continue
  t('resolves to the expected company', c.expectName.test(match.name), match.name)

  const fin = await getCompanyFacts(match.cik)
  t('companyfacts returns data', !!fin)
  if (!fin) continue

  console.log(`      revenue ${b(fin.revenue)}  (${fin.revenueConcept}, FY ending ${fin.fiscalPeriodEnd})`)
  console.log(`      assets  ${b(fin.totalAssets)}   cash ${b(fin.cashAndEquivalents)}   netIncome ${b(fin.netIncome)}`)

  t('revenue is within a sane range', fin.revenue > c.minRev && fin.revenue < c.maxRev, b(fin.revenue))
  t('revenue is CURRENT, not a stale concept', fin.fiscalPeriodEnd >= c.since, fin.fiscalPeriodEnd)
  t('revenue records its source concept', !!fin.revenueConcept, fin.revenueConcept)
  // NOT "assets > revenue" — that is false for a high-turnover business and
  // NVIDIA fails it legitimately (FY2026: $215.9B revenue on $206.8B assets).
  // Assert only what is actually universal.
  t('total assets present and positive', fin.totalAssets > 0, b(fin.totalAssets))
  t('assets within an order of magnitude sanity band', fin.totalAssets < 100e12, b(fin.totalAssets))
  t('employeeCount is absent rather than wrong', fin.employeeCount === undefined, fin.employeeCount)

  const rels = await extractBankingRelationships(match.name, match.cik)
  console.log(`      banking relationships: ${rels.length}`)
  for (const r of rels.slice(0, 4)) {
    console.log(`        - ${r.bankName} (${r.role}${r.facilitySize ? ', ' + r.facilitySize : ''}) [${r.confidence}]`)
  }
  t('every banking claim carries a source document', rels.every((r) => /^https:\/\/www\.sec\.gov\/Archives\//.test(r.sourceExhibit || '')))
  t('every banking claim carries evidence text', rels.every((r) => (r.evidence || '').length > 20))
  t('no claim is high confidence without the agent role',
    rels.every((r) => r.confidence !== 'high' || r.role === 'Administrative Agent'))
}

console.log('\n--- unscoped extraction must refuse ---')
t('no CIK => no relationships (cannot attribute correctly)',
  (await extractBankingRelationships('Microsoft', undefined)).length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
