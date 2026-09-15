import { canonicalSkill, SKILL_SURFACE_FORMS } from '../pipeline/skills'
import { tokenizeText } from './normalize'

/**
 * Natural-language query -> structured search intent.
 *
 * The point is that a job search query is mostly *constraints* wearing the
 * costume of free text. "senior ML engineer in Bangalore with visa sponsorship
 * posted this week" is five filters and one topic, and a keyword engine treats
 * all six as bag-of-words -- so it happily returns a junior role in Boston that
 * merely mentions Bangalore.
 *
 * Extracting the constraints first means they become hard filters and the
 * residue becomes the topical query. That is the single biggest quality
 * difference between "search over job text" and "job search".
 *
 * Every extraction records the span it consumed, so the UI can show the user
 * how their sentence was understood and let them correct it.
 */

export interface QueryFacet {
  field: string
  value: string | number | boolean
  /** The exact text this was read from. */
  matched: string
  confidence: number
}

export interface ParsedIntent {
  raw: string
  /** What's left after the constraints are lifted out -- the topic. */
  topic: string
  titleTerms: string[]
  skills: string[]
  locations: string[]
  countries: string[]
  seniority: string | null
  workplace: string | null
  remoteOnly: boolean
  visa: 'required' | 'exclude-none' | null
  employmentType: string | null
  postedWithinDays: number | null
  salaryMin: number | null
  salaryCurrency: string | null
  companies: string[]
  /** Countries implied by the cities named in the query (Bangalore -> India). */
  impliedCountries: string[]
  facets: QueryFacet[]
}

/* ------------------------------- vocabularies ----------------------------- */

const SENIORITY: [RegExp, string][] = [
  [/\b(intern|internship)\b/i, 'internship'],
  [/\b(new\s?grad|graduate|entry[\s-]?level|junior|jr\.?)\b/i, 'entry'],
  [/\b(mid[\s-]?level|intermediate)\b/i, 'mid'],
  [/\b(senior|sr\.?)\b/i, 'senior'],
  [/\bstaff\b/i, 'staff'],
  [/\b(principal|distinguished|fellow)\b/i, 'principal'],
  [/\b(engineering\s+manager|manager)\b/i, 'manager'],
  [/\b(director|head\s+of)\b/i, 'executive'],
  [/\b(vp|vice\s+president|c-?level|cto|ceo)\b/i, 'executive'],
]

const WORKPLACE: [RegExp, string][] = [
  [/\b(fully\s+remote|100%\s+remote|remote[\s-]?first|remote|wfh|work\s+from\s+home)\b/i, 'REMOTE'],
  [/\bhybrid\b/i, 'HYBRID'],
  [/\b(on[\s-]?site|onsite|in[\s-]?office|in[\s-]?person)\b/i, 'ONSITE'],
]

const EMPLOYMENT: [RegExp, string][] = [
  [/\bfull[\s-]?time\b/i, 'full-time'],
  [/\bpart[\s-]?time\b/i, 'part-time'],
  [/\b(contract|contractor|freelance)\b/i, 'contract'],
  [/\b(intern|internship)\b/i, 'internship'],
  [/\btemporary\b/i, 'temporary'],
  [/\bapprentice(ship)?\b/i, 'apprenticeship'],
]

/** Relative-time phrases -> a day window. */
const RECENCY: [RegExp, number][] = [
  [/\b(today|past\s+(24\s*hours?|day)|last\s+24\s*hours?|just\s+posted|fresh)\b/i, 1],
  [/\b(yesterday|past\s+2\s+days?|last\s+2\s+days?)\b/i, 2],
  [/\b(this\s+week|past\s+(week|7\s*days?)|last\s+(week|7\s*days?)|recent(ly)?)\b/i, 7],
  [/\b(past\s+3\s+days?|last\s+3\s+days?)\b/i, 3],
  [/\b(this\s+month|past\s+(month|30\s*days?)|last\s+(month|30\s*days?))\b/i, 30],
]

const VISA: [RegExp, 'required'][] = [
  [/\b(visa\s+sponsorship|sponsors?\s+(a\s+)?visas?|will\s+sponsor|h-?1b|sponsorship\s+available|sponsored)\b/i, 'required'],
  [/\b(that\s+sponsor|who\s+sponsor|with\s+sponsorship)\b/i, 'required'],
]

