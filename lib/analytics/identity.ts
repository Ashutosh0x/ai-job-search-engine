import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Deriving a pseudonymous visitor identity, and coarse context, from a request.
 *
 * THE PRIVACY RULE THIS FILE ENFORCES
 * -----------------------------------
 * The raw IP address and the raw User-Agent are used HERE, in memory, and are
 * never returned, logged or stored. What leaves this module is:
 *
 *   sessionId   a one-way hash, salted with a secret that rotates daily
 *   device      one of five categories
 *   browser     one of eight families
 *   os          one of six families
 *   referrer    one of six classes -- never the referring URL
 *   country     ISO-3166 alpha-2, from the CDN's own header
 *
 * Each of those is a bucket with a very large membership. That is the point:
 * they are enough to answer "do mobile users apply less often?" and not enough
 * to single anyone out.
 *
 * WHY THE SALT ROTATES
 * --------------------
 * A hash of an IP with a FIXED salt is still a stable identifier for that IP
 * forever -- it is pseudonymous, not anonymous, and it is linkable across
 * months. Rotating the salt every day means yesterday's id cannot be matched to
 * today's, so the data supports daily and funnel analysis without accumulating
 * a long-term profile of anybody.
 *
 * The cost is honest and worth stating: a visitor returning tomorrow counts as
 * a new visitor. "Unique visitors" here therefore means "unique visitors within
 * a day", and the dashboard says so rather than implying something stronger.
 */

/* --------------------------------- salt ----------------------------------- */

/**
 * Process-lifetime fallback salt.
 *
 * Used when ANALYTICS_SALT is unset. It is random per process, which on a
 * serverless host means per instance -- so session ids do not correlate across
 * instances and unique counts are inflated. That is a real accuracy cost, and
 * it is the safe direction to fail: over-counting visitors is a reporting
 * inaccuracy, whereas a predictable salt would make the hashes reversible by
 * anyone who can guess an IP.
 */
const FALLBACK_SALT = randomBytes(32).toString('hex')

/** UTC day, so the salt rotates at a defined instant everywhere. */
function saltWindow(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function dailySalt(now: Date): string {
  const base = process.env.ANALYTICS_SALT?.trim() || FALLBACK_SALT
  return `${base}:${saltWindow(now)}`
}

/* ------------------------------- client IP -------------------------------- */

/**
 * The caller's address, for hashing only.
 *
 * `x-forwarded-for` is a chain and the FIRST entry is the original client;
 * taking the last gives the proxy and collapses every visitor into one bucket.
 * Mirrors clientIp() in lib/api-guard.ts deliberately -- two different rules for
 * "who is this" in one codebase is how rate limits and analytics end up
 * disagreeing about the same request.
 */
function rawIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'anon'
}

/* ------------------------------ derivations -------------------------------- */

export type DeviceCategory = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown'
export type BrowserFamily = 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'samsung' | 'other' | 'bot'
export type OsFamily = 'windows' | 'macos' | 'ios' | 'android' | 'linux' | 'other'
export type ReferrerCategory = 'direct' | 'search_engine' | 'social' | 'internal' | 'external' | 'unknown'

/**
 * Automated traffic.
 *
 * Bots are not filtered out at the door -- they are LABELLED and kept, and the
 * aggregation excludes them. Dropping them silently means the difference
 * between "nobody visited" and "only crawlers visited" is invisible, and those
 * call for very different responses.
 *
 * This catches self-identifying agents, which is most of them. It does not
 * catch a crawler that lies about its user agent; the per-session click
 * de-duplication in lib/analytics/dedupe.ts is what bounds those.
 */
const BOT_RE =
  /(bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|feedfetcher|headless|phantomjs|puppeteer|playwright|selenium|curl\/|wget\/|python-requests|go-http-client|axios\/|node-fetch|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|scrapy|httpclient)/i

