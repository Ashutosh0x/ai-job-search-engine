/**
 * Workplace classification (§15-17).
 *
 * Two problems with the previous boolean model, both visible in the audit:
 *
 *  1. `onsite` read 84.1%, because anything with a location string and no
 *     remote marker was *defaulted* to onsite. That is an assumption presented
 *     as a classification -- exactly what §46 forbids. Most postings simply do
 *     not say, and the honest answer is UNKNOWN.
 *
 *  2. "Remote" was a bare boolean. "Remote" almost never means worldwide: it
 *     usually means remote within one country, and telling someone in Bengaluru
 *     that a US-only remote role is open to them is a real harm. Scope is now
 *     first-class.
 */

export type WorkplaceType = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE' | 'UNKNOWN'
export type RemoteScope =
  | 'WORLDWIDE' | 'COUNTRY' | 'REGION' | 'TIMEZONE' | 'STATE' | 'UNSPECIFIED'

export interface WorkplaceClassification {
  type: WorkplaceType
  confidence: number
  /** Verbatim phrases the decision rests on. */
  evidence: string[]

  remoteScope: RemoteScope | null
  remoteCountries: string[]
  remoteRegions: string[]
  remoteTimezones: string[]

  /** Hybrid detail, when stated. */
  officeDaysPerWeek: number | null
  officeLocation: string | null
  hybridDetails: string | null
}

const REGIONS: [RegExp, string][] = [
  [/\bemea\b/i, 'EMEA'],
  [/\bapac\b|\basia[\s-]pacific\b/i, 'APAC'],
  [/\blatam\b|\blatin\s+america\b/i, 'LATAM'],
  [/\bnamer\b|\bnorth\s+america\b/i, 'North America'],
  [/\beurope(an)?\b|\beu\b|\beea\b/i, 'Europe'],
  [/\bmena\b|\bmiddle\s+east\b/i, 'MENA'],
  [/\banz\b|\baustralia\s*\/?\s*new\s+zealand\b/i, 'ANZ'],
]

const COUNTRIES: [RegExp, string][] = [
  [/\b(united\s+states|u\.?s\.?a?\.?|stateside)\b/i, 'United States'],
  [/\b(united\s+kingdom|u\.?k\.?|britain)\b/i, 'United Kingdom'],
  [/\bcanada\b/i, 'Canada'],
  [/\bindia\b/i, 'India'],
  [/\bgermany\b/i, 'Germany'],
  [/\bfrance\b/i, 'France'],
  [/\bnetherlands\b/i, 'Netherlands'],
  [/\bireland\b/i, 'Ireland'],
  [/\bspain\b/i, 'Spain'],
  [/\bpoland\b/i, 'Poland'],
  [/\bportugal\b/i, 'Portugal'],
  [/\baustralia\b/i, 'Australia'],
  [/\bsingapore\b/i, 'Singapore'],
  [/\bjapan\b/i, 'Japan'],
  [/\bbrazil\b/i, 'Brazil'],
  [/\bmexico\b/i, 'Mexico'],
  [/\bisrael\b/i, 'Israel'],
]

const TIMEZONES: [RegExp, string][] = [
  [/\b(pst|pdt|pacific\s+time)\b/i, 'Pacific'],
  [/\b(est|edt|eastern\s+time)\b/i, 'Eastern'],
  [/\b(cst|cdt|central\s+time)\b/i, 'Central'],
  [/\b(mst|mdt|mountain\s+time)\b/i, 'Mountain'],
  [/\b(gmt|utc|bst)\b/i, 'GMT/UTC'],
  [/\bcet\b|\bcest\b|\bcentral\s+european\b/i, 'CET'],
  [/\bist\b|\bindia\s+standard\s+time\b/i, 'IST'],
  [/\boverlap\s+with\s+[^.]{0,40}\b(time|hours|timezone)\b/i, 'Overlap required'],
]

