/**
 * Visa sponsorship / work-authorization classification (§11-14).
 *
 * DESIGN PRINCIPLE, and the one that matters most here: **silence is not
 * consent.** A posting that says nothing about sponsorship is
 * SPONSORSHIP_NOT_MENTIONED, never "available". Getting this wrong sends
 * someone through a multi-week application for a role that was never open to
 * them, which is a materially worse failure than showing them nothing.
 *
 * Equally, the classifier must not overreach in the other direction: "must be
 * authorized to work" is extremely common boilerplate that does NOT by itself
 * mean sponsorship is refused, because many employers who do sponsor still
 * write it. Only an explicit refusal downgrades to NOT_AVAILABLE.
 *
 * Every classification carries the sentence it was drawn from. No evidence,
 * no claim.
 */

export type VisaStatus =
  | 'SPONSORSHIP_EXPLICIT'
  | 'SPONSORSHIP_LIKELY'
  | 'SPONSORSHIP_POSSIBLE'
  | 'SPONSORSHIP_NOT_MENTIONED'
  | 'SPONSORSHIP_NOT_AVAILABLE'

export interface VisaEvidence {
  /** The sentence, verbatim from the posting. Never paraphrased. */
  quote: string
  polarity: 'positive' | 'negative' | 'neutral'
  /** Which rule matched, for the debug view (§53). */
  rule: string
  weight: number
}

export interface VisaClassification {
  status: VisaStatus
  /** 0-1. How confident we are in `status`, not how likely sponsorship is. */
  confidence: number
  evidence: VisaEvidence[]
  /** Visa programmes named in the text, e.g. ['H-1B', 'STEM OPT']. */
  visaTypes: string[]
  /** Countries the sponsorship language refers to, when stated. */
  visaCountries: string[]
  /** True when the posting requires existing authorization. */
  workAuthorizationRequired: boolean
}

interface Rule {
  id: string
  re: RegExp
  polarity: 'positive' | 'negative' | 'neutral'
  weight: number
}

/* --------------------------------- rules ---------------------------------- */

/**
 * Explicit offers of sponsorship. These are unambiguous enough to justify
 * SPONSORSHIP_EXPLICIT on their own.
 */
const POSITIVE_STRONG: Rule[] = [
  { id: 'sponsorship-available', re: /\b(visa|immigration|work\s*permit)\s+sponsorship\s+(is\s+)?(available|offered|provided|possible)\b/i, polarity: 'positive', weight: 1.0 },
  { id: 'we-will-sponsor', re: /\bwe\s+(will|do|can|are\s+able\s+to|are\s+willing\s+to)\s+sponsor\b/i, polarity: 'positive', weight: 1.0 },
  { id: 'will-sponsor-visa', re: /\b(will|can|do)\s+sponsor\s+(a\s+)?(work\s+)?(visa|visas|work\s*permit)/i, polarity: 'positive', weight: 1.0 },
  { id: 'sponsorship-provided', re: /\b(sponsorship|immigration\s+support|relocation\s+and\s+visa\s+support)\s+(is\s+)?(provided|offered|available)\b/i, polarity: 'positive', weight: 1.0 },
  { id: 'offers-sponsorship', re: /\b(offers?|providing|provides)\s+(visa\s+|immigration\s+)?sponsorship\b/i, polarity: 'positive', weight: 0.95 },
  { id: 'eligible-for-sponsorship', re: /\b(is|are)\s+eligible\s+for\s+(visa\s+)?sponsorship\b/i, polarity: 'positive', weight: 0.95 },
  { id: 'sponsor-licence', re: /\b(licensed|approved)\s+(uk\s+)?visa\s+sponsor\b|\bsponsor\s+licence\b/i, polarity: 'positive', weight: 0.95 },
]

/**
 * Softer signals. A named programme or immigration-support language suggests
 * sponsorship without stating it, which is LIKELY rather than EXPLICIT.
 */
