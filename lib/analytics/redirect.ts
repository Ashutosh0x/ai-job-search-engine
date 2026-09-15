/**
 * Validation for outbound Apply destinations.
 *
 * WHY THIS IS SEPARATE AND STRICT
 * -------------------------------
 * /go/job never takes a destination from the request -- it resolves the job id
 * against the index and uses the stored `applyUrl`. That alone makes the
 * endpoint useless as an open redirect.
 *
 * This is the second line. The stored URL came from a third party's ATS
 * response, so it is still untrusted data that happens to live in our index. A
 * crawler bug, a hijacked board, or a hostile employer page could put anything
 * in that field, and an allow-by-default redirect would hand a job board's
 * domain reputation to whoever managed it.
 *
 * So: an explicit allowlist of schemes, and an explicit denylist of the things
 * that turn a redirect into an attack.
 */

/** Only these two. Everything else is refused. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Hostnames that must never be a redirect target.
 *
 * Redirecting a browser to a loopback or link-local address is an SSRF-adjacent
 * trick: the request is made by the VICTIM's browser, from inside their network,
 * which can reach routers, printers and admin panels that the public internet
 * cannot. `169.254.169.254` is the cloud metadata endpoint and is called out
 * because it is the single most-abused address of this kind.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '169.254.169.254', 'metadata.google.internal', 'metadata.goog',
])

/** Private and reserved IPv4 ranges, plus IPv6 loopback/link-local/ULA. */
function isPrivateAddress(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  // IPv6 loopback, link-local (fe80::/10) and unique-local (fc00::/7).
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 10) return true                          // 10.0.0.0/8
  if (a === 127) return true                         // loopback
  if (a === 0) return true                           // "this network"
  if (a === 169 && b === 254) return true            // link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 192 && b === 168) return true            // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT 100.64.0.0/10
  if (a >= 224) return true                          // multicast + reserved
  return false
}

/**
 * Is this a destination we are willing to send a browser to?
 *
 * Intentionally does NOT allowlist specific ATS domains. The index legitimately
 * carries thousands of employer-owned career sites on their own domains, and a
 * domain allowlist would silently break Apply for most of the corpus -- which
 * is a worse failure than the one it prevents, and an invisible one.
 */
export function isSafeApplyUrl(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (!value) return false

  /**
   * Reject control characters before parsing.
   *
   * A newline or a NUL inside a URL is a response-splitting attempt: it can
   * terminate the Location header early and inject headers of the attacker's
   * choosing. `URL` tolerates some of these, so the check has to come first.
   */
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false

  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Relative URLs land here too, and are refused: an Apply link that does not
    // name a host is a crawler bug, not a destination.
    return false
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false
  if (!url.hostname) return false

  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return false
  if (isPrivateAddress(host)) return false

  // A hostname with no dot is either a bare intranet name or a parse artefact;
  // a real employer ATS always has a registrable domain.
  if (!host.includes('.') && !host.includes(':')) return false

  /**
   * Credentials in the URL are refused.
   *
   * `https://evil.com@real-employer.com/` reads as the employer to a human and
   * resolves to evil.com in a browser. That is the classic disguised-redirect,
   * and there is no legitimate Apply link that carries a username.
   */
  if (url.username || url.password) return false

  return true
}

/**
 * Query parameters stripped before redirecting.
 *
 * Employer links routinely arrive carrying tracking parameters from wherever
 * the crawler found them. Forwarding those attributes our traffic to someone
 * else's campaign and tells a third party how the visitor arrived, so they are
 * removed. Parameters the ATS itself needs -- job ids, board tokens -- are not
 * in this list and pass through untouched.
 */
const STRIPPED_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'gclid', 'fbclid', 'msclkid', 'mc_eid', 'mc_cid', 'igshid', 'ttclid', 'twclid',
]

/**
 * The URL actually sent to the browser.
 *
 * Returns null when the input is unsafe, so a caller cannot accidentally use an
 * unvalidated value: there is no path through this function that yields a URL
 * which has not been checked.
 */
export function cleanApplyUrl(raw: string | null | undefined): string | null {
  if (!isSafeApplyUrl(raw)) return null
  const url = new URL((raw as string).trim())
  for (const p of STRIPPED_PARAMS) url.searchParams.delete(p)
  // The fragment is never sent to a server and can carry anything; drop it.
  url.hash = ''
  return url.toString()
}