const US_STATE_RE =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|ohio|oklahoma|oregon|pennsylvania|texas|utah|vermont|virginia|washington|wisconsin)\b/gi

/** Sentences mentioning workplace, so evidence is quotable and scoped. */
function relevantSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|(?:\s*[•·]\s*)/)
    .map((s) => s.trim())
    .filter((s) =>
      s.length > 8 && s.length < 400 &&
      /\b(remote|hybrid|on[\s-]?site|onsite|in[\s-]?office|work\s+from\s+home|wfh|distributed|anywhere|office|relocat)\b/i.test(s)
    )
    .slice(0, 25)
}

export function classifyWorkplace(
  input: { title?: string; locationRaw?: string | null; description?: string | null; providerRemoteFlag?: boolean | null }
): WorkplaceClassification {
  const location = input.locationRaw ?? ''
  const description = input.description ?? ''
  const title = input.title ?? ''
  // Location and title are far more reliable than a long description, which
  // often mentions "remote" only in passing ("our remote-friendly culture").
  const strong = `${title} ${location}`
  const all = `${strong} ${description}`

  const base: WorkplaceClassification = {
    type: 'UNKNOWN', confidence: 0, evidence: [],
    remoteScope: null, remoteCountries: [], remoteRegions: [], remoteTimezones: [],
    officeDaysPerWeek: null, officeLocation: null, hybridDetails: null,
  }

  const evidence: string[] = []
  const sents = relevantSentences(description)

  /* -------------------------------- HYBRID -------------------------------- */
  // Checked before remote: "hybrid remote" is hybrid, not remote.
  const hybridInStrong = /\bhybrid\b/i.test(strong)
  const hybridSent = sents.find((s) => /\bhybrid\b/i.test(s))
  const daysMatch = all.match(/\b(\d)\s*(?:\+)?\s*days?\s*(?:per|a|\/)\s*week\s*(?:in|at|from)?\s*(?:the\s+)?(?:office|onsite|on[\s-]site)?/i)
    || all.match(/\b(?:in\s+(?:the\s+)?office|onsite)\s*(\d)\s*days?\b/i)

  if (hybridInStrong || hybridSent) {
    if (hybridInStrong) evidence.push(location || title)
    if (hybridSent) evidence.push(hybridSent)
    const days = daysMatch ? Number(daysMatch[1]) : null
    return {
      ...base,
      type: 'HYBRID',
      confidence: hybridInStrong ? 0.95 : 0.75,
      evidence,
      officeDaysPerWeek: days && days >= 1 && days <= 7 ? days : null,
      officeLocation: location || null,
      hybridDetails: hybridSent ?? null,
    }
  }

  /* -------------------------------- REMOTE -------------------------------- */
  const remoteInStrong = /\b(remote|work\s+from\s+home|wfh|anywhere|distributed)\b/i.test(strong)
  const remoteSent = sents.find((s) =>
    /\b(fully\s+remote|remote[\s-]first|100%\s+remote|is\s+(a\s+)?remote|remote\s+position|remote\s+role|work\s+from\s+anywhere)\b/i.test(s)
  )
  const providerSaysRemote = input.providerRemoteFlag === true

  if (remoteInStrong || remoteSent || providerSaysRemote) {
    if (remoteInStrong) evidence.push(location || title)
    if (remoteSent) evidence.push(remoteSent)
    if (providerSaysRemote && !remoteInStrong && !remoteSent) evidence.push('Employer marked this role remote')

    // Scope. The text around "remote" is what qualifies it.
    const scopeText = [location, remoteSent ?? '', title].join(' ')
    const countries = [...new Set(COUNTRIES.filter(([re]) => re.test(scopeText)).map(([, c]) => c))]
    const regions = [...new Set(REGIONS.filter(([re]) => re.test(scopeText)).map(([, r]) => r))]
    const timezones = [...new Set(TIMEZONES.filter(([re]) => re.test(scopeText)).map(([, t]) => t))]
    const states = [...new Set((scopeText.match(US_STATE_RE) ?? []).map((s) => s.trim()))]

    let scope: RemoteScope = 'UNSPECIFIED'
    if (/\b(worldwide|globally|anywhere\s+in\s+the\s+world|any\s+country|global\s+remote)\b/i.test(scopeText)) {
      scope = 'WORLDWIDE'
    } else if (countries.length > 0) {
      scope = 'COUNTRY'
    } else if (regions.length > 0) {
      scope = 'REGION'
    } else if (states.length > 0) {
      scope = 'STATE'
    } else if (timezones.length > 0) {
      scope = 'TIMEZONE'
    }

    return {
      ...base,
      type: 'REMOTE',
      confidence: remoteInStrong ? 0.95 : remoteSent ? 0.8 : 0.7,
      evidence,
      // UNSPECIFIED is deliberate and load-bearing: "Remote" with no qualifier
      // is NOT worldwide, we simply do not know the boundary.
      remoteScope: scope,
      remoteCountries: countries,
      remoteRegions: regions,
      remoteTimezones: timezones,
    }
  }

  /* -------------------------------- ONSITE -------------------------------- */
  // Only when the posting SAYS so. A bare city is not a statement about
  // whether the role is onsite -- that was the 84.1% fabrication.
  const onsiteInStrong = /\b(on[\s-]?site|onsite|in[\s-]?office|in[\s-]person|office[\s-]based)\b/i.test(strong)
  const onsiteSent = sents.find((s) =>
    /\b(on[\s-]?site|in[\s-]?office|office[\s-]based|in[\s-]person)\b/i.test(s) && !/\bremote\b/i.test(s)
  )
  if (onsiteInStrong || onsiteSent) {
    if (onsiteInStrong) evidence.push(location || title)
    if (onsiteSent) evidence.push(onsiteSent)
    return {
      ...base,
      type: 'ONSITE',
      confidence: onsiteInStrong ? 0.9 : 0.7,
      evidence,
      officeLocation: location || null,
    }
  }

  /* ------------------------------- FLEXIBLE ------------------------------- */
  const flexSent = sents.find((s) => /\bflexib(le|ility)\b/i.test(s) && /\b(work|location|arrangement|where)\b/i.test(s))
  if (flexSent) {
    return { ...base, type: 'FLEXIBLE', confidence: 0.6, evidence: [flexSent] }
  }

  /* -------------------------------- UNKNOWN ------------------------------- */
  return base
}

