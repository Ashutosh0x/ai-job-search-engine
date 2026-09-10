import type { AtsProvider } from '../ats/types'

/**
 * Company registry.
 *
 * Each entry is an employer we have VERIFIED by reaching its own ATS board and
 * seeing live postings (see scripts/verify-ats-boards.mjs). That verification
 * is what "genuine company" means here -- not a name scraped off a listings
 * page, but an employer whose own applicant tracking system is answering.
 *
 * VALUATION PROVENANCE
 * --------------------
 * Valuation is only as good as its source, so every figure carries one.
 *
 *  - `public`  : market capitalisation, computed at ingest time from SEC EDGAR
 *                shares-outstanding x last close. Both inputs are free and
 *                authoritative; the number is derived, not asserted.
 *  - `private` : last publicly reported post-money valuation, entered by hand
 *                with a source and an as-of date. There is no free API that
 *                reports private valuations reliably, so these are curated
 *                rather than fetched, and the UI must show the as-of date.
 *                A stale private valuation presented as current is exactly the
 *                kind of confident-but-wrong number worth avoiding.
 *  - `unknown` : we genuinely do not know. Shown as "Not disclosed", never
 *                guessed or interpolated.
 */

export type ValuationKind = 'public' | 'private' | 'unknown'

export interface CompanyBoard {
  provider: AtsProvider
  token: string
  site?: string
  host?: string
}

export interface CompanyRecord {
  slug: string
  name: string
  /** Primary domain; drives the logo and is the join key for enrichment. */
  domain: string
  boards: CompanyBoard[]
  valuationKind: ValuationKind
  /** SEC ticker, for `public`. Market cap is derived from this at ingest. */
  ticker?: string
  /** USD. For `private` only -- last reported post-money. */
  reportedValuationUsd?: number
  /** ISO date the private figure refers to. */
  valuationAsOf?: string
  /** Where the private figure came from. */
  valuationSource?: string
  industry?: string
  hqLocation?: string
  foundedYear?: number
}

/**
 * Seeded from boards confirmed live on 10 Sep 2026. Only companies whose board
 * actually answered with open roles are included.
 */
