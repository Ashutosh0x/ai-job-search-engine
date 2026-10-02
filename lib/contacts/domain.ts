/**
 * Validate a caller-supplied company domain before any code builds a URL,
 * DNS query or email address from it.
 *
 * WHY
 * ---
 * `/api/contacts/discover` is anonymous by design, and its `domain` went
 * straight into `https://www.${domain}${path}` (lib/contacts/scraper.ts), plus
 * `https://${domain}` and DNS lookups in lib/contacts/sources/public-records.ts.
 * A value such as `evil.com@10.0.0.5` makes `www.evil.com` the URL's userinfo
 * and 10.0.0.5 its host, so the server fetched an arbitrary host chosen by an
 * unauthenticated caller. `example.com:8443/x?` and bare IPs worked the same way.
 *
 * Accepting only a plain public DNS name at the single entry point
 * (discoverContact) closes every downstream sink at once, instead of patching
 * each URL template separately.
 *
 * WHAT IS ACCEPTED
 * ----------------
 * Lowercase LDH labels (RFC 1123), at least two labels, an alphabetic TLD, and
 * no IP literals, ports, paths, userinfo, or internal-only suffixes. A trailing
 * dot is tolerated and removed. Internationalised names must arrive in their
 * punycode (xn--) form.
 */

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/** Suffixes that never name a public company website. */
const INTERNAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'test', 'invalid', 'example', 'onion']

/**
 * The normalised hostname, or null when `raw` is not a plain public DNS name.
 */
export function normalizePublicHostname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let host = raw.trim().toLowerCase()
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host.length === 0 || host.length > 253) return null

  const labels = host.split('.')
  if (labels.length < 2) return null
  if (!labels.every((l) => LABEL.test(l))) return null

  const tld = labels[labels.length - 1]
  if (!TLD.test(tld)) return null
  if (INTERNAL_SUFFIXES.includes(tld)) return null

  return host
}

export class InvalidDomainError extends Error {
  constructor() {
    super('domain must be a plain public hostname, e.g. example.com')
    this.name = 'InvalidDomainError'
  }
}