export const WORKPLACE_LABELS: Record<WorkplaceType, string> = {
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
  ONSITE: 'On-site',
  FLEXIBLE: 'Flexible',
  UNKNOWN: 'Not specified',
}

/** "Remote — India", "Hybrid — London, 3 days/week". */
export function workplaceDisplay(w: WorkplaceClassification, fallbackLocation?: string | null): string {
  if (w.type === 'REMOTE') {
    if (w.remoteScope === 'WORLDWIDE') return 'Remote — Worldwide'
    if (w.remoteCountries.length) return `Remote — ${w.remoteCountries.slice(0, 2).join(' / ')}`
    if (w.remoteRegions.length) return `Remote — ${w.remoteRegions.slice(0, 2).join(' / ')}`
    if (w.remoteTimezones.length) return `Remote — ${w.remoteTimezones[0]}`
    return 'Remote'
  }
  if (w.type === 'HYBRID') {
    const where = w.officeLocation || fallbackLocation
    const days = w.officeDaysPerWeek ? `, ${w.officeDaysPerWeek} days/week` : ''
    return where ? `Hybrid — ${where}${days}` : `Hybrid${days}`
  }
  if (w.type === 'ONSITE') {
    const where = w.officeLocation || fallbackLocation
    return where ? `On-site — ${where}` : 'On-site'
  }
  if (w.type === 'FLEXIBLE') return 'Flexible'
  return fallbackLocation || 'Not specified'
}
