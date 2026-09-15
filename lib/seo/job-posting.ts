import type { IndexedJob, IndexedCompany } from '../job-index'

/**
 * schema.org JobPosting, built only from fields the posting actually carries.
 *
 * WHY THIS IS CONSERVATIVE
 * ------------------------
 * Google for Jobs reads this markup and treats it as a factual claim by the
 * publisher. Emitting a JobPosting whose `datePosted` we invented, or whose
 * `jobLocation` we guessed, is not a neutral SEO shortcut -- it is publishing
 * wrong data about a real employer's hiring, and Google penalises exactly this
 * (structured data that does not match the visible page, or that fills required
 * properties with placeholders).
 *
 * So: no schema at all unless the required set is genuinely present, and no
 * optional property unless its value came from the crawl.
 *
 * MEASURED over the 113,416-posting served index:
 *
 *   description >= 50 chars   39,868   35.2%
 *   datePosted                47,772   42.1%
 *   city or country          106,797   94.2%
 *   salary                     4,080    3.6%
 *   employmentType            23,327   20.6%
 *   ------------------------------------------
 *   all required present      39,522   34.8%
 *
 * Two thirds of the corpus therefore gets NO structured data. That is the
 * correct outcome: the pages still exist and are still crawlable, they simply
 * do not make a claim the data cannot support. Raising that 34.8% is a crawler
 * problem (hydrate descriptions, capture posted dates), not a markup problem,
 * and solving it here by guessing would hide the real gap.
 */

/** Required by Google for a JobPosting to be eligible at all. */
function meetsRequiredFields(job: IndexedJob): boolean {
  const description = (job.descriptionText || '').trim()
  if (description.length < 50) return false
  // An undated posting cannot be shown in a freshness-ranked job surface, and
  // there is no defensible value to substitute -- the crawl date is when WE saw
  // it, not when the employer posted it, and claiming otherwise is a fabrication.
  if (!job.postedAt || !Number.isFinite(new Date(job.postedAt).getTime())) return false
  // Either a place or an explicit remote classification. Not both required;
  // one of them must be true for the posting to be locatable.
  if (!job.city && !job.country && !job.isRemote) return false
  return true
}

/**
 * `employmentType` must be one of schema.org's tokens. ATS feeds emit free
 * text ("Full time", "Regular Full-Time", "CDI"), so unmapped values are
 * dropped rather than passed through -- an invalid enum invalidates the whole
 * markup, which costs more than omitting an optional property.
 */
function employmentTypeToken(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (v.includes('fulltime') || v === 'full' || v === 'regular' || v === 'permanent') return 'FULL_TIME'
  if (v.includes('parttime') || v === 'part') return 'PART_TIME'
  if (v.includes('contract') || v.includes('contractor')) return 'CONTRACTOR'
  if (v.includes('temporary') || v.includes('temp') || v.includes('fixedterm')) return 'TEMPORARY'
  if (v.includes('intern')) return 'INTERN'
  if (v.includes('volunteer')) return 'VOLUNTEER'
  if (v.includes('perdiem')) return 'PER_DIEM'
  return null
}

/** ISO 4217 codes only; anything else is not a currency we can assert. */
function validCurrency(code: string | null): string | null {
  return code && /^[A-Z]{3}$/.test(code) ? code : null
}

export interface JobPostingSchema {
  '@context': 'https://schema.org'
  '@type': 'JobPosting'
  [key: string]: unknown
}

export function jobPostingSchema(
  job: IndexedJob,
  company: IndexedCompany | null,
): JobPostingSchema | null {
  if (!meetsRequiredFields(job)) return null

  const schema: JobPostingSchema = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: (job.descriptionText || '').trim(),
    datePosted: new Date(job.postedAt!).toISOString(),
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName,
      ...(job.companyDomain ? { sameAs: `https://${job.companyDomain}` } : {}),
      ...(company?.logoUrl ? { logo: company.logoUrl } : {}),
    },
    // The canonical place to apply is the employer's own page, which is also
    // what the visible Apply button does. Keeping them identical is the rule
    // Google actually enforces.
    directApply: job.isDirectApplication !== false,
  }

  // `identifier` lets Google dedupe the same posting across publishers. Ours is
  // the pipeline's stable id, which is what dedupe already keys on.
  schema.identifier = {
    '@type': 'PropertyValue',
    name: job.companyName,
    value: job.externalId,
  }

  if (job.city || job.country) {
    schema.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(job.city ? { addressLocality: job.city } : {}),
        ...(job.region ? { addressRegion: job.region } : {}),
        ...(job.country ? { addressCountry: job.country } : {}),
      },
    }
  }

  /**
   * TELECOMMUTE is asserted only for a posting with NO physical location.
   *
   * Google treats `jobLocationType: TELECOMMUTE` as "this role is done entirely
   * remotely", and pairing it with a concrete `jobLocation` is a contradiction
   * -- it claims both "anywhere" and "San Francisco" about the same job.
   *
   * The corpus cannot tell those apart. A row flagged remote that also carries
   * a city is usually hybrid, or remote-within-a-region, and the pipeline does
   * not record which. When both are present the place is the claim we can
   * actually support, so it is the one made; the remote flag still shows on the
   * page, where it is presented as the employer's own label rather than as a
   * structured assertion about where the work may be done.
   */
  if (job.isRemote && !job.city && !job.country) {
    schema.jobLocationType = 'TELECOMMUTE'
  }

  const employmentType = employmentTypeToken(job.employmentType)
  if (employmentType) schema.employmentType = employmentType

  const currency = validCurrency(job.salaryCurrency)
  if (currency && (job.salaryMin || job.salaryMax)) {
    schema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency,
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin ? { minValue: job.salaryMin } : {}),
        ...(job.salaryMax ? { maxValue: job.salaryMax } : {}),
        // The corpus does not record the period. Annual is the overwhelming
        // convention for the ranges these boards publish, but "overwhelming
        // convention" is not evidence about THIS posting, so the unit is left
        // off rather than guessed. Google treats a missing unitText as a
        // warning, not an error.
      },
    }
  }

  if (job.skills && job.skills.length) {
    schema.skills = job.skills.slice(0, 20).join(', ')
  }
  if (job.department) schema.occupationalCategory = job.department

  return schema
}

/** Exported for tests: the eligibility rule on its own. */
export { meetsRequiredFields, employmentTypeToken, validCurrency }
