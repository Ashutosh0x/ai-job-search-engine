/**
 * Small, dependency-free robots.txt policy evaluator for company-site crawls.
 *
 * The ATS adapters primarily read documented JSON feeds. `CustomSiteAdapter`
 * is different: it reads public HTML and sitemap pages, so respecting the
 * publisher's robots policy is part of the adapter's contract rather than an
 * optional discovery hint. This implements the useful subset of RFC 9309:
 * named user-agent groups, `Allow` / `Disallow`, wildcards, end anchors, and
 * longest-rule precedence (with Allow winning a tie).
 *
 * It intentionally does not pretend that the non-standard `Crawl-delay`
 * directive is portable. Host pacing belongs in the shared HTTP layer, where
 * it applies uniformly to every request.
 */

export type RobotsDirective = 'allow' | 'disallow'

export interface RobotsRule {
  directive: RobotsDirective
  pattern: string
  /** Literal path characters, used for longest-match precedence. */
  specificity: number
}

export interface RobotsPolicy {
  rules: RobotsRule[]
  sitemaps: string[]
}

export interface RobotsDecision {
  allowed: boolean
  rule: RobotsRule | null
}

interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}

/**
 * Parse the groups that apply to this crawler.
 *
 * A named group wins over the `*` fallback. When several named groups match,
 * their rules are combined, which is the behaviour crawlers need when a
 * publisher splits one policy across multiple blocks.
 */
export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const groups: RobotsGroup[] = []
  const sitemaps: string[] = []
  let current: RobotsGroup | null = null

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue

    const match = line.match(/^([a-z][a-z-]*)\s*:\s*(.*)$/i)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()

    if (key === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }

    if (key === 'user-agent') {
      // Consecutive User-agent lines share a group. Once a rule appeared, a
      // following User-agent begins the next group.
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      if (value) current.agents.push(value.toLowerCase())
      continue
    }

    if ((key === 'allow' || key === 'disallow') && current?.agents.length) {
      // An empty Disallow means "allow everything", not "block everything".
      if (!value) continue
      current.rules.push({
        directive: key,
        pattern: value,
        specificity: value.replace(/[\*$]/g, '').length,
      })
    }
  }

  const token = productToken(userAgent)
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && token.includes(agent)),
  )
  const fallback = groups.filter((group) => group.agents.includes('*'))
  const applicable = specific.length > 0 ? specific : fallback

  return {
    rules: applicable.flatMap((group) => group.rules),
    sitemaps: [...new Set(sitemaps)],
  }
}

/** Decide whether one same-origin URL is permitted by a parsed policy. */
export function robotsDecision(policy: RobotsPolicy | null, url: string): RobotsDecision {
  let path: string
  try {
    const parsed = new URL(url)
    path = `${parsed.pathname || '/'}${parsed.search}`
  } catch {
    // A malformed URL is not safe to crawl. Callers should surface this as a
    // warning rather than silently treating it as allowed.
    return { allowed: false, rule: null }
  }

  if (!policy?.rules.length) return { allowed: true, rule: null }

  const matches = policy.rules.filter((rule) => ruleMatches(rule.pattern, path))
  if (!matches.length) return { allowed: true, rule: null }

  matches.sort(
    (a, b) => b.specificity - a.specificity || Number(b.directive === 'allow') - Number(a.directive === 'allow'),
  )
  const rule = matches[0]
  return { allowed: rule.directive === 'allow', rule }
}

function productToken(userAgent: string): string {
  return String(userAgent).split(/[\s/]/, 1)[0].toLowerCase()
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const source = pattern
    .replace(/\$$/, '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path)
}
