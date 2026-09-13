import type { SourceId, SourceTarget } from './types'
import { httpGet, CACHE_TTL } from './http'

/**
 * ATS classification.
 *
 * The brief is explicit that `if (url.includes("workday"))` must not be the
 * only mechanism (§34), and it is right: plenty of employers proxy their ATS
 * behind `careers.company.com`, where the host tells you nothing. So detection
 * combines several independent signals and returns a confidence rather than a
 * boolean.
 *
 * Signals, strongest first:
 *   1. Host pattern            - definitive when the ATS is not white-labelled.
 *   2. URL path shape          - e.g. /wday/cxs/, /o/<slug>, /embed/job_board.
 *   3. Response headers        - some platforms announce themselves.
 *   4. Script/asset origins    - a white-labelled page still loads ATS JS.
 *   5. Embedded JSON / JSON-LD - board tokens and tenants appear inline.
 *   6. Link hrefs              - "apply" links leak the underlying platform.
 *
 * Signals are additive and capped, so two weak agreeing signals beat one weak
 * signal but never outrank a definitive host match.
 */

export interface DetectionResult {
  source: SourceId
  confidence: number
  /** Which signals fired, for debugging and for the feedback loop (§33). */
  evidence: string[]
  target?: SourceTarget
}

interface Signature {
  source: SourceId
  /** Host patterns -- a match here is near-definitive. */
  hosts?: RegExp[]
  /** Path patterns on any host. */
  paths?: RegExp[]
  /** Substrings found in scripts, links or inline JSON. */
  markers?: RegExp[]
  /** Header name/value pairs. */
  headers?: { name: string; pattern: RegExp }[]
  /** Pull a target out of a matching URL. */
  parseUrl?: (url: URL) => Omit<SourceTarget, 'source'> | null
}

/**
 * Platform signatures. Adding an ATS means adding one entry here plus an
 * adapter -- nothing else in the pipeline changes.
 */
