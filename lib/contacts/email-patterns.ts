import { EmailPattern, DiscoveredEmail, EMAIL_PATTERN_TEMPLATES } from './types';
import { mineDomainAuthors } from './github';

/**
 * Infer which pattern template produced the given email based on the person's name.
 * 
 * @param email - The email address to check
 * @param firstName - The person's first name
 * @param lastName - The person's last name
 * @returns The matching pattern template, or null if none match
 */
export function inferPattern(email: string, firstName: string, lastName: string): string | null {
  const localPart = email.split('@')[0].toLowerCase();
  const first = firstName.toLowerCase();
  const last = lastName.toLowerCase();
  
  if (!first || !last) return null;

  for (const template of EMAIL_PATTERN_TEMPLATES) {
    const generated = applyPattern(template, first, last);
    if (generated === localPart) {
      return template;
    }
  }
  
  return null;
}

/**
 * Generate the local part of an email based on a pattern template and name.
 * 
 * @param pattern - The pattern template (e.g., '{first}.{last}')
 * @param firstName - The person's first name
 * @param lastName - The person's last name
 * @returns The generated local part of the email
 */
export function applyPattern(pattern: string, firstName: string, lastName: string): string {
  const first = firstName.toLowerCase();
  const last = lastName.toLowerCase();
  const f = first.charAt(0);
  const l = last.charAt(0);
  
  return pattern
    .replace('{first}', first)
    .replace('{last}', last)
    .replace('{f}', f)
    .replace('{l}', l);
}

/**
 * Discover the email patterns a domain actually uses, from public evidence.
 *
 * Returns an EMPTY ARRAY when nothing can be observed.
 *
 * It used to return `{first}.{last}` at 0.3 confidence instead. That default
 * was indistinguishable downstream from a pattern with real evidence behind
 * it — same shape, same fields, a confidence number that looks measured — so
 * every company in the registry appeared to have a "discovered" pattern. In a
 * live measurement across 273 domains, the mining step returned nothing for
 * every single one, and that default was the only reason it looked like it was
 * working. An absent pattern has to read as absent.
 *
 * @param domain - The domain to discover patterns for
 * @returns Patterns ordered by share of observed addresses; [] if none observed
 */
export async function discoverPatterns(domain: string): Promise<EmailPattern[]> {
  const { authors } = await mineDomainAuthors(domain);
  if (authors.length === 0) return [];

  const patternCounts: Record<string, { count: number; emails: string[] }> = {};
  let totalInferred = 0;

  for (const { email, name } of authors) {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) continue;

    const pattern = inferPattern(email, parts[0], parts[parts.length - 1]);
    if (!pattern) continue;

    if (!patternCounts[pattern]) patternCounts[pattern] = { count: 0, emails: [] };
    patternCounts[pattern].count++;
    if (patternCounts[pattern].emails.length < 5) {
      patternCounts[pattern].emails.push(email);
    }
    totalInferred++;
  }

  if (totalInferred === 0) return [];

  const now = new Date();
  return Object.entries(patternCounts)
    .map(([pattern, data]) => ({
      pattern,
      domain,
      confidence: data.count / totalInferred,
      sampleSize: data.count,
      sampleEmails: data.emails,
      sources: ['github'],
      createdAt: now,
      updatedAt: now,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Generate candidate emails based on name, domain, and patterns.
 * 
 * @param firstName - First name
 * @param lastName - Last name
 * @param domain - Domain
 * @param patterns - Discovered email patterns
 * @returns Array of generated DiscoveredEmail objects
 */
export function generateEmails(firstName: string, lastName: string, domain: string, patterns: EmailPattern[]): DiscoveredEmail[] {
  const generated: DiscoveredEmail[] = [];
  const seenAddresses = new Set<string>();

  for (const pattern of patterns) {
    const localPart = applyPattern(pattern.pattern, firstName, lastName);
    const address = `${localPart}@${domain}`;
    
    if (!seenAddresses.has(address)) {
      seenAddresses.add(address);
      generated.push({
        address,
        confidence: Math.round(pattern.confidence * 100),
        source: 'pattern',
        verified: false,
      });
    }
  }

  return generated.sort((a, b) => b.confidence - a.confidence);
}
