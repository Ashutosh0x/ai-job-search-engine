import { promises as dns } from 'dns';

export interface VerificationResult {
  valid: boolean;
  checks: {
    syntax: boolean;
    mxExists: boolean;
    domainValid: boolean;
    disposable: boolean;
    catchAll: boolean | null;
  };
  confidence: number;
}

export interface DomainVerification {
  hasMx: boolean;
  mxRecords: string[];
  hasSpf: boolean;
  spfRecord?: string;
  dmarcPolicy?: string;
  isDisposable: boolean;
}

// The maintained list (~120k domains), not a hand-written dozen. A short
// hardcoded set silently passes every disposable domain it happens to omit,
// which reads downstream as a legitimate address.
import disposableDomains from 'disposable-email-domains';
import disposableWildcards from 'disposable-email-domains/wildcard.json';

const DISPOSABLE_DOMAINS = new Set<string>(disposableDomains as string[]);
const DISPOSABLE_WILDCARDS: string[] = disposableWildcards as string[];

/**
 * Whether a domain belongs to a disposable mail provider.
 *
 * Exported so scripts/test-email-patterns.mjs checks the same list the app
 * uses rather than a copy that can drift away from it.
 */
export function isDisposableDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(normalized)) return true;

  // Wildcard entries cover every subdomain of a throwaway host.
  return DISPOSABLE_WILDCARDS.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
}

/**
 * Basic syntax check for email addresses (RFC 5322 approximation).
 */
export function isValidEmailSyntax(email: string): boolean {
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return regex.test(email);
}

/**
 * Verify a domain's DNS records including MX and SPF.
 * 
 * @param domain - The domain to verify
 * @returns A promise resolving to DomainVerification
 */
export async function verifyDomain(domain: string): Promise<DomainVerification> {
  const isDisposable = isDisposableDomain(domain);
  
  let hasMx = false;
  let mxRecords: string[] = [];
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length > 0) {
      hasMx = true;
      mxRecords = mx.map(r => r.exchange);
    }
  } catch (err) {
    // Domain doesn't have MX records
  }

  let hasSpf = false;
  let spfRecord: string | undefined;
  try {
    const txt = await dns.resolveTxt(domain);
    for (const record of txt) {
      const joined = record.join('');
      if (joined.startsWith('v=spf1')) {
        hasSpf = true;
        spfRecord = joined;
        break;
      }
    }
  } catch (err) {
    // Domain doesn't have TXT records
  }

  return {
    hasMx,
    mxRecords,
    hasSpf,
    spfRecord,
    isDisposable
  };
}

/**
 * Verify an email address without sending an SMTP probe.
 * 
 * @param email - The email address to verify
 * @returns A promise resolving to VerificationResult
 */
export async function verifyEmail(email: string): Promise<VerificationResult> {
  const checks = {
    syntax: false,
    mxExists: false,
    domainValid: false,
    disposable: false,
    catchAll: null as boolean | null
  };
  
  let confidence = 0;

  checks.syntax = isValidEmailSyntax(email);
  if (checks.syntax) {
    confidence += 10;
  } else {
    return { valid: false, checks, confidence };
  }

  const [, domain] = email.split('@');
  if (!domain) {
    return { valid: false, checks, confidence };
  }

  checks.domainValid = true;

  try {
    const domainInfo = await verifyDomain(domain);
    
    checks.mxExists = domainInfo.hasMx;
    if (domainInfo.hasMx) {
      confidence += 40;
    }

    checks.disposable = domainInfo.isDisposable;
    if (!domainInfo.isDisposable) {
      confidence += 20;
    }

    // Basic heuristic: Assume confidence from pattern match (20 added here implicitly if we assume it came from pattern)
    // Domain age could add +10 (omitted here as it requires whois lookup)
    confidence += 30; // giving benefit of doubt for age/pattern

    // Catch-all detection using SPF hints (basic heuristic)
    if (domainInfo.spfRecord && domainInfo.spfRecord.includes('~all')) {
      checks.catchAll = true; // Soft fail might indicate catch-all tendencies
      confidence -= 10;
    }

  } catch (err) {
    console.error(`Error verifying email ${email}:`, err);
  }

  return {
    valid: checks.mxExists && checks.syntax && !checks.disposable,
    checks,
    confidence: Math.max(0, Math.min(100, confidence))
  };
}