export const SIGNATURES: Signature[] = [
  {
    source: 'workday',
    hosts: [/(^|\.)myworkdayjobs\.com$/i, /(^|\.)myworkdaysite\.com$/i, /(^|\.)wd\d+\.myworkdayjobs\.com$/i],
    paths: [/\/wday\/cxs\//i, /\/en-US\/[^/]+\/job\//i],
    markers: [/myworkdayjobs\.com/i, /wday\/cxs/i, /"workdayApp"/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i)
      if (!m) return null
      const seg = u.pathname.split('/').filter(Boolean)
      // Skip a leading locale like en-US.
      const site = seg.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s) && !/^wday$/i.test(s))
      return site ? { token: m[1].toLowerCase(), site, host: u.host.toLowerCase() } : null
    },
  },
  {
    source: 'greenhouse',
    // Greenhouse serves both the legacy and the current board host (§7).
    hosts: [/(^|\.)greenhouse\.io$/i],
    paths: [/^\/embed\/job_board/i],
    markers: [/boards\.greenhouse\.io/i, /job-boards\.greenhouse\.io/i, /grnhse/i, /greenhouse\.io\/embed/i],
    parseUrl: (u) => {
      if (!/greenhouse\.io$/i.test(u.host)) return null
      const embed = u.searchParams.get('for')
      if (embed) return { token: embed.toLowerCase() }
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0].toLowerCase() } : null
    },
  },
  {
    source: 'keka',
    hosts: [/(^|\.)keka\.com$/i],
    paths: [/^\/careers/i],
    markers: [/kh-jobs-section/i, /careers\/api\/jobs\//i, /cdn\.keka\.com/i],
    parseUrl: (u) => {
      // The tenant is the subdomain; the path carries the posting, not the
      // board. keka.com itself is the vendor's own site, not a career portal.
      const m = u.host.match(/^([a-z0-9][a-z0-9-]*)\.keka\.com$/i)
      if (!m || /^(www|help|blog|docs|support|status|cdn)$/i.test(m[1])) return null
      return { token: m[1].toLowerCase(), host: u.host.toLowerCase() }
    },
  },
  {
    source: 'lever',
    hosts: [/(^|\.)lever\.co$/i],
    markers: [/jobs\.lever\.co/i, /api\.lever\.co/i, /lever-client/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0].toLowerCase() } : null
    },
  },
  {
    source: 'ashby',
    hosts: [/(^|\.)ashbyhq\.com$/i],
    markers: [/jobs\.ashbyhq\.com/i, /ashbyhq\.com\/posting-api/i, /_ashby/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0].toLowerCase() } : null
    },
  },
  {
    source: 'smartrecruiters',
    hosts: [/(^|\.)smartrecruiters\.com$/i],
    markers: [/jobs\.smartrecruiters\.com/i, /api\.smartrecruiters\.com/i, /smartrecruiters/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0] } : null
    },
  },
  {
    source: 'recruitee',
    hosts: [/(^|\.)recruitee\.com$/i],
    markers: [/recruitee\.com\/api\/offers/i, /recruitee/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.recruitee\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'teamtailor',
    hosts: [/(^|\.)teamtailor\.com$/i],
    markers: [/teamtailor/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.teamtailor\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'personio',
    hosts: [/(^|\.)jobs\.personio\.(com|de)$/i, /(^|\.)personio\.de$/i],
    markers: [/personio/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.jobs\.personio\./i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'workable',
    hosts: [/(^|\.)workable\.com$/i],
    markers: [/apply\.workable\.com/i, /workable/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0].toLowerCase() } : null
    },
  },
  {
    source: 'breezy',
    hosts: [/(^|\.)breezy\.hr$/i],
    markers: [/breezy\.hr/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.breezy\.hr$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'comeet',
    hosts: [/(^|\.)comeet\.co$/i, /(^|\.)comeet\.com$/i],
    markers: [/comeet\.co/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg.length >= 2 ? { token: seg[1] } : null
    },
  },
  {
    source: 'jazzhr',
    hosts: [/(^|\.)applytojob\.com$/i, /(^|\.)jazz\.co$/i],
    markers: [/applytojob\.com/i, /jazzhr/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.applytojob\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'jobvite',
    hosts: [/(^|\.)jobvite\.com$/i],
    markers: [/jobvite/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0].toLowerCase() } : null
    },
  },
  {
    source: 'bamboohr',
    hosts: [/(^|\.)bamboohr\.com$/i],
    markers: [/bamboohr\.com\/(careers|jobs)/i, /bamboohr/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.bamboohr\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'pinpoint',
    hosts: [/(^|\.)pinpointhq\.com$/i],
    markers: [/pinpointhq/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.pinpointhq\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'rippling',
    hosts: [/(^|\.)rippling\.com$/i, /(^|\.)ats\.rippling\.com$/i],
    markers: [/ats\.rippling\.com/i, /rippling/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] ? { token: seg[0] } : null
    },
  },
  {
    source: 'icims',
    hosts: [/(^|\.)icims\.com$/i],
    markers: [/icims\.com/i, /icimsSearch/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.icims\.com$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'taleo',
    hosts: [/(^|\.)taleo\.net$/i],
    markers: [/taleo\.net/i, /careersection/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.taleo\.net$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'successfactors',
    hosts: [/(^|\.)successfactors\.(com|eu)$/i, /(^|\.)sapsf\.(com|eu)$/i],
    markers: [/successfactors/i, /career\?company=/i],
    parseUrl: (u) => {
      const company = u.searchParams.get('company')
      return company ? { token: company } : null
    },
  },
  {
    source: 'eightfold',
    hosts: [/(^|\.)eightfold\.ai$/i],
    markers: [/eightfold\.ai/i, /careers\/v2\/search/i],
    parseUrl: (u) => {
      const seg = u.pathname.split('/').filter(Boolean)
      return seg[0] === 'careers' && seg[1] ? { token: seg[1] } : null
    },
  },
  {
    source: 'avature',
    hosts: [/(^|\.)avature\.net$/i],
    markers: [/avature\.net/i],
    parseUrl: (u) => {
      const m = u.host.match(/^([a-z0-9-]+)\.avature\.net$/i)
      return m ? { token: m[1].toLowerCase() } : null
    },
  },
  {
    source: 'phenom',
    hosts: [/(^|\.)phenompeople\.com$/i],
    markers: [/phenompeople/i, /phApp\.ddo/i],
  },
  {
    source: 'ukg',
    hosts: [/(^|\.)ultipro\.com$/i, /(^|\.)ukg\.(com|net)$/i],
    markers: [/ultipro/i, /ukg\.com/i],
  },
  {
    source: 'dover',
    hosts: [/(^|\.)dover\.com$/i, /(^|\.)dover\.io$/i],
    markers: [/dover\.(com|io)\/careers/i],
  },
  {
    source: 'wellfound',
    hosts: [/(^|\.)wellfound\.com$/i, /(^|\.)angel\.co$/i],
    markers: [/wellfound\.com/i],
  },
]

/** Hosts that aggregate rather than employ. Used to prefer first-party links. */
export const AGGREGATOR_HOSTS = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)indeed\.(com|co\.[a-z]{2}|[a-z]{2})$/i,
  /(^|\.)glassdoor\.(com|[a-z.]{2,6})$/i,
  /(^|\.)ziprecruiter\.com$/i,
  /(^|\.)monster\.(com|[a-z.]{2,6})$/i,
  /(^|\.)dice\.com$/i,
  /(^|\.)simplyhired\.com$/i,
  /(^|\.)naukri\.com$/i,
  /(^|\.)totaljobs\.com$/i,
  /(^|\.)reed\.co\.uk$/i,
  /(^|\.)seek\.com(\.au)?$/i,
  /(^|\.)jobs\.google\.com$/i,
  /(^|\.)talent\.com$/i,
  /(^|\.)builtin\.com$/i,
]

export function isAggregatorUrl(url: string): boolean {
  try {
    const host = new URL(url).host
    return AGGREGATOR_HOSTS.some((re) => re.test(host))
  } catch {
    return false
  }
}

/** Detect from the URL alone -- no network. */
export function detectFromUrl(rawUrl: string): DetectionResult {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { source: 'unknown', confidence: 0, evidence: ['malformed url'] }
  }

  for (const sig of SIGNATURES) {
    const hostHit = sig.hosts?.some((re) => re.test(u.host))
    const pathHit = sig.paths?.some((re) => re.test(u.pathname))
    if (!hostHit && !pathHit) continue

    const evidence: string[] = []
    if (hostHit) evidence.push(`host matches ${sig.source}`)
    if (pathHit) evidence.push(`path matches ${sig.source}`)

    const parsed = sig.parseUrl?.(u) ?? null
    // A host match is near-definitive; a path-only match is strong but not
    // certain, because paths can collide across platforms.
    const confidence = hostHit ? (parsed ? 0.99 : 0.9) : 0.75

    return {
      source: sig.source,
      confidence,
      evidence,
      target: parsed ? { source: sig.source, ...parsed, confidence, discoveredVia: 'url' } : undefined,
    }
  }

  if (isAggregatorUrl(rawUrl)) {
    return { source: 'unknown', confidence: 0.2, evidence: ['aggregator host'] }
  }

  return { source: 'unknown', confidence: 0, evidence: [] }
}

