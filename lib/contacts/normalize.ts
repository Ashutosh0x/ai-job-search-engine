import { DiscoveredEmail, DiscoveredPhone, EnrichedContact } from './types';

/**
 * The single shape every contact surface renders.
 *
 * Two things produce contacts and they disagree on spelling: a fresh discovery
 * returns a camelCase `EnrichedContact`, while a saved reveal comes back from
 * Postgres as a snake_case row. Normalising here is what stops a card from
 * silently rendering blanks because it read `email` where the value lives under
 * `address`.
 */
export interface ContactView {
  id: string | null;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  domain: string;
  linkedinUrl?: string;
  emails: DiscoveredEmail[];
  phones: DiscoveredPhone[];
  socials: {
    linkedin?: string;
    github?: string;
    twitter?: string;
  };
  revealedAt: string | null;
  /** False when this came straight from discovery and was never persisted. */
  saved: boolean;
}

function asEmails(value: unknown): DiscoveredEmail[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      address: String(e.address ?? ''),
      confidence: Number(e.confidence ?? 0),
      source: (e.source ?? 'pattern') as DiscoveredEmail['source'],
      verified: Boolean(e.verified),
      verifiedAt: e.verifiedAt ? new Date(e.verifiedAt as string) : undefined,
    }))
    .filter((e) => e.address.length > 0);
}

function asPhones(value: unknown): DiscoveredPhone[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      number: String(p.number ?? ''),
      type: (p.type ?? 'work') as DiscoveredPhone['type'],
      source: String(p.source ?? ''),
    }))
    .filter((p) => p.number.length > 0);
}

/** Normalise a `contact_reveals` row. */
export function fromRevealRow(row: any): ContactView {
  const socials = (row?.social_profiles ?? {}) as Record<string, string | undefined>;
  return {
    id: row?.id ?? null,
    firstName: row?.first_name ?? '',
    lastName: row?.last_name ?? '',
    title: row?.title ?? '',
    company: row?.company ?? '',
    domain: row?.domain ?? '',
    linkedinUrl: row?.linkedin_url ?? undefined,
    emails: asEmails(row?.emails),
    phones: asPhones(row?.phones),
    socials: {
      linkedin: socials.linkedin ?? row?.linkedin_url ?? undefined,
      github: socials.github,
      twitter: socials.twitter,
    },
    revealedAt: row?.revealed_at ?? null,
    saved: true,
  };
}

/** Normalise the result of an unsaved discovery. */
export function fromEnriched(contact: EnrichedContact): ContactView {
  return {
    id: null,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company,
    domain: contact.domain,
    linkedinUrl: contact.linkedinUrl,
    emails: asEmails(contact.emails),
    phones: asPhones(contact.phones),
    socials: contact.socialProfiles ?? {},
    revealedAt: null,
    saved: false,
  };
}

/** Human label for where an address came from. */
export function sourceLabel(source: DiscoveredEmail['source']): string {
  switch (source) {
    case 'pattern': return 'Inferred from company pattern';
    case 'github': return 'Public GitHub commit';
    case 'careers': return 'Published on careers page';
    case 'public': return 'Public profile';
    case 'sec': return 'Public filing';
    default: return String(source);
  }
}

/**
 * Whether an address was observed somewhere public, as opposed to constructed
 * from the company's naming pattern. The UI must never present the second kind
 * as a known address.
 */
export function isObserved(email: DiscoveredEmail): boolean {
  return email.source !== 'pattern';
}
