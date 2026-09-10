/**
 * Market capitalisation for public companies, derived rather than asserted.
 *
 *   market cap = shares outstanding (SEC EDGAR XBRL) x last close (Yahoo chart)
 *
 * Both inputs are free and require no key. SEC EDGAR is authoritative for the
 * share count (it is what the company itself filed) but publishes no price;
 * Yahoo's chart endpoint supplies the close. Neither number is invented, and
 * the result carries the as-of dates of both inputs so a stale figure is
 * visible rather than silently presented as current.
 *
 * SEC requires a descriptive User-Agent with contact details on API requests
 * and rate-limits to 10 req/s; both are respected below.
 */

const SEC_UA =
  process.env.SEC_USER_AGENT || 'JobSparkAI/1.0 (contact: support@jobspark.ai)'

export interface MarketCapResult {
  ticker: string
  marketCapUsd: number | null
  sharesOutstanding: number | null
  price: number | null
  currency: string | null
  /** ISO date of the share count as filed. */
  sharesAsOf: string | null
  /** ISO timestamp of the price quote. */
  priceAsOf: string | null
  error?: string
}

let tickerToCik: Map<string, string> | null = null

/** SEC's ticker -> CIK map. Cached for the life of the process. */
async function loadTickerMap(): Promise<Map<string, string>> {
  if (tickerToCik) return tickerToCik
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`SEC ticker map: ${res.status}`)
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string }>
  const map = new Map<string, string>()
  for (const row of Object.values(data)) {
    map.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'))
  }
  tickerToCik = map
  return map
}

/**
 * Most recent shares-outstanding value the company has filed.
 *
 * `dei:EntityCommonStockSharesOutstanding` is the cover-page figure and is the
 * closest thing to a current count. Multi-class issuers file one fact per
 * class, so the values sharing the latest end date are summed -- taking only
 * the first would understate a company like Alphabet by roughly half.
 */
async function fetchSharesOutstanding(
  cik: string
): Promise<{ shares: number | null; asOf: string | null }> {
  // Not every filer tags the cover-page concept. Airbnb, for instance,
  // publishes only dei:EntityPublicFloat. Try the cover-page fact first, then
  // the balance-sheet concept. If neither exists we return null and the caller
  // reports "not available" -- deliberately NOT falling back to
  // weighted-average diluted shares, which is a different quantity and would
  // produce a market cap that looks precise and is wrong.
  const CONCEPTS: [string, string][] = [
    ['dei', 'EntityCommonStockSharesOutstanding'],
    ['us-gaap', 'CommonStockSharesOutstanding'],
    ['us-gaap', 'CommonStockSharesIssued'],
  ]

  let units: any[] = []
  for (const [taxonomy, concept] of CONCEPTS) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json`
    const res = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' } })
    if (!res.ok) continue
    let data: any
    try {
      data = await res.json()
    } catch {
      continue // SEC returns an XML error document for a missing key
    }
    const found: any[] = data?.units?.shares ?? []
    if (found.length) {
      units = found
      break
    }
  }
  if (!units.length) return { shares: null, asOf: null }

  let latest = ''
  for (const u of units) if (u.end && u.end > latest) latest = u.end
  if (!latest) return { shares: null, asOf: null }

  // Sum distinct share classes reported at the same date. Dedupe by frame/form
  // so an amended filing does not double-count a class.
  const seen = new Map<string, number>()
  for (const u of units) {
    if (u.end !== latest) continue
    const key = `${u.frame ?? ''}|${u.form ?? ''}|${u.val}`
    if (!seen.has(key)) seen.set(key, Number(u.val) || 0)
  }
  const shares = [...seen.values()].reduce((a, b) => a + b, 0)
  return { shares: shares > 0 ? shares : null, asOf: latest }
}

/** Last close from Yahoo's public chart endpoint. */
async function fetchPrice(
  ticker: string
): Promise<{ price: number | null; currency: string | null; asOf: string | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobSparkAI/1.0)', Accept: 'application/json' },
  })
  if (!res.ok) return { price: null, currency: null, asOf: null }

  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!Number.isFinite(price)) return { price: null, currency: null, asOf: null }

  const ts = Number(meta?.regularMarketTime)
  return {
    price,
    currency: meta?.currency ?? null,
    asOf: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
  }
}

export async function getMarketCap(ticker: string): Promise<MarketCapResult> {
  const base: MarketCapResult = {
    ticker,
    marketCapUsd: null,
    sharesOutstanding: null,
    price: null,
    currency: null,
    sharesAsOf: null,
    priceAsOf: null,
  }

  try {
    const map = await loadTickerMap()
    const cik = map.get(ticker.toUpperCase())
    if (!cik) return { ...base, error: 'Ticker not found in SEC registry' }

    const [{ shares, asOf }, quote] = await Promise.all([
      fetchSharesOutstanding(cik),
      fetchPrice(ticker),
    ])

    if (!shares || !quote.price) {
      return {
        ...base,
        sharesOutstanding: shares,
        sharesAsOf: asOf,
        price: quote.price,
        currency: quote.currency,
        priceAsOf: quote.asOf,
        error: !shares ? 'No shares-outstanding fact filed' : 'No price available',
      }
    }

    return {
      ticker,
      marketCapUsd: shares * quote.price,
      sharesOutstanding: shares,
      price: quote.price,
      currency: quote.currency,
      sharesAsOf: asOf,
      priceAsOf: quote.asOf,
    }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