export const COMPANIES: CompanyRecord[] = [
  // ---- Public companies: valuation derived from SEC EDGAR + last close ----
  { slug: 'salesforce', name: 'Salesforce', domain: 'salesforce.com', ticker: 'CRM', valuationKind: 'public', industry: 'Enterprise Software', hqLocation: 'San Francisco, CA', foundedYear: 1999,
    boards: [{ provider: 'workday', token: 'salesforce', site: 'External_Career_Site', host: 'salesforce.wd12.myworkdayjobs.com' }] },
  { slug: 'adobe', name: 'Adobe', domain: 'adobe.com', ticker: 'ADBE', valuationKind: 'public', industry: 'Creative Software', hqLocation: 'San Jose, CA', foundedYear: 1982,
    boards: [{ provider: 'workday', token: 'adobe', site: 'external_experienced', host: 'adobe.wd5.myworkdayjobs.com' }] },
  { slug: 'airbnb', name: 'Airbnb', domain: 'airbnb.com', ticker: 'ABNB', valuationKind: 'public', industry: 'Travel Marketplace', hqLocation: 'San Francisco, CA', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'airbnb' }] },
  { slug: 'coinbase', name: 'Coinbase', domain: 'coinbase.com', ticker: 'COIN', valuationKind: 'public', industry: 'Crypto Exchange', hqLocation: 'Remote-first, USA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'coinbase' }] },
  { slug: 'robinhood', name: 'Robinhood', domain: 'robinhood.com', ticker: 'HOOD', valuationKind: 'public', industry: 'Fintech / Brokerage', hqLocation: 'Menlo Park, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'robinhood' }] },
  { slug: 'reddit', name: 'Reddit', domain: 'reddit.com', ticker: 'RDDT', valuationKind: 'public', industry: 'Social Media', hqLocation: 'San Francisco, CA', foundedYear: 2005,
    boards: [{ provider: 'greenhouse', token: 'reddit' }] },
  { slug: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', ticker: 'PINS', valuationKind: 'public', industry: 'Social Media', hqLocation: 'San Francisco, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'pinterest' }] },
  { slug: 'lyft', name: 'Lyft', domain: 'lyft.com', ticker: 'LYFT', valuationKind: 'public', industry: 'Mobility', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'lyft' }] },
  { slug: 'twilio', name: 'Twilio', domain: 'twilio.com', ticker: 'TWLO', valuationKind: 'public', industry: 'Communications API', hqLocation: 'San Francisco, CA', foundedYear: 2008,
    boards: [{ provider: 'greenhouse', token: 'twilio' }] },
  { slug: 'dropbox', name: 'Dropbox', domain: 'dropbox.com', ticker: 'DBX', valuationKind: 'public', industry: 'Cloud Storage', hqLocation: 'San Francisco, CA', foundedYear: 2007,
    boards: [{ provider: 'greenhouse', token: 'dropbox' }] },
  { slug: 'affirm', name: 'Affirm', domain: 'affirm.com', ticker: 'AFRM', valuationKind: 'public', industry: 'Fintech / BNPL', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'affirm' }] },
  { slug: 'samsara', name: 'Samsara', domain: 'samsara.com', ticker: 'IOT', valuationKind: 'public', industry: 'IoT / Fleet', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'samsara' }] },
  { slug: 'sofi', name: 'SoFi', domain: 'sofi.com', ticker: 'SOFI', valuationKind: 'public', industry: 'Fintech / Banking', hqLocation: 'San Francisco, CA', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'sofi' }] },
  { slug: 'gitlab', name: 'GitLab', domain: 'gitlab.com', ticker: 'GTLB', valuationKind: 'public', industry: 'DevOps', hqLocation: 'All-remote', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'gitlab' }] },
  { slug: 'instacart', name: 'Instacart', domain: 'instacart.com', ticker: 'CART', valuationKind: 'public', industry: 'Grocery Delivery', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'instacart' }] },
  { slug: 'palantir', name: 'Palantir', domain: 'palantir.com', ticker: 'PLTR', valuationKind: 'public', industry: 'Data Analytics', hqLocation: 'Denver, CO', foundedYear: 2003,
    boards: [{ provider: 'lever', token: 'palantir' }] },
  { slug: 'spotify', name: 'Spotify', domain: 'spotify.com', ticker: 'SPOT', valuationKind: 'public', industry: 'Audio Streaming', hqLocation: 'Stockholm, Sweden', foundedYear: 2006,
    boards: [{ provider: 'lever', token: 'spotify' }] },
  { slug: 'wise', name: 'Wise', domain: 'wise.com', valuationKind: 'unknown', industry: 'Fintech / Payments', hqLocation: 'London, UK', foundedYear: 2011,
    boards: [{ provider: 'greenhouse', token: 'wise' }] },

  // ---- Private companies: curated, each with a source and an as-of date ----
  { slug: 'openai', name: 'OpenAI', domain: 'openai.com', valuationKind: 'private',
    reportedValuationUsd: 500_000_000_000, valuationAsOf: '2025-10-02',
    valuationSource: 'Secondary share sale reported by Reuters/Bloomberg, Oct 2025',
    industry: 'Artificial Intelligence', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'ashby', token: 'openai' }] },
  { slug: 'anthropic', name: 'Anthropic', domain: 'anthropic.com', valuationKind: 'private',
    reportedValuationUsd: 183_000_000_000, valuationAsOf: '2025-09-02',
    valuationSource: 'Series F, announced Sep 2025',
    industry: 'Artificial Intelligence', hqLocation: 'San Francisco, CA', foundedYear: 2021,
    boards: [{ provider: 'greenhouse', token: 'anthropic' }] },
  { slug: 'databricks', name: 'Databricks', domain: 'databricks.com', valuationKind: 'private',
    reportedValuationUsd: 100_000_000_000, valuationAsOf: '2025-08-01',
    valuationSource: 'Series K, reported Aug 2025',
    industry: 'Data & AI Platform', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'databricks' }] },
  { slug: 'stripe', name: 'Stripe', domain: 'stripe.com', valuationKind: 'private',
    reportedValuationUsd: 106_500_000_000, valuationAsOf: '2025-02-27',
    valuationSource: 'Tender offer, Feb 2025',
    industry: 'Payments Infrastructure', hqLocation: 'South San Francisco, CA', foundedYear: 2010,
    boards: [{ provider: 'greenhouse', token: 'stripe' }] },
  { slug: 'figma', name: 'Figma', domain: 'figma.com', valuationKind: 'unknown',
    industry: 'Design Software', hqLocation: 'San Francisco, CA', foundedYear: 2012,
    boards: [{ provider: 'greenhouse', token: 'figma' }] },
  { slug: 'cloudflare', name: 'Cloudflare', domain: 'cloudflare.com', ticker: 'NET', valuationKind: 'public',
    industry: 'Internet Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2009,
    boards: [{ provider: 'greenhouse', token: 'cloudflare' }] },
  { slug: 'scale-ai', name: 'Scale AI', domain: 'scale.com', valuationKind: 'private',
    reportedValuationUsd: 29_000_000_000, valuationAsOf: '2025-06-13',
    valuationSource: 'Meta investment, Jun 2025',
    industry: 'AI Data Infrastructure', hqLocation: 'San Francisco, CA', foundedYear: 2016,
    boards: [{ provider: 'greenhouse', token: 'scaleai' }] },
  { slug: 'brex', name: 'Brex', domain: 'brex.com', valuationKind: 'private',
    reportedValuationUsd: 12_300_000_000, valuationAsOf: '2024-10-01',
    valuationSource: 'Series D-2, Oct 2024',
    industry: 'Corporate Fintech', hqLocation: 'San Francisco, CA', foundedYear: 2017,
    boards: [{ provider: 'greenhouse', token: 'brex' }] },
  { slug: 'discord', name: 'Discord', domain: 'discord.com', valuationKind: 'private',
    reportedValuationUsd: 14_800_000_000, valuationAsOf: '2021-09-15',
    valuationSource: 'Series H, Sep 2021 (no newer public figure)',
    industry: 'Communications', hqLocation: 'San Francisco, CA', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'discord' }] },
  { slug: 'flexport', name: 'Flexport', domain: 'flexport.com', valuationKind: 'private',
    reportedValuationUsd: 8_000_000_000, valuationAsOf: '2022-02-01',
    valuationSource: 'Series E, Feb 2022',
    industry: 'Logistics', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'greenhouse', token: 'flexport' }] },
  { slug: 'monzo', name: 'Monzo', domain: 'monzo.com', valuationKind: 'private',
    reportedValuationUsd: 5_900_000_000, valuationAsOf: '2025-03-01',
    valuationSource: 'Secondary sale reported Mar 2025',
    industry: 'Digital Banking', hqLocation: 'London, UK', foundedYear: 2015,
    boards: [{ provider: 'greenhouse', token: 'monzo' }] },
  { slug: 'supabase', name: 'Supabase', domain: 'supabase.com', valuationKind: 'private',
    reportedValuationUsd: 5_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Series E, reported Sep 2025',
    industry: 'Developer Platform', hqLocation: 'Remote-first', foundedYear: 2020,
    boards: [{ provider: 'ashby', token: 'supabase' }] },
  { slug: 'replit', name: 'Replit', domain: 'replit.com', valuationKind: 'private',
    reportedValuationUsd: 3_000_000_000, valuationAsOf: '2025-09-01',
    valuationSource: 'Series C, reported Sep 2025',
    industry: 'Developer Tools', hqLocation: 'Foster City, CA', foundedYear: 2016,
    boards: [{ provider: 'ashby', token: 'replit' }] },
  { slug: 'linear', name: 'Linear', domain: 'linear.app', valuationKind: 'private',
    reportedValuationUsd: 1_250_000_000, valuationAsOf: '2025-06-01',
    valuationSource: 'Series C, Jun 2025',
    industry: 'Developer Tools', hqLocation: 'Remote-first', foundedYear: 2019,
    boards: [{ provider: 'ashby', token: 'linear' }] },
  { slug: 'notion', name: 'Notion', domain: 'notion.so', valuationKind: 'private',
    reportedValuationUsd: 10_000_000_000, valuationAsOf: '2021-10-08',
    valuationSource: 'Series C, Oct 2021 (no newer public figure)',
    industry: 'Productivity Software', hqLocation: 'San Francisco, CA', foundedYear: 2013,
    boards: [{ provider: 'ashby', token: 'notion' }] },
  { slug: 'cohere', name: 'Cohere', domain: 'cohere.com', valuationKind: 'private',
    reportedValuationUsd: 6_800_000_000, valuationAsOf: '2025-08-14',
    valuationSource: 'Series D extension, Aug 2025',
    industry: 'Artificial Intelligence', hqLocation: 'Toronto, Canada', foundedYear: 2019,
    boards: [{ provider: 'ashby', token: 'cohere' }] },
  { slug: 'posthog', name: 'PostHog', domain: 'posthog.com', valuationKind: 'private',
    reportedValuationUsd: 920_000_000, valuationAsOf: '2025-05-01',
    valuationSource: 'Series D, May 2025',
    industry: 'Product Analytics', hqLocation: 'Remote-first', foundedYear: 2020,
    boards: [{ provider: 'ashby', token: 'posthog' }] },
  { slug: 'clickhouse', name: 'ClickHouse', domain: 'clickhouse.com', valuationKind: 'private',
    reportedValuationUsd: 6_350_000_000, valuationAsOf: '2025-05-28',
    valuationSource: 'Series C, May 2025',
    industry: 'Database', hqLocation: 'Portola Valley, CA', foundedYear: 2021,
    boards: [{ provider: 'ashby', token: 'clickhouse' }] },
  { slug: 'elevenlabs', name: 'ElevenLabs', domain: 'elevenlabs.io', valuationKind: 'private',
    reportedValuationUsd: 3_300_000_000, valuationAsOf: '2025-01-30',
    valuationSource: 'Series C, Jan 2025',
    industry: 'Artificial Intelligence', hqLocation: 'New York, NY', foundedYear: 2022,
    boards: [{ provider: 'ashby', token: 'elevenlabs' }] },
]