const POSITIVE_WEAK: Rule[] = [
  { id: 'named-programme', re: /\b(h-?1b|h1-?b|e-?3\s+visa|tn\s+visa|o-?1\s+visa|l-?1\s+visa|stem\s+opt|opt\/cpt|cpt)\b/i, polarity: 'positive', weight: 0.55 },
  { id: 'skilled-worker', re: /\bskilled\s+worker\s+(visa|route|sponsorship)\b|\bglobal\s+talent\s+(visa|route)\b/i, polarity: 'positive', weight: 0.6 },
  { id: 'lmia-gts', re: /\b(lmia|global\s+talent\s+stream)\b/i, polarity: 'positive', weight: 0.6 },
  { id: 'blue-card', re: /\b(eu\s+blue\s+card|blue\s*card)\b/i, polarity: 'positive', weight: 0.6 },
  { id: 'immigration-support', re: /\b(immigration|visa|relocation)\s+(support|assistance|help)\b/i, polarity: 'positive', weight: 0.5 },
  { id: 'global-mobility', re: /\bglobal\s+mobility\s+(team|support|programme|program)\b/i, polarity: 'positive', weight: 0.45 },
  { id: 'relocation-package', re: /\brelocation\s+(package|assistance|support|bonus)\b/i, polarity: 'positive', weight: 0.3 },
  { id: 'work-permit-support', re: /\bwork\s*permit\s+(support|assistance|sponsorship)\b/i, polarity: 'positive', weight: 0.6 },
]

/**
 * Explicit refusals. These are decisive: an employer saying they cannot
 * sponsor is the most actionable information on the page.
 */
const NEGATIVE_STRONG: Rule[] = [
  // NOTE ON TOLERANCE: these patterns must allow intervening qualifiers.
  // An earlier version required the negation verb to sit directly against
  // "sponsor", so "unable TO sponsor" and "does not offer VISA sponsorship"
  // both slipped through -- and the second was then matched by the positive
  // "offers sponsorship" rule and reported as EXPLICIT sponsorship. Telling a
  // candidate a role sponsors when it explicitly refuses is the single worst
  // output this classifier can produce, so the negative side is deliberately
  // the more permissive one.
  { id: 'no-sponsorship', re: /\b(no|not|without)\s+(\w+\s+){0,2}?(visa|immigration|work[\s-]*permit)?\s*sponsorship\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'unable-to-sponsor', re: /\b(unable|not\s+able|cannot|can'?t|do(es)?\s+not|won'?t|will\s+not|are\s+not\s+able)\s+(to\s+)?(\w+\s+){0,3}?sponsor(ship|ing)?\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'not-offer-sponsorship', re: /\b(do(es)?\s+not|cannot|can'?t|unable\s+to|will\s+not|won'?t)\s+(currently\s+)?(offer|provide|support|consider|entertain)\s+(\w+\s+){0,2}?sponsorship\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'sponsorship-unavailable', re: /\bsponsorship\s+(is\s+)?(not\s+(available|offered|provided|possible)|unavailable)\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'not-eligible-sponsorship', re: /\b(not|non)[\s-]?eligible\s+for\s+(\w+\s+){0,2}?sponsorship\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'no-sponsorship-now-or-future', re: /\b(now\s+or\s+in\s+the\s+future|either\s+now\s+or\s+in\s+the\s+future)\b[^.]{0,80}\bsponsor|sponsor[^.]{0,80}\bnow\s+or\s+in\s+the\s+future\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'must-not-require-sponsorship', re: /\b(must\s+not|without\s+the\s+need\s+for|do\s+not)\s+(\w+\s+){0,3}?require\s+(\w+\s+){0,2}?sponsorship\b/i, polarity: 'negative', weight: 1.0 },
  { id: 'not-sponsoring', re: /\b(not|no\s+longer)\s+sponsoring\b/i, polarity: 'negative', weight: 1.0 },
]

/**
 * Authorization requirements. IMPORTANT: these do NOT mean sponsorship is
 * refused. "Must be authorized to work in the US" appears in a great many
 * postings from employers who sponsor routinely -- it is usually a statement
 * about start-date readiness, not immigration policy. Treated as neutral and
 * recorded on `workAuthorizationRequired`, never as a negative on its own.
 */
