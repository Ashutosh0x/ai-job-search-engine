/**
 * Normalised job + company shapes shared by every ATS connector.
 *
 * WHY THIS LAYER EXISTS, AND WHY NOT LINKEDIN/INDEED
 * --------------------------------------------------
 * Every connector here talks to an ATS's own public, documented, no-auth JSON
 * endpoint -- the same feed that powers the company's careers page. This is
 * deliberate:
 *
 *  - It is the SOURCE. LinkedIn and Indeed are aggregators; the postings they
 *    show mostly originate from these same Greenhouse/Lever/Ashby/Workday
 *    boards. Reading the ATS gets the same jobs earlier, with structured
 *    fields (department, compensation, remote flag) that the aggregators strip.
 *  - It is permitted. LinkedIn's and Indeed's terms both prohibit scraping,
 *    and LinkedIn actively enforces it. Building on scraped data means the
 *    product breaks the first time they change markup or block the IP range,
 *    and it cannot be operated openly.
 *  - It self-verifies the employer. A company with a live ATS board is a real
 *    company that is really hiring. That is a stronger genuineness signal than
 *    anything scraped off a listings page, where duplicate and ghost postings
 *    are the main quality problem.
 *
 * If first-party LinkedIn/Indeed data is ever needed, both have official
 * partner programmes (LinkedIn Talent Solutions, Indeed Publisher/Employer
 * APIs). Those are the supported routes and they require an agreement.
 */

export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'recruitee'
  | 'workday'

/** A single board belonging to one employer on one ATS. */
export interface AtsBoard {
  provider: AtsProvider
  /** Board identifier used by the provider (token / slug / tenant). */
  token: string
  /** Extra path segment some providers need (Workday site, host shard). */
  site?: string
  host?: string
  /** Canonical company slug in our own registry. */
  companySlug: string
}

/** A job posting normalised across providers. */
export interface NormalizedJob {
  /** Stable id: `${provider}:${token}:${providerJobId}`. */
  externalId: string
  provider: AtsProvider
  companySlug: string
  title: string
  location: string | null
  /** Provider's department/team label, used for category facets. */
  department: string | null
  employmentType: string | null
  isRemote: boolean
  descriptionHtml: string | null
  /** ISO 8601. Null when the provider does not expose a post date. */
  postedAt: string | null
  applyUrl: string
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
}

export interface FetchResult {
  jobs: NormalizedJob[]
  /** Non-fatal problems worth surfacing rather than swallowing. */
  warnings: string[]
}

/** Best-effort remote detection from free text. */
export function detectRemote(...fields: (string | null | undefined)[]): boolean {
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  if (/\bhybrid\b/.test(text) && !/\bfully remote\b/.test(text)) return false
  return /\bremote\b|\bwork from home\b|\bdistributed\b|\banywhere\b/.test(text)
}

/** Normalise an ISO-ish date to ISO 8601, or null when unusable. */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  // Providers use seconds, milliseconds, and ISO strings interchangeably.
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Strip HTML to plain text for indexing/snippets. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}