/** Words that never carry topical meaning in a job query. */
const STOPWORDS = new Set([
  'jobs', 'job', 'roles', 'role', 'positions', 'position', 'openings', 'opening',
  'vacancies', 'vacancy', 'careers', 'career', 'hiring', 'work', 'looking',
  'for', 'in', 'at', 'with', 'and', 'or', 'the', 'a', 'an', 'of', 'to', 'on',
  'from', 'by', 'that', 'who', 'which', 'me', 'i', 'my', 'find', 'show', 'get',
  'paying', 'pays', 'over', 'above', 'under', 'below', 'near', 'around',
  'posted', 'available', 'open',
])

/* --------------------------------- helpers -------------------------------- */

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface Consumed {
  text: string
  spans: [number, number][]
}

function takeFirst(
  text: string,
  rules: [RegExp, any][],
  onMatch: (value: any, matched: string) => void
): Consumed {
  const spans: [number, number][] = []
  for (const [re, value] of rules) {
    const m = text.match(re)
    if (m && m.index !== undefined) {
      onMatch(value, m[0])
      spans.push([m.index, m.index + m[0].length])
      break // first rule wins; they are ordered by specificity
    }
  }
  return { text, spans }
}

function blankSpans(text: string, spans: [number, number][]): string {
  if (spans.length === 0) return text
  const chars = [...text]
  for (const [a, b] of spans) for (let i = a; i < b && i < chars.length; i++) chars[i] = ' '
  return chars.join('')
}

/**
 * Salary phrases: "over $150k", "paying 150000+", "₹20L+", "€100k".
 * Returns the amount in whole currency units.
 */
function parseSalary(text: string): { min: number; currency: string; matched: string } | null {
  // Japanese listings commonly express annual compensation as 年収1000万円,
  // while English-speaking candidates often write ¥10M. Both are yen, but
  // 万 is ten thousand rather than the western k multiplier.
  const yenWithMarker = text.match(/(?:年収\s*)?([¥￥]|jpy\s*)(\d[\d,]*(?:\.\d+)?)\s*(万円?|man|m)?\s*(?:円)?(?:以上|\+)?/i)
  if (yenWithMarker) {
    let min = Number(yenWithMarker[2].replace(/,/g, ''))
    const unit = (yenWithMarker[3] ?? '').toLowerCase()
    if (unit === '万' || unit === '万円' || unit === 'man') min *= 10_000
    else if (unit === 'm') min *= 1_000_000
    if (Number.isFinite(min) && min >= 1_000) {
      return { min: Math.round(min), currency: 'JPY', matched: yenWithMarker[0] }
    }
  }
  const yenAnnual = text.match(/年収\s*(\d[\d,]*(?:\.\d+)?)\s*(万円?|万|man|m)?\s*(?:円)?(?:以上|\+)?/i)
  if (yenAnnual) {
    let min = Number(yenAnnual[1].replace(/,/g, ''))
    const unit = (yenAnnual[2] ?? '').toLowerCase()
    if (unit === '万' || unit === '万円' || unit === 'man') min *= 10_000
    else if (unit === 'm') min *= 1_000_000
    if (Number.isFinite(min) && min >= 1_000) {
      return { min: Math.round(min), currency: 'JPY', matched: yenAnnual[0] }
    }
  }
  const yenMan = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(万円?|万|man)\s*(?:円)?(?:以上|\+)?/i)
  if (yenMan) {
    const min = Number(yenMan[1].replace(/,/g, '')) * 10_000
    if (Number.isFinite(min) && min >= 1_000) {
      return { min: Math.round(min), currency: 'JPY', matched: yenMan[0] }
    }
  }

  // Indian lakh/crore notation is common and does not fit the k/m pattern.
  const lakh = text.match(/(?:₹|rs\.?\s*|inr\s*)?(\d+(?:\.\d+)?)\s*(l|lpa|lakhs?)\b/i)
  if (lakh) {
    return { min: Math.round(Number(lakh[1]) * 100_000), currency: 'INR', matched: lakh[0] }
  }
  const crore = text.match(/(?:₹|rs\.?\s*|inr\s*)?(\d+(?:\.\d+)?)\s*(cr|crores?)\b/i)
  if (crore) {
    return { min: Math.round(Number(crore[1]) * 10_000_000), currency: 'INR', matched: crore[0] }
  }

  const m = text.match(/([$€£₹]|usd|eur|gbp|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\+?/i)
  if (!m) return null
  // Only treat it as salary when the sentence frames it as money.
  if (!/\b(pay|paying|pays|salary|comp|compensation|over|above|min|at\s+least|\+)\b|[$€£₹]/i.test(text)) {
    return null
  }
  const symbol = (m[1] ?? '$').toLowerCase()
  const currency =
    symbol.includes('€') || symbol === 'eur' ? 'EUR'
    : symbol.includes('£') || symbol === 'gbp' ? 'GBP'
    : symbol.includes('₹') || symbol === 'inr' ? 'INR'
    : 'USD'
  let n = Number(m[2].replace(/,/g, ''))
  const suffix = (m[3] ?? '').toLowerCase()
  if (suffix === 'k') n *= 1_000
  else if (suffix === 'm') n *= 1_000_000
  else if (n < 1000) n *= 1_000 // "over 150" means 150k
  if (!Number.isFinite(n) || n < 1000) return null
  return { min: n, currency, matched: m[0].trim() }
}

