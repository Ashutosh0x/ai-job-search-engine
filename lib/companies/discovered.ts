import { readFileSync, existsSync } from 'fs'
import path from 'path'
import type { AtsProvider } from '../ats/types'
import { COMPANIES, type CompanyRecord } from './registry'

/**
 * Merge auto-discovered boards into the curated registry.
 *
 * The curated list (registry.ts) carries what a machine cannot derive:
 * valuation, industry, HQ, founding year, and a human-readable name. The
 * discovered list carries reach -- thousands of boards found in the open web
 * index and then verified live (scripts/discover-boards.mjs).
 *
 * Curated entries always win on conflict. A discovered board only contributes a
 * NEW company, never overwrites a hand-checked one, so auto-discovery can never
 * silently replace a verified valuation with a guess.
 *
 * Discovered companies get `valuationKind: 'unknown'` -- deliberately. We know
 * they are hiring because their ATS answered; we know nothing about their worth,
 * and inventing a figure would undermine the one number users would most want to
 * trust.
 */

export interface DiscoveredBoard {
  provider: AtsProvider
  token: string
  site?: string
  host?: string
  openRoles: number
}

interface DiscoveryFile {
  discoveredAt: string
  crawl: string
  boards: DiscoveredBoard[]
}

/** Turn an ATS token into a presentable company name. */
export function humanizeToken(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    // Trailing digits are usually a disambiguator ("addepar1"), not a name.
    .replace(/\s*\d+$/, '')
    .replace(/\b(inc|llc|ltd|corp|corporation|gmbh|plc)\b/gi, '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ') || token
}

/** Guess a domain from the token. Marked as a guess, and only used for logos. */
function guessDomain(token: string): string {
  return `${token.replace(/[^a-z0-9]/gi, '').toLowerCase()}.com`
}

export function loadDiscoveredBoards(file = 'scripts/discovered-boards.json'): DiscoveryFile | null {
  const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
  if (!existsSync(full)) return null
  try {
    return JSON.parse(readFileSync(full, 'utf8')) as DiscoveryFile
  } catch {
    return null
  }
}

/**
 * The full company set: curated first, then discovered companies that are not
 * already covered.
 *
 * `minOpenRoles` filters out boards with a token handful of postings. Those are
 * usually agencies, test tenants, or a single-role board; including them
 * inflates the company count without improving the product.
 */
export function buildCompanyList({
  includeDiscovered = true,
  minOpenRoles = 5,
  maxDiscovered = 2000,
  file,
}: {
  includeDiscovered?: boolean
  minOpenRoles?: number
  maxDiscovered?: number
  file?: string
} = {}): CompanyRecord[] {
  const curated = [...COMPANIES]
  if (!includeDiscovered) return curated

  const discovery = loadDiscoveredBoards(file)
  if (!discovery) return curated

  // Index curated boards so a discovered duplicate is skipped rather than
  // added as a second company for the same employer.
  const curatedBoardKeys = new Set<string>()
  const curatedSlugs = new Set<string>()
  for (const c of curated) {
    curatedSlugs.add(c.slug)
    for (const b of c.boards) curatedBoardKeys.add(`${b.provider}|${b.token.toLowerCase()}`)
  }

  const extra: CompanyRecord[] = []
  const seenSlugs = new Set(curatedSlugs)

  for (const b of discovery.boards) {
    if (b.openRoles < minOpenRoles) continue
    if (curatedBoardKeys.has(`${b.provider}|${b.token.toLowerCase()}`)) continue

    let slug = b.token.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
    if (seenSlugs.has(slug)) slug = `${slug}-${b.provider}`
    if (seenSlugs.has(slug)) continue
    seenSlugs.add(slug)

    extra.push({
      slug,
      name: humanizeToken(b.token),
      domain: guessDomain(b.token),
      boards: [{ provider: b.provider, token: b.token, site: b.site, host: b.host }],
      // We verified they are hiring. We have not verified what they are worth.
      valuationKind: 'unknown',
    })

    if (extra.length >= maxDiscovered) break
  }

  return [...curated, ...extra]
}