const AUTHORIZATION: Rule[] = [
  { id: 'must-be-authorized', re: /\b(must|should)\s+(be|already\s+be)\s+(legally\s+)?(authoriz|authoris)ed\s+to\s+work\b/i, polarity: 'neutral', weight: 0.4 },
  { id: 'unrestricted-authorization', re: /\b(unrestricted|permanent)\s+(work\s+)?(authoriz|authoris)ation\b/i, polarity: 'neutral', weight: 0.5 },
  { id: 'existing-right-to-work', re: /\b(existing\s+)?right\s+to\s+work\s+in\b/i, polarity: 'neutral', weight: 0.4 },
  { id: 'citizen-or-pr', re: /\b(citizen|permanent\s+resident)s?\s+(only|or\s+permanent\s+residents)\b/i, polarity: 'neutral', weight: 0.5 },
  { id: 'security-clearance', re: /\b(security\s+clearance|us\s+citizenship\s+required|itar)\b/i, polarity: 'neutral', weight: 0.6 },
]

const ALL_RULES = [...POSITIVE_STRONG, ...POSITIVE_WEAK, ...NEGATIVE_STRONG, ...AUTHORIZATION]

/** Visa programmes, for the `visaTypes` facet. */
const VISA_TYPES: [RegExp, string][] = [
  [/\bh-?1b\b/i, 'H-1B'],
  [/\bstem\s+opt\b/i, 'STEM OPT'],
  [/\bopt\b/i, 'OPT'],
  [/\bcpt\b/i, 'CPT'],
  [/\btn\s+visa\b/i, 'TN'],
  [/\bo-?1\b/i, 'O-1'],
  [/\bl-?1\b/i, 'L-1'],
  [/\be-?3\b/i, 'E-3'],
  [/\bgreen\s*card\b|\bpermanent\s+residency\s+sponsorship\b/i, 'Green Card'],
  [/\bskilled\s+worker\b/i, 'UK Skilled Worker'],
  [/\bglobal\s+talent\b/i, 'Global Talent'],
  [/\beu\s+blue\s+card\b|\bblue\s*card\b/i, 'EU Blue Card'],
  [/\blmia\b/i, 'LMIA'],
  [/\bglobal\s+talent\s+stream\b/i, 'Global Talent Stream'],
  [/\bsubclass\s*(482|186|494)\b|\btss\s+visa\b/i, 'Australia TSS'],
  [/\bhighly\s+skilled\s+migrant\b/i, 'NL Highly Skilled Migrant'],
]

/** Countries named near sponsorship language. */
const VISA_COUNTRY_HINTS: [RegExp, string][] = [
  [/\b(united\s+states|u\.?s\.?a?\.?|america)\b/i, 'United States'],
  [/\b(united\s+kingdom|u\.?k\.?|britain|england)\b/i, 'United Kingdom'],
  [/\bcanad(a|ian)\b/i, 'Canada'],
  [/\b(germany|german|deutschland)\b/i, 'Germany'],
  [/\b(netherlands|dutch|holland)\b/i, 'Netherlands'],
  [/\b(ireland|irish)\b/i, 'Ireland'],
  [/\b(australia|australian)\b/i, 'Australia'],
  [/\b(singapore)\b/i, 'Singapore'],
  [/\b(india|indian)\b/i, 'India'],
  [/\b(france|french)\b/i, 'France'],
  [/\b(switzerland|swiss)\b/i, 'Switzerland'],
  [/\b(united\s+arab\s+emirates|uae|dubai)\b/i, 'United Arab Emirates'],
]

/* ------------------------------- extraction ------------------------------- */

/** Split into sentences so evidence can be quoted at a useful granularity. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|(?:\s*[•·\-\*]\s+)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 400)
}

/**
 * Classify a posting.
 *
 * `text` should be title + description. When no description is available the
 * honest answer is NOT_MENTIONED with zero evidence, and the caller is expected
 * to surface that as "not mentioned", not as "no sponsorship".
 */