/* ---------------------------------- parse --------------------------------- */

export function parseIntent(
  raw: string,
  vocab: {
    cities?: Set<string>
    countries?: Set<string>
    companies?: Map<string, string>
    /** city -> country, taken from the index so it reflects what we hold. */
    cityCountries?: Map<string, string>
  } = {}
): ParsedIntent {
  const facets: QueryFacet[] = []
  const allSpans: [number, number][] = []
  const text = raw.trim()
  const lower = text.toLowerCase()

  const out: ParsedIntent = {
    raw: text, topic: '', titleTerms: [], skills: [], locations: [], countries: [],
    seniority: null, workplace: null, remoteOnly: false, visa: null,
    employmentType: null, postedWithinDays: null, salaryMin: null,
    salaryCurrency: null, companies: [], impliedCountries: [], facets,
  }
  if (!text) return out

  const add = (field: string, value: any, matched: string, confidence: number) =>
    facets.push({ field, value, matched, confidence })

  // --- seniority
  allSpans.push(...takeFirst(text, SENIORITY, (v, m) => {
    out.seniority = v
    add('seniority', v, m, 0.9)
  }).spans)

  // --- workplace (before employment type, so "remote contract" reads both)
  allSpans.push(...takeFirst(text, WORKPLACE, (v, m) => {
    out.workplace = v
    out.remoteOnly = v === 'REMOTE'
    add('workplace', v, m, 0.9)
  }).spans)

  // --- employment type
  allSpans.push(...takeFirst(text, EMPLOYMENT, (v, m) => {
    out.employmentType = v
    add('employmentType', v, m, 0.85)
  }).spans)

  // --- recency
  allSpans.push(...takeFirst(text, RECENCY, (v, m) => {
    out.postedWithinDays = v
    add('postedWithinDays', v, m, 0.9)
  }).spans)

  // --- visa
  allSpans.push(...takeFirst(text, VISA as any, (v, m) => {
    out.visa = v
    add('visa', v, m, 0.9)
  }).spans)

  // --- salary
  const sal = parseSalary(text)
  if (sal) {
    out.salaryMin = sal.min
    out.salaryCurrency = sal.currency
    add('salaryMin', sal.min, sal.matched, 0.8)
    const i = text.toLowerCase().indexOf(sal.matched.toLowerCase())
    if (i >= 0) allSpans.push([i, i + sal.matched.length])
  }

  // --- locations, matched against the live corpus vocabulary rather than a
  //     hardcoded gazetteer, so the parser knows exactly the places we index.
  const matchVocab = (set: Set<string> | undefined, field: 'locations' | 'countries') => {
    if (!set) return
    // Longest first: "New York" must win over "York".
    const sorted = [...set].sort((a, b) => b.length - a.length)
    for (const name of sorted) {
      if (name.length < 3) continue
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      const m = text.match(re)
      if (m && m.index !== undefined) {
        // Skip if this span was already consumed by a stronger facet.
        if (allSpans.some(([a, b]) => m.index! >= a && m.index! < b)) continue
        out[field].push(name)
        add(field === 'locations' ? 'city' : 'country', name, m[0], 0.85)
        allSpans.push([m.index, m.index + m[0].length])
        if (out[field].length >= 3) break
      }
    }
  }
  matchVocab(vocab.countries, 'countries')
  matchVocab(vocab.cities, 'locations')

  // Resolve each named city to its country so downstream ranking can treat a
  // country-scoped remote role as covering a city inside that country.
  if (vocab.cityCountries) {
    for (const city of out.locations) {
      const country = vocab.cityCountries.get(city.toLowerCase())
      if (country && !out.impliedCountries.includes(country)) out.impliedCountries.push(country)
    }
  }

  // --- companies
  if (vocab.companies) {
    for (const [name, slug] of vocab.companies) {
      if (name.length < 4) continue
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      const m = text.match(re)
      if (m && m.index !== undefined) {
        if (allSpans.some(([a, b]) => m.index! >= a && m.index! < b)) continue
        out.companies.push(slug)
        add('company', slug, m[0], 0.9)
        allSpans.push([m.index, m.index + m[0].length])
        if (out.companies.length >= 3) break
      }
    }
  }

  // --- skills, matched on the surface forms people actually type ("ML",
  //     "K8s", "GCP") and resolved to the canonical value the index stores.
  //     Matching only canonical names meant "ML engineer" extracted no skill.
  for (const [surface, canonical] of SKILL_SURFACE_FORMS) {
    if (out.skills.includes(canonical)) continue
    // Very short forms are ambiguous in prose; allow only the well-known ones.
    if (surface.length <= 2 && !/^(js|ts|ml|ai|go|py|r|c)$/i.test(surface)) continue
    // Word-boundary edges written explicitly: \b does not fire next to the
    // "+", "#" and "." that appear in skill names like c++, c# and node.js.
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(surface)}($|[^a-z0-9+#.])`, 'i')
    if (re.test(lower)) {
      out.skills.push(canonicalSkill(canonical))
      add('skill', canonical, surface, surface.length <= 2 ? 0.65 : 0.8)
    }
  }

  // --- residue: what the user is actually looking for
  const residue = blankSpans(text, allSpans)
  // Use the retrieval tokeniser. The former ASCII-only split erased Japanese
  // role queries here, so smart search treated infrastructure-engineer text as
  // an empty query even though ordinary search handled it.
  const terms = tokenizeText(residue).filter((t) => !STOPWORDS.has(t))

  out.titleTerms = terms
  out.topic = terms.join(' ')
  return out
}

/**
 * Human-readable summary of how the query was understood, for the UI.
 * Being able to see and correct the interpretation matters more than being
 * right every time.
 */
export function describeIntent(intent: ParsedIntent): string[] {
  const parts: string[] = []
  if (intent.topic) parts.push(`matching "${intent.topic}"`)
  if (intent.seniority) parts.push(`${intent.seniority} level`)
  if (intent.workplace) parts.push(intent.workplace.toLowerCase())
  if (intent.locations.length) parts.push(`in ${intent.locations.join(' or ')}`)
  if (intent.countries.length) parts.push(`in ${intent.countries.join(' or ')}`)
  if (intent.companies.length) parts.push(`at ${intent.companies.join(', ')}`)
  if (intent.skills.length) parts.push(`using ${intent.skills.slice(0, 4).join(', ')}`)
  if (intent.visa === 'required') parts.push('with visa sponsorship')
  if (intent.employmentType) parts.push(intent.employmentType)
  if (intent.postedWithinDays) {
    parts.push(intent.postedWithinDays === 1 ? 'posted today' : `posted in the last ${intent.postedWithinDays} days`)
  }
  if (intent.salaryMin) {
    const sym = intent.salaryCurrency === 'INR' ? '₹'
      : intent.salaryCurrency === 'JPY' ? '¥'
      : intent.salaryCurrency === 'EUR' ? '€'
      : intent.salaryCurrency === 'GBP' ? '£'
      : '$'
    // A server's host locale must not change the API's English explanation.
    parts.push(`paying over ${sym}${intent.salaryMin.toLocaleString('en-US')}`)
  }
  return parts
}