export const COMPANY_BY_SLUG = new Map(COMPANIES.map((c) => [c.slug, c]))

/**
 * Logo URL for a company.
 *
 * Logo.dev and Clearbit both serve logos keyed by domain, which is why the
 * registry stores a domain rather than an image. Google's favicon service is
 * the keyless fallback and is what we use by default, so the app has no
 * third-party logo dependency and no API key to leak.
 *
 * This replaces the emoji "logos" ("üöÄ", "‚ö°", "üé®") that the jobs page
 * previously hard-coded alongside invented companies.
 */
export function companyLogoUrl(domain: string, size = 128): string {
  const token = process.env.NEXT_PUBLIC_LOGODEV_TOKEN
  if (token) {
    return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(token)}&size=${size}&format=png`
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
}

/** Compact human formatting for large USD figures. */
export function formatValuation(usd: number | null | undefined): string {
  if (!usd || !Number.isFinite(usd)) return 'Not disclosed'
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(usd >= 1e13 ? 0 : 1)}T`
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`
  return `$${usd.toLocaleString()}`
}

/** Buckets used by the valuation facet in the UI. */
export const VALUATION_TIERS = [
  { id: 'mega', label: '$100B+', min: 100e9, max: Infinity },
  { id: 'decacorn', label: '$10B - $100B', min: 10e9, max: 100e9 },
  { id: 'unicorn', label: '$1B - $10B', min: 1e9, max: 10e9 },
  { id: 'growth', label: 'Under $1B', min: 0, max: 1e9 },
] as const

export function valuationTier(usd: number | null | undefined): string | null {
  if (!usd || !Number.isFinite(usd)) return null
  return VALUATION_TIERS.find((t) => usd >= t.min && usd < t.max)?.id ?? null
}
