import { getRecruitingContacts } from './recruiting-contacts';
import { COMPANY_BY_SLUG } from './registry';

/**
 * The recruiting contact shown against a job posting.
 *
 * Deliberately a narrow view of the recruiting-intelligence data. It carries
 * only what that subsystem already stands behind: application channels, a
 * PUBLISHED address with its evidence, and the aggregate email pattern as a
 * pattern. It never carries an address inferred for a named individual —
 * lib/contacts does that, on its own clearly-labelled surface, and the two must
 * not be blended here.
 */
export interface RecruiterContactSummary {
  companySlug: string;
  /** Where to apply — the employer's own board. */
  applyChannels: { provider: string; label: string; url: string | null }[];
  /** Addresses the company published itself, each with its evidence. */
  publishedContacts: { address: string; kind: string; evidence: string }[];
  /** Aggregate naming pattern for the domain. Not a mailbox. */
  emailPattern: { domain: string; pattern: string; share: number } | null;
  /** True when no writable address exists and the ATS is the only route. */
  atsOnly: boolean;
  checkedAt: string | null;
}

const cache = new Map<string, RecruiterContactSummary | null>();

/**
 * Resolve the recruiting contact for one company slug.
 *
 * Read-time rather than baked into the job index: the index holds ~113k
 * postings and a contact belongs to a company, not to a posting. Writing it
 * onto every row would multiply one fact tens of thousands of times and let
 * copies go stale independently of the source.
 */
export async function getRecruiterContactForCompany(
  companySlug: string
): Promise<RecruiterContactSummary | null> {
  if (cache.has(companySlug)) return cache.get(companySlug) ?? null;

  let summary: RecruiterContactSummary | null = null;
  try {
    const company = COMPANY_BY_SLUG.get(companySlug);
    const recruiting = await getRecruitingContacts(companySlug, company?.boards ?? []);

    const topPattern = recruiting.emailPatterns.length
      ? [...recruiting.emailPatterns].sort((a, b) => b.share - a.share)[0]
      : null;

    summary = {
      companySlug,
      applyChannels: recruiting.applicationChannels,
      publishedContacts: recruiting.publishedContacts.map((c) => ({
        address: c.address,
        kind: c.kind,
        evidence: c.evidence,
      })),
      emailPattern:
        recruiting.emailPattern && topPattern
          ? { domain: recruiting.emailPattern.domain, pattern: topPattern.pattern, share: topPattern.share }
          : null,
      atsOnly: recruiting.atsOnly,
      checkedAt: recruiting.checkedAt,
    };
  } catch (error) {
    // An unresolvable company is a missing contact, not a broken job page.
    console.error(`Could not resolve recruiting contact for ${companySlug}:`, error);
    summary = null;
  }

  cache.set(companySlug, summary);
  return summary;
}

/** Attach `recruiterContact` to a batch of jobs, resolving each company once. */
export async function attachRecruiterContacts<T extends { companySlug: string }>(
  jobs: T[]
): Promise<(T & { recruiterContact?: RecruiterContactSummary })[]> {
  const slugs = Array.from(new Set(jobs.map((j) => j.companySlug)));
  const resolved = new Map<string, RecruiterContactSummary | null>();

  await Promise.all(
    slugs.map(async (slug) => {
      resolved.set(slug, await getRecruiterContactForCompany(slug));
    })
  );

  return jobs.map((job) => {
    const contact = resolved.get(job.companySlug);
    return contact ? { ...job, recruiterContact: contact } : job;
  });
}
