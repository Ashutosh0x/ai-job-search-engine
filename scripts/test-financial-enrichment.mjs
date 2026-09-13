/**
 * Assertions for the SEC EDGAR financial-intelligence layer.
 *
 *   npx tsx scripts/test-financial-enrichment.mjs
 *
 * Every fixture below is shaped from a real companyfacts / EFTS response
 * observed against the live SEC service on 2026-09-14, not invented. Each one
 * pins a bug that was present in the adapter and that produced a plausible,
 * ordinary-looking wrong number rather than an error:
 *
 *   1. Concept preference order returned Microsoft's FY2010 revenue in 2026.
 *   2. Filtering on form alone returned a Q4 figure as the annual one.
 *   3. The banking extractor read an exhibit LABEL as if it were filing prose,
 *      and searched EFTS unscoped so another filer's document could answer.
 *
 * No network: these are pure-function tests. `scripts/verify-sec-live.mjs`
 * covers the live service separately.
 */
import {
  selectLatestAnnual,
  selectLatestInstant,
  isFullYearFact,
  factSpanDays,
  extractBankingEvidence,
  filingHtmlToText,
  bankNamePattern,
  canonicalBankName,
  REVENUE_CONCEPTS,
} from '../lib/sources/sec-edgar.ts'

let pass = 0, fail = 0
const t = (n, c, g) => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (g !== undefined ? '  got: ' + JSON.stringify(g) : '')) } }

const usd = (facts) => ({ units: { USD: facts } })

console.log('\nfull-year detection')
t('FY fact spanning a year is annual',
  isFullYearFact({ val: 1, start: '2025-01-01', end: '2025-12-31', fp: 'FY', form: '10-K' }) === true)
t('Q4 fact inside a 10-K is NOT annual',
  isFullYearFact({ val: 1, start: '2025-10-01', end: '2025-12-31', fp: 'Q4', form: '10-K' }) === false)
t('FY-marked fact with a quarter-long span is rejected',
  isFullYearFact({ val: 1, start: '2025-10-01', end: '2025-12-31', fp: 'FY', form: '10-K' }) === false)
t('instant fact (no start) is not a full-year duration',
  isFullYearFact({ val: 1, end: '2025-12-31', fp: 'FY', form: '10-K' }) === false)
t('null value is never annual',
  isFullYearFact({ val: null, start: '2025-01-01', end: '2025-12-31', fp: 'FY', form: '10-K' }) === false)
t('factSpanDays measures the period', factSpanDays({ val: 1, start: '2025-01-01', end: '2025-12-31' }) === 364)
t('factSpanDays null for instants', factSpanDays({ val: 1, end: '2025-12-31' }) === null)

console.log('\nthe Microsoft trap: a stale concept must not win on order')
{
  // Microsoft really does report both. `Revenues` stops at FY2010; the current
  // figure lives under the contract-revenue concept.
  const msft = {
    Revenues: usd([
      { val: 62_484_000_000, start: '2009-07-01', end: '2010-06-30', fp: 'FY', form: '10-K', filed: '2010-07-30' },
      { val: 16_039_000_000, start: '2010-04-01', end: '2010-06-30', fp: 'Q4', form: '10-K', filed: '2010-07-30' },
    ]),
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([
      { val: 331_800_000_000, start: '2025-07-01', end: '2026-06-30', fp: 'FY', form: '10-K', filed: '2026-07-30' },
    ]),
  }

  const picked = selectLatestAnnual(msft, REVENUE_CONCEPTS)
  t('picks the concept with the most RECENT year, not the first listed',
    picked.fact.val === 331_800_000_000, picked.fact.val)
  t('reports which concept it came from',
    picked.concept === 'RevenueFromContractWithCustomerExcludingAssessedTax', picked.concept)
  t('the stale concept is listed FIRST in REVENUE_CONCEPTS, so order is not doing the work',
    REVENUE_CONCEPTS.indexOf('Revenues') < REVENUE_CONCEPTS.indexOf('RevenueFromContractWithCustomerExcludingAssessedTax'))

  // The old code took the last 10-K entry, which here is the Q4 number.
  const lastEntryOfFirstConcept = msft.Revenues.units.USD[msft.Revenues.units.USD.length - 1].val
  t('the old behaviour would have returned a QUARTERLY figure', lastEntryOfFirstConcept === 16_039_000_000)
  t('and it is understated 20x against the real annual number',
    Math.round(picked.fact.val / lastEntryOfFirstConcept) === 21, Math.round(picked.fact.val / lastEntryOfFirstConcept))
}

console.log('\nannual selection')
{
  const nvda = {
    Revenues: usd([
      { val: 26_914_000_000, start: '2021-02-01', end: '2022-01-30', fp: 'FY', form: '10-K' },
      { val: 215_900_000_000, start: '2025-01-27', end: '2026-01-25', fp: 'FY', form: '10-K' },
    ]),
  }
  t('latest fiscal year wins', selectLatestAnnual(nvda, REVENUE_CONCEPTS).fact.val === 215_900_000_000)
  t('null when no concept matches', selectLatestAnnual(nvda, ['NotATag']) === null)
  t('null when the only facts are quarterly',
    selectLatestAnnual({ Revenues: usd([{ val: 5, start: '2025-10-01', end: '2025-12-31', fp: 'Q4', form: '10-K' }]) }, ['Revenues']) === null)
  t('10-Q facts are ignored even when newer',
    selectLatestAnnual({ Revenues: usd([
      { val: 100, start: '2025-01-01', end: '2025-12-31', fp: 'FY', form: '10-K' },
      { val: 999, start: '2026-01-01', end: '2026-12-31', fp: 'FY', form: '10-Q' },
    ]) }, ['Revenues']).fact.val === 100)
  t('20-F (foreign annual report) is accepted',
    selectLatestAnnual({ Revenues: usd([{ val: 77, start: '2025-01-01', end: '2025-12-31', fp: 'FY', form: '20-F' }]) }, ['Revenues']).fact.val === 77)
}