export function classifyDevice(ua: string): DeviceCategory {
  if (!ua) return 'unknown'
  if (BOT_RE.test(ua)) return 'bot'
  // Tablet before mobile: an iPad's UA contains neither "Mobile" nor "Android"
  // in the usual place, and an Android tablet's contains "Android" WITHOUT
  // "Mobile" -- checking mobile first mislabels both.
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet'
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function classifyBrowser(ua: string): BrowserFamily {
  if (!ua) return 'other'
  if (BOT_RE.test(ua)) return 'bot'
  // Order matters: every one of these also contains "Safari", and Chromium
  // browsers also contain "Chrome". Most specific first.
  if (/edg[ae]?\//i.test(ua)) return 'edge'
  if (/opr\/|opera/i.test(ua)) return 'opera'
  if (/samsungbrowser/i.test(ua)) return 'samsung'
  if (/firefox|fxios/i.test(ua)) return 'firefox'
  if (/chrome|crios|chromium/i.test(ua)) return 'chrome'
  if (/safari/i.test(ua)) return 'safari'
  return 'other'
}

export function classifyOs(ua: string): OsFamily {
  if (!ua) return 'other'
  // iOS before macOS: iPadOS reports "Macintosh" in desktop-site mode.
  if (/iphone|ipad|ipod|ios/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  if (/windows/i.test(ua)) return 'windows'
  if (/mac os x|macintosh/i.test(ua)) return 'macos'
  if (/linux|x11|ubuntu|fedora|debian/i.test(ua)) return 'linux'
  return 'other'
}

const SEARCH_ENGINE_RE = /^(www\.)?(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage)\./i
const SOCIAL_RE = /^(www\.)?(x|twitter|t|facebook|fb|instagram|linkedin|lnkd|reddit|news\.ycombinator|youtube|tiktok|threads|mastodon|bsky)\./i

/**
 * Classify the referrer WITHOUT storing it.
 *
 * A full referring URL can carry another site's query string, which is both a
 * privacy leak and useless for aggregation. The class is what a product
 * decision actually turns on.
 */
export function classifyReferrer(referer: string | null, selfHost: string | null): ReferrerCategory {
  if (!referer) return 'direct'
  let host: string
  try {
    host = new URL(referer).hostname
  } catch {
    return 'unknown'
  }
  if (selfHost && host === selfHost) return 'internal'
  if (SEARCH_ENGINE_RE.test(host)) return 'search_engine'
  if (SOCIAL_RE.test(host)) return 'social'
  return 'external'
}

/**
 * Country, from the CDN. Never inferred from the IP ourselves.
 *
 * Vercel sets `x-vercel-ip-country`; Cloudflare sets `cf-ipcountry`. Absent
 * either, the answer is null -- an unknown country is recorded as unknown
 * rather than guessed, because a wrong country in a geographic report is worse
 * than a gap in one.
 */
export function readCountry(req: NextRequest): string | null {
  const raw =
    req.headers.get('x-vercel-ip-country') ??
    req.headers.get('cf-ipcountry') ??
    req.headers.get('x-country-code')
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null
}

/* ------------------------------- the result -------------------------------- */

export interface RequestIdentity {
  sessionId: string
  device: DeviceCategory
  browser: BrowserFamily
  os: OsFamily
  referrer: ReferrerCategory
  country: string | null
  isBot: boolean
}

/**
 * Everything the event writer needs, and nothing it should not have.
 *
 * The returned object contains no raw IP and no raw user agent, so a caller
 * cannot accidentally persist one. That is enforced by this function being the
 * only place either value is read.
 */
export function deriveIdentity(req: NextRequest, now = new Date()): RequestIdentity {
  const ua = req.headers.get('user-agent') ?? ''
  const ip = rawIp(req)

  /**
   * The session id.
   *
   * IP + user-agent + a daily-rotating salt. The user agent is included so two
   * people behind one NAT are usually distinguished; the salt is what stops the
   * result being a durable identifier. SHA-256 truncated to 128 bits -- ample
   * against collisions at this volume, and half the storage.
   */
  const sessionId = createHash('sha256')
    .update(`${dailySalt(now)}|${ip}|${ua}`)
    .digest('hex')
    .slice(0, 32)

  const device = classifyDevice(ua)
  const selfHost = (() => {
    try {
      return new URL(req.url).hostname
    } catch {
      return null
    }
  })()

  return {
    sessionId,
    device,
    browser: classifyBrowser(ua),
    os: classifyOs(ua),
    referrer: classifyReferrer(req.headers.get('referer'), selfHost),
    country: readCountry(req),
    isBot: device === 'bot' || BOT_RE.test(ua),
  }
}

/**
 * Has this visitor asked not to be tracked?
 *
 * Honours Global Privacy Control (`Sec-GPC`, which is legally recognised under
 * CCPA) and the legacy `DNT` header, plus an explicit opt-out cookie the site
 * can set. When true, nothing at all is recorded for the request -- not a
 * reduced event, not a counter.
 */
export function hasOptedOut(req: NextRequest): boolean {
  if (req.headers.get('sec-gpc') === '1') return true
  if (req.headers.get('dnt') === '1') return true
  if (req.cookies.get('js_no_analytics')?.value === '1') return true
  return false
}
