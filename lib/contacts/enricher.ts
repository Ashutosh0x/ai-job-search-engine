import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { 
  ContactDiscoveryRequest, 
  ContactDiscoveryResult, 
  EnrichedContact, 
  DiscoveredEmail,
  EmailPattern
} from './types';
import { generateEmails } from './email-patterns';
import { getObservedPatterns } from './pattern-source';
import { scrapeCareersPage, scrapeGitHubEmails, scrapePublicProfiles, PublicProfiles } from './scraper';
import { verifyEmail } from './verify';

/**
 * Resolved per call, never at module scope.
 *
 * `createClient` throws "supabaseUrl is required" when the env is missing, and
 * a module-level call runs at IMPORT time -- which during `next build` is the
 * "Collecting page data" phase. CI and a fresh Vercel project have no env
 * vars, so a top-level client fails the build of every route that transitively
 * imports this file, long before any request exists. Returns null rather than
 * throwing: discovery still works without a database, it just cannot cache.
 */
function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Resolves a domain from a company name if not provided.
 */
function resolveDomain(company: string): string {
  const cleanName = company
    .toLowerCase()
    .replace(/\s+(inc|llc|ltd|corp|corporation|inc\.|llc\.|ltd\.|corp\.)$/gi, '')
    .replace(/[^a-z0-9]/g, '');
  return `${cleanName}.com`;
}

/**
 * Discover and enrich contact information.
 */
export async function discoverContact(request: ContactDiscoveryRequest): Promise<ContactDiscoveryResult> {
  const startTime = Date.now();
  const domain = request.domain || resolveDomain(request.company);
  let cached = true;
  
  try {
    // 1-4. Patterns, from the daily crawl where it has reached this company.
    //
    // The crawl verifies each company's GitHub org against its website and
    // counts real commit authors, which a request-time lookup cannot do:
    // unauthenticated commit search allows 10 requests a minute, so a live
    // call during a profile visit is usually rate-limited into returning
    // nothing. getObservedPatterns falls back to live mining for a company
    // the crawl has not covered, and returns [] when nothing is observed.
    const { patterns, origin } = await getObservedPatterns(domain);
    cached = origin === 'directory';

    // Keep the Supabase cache warm when a live lookup did find something, so
    // the next request for this domain does not repeat the rate-limited call.
    const supabase = getServiceClient();
    if (supabase && origin === 'live' && patterns.length > 0) {
      await supabase.from('email_patterns').upsert(
        patterns.map(p => ({
          domain: p.domain,
          pattern: p.pattern,
          confidence: p.confidence,
          sample_size: p.sampleSize,
          updated_at: new Date().toISOString()
        }))
      ).then(
        () => undefined,
        (err: unknown) => console.error('Failed to cache patterns:', err)
      );
    }

    // 5. Generate emails
    const generatedEmails = generateEmails(request.firstName, request.lastName, domain, patterns);
    
    // 6 & 7. Scrape public sources (concurrently)
    const [careersEmails, githubEmails, publicProfiles] = await Promise.all([
      scrapeCareersPage(domain).catch(() => []),
      scrapeGitHubEmails(domain).catch(() => []),
      scrapePublicProfiles(`${request.firstName} ${request.lastName}`, request.company).catch((): PublicProfiles => ({}))
    ]);

    // 8. Merge and deduplicate
    const emailMap = new Map<string, DiscoveredEmail>();
    
    for (const em of generatedEmails) {
      emailMap.set(em.address, em);
    }
    
    for (const em of githubEmails) {
      const matchName = em.name.toLowerCase();
      const first = request.firstName.toLowerCase();
      const last = request.lastName.toLowerCase();
      // Only include if it likely belongs to them or if we're desperate
      if (matchName.includes(first) || matchName.includes(last) || emailMap.size === 0) {
        emailMap.set(em.email, {
          address: em.email,
          confidence: 90,
          source: 'github',
          verified: false
        });
      }
    }

    if (publicProfiles.email) {
      emailMap.set(publicProfiles.email, {
        address: publicProfiles.email,
        confidence: 95,
        source: 'public',
        verified: false
      });
    }

    let emails = Array.from(emailMap.values());
    
    // 9. Verify top 5 emails
    emails = emails.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    for (const email of emails) {
      const verification = await verifyEmail(email.address);
      email.verified = verification.valid;
      if (verification.valid) {
        email.verifiedAt = new Date();
        email.confidence = Math.min(100, email.confidence + 20); // Boost confidence if valid
      }
    }

    // Sort again after verification
    emails.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      return b.confidence - a.confidence;
    });

    // 10. Build EnrichedContact
    const contact: EnrichedContact = {
      firstName: request.firstName,
      lastName: request.lastName,
      company: request.company,
      domain,
      title: 'Employee', // Default, could be expanded
      linkedinUrl: request.linkedinUrl,
      emails,
      phones: [],
      socialProfiles: {
        linkedin: request.linkedinUrl,
        github: publicProfiles.github,
        twitter: publicProfiles.twitter
      },
      discoveredAt: new Date()
    };

    // 11. Persistence is deliberately NOT done here.
    // Discovery runs for anonymous callers too (/api/contacts/discover), so there
    // is no user to attribute a row to. Writing one anyway produced a duplicate
    // contact_reveals row with a NULL user_id that RLS then hid from everyone.
    // /api/contacts/reveal owns the write, because only it has the session.

    return {
      contact,
      cached,
      discoveryTimeMs: Date.now() - startTime
    };
    
  } catch (error) {
    console.error(`Contact discovery failed for ${request.firstName} ${request.lastName} at ${request.company}:`, error);
    throw error;
  }
}

/**
 * Bulk discover contacts with concurrency limit.
 */
export async function discoverBulk(requests: ContactDiscoveryRequest[]): Promise<ContactDiscoveryResult[]> {
  const results: ContactDiscoveryResult[] = [];
  const concurrencyLimit = 3;
  
  for (let i = 0; i < requests.length; i += concurrencyLimit) {
    const chunk = requests.slice(i, i + concurrencyLimit);
    const settled = await Promise.allSettled(chunk.map(req => discoverContact(req)));
    
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }
  
  return results;
}