console.log('\nbalance-sheet instants')
{
  const facts = {
    Assets: usd([
      { val: 100, end: '2024-12-31', fp: 'FY', form: '10-K' },
      { val: 200, end: '2025-12-31', fp: 'FY', form: '10-K' },
    ]),
    Cash: usd([{ val: 9, start: '2025-01-01', end: '2025-12-31', fp: 'FY', form: '10-K' }]),
  }
  t('latest instant wins', selectLatestInstant(facts, ['Assets']).fact.val === 200)
  t('duration facts are not treated as instants', selectLatestInstant(facts, ['Cash']) === null)
}

console.log('\nbanking evidence: a mention is not a relationship')
{
  // Real sentence from Microsoft's 424B2, fetched from the SEC archive.
  const real = 'An affiliate of J.P. Morgan Securities Inc. is the administrative agent under our credit agreement dated as of November 7, 2008, and affiliates of Banc of America Securities LLC participate as lenders.'
  const rels = extractBankingEvidence(real, 'https://www.sec.gov/Archives/x.htm')
  // "J.P. Morgan Securities" is reported under the canonical institution name,
  // not whichever spelling the filing happened to use.
  const jpm = rels.find((r) => r.bankName === 'JPMorgan Chase')
  t('finds the administrative agent', !!jpm, rels.map((r) => r.bankName))
  t('agent role is high confidence', jpm && jpm.confidence === 'high')
  t('stores the source document url', jpm && jpm.sourceExhibit === 'https://www.sec.gov/Archives/x.htm')
  t('stores the evidence text', jpm && jpm.evidence.includes('administrative agent'))
}
{
  // A bank named with no role nearby is not a banking relationship. This is the
  // case that used to fabricate one.
  const mention = 'Our competitors include Goldman Sachs and Morgan Stanley in certain markets. The index also contains Barclays.'
  t('bank named without a role yields nothing',
    extractBankingEvidence(mention, 'u').length === 0, extractBankingEvidence(mention, 'u'))
}
{
  // What the old extractor actually read: the exhibit label, never prose.
  t('an exhibit label yields nothing', extractBankingEvidence('EX-13.1', 'u').length === 0)
  t('an empty document yields nothing', extractBankingEvidence('', 'u').length === 0)
}
{
  const twoRoles = 'Citibank, N.A. acts as administrative agent. Separately, HSBC serves as syndication agent for the $2.5 billion revolving credit facility.'
  const rels = extractBankingEvidence(twoRoles, 'u')
  t('finds both banks', rels.length === 2, rels.map((r) => r.bankName + ':' + r.role))
  const hsbc = rels.find((r) => r.bankName === 'HSBC')
  t('captures facility size', hsbc && hsbc.facilitySize === '$2.5 billion', hsbc && hsbc.facilitySize)
  t('captures facility type', hsbc && hsbc.facilityType === 'Revolving Credit Facility', hsbc && hsbc.facilityType)
  t('syndication agent is medium, not high', hsbc && hsbc.confidence === 'medium')
}
{
  const dup = 'Barclays is the administrative agent. Barclays is the administrative agent under the facility.'
  t('same bank+role reported once', extractBankingEvidence(dup, 'u').length === 1)
}

console.log('\ncanonical bank identity')
t('JP Morgan and JPMorgan Chase are one institution',
  canonicalBankName('JP Morgan') === canonicalBankName('JPMorgan Chase'))
t('an unaliased bank is returned unchanged', canonicalBankName('Barclays') === 'Barclays')
{
  // The real failure this prevents: JPMorgan's own filing names the same bank
  // under two spellings, and it read as two lenders in a syndicate.
  const text = 'JPMorgan Chase Bank, N.A. is the administrative agent. J.P. Morgan Securities LLC acted as bookrunner.'
  const names = new Set(extractBankingEvidence(text, 'u').map((r) => r.bankName))
  t('both spellings collapse to one bank', names.size === 1, [...names])
}

console.log('\nbank name matching')
t('ING does not match inside "revolving"',
  extractBankingEvidence('the revolving credit administrative agent facility', 'u').length === 0)
t('initials with periods still match', bankNamePattern('JP Morgan').test('J.P. Morgan Securities'))
t('initials without periods still match', bankNamePattern('JP Morgan').test('JP Morgan Chase'))
t('a bank name inside a longer word does not match', bankNamePattern('ING').test('lending') === false)

console.log('\nfiling html to text')
t('strips tags', filingHtmlToText('<p>Wells Fargo</p>') === 'Wells Fargo')
t('decodes nbsp', filingHtmlToText('a&nbsp;b') === 'a b')
t('drops script bodies', filingHtmlToText('<script>var x="Citibank"</script><p>ok</p>') === 'ok')
t('collapses whitespace', filingHtmlToText('<div>a</div>\n\n   <div>b</div>') === 'a b')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