export function classifyVisa(text: string, opts: { country?: string | null } = {}): VisaClassification {
  const empty: VisaClassification = {
    status: 'SPONSORSHIP_NOT_MENTIONED',
    confidence: 0,
    evidence: [],
    visaTypes: [],
    visaCountries: [],
    workAuthorizationRequired: false,
  }

  if (!text || text.trim().length < 40) return empty

  const evidence: VisaEvidence[] = []
  let bestPositive = 0
  let bestNegative = 0
  let authRequired = false

  for (const sentence of sentences(text)) {
    for (const rule of ALL_RULES) {
      if (!rule.re.test(sentence)) continue

      // A sentence that both mentions sponsorship and negates it must not
      // also count as positive: "we do not offer visa sponsorship" contains
      // the substring "visa sponsorship".
      if (rule.polarity === 'positive' && NEGATIVE_STRONG.some((n) => n.re.test(sentence))) {
        continue
      }

      evidence.push({
        quote: sentence.length > 300 ? sentence.slice(0, 297) + '...' : sentence,
        polarity: rule.polarity,
        rule: rule.id,
        weight: rule.weight,
      })

      if (rule.polarity === 'positive') bestPositive = Math.max(bestPositive, rule.weight)
      if (rule.polarity === 'negative') bestNegative = Math.max(bestNegative, rule.weight)
      if (rule.polarity === 'neutral') authRequired = true
    }
  }

  // Deduplicate evidence by quote, keeping the strongest rule per sentence.
  const byQuote = new Map<string, VisaEvidence>()
  for (const e of evidence) {
    const prev = byQuote.get(e.quote)
    if (!prev || e.weight > prev.weight) byQuote.set(e.quote, e)
  }
  const finalEvidence = [...byQuote.values()].sort((a, b) => b.weight - a.weight).slice(0, 6)

  const visaTypes = [...new Set(VISA_TYPES.filter(([re]) => re.test(text)).map(([, t]) => t))]

  // Only look for countries in sentences that actually discuss sponsorship,
  // so an office list does not become a sponsorship claim.
  const visaText = finalEvidence.map((e) => e.quote).join(' ')
  const visaCountries = [...new Set(
    VISA_COUNTRY_HINTS.filter(([re]) => re.test(visaText)).map(([, c]) => c)
  )]
  if (visaCountries.length === 0 && opts.country && finalEvidence.length > 0) {
    visaCountries.push(opts.country)
  }

  /* ------------------------------ decision ------------------------------- */

  // A refusal outranks everything: it is the most decisive and most actionable.
  if (bestNegative >= 0.9) {
    return {
      status: 'SPONSORSHIP_NOT_AVAILABLE',
      confidence: bestNegative,
      evidence: finalEvidence,
      visaTypes,
      visaCountries,
      workAuthorizationRequired: true,
    }
  }

  if (bestPositive >= 0.9) {
    return {
      status: 'SPONSORSHIP_EXPLICIT',
      confidence: bestPositive,
      evidence: finalEvidence,
      visaTypes,
      visaCountries,
      workAuthorizationRequired: authRequired,
    }
  }

  if (bestPositive >= 0.55) {
    return {
      status: 'SPONSORSHIP_LIKELY',
      confidence: bestPositive,
      evidence: finalEvidence,
      visaTypes,
      visaCountries,
      workAuthorizationRequired: authRequired,
    }
  }

  if (bestPositive > 0) {
    return {
      status: 'SPONSORSHIP_POSSIBLE',
      confidence: bestPositive,
      evidence: finalEvidence,
      visaTypes,
      visaCountries,
      workAuthorizationRequired: authRequired,
    }
  }

  // Authorization boilerplate with no sponsorship language either way is still
  // NOT_MENTIONED. It tells us the employer wants someone work-ready; it does
  // not tell us whether they would sponsor.
  return {
    status: 'SPONSORSHIP_NOT_MENTIONED',
    confidence: authRequired ? 0.3 : 0,
    evidence: finalEvidence,
    visaTypes,
    visaCountries: [],
    workAuthorizationRequired: authRequired,
  }
}

/** Short label for the UI. */
export const VISA_LABELS: Record<VisaStatus, string> = {
  SPONSORSHIP_EXPLICIT: 'Explicit',
  SPONSORSHIP_LIKELY: 'Likely',
  SPONSORSHIP_POSSIBLE: 'Possible',
  SPONSORSHIP_NOT_MENTIONED: 'Not mentioned',
  SPONSORSHIP_NOT_AVAILABLE: 'Not available',
}
