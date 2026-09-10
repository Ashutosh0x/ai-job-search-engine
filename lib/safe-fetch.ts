import { lookup } from 'dns/promises'
import net from 'net'

/**
 * SSRF guard for URLs that originate from a request payload.
 *
 * Fetching a caller-supplied URL from the server turns the server into a proxy
 * for anything it can reach: cloud instance metadata (169.254.169.254, which on
 * most providers hands out credentials), Supabase/Redis on a private subnet,
 * admin panels bound to localhost. The host is resolved first and every
 * resulting address is checked, so DNS names that point at private space are
 * rejected too.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
])

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true // fail closed
  const [a, b] = p
  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT, RFC6598
  if (a >= 224) return true // multicast + reserved + broadcast
  return false
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 * Returns null when the input is not parseable, so callers can fail closed.
 */
function expandIPv6(addr: string): number[] | null {
  let text = addr
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two hex groups.
  const dotted = text.match(/(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const octets = dotted[2].split('.').map(Number)
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null
    }
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    text = `${dotted[1]}${hi}:${lo}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const parse = (part: string) =>
    part ? part.split(':').filter((g) => g !== '').map((g) => parseInt(g, 16)) : []

  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if ([...head, ...tail].some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    return [...head, ...Array(fill).fill(0), ...tail]
  }
  return head.length === 8 ? head : null
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '')

  const groups = expandIPv6(addr)
  if (!groups) return true // unparseable -- fail closed

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses
  // must be judged by their embedded IPv4 address. Note that the WHATWG URL
  // parser rewrites "::ffff:169.254.169.254" to its hex form
  // "::ffff:a9fe:a9fe", so matching only the dotted spelling let that through.
  const firstFiveZero = groups.slice(0, 5).every((g) => g === 0)
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ].join('.')
    // ::  and ::1 fall out of this as 0.0.0.0 / 0.0.0.1, both already blocked.
    return isPrivateIPv4(embedded)
  }

  // NAT64 well-known prefix 64:ff9b::/96 also embeds an IPv4 destination.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const embedded = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ].join('.')
    return isPrivateIPv4(embedded)
  }

  const first = groups[0]
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  return true // not an IP literal we understand -- fail closed
}

export class UnsafeUrlError extends Error {}

/**
 * Validate a caller-supplied URL. Throws UnsafeUrlError when the target is not
 * a public HTTP(S) endpoint.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError('Malformed URL')
  }

  // file:, gopher:, data: and friends are not reachable targets for a fetch of
  // remote user content.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are allowed')
  }

  // Credentials in the URL are a redirect/parsing-confusion vector.
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('Target host is not allowed')
  }

  // An IP literal can be checked directly; a name has to be resolved, because
  // an attacker controls what their DNS returns.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new UnsafeUrlError('Target address is not allowed')
    return url
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    throw new UnsafeUrlError('Could not resolve target host')
  }

  if (addresses.length === 0) throw new UnsafeUrlError('Could not resolve target host')
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throw new UnsafeUrlError('Target address is not allowed')
  }

  return url
}

/**
 * fetch() for caller-supplied URLs: validates the target, refuses to follow
 * redirects (a 302 to 169.254.169.254 would sidestep the check), and caps both
 * time and response size.
 */
export async function safeFetch(
  rawUrl: string,
  { timeoutMs = 15_000, maxBytes = 10 * 1024 * 1024 }: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = await assertPublicHttpUrl(rawUrl)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal })

    if (res.status >= 300 && res.status < 400) {
      throw new UnsafeUrlError('Redirects are not followed for remote files')
    }
    if (!res.ok) {
      throw new UnsafeUrlError(`Failed to fetch file: ${res.status}`)
    }

    // Trust the declared length only as an early reject; enforce the real cap
    // while reading, since the header can lie.
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared && declared > maxBytes) {
      throw new UnsafeUrlError('Remote file is too large')
    }

    const chunks: Buffer[] = []
    let total = 0
    const reader = res.body?.getReader()
    if (!reader) throw new UnsafeUrlError('Empty response body')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new UnsafeUrlError('Remote file is too large')
      }
      chunks.push(Buffer.from(value))
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: res.headers.get('content-type') || '',
    }
  } finally {
    clearTimeout(timer)
  }
}