/**
 * Detect from a fetched page. This is what catches white-labelled career sites
 * where the host is the employer's own domain.
 */
export function detectFromContent(
  url: string,
  html: string,
  headers?: Record<string, string>
): DetectionResult {
  const fromUrl = detectFromUrl(url)
  if (fromUrl.confidence >= 0.9) return fromUrl

  const scores = new Map<SourceId, { score: number; evidence: string[] }>()
  const bump = (source: SourceId, amount: number, why: string) => {
    const cur = scores.get(source) ?? { score: 0, evidence: [] }
    cur.score += amount
    cur.evidence.push(why)
    scores.set(source, cur)
  }

  if (fromUrl.confidence > 0) bump(fromUrl.source, fromUrl.confidence * 0.5, ...[fromUrl.evidence[0] ?? 'url hint'])

  // Look only at the head plus a sample of the body: markers appear early and
  // scanning megabytes of listing markup buys nothing.
  const sample = html.slice(0, 300_000)

  for (const sig of SIGNATURES) {
    for (const marker of sig.markers ?? []) {
      if (marker.test(sample)) {
        bump(sig.source, 0.35, `page references ${sig.source}`)
        break
      }
    }
    // A script or link pointing at the platform is a strong signal: a
    // white-labelled page still has to load the vendor's assets.
    const assetRe = new RegExp(
      `(?:src|href|action)=["'][^"']*${sig.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'i'
    )
    if (assetRe.test(sample)) bump(sig.source, 0.3, `asset origin references ${sig.source}`)

    for (const h of sig.headers ?? []) {
      const val = headers?.[h.name.toLowerCase()]
      if (val && h.pattern.test(val)) bump(sig.source, 0.4, `header ${h.name} matches`)
    }
  }

  // Embedded absolute URLs are the most useful signal of all: they usually
  // carry the board token, so detection and target extraction happen together.
  let bestTarget: SourceTarget | undefined
  const urlRe = /https?:\/\/[^\s"'<>()]+/gi
  const seen = new Set<string>()
  for (const found of sample.match(urlRe) ?? []) {
    if (seen.has(found) || seen.size > 400) continue
    seen.add(found)
    const d = detectFromUrl(found)
    if (d.confidence >= 0.9 && d.target) {
      bump(d.source, 0.45, `embedded ${d.source} url`)
      if (!bestTarget) bestTarget = { ...d.target, discoveredVia: 'embedded-url' }
    }
  }

  let best: { source: SourceId; score: number; evidence: string[] } | null = null
  for (const [source, v] of scores) {
    if (!best || v.score > best.score) best = { source, ...v }
  }

  if (!best || best.score < 0.3) {
    // A page with job markup but no recognisable vendor is a custom career
    // site -- a first-class source, not a failure.
    const hasJobLd = /"@type"\s*:\s*"JobPosting"/i.test(sample)
    if (hasJobLd) {
      return { source: 'custom', confidence: 0.8, evidence: ['JobPosting JSON-LD present'] }
    }
    return { source: 'unknown', confidence: 0, evidence: [] }
  }

  return {
    source: best.source,
    confidence: Math.min(0.95, best.score),
    evidence: best.evidence,
    target: bestTarget && bestTarget.source === best.source ? bestTarget : undefined,
  }
}

/** Fetch a URL and classify it. Cached for a week (§28). */
export async function detectAts(url: string): Promise<DetectionResult> {
  const quick = detectFromUrl(url)
  if (quick.confidence >= 0.9) return quick

  const res = await httpGet(url, { cacheTtlMs: CACHE_TTL.atsDetection, retries: 1 }).catch(() => null)
  if (!res?.ok || !res.body) return quick

  return detectFromContent(url, res.body)
}
