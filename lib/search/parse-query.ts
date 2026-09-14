/**
 * Natural-language job query -> structured search intent.
 *
 * "Remote software engineering internships in Europe"
 *   -> { role: 'software engineering', earlyCareer: 'internship',
 *        remote: true, region: 'Europe', q: 'software engineering' }
 *
 * WHY THIS IS RULE-BASED AND NOT A MODEL
 * --------------------------------------
 * The output of this function is shown back to the user as editable chips --
 * "Remote", "Internship", "Europe" -- and every chip is a claim about what we
 * understood. A model would produce chips it cannot justify and would vary
 * between identical queries, which is worse than a narrower parser that is
 * always explicable. Each token here records the span of the query it came
 * from, so the UI can show why a chip exists and the user can remove it.
 *
 * WHAT IT DELIBERATELY DOES NOT PARSE
 * -----------------------------------
 * Measured against the served index before writing this:
 *
 *   salary present on   3.6% of postings
 *   visaStatus known    2.5%
 *   remote flag true    7.3%
 *   employmentType     20.6%
 *
 * So "paying above £50k" and "that sponsor visas" are understood and turned
 * into filters, but the UI must warn that they narrow results to the small
 * slice where that data exists. Parsing a constraint the corpus cannot answer
 * produces an empty result set that looks like "no such jobs exist", which is a
 * lie about the market rather than about our data.
 */

export interface ParsedIntent {
  /** Free-text remainder, after recognised constraints are removed. */
  q: string
  remote?: boolean
  workMode?: 'remote' | 'hybrid' | 'onsite'
  earlyCareer?: string
  seniority?: string
  country?: string
  city?: string
  /** A multi-country region the UI expands into countries. */
  region?: string
  postedWithinDays?: number
  minSalary?: number
  salaryCurrency?: string
  visaSponsorship?: boolean
  skills?: string[]
  /** Every recognised span, for rendering editable chips. */
  tokens: IntentToken[]
  /** Constraints the corpus can only answer for a small slice. */
  warnings: string[]
}

export interface IntentToken {
  kind: 'role' | 'workMode' | 'level' | 'location' | 'date' | 'salary' | 'visa' | 'skill'
  label: string
  /** The field this chip maps to, so removing it clears the right filter. */
  field: keyof ParsedIntent
  value: string | number | boolean
  /** The exact text in the query that produced it. */
  matched: string
}

/* ------------------------------ vocabularies ------------------------------ */

const WORK_MODE: [RegExp, 'remote' | 'hybrid' | 'onsite', string][] = [
  [/\b(fully[- ]?remote|work from home|wfh|remote)\b/i, 'remote', 'Remote'],
  [/\bhybrid\b/i, 'hybrid', 'Hybrid'],
  [/\b(on[- ]?site|in[- ]?office|onsite)\b/i, 'onsite', 'On-site'],
]

/** Maps to the earlyCareer facet, which is a stored classification. */
const EARLY_CAREER: [RegExp, string, string][] = [
  [/\b(internships?|interns?)\b/i, 'internship', 'Internship'],
  [/\b(apprenticeships?|apprentices?)\b/i, 'apprenticeship', 'Apprenticeship'],
  [/\b(graduate schemes?|graduate programmes?|graduate programs?|new grads?|graduates?)\b/i, 'graduate', 'Graduate'],
  [/\b(placements?|year in industry|industrial placements?)\b/i, 'placement', 'Placement'],
  [/\btrainees?\b/i, 'trainee', 'Trainee'],
  [/\b(entry[- ]?level|no experience)\b/i, 'entry-level', 'Entry level'],
  [/\bjunior\b/i, 'junior', 'Junior'],
]

const SENIORITY: [RegExp, string, string][] = [
  [/\b(senior|sr\.?)\b/i, 'senior', 'Senior'],
  [/\b(staff)\b/i, 'staff', 'Staff'],
  [/\b(principal)\b/i, 'principal', 'Principal'],
  [/\b(lead)\b/i, 'lead', 'Lead'],
  [/\b(mid[- ]?level|mid)\b/i, 'mid', 'Mid-level'],
]

/**
 * Regions are expanded to countries by the caller.
 *
 * Kept small and explicit rather than pulled from a geo database: the index
 * stores `country` as a display string, so a region is only useful here if its
 * members match strings the corpus actually contains.
 */
export const REGIONS: Record<string, string[]> = {
  Europe: ['United Kingdom', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Ireland',
           'Poland', 'Portugal', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Switzerland',
           'Austria', 'Belgium', 'Czechia', 'Romania', 'Hungary', 'Greece'],
  'North America': ['United States', 'Canada', 'Mexico'],
  APAC: ['India', 'Singapore', 'Japan', 'China', 'Australia', 'New Zealand', 'Hong Kong SAR',
         'Taiwan', 'Malaysia', 'Vietnam', 'Thailand', 'Philippines', 'Indonesia', 'South Korea'],
  'Middle East': ['United Arab Emirates', 'Saudi Arabia', 'Israel', 'Qatar'],
}

const DATE_RULES: [RegExp, number, string][] = [
  [/\b(today|last 24 ?h(ours)?|past 24 ?h(ours)?)\b/i, 1, 'Past 24 hours'],
  [/\b(this week|past week|last week|last 7 days|past 7 days)\b/i, 7, 'Past week'],
  [/\b(last (?:two|2) weeks|past (?:two|2) weeks|last 14 days)\b/i, 14, 'Past 2 weeks'],
  [/\b(this month|last 30 days|past month)\b/i, 30, 'Past 30 days'],
]

const CURRENCY: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR', '₹': 'INR' }

/**
 * Skills recognised in a query.
 *
 * Only terms that appear in the index's own `skills` field are worth matching:
 * a chip for a skill nothing is tagged with filters everything away.
 */
const SKILLS = [
  'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c++', 'c#', 'ruby',
  'php', 'scala', 'kotlin', 'swift', 'react', 'angular', 'vue', 'node', 'django', 'flask',
  'spring', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'sql', 'postgres',
  'mysql', 'mongodb', 'redis', 'kafka', 'spark', 'hadoop', 'tensorflow', 'pytorch',
  'machine learning', 'deep learning', 'nlp', 'solidity', 'rust', 'graphql',
]

/* -------------------------------- parsing --------------------------------- */

function take(text: string, re: RegExp): { hit: string | null; rest: string } {
  const m = text.match(re)
  if (!m) return { hit: null, rest: text }
  return { hit: m[0], rest: text.replace(m[0], ' ') }
}

export function parseQuery(
  raw: string,
  known: { countries?: string[]; cities?: string[] } = {},
): ParsedIntent {
  const tokens: IntentToken[] = []
  const warnings: string[] = []
  let rest = ` ${(raw || '').trim()} `
  const out: ParsedIntent = { q: '', tokens, warnings }

  const push = (t: IntentToken) => tokens.push(t)

  // --- work mode
  for (const [re, value, label] of WORK_MODE) {
    const { hit, rest: r } = take(rest, re)
    if (hit) {
      rest = r
      out.workMode = value
      if (value === 'remote') out.remote = true
      push({ kind: 'workMode', label, field: 'workMode', value, matched: hit.trim() })
      if (value === 'remote') {
        warnings.push('Only 7% of postings carry an explicit remote flag, so a remote filter hides roles that are remote but do not say so in a machine-readable field.')
      }
      break
    }
  }

  // --- early-career level (checked before seniority: "graduate engineer" is
  //     an early-career role, not a seniority)
  for (const [re, value, label] of EARLY_CAREER) {
    const { hit, rest: r } = take(rest, re)
    if (hit) {
      rest = r
      out.earlyCareer = value
      push({ kind: 'level', label, field: 'earlyCareer', value, matched: hit.trim() })
      break
    }
  }
  if (!out.earlyCareer) {
    for (const [re, value, label] of SENIORITY) {
      const { hit, rest: r } = take(rest, re)
      if (hit) {
        rest = r
        out.seniority = value
        push({ kind: 'level', label, field: 'seniority', value, matched: hit.trim() })
        break
      }
    }
  }

  // --- date
  for (const [re, days, label] of DATE_RULES) {
    const { hit, rest: r } = take(rest, re)
    if (hit) {
      rest = r
      out.postedWithinDays = days
      push({ kind: 'date', label, field: 'postedWithinDays', value: days, matched: hit.trim() })
      warnings.push('A posting date is recorded for 42% of listings; a date filter excludes the rest rather than assuming they are recent.')
      break
    }
  }

  // --- salary: "above £50k", "paying $100k+", "over 80000"
  const sal = rest.match(/\b(?:above|over|more than|at least|paying|from|\+)?\s*([£$€₹])?\s*(\d{2,3})\s*[kK]\b|\b([£$€₹])\s?(\d{4,7})\b/)
  if (sal) {
    const sym = sal[1] || sal[3] || ''
    const amount = sal[2] ? Number(sal[2]) * 1000 : Number(sal[4])
    if (Number.isFinite(amount) && amount >= 1000) {
      out.minSalary = amount
      if (CURRENCY[sym]) out.salaryCurrency = CURRENCY[sym]
      rest = rest.replace(sal[0], ' ')
      push({ kind: 'salary', label: `${sym}${amount.toLocaleString('en-US')}+`, field: 'minSalary', value: amount, matched: sal[0].trim() })
      warnings.push('Salary is published on 3.6% of postings. A salary filter searches only that slice, not the whole market.')
    }
  }

  // --- visa
  {
    const { hit, rest: r } = take(rest, /\b(visa sponsorship|sponsors? visas?|visa[- ]sponsored|sponsorship available)\b/i)
    if (hit) {
      rest = r
      out.visaSponsorship = true
      push({ kind: 'visa', label: 'Visa sponsorship', field: 'visaSponsorship', value: true, matched: hit.trim() })
      warnings.push('Visa status is stated on 2.5% of postings. Most employers simply do not say, so this filter is a floor rather than a complete answer.')
    }
  }

  // --- region
  for (const region of Object.keys(REGIONS)) {
    const re = new RegExp(`\\b${region.replace(/\s/g, '\\s')}\\b`, 'i')
    const { hit, rest: r } = take(rest, re)
    if (hit) {
      rest = r
      out.region = region
      push({ kind: 'location', label: region, field: 'region', value: region, matched: hit.trim() })
      break
    }
  }

  // --- country / city, matched against values the index actually holds
  if (!out.region) {
    for (const c of known.countries ?? []) {
      const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      const { hit, rest: r } = take(rest, re)
      if (hit) { rest = r; out.country = c; push({ kind: 'location', label: c, field: 'country', value: c, matched: hit.trim() }); break }
    }
  }
  if (!out.country) {
    for (const c of known.cities ?? []) {
      if (c.length < 4) continue
      const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      const { hit, rest: r } = take(rest, re)
      if (hit) { rest = r; out.city = c; push({ kind: 'location', label: c, field: 'city', value: c, matched: hit.trim() }); break }
    }
  }

  // --- skills
  const skills: string[] = []
  for (const s of SKILLS) {
    const re = new RegExp(`(^|[^a-z0-9+#])${s.replace(/[+#]/g, '\\$&')}([^a-z0-9+#]|$)`, 'i')
    if (re.test(rest)) {
      skills.push(s)
      push({ kind: 'skill', label: s, field: 'skills', value: s, matched: s })
    }
  }
  if (skills.length) out.skills = skills

  // --- whatever is left is the role text
  const stop = /\b(jobs?|roles?|positions?|openings?|opportunities|in|at|for|the|a|an|with|that|who|which|and|or|near|around|me|looking|find|show|paying|above|over|under|posted|this|past|last|new)\b/gi
  out.q = rest
    .replace(stop, ' ')
    .replace(/[^\p{L}\p{N}+#. ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (out.q) {
    push({ kind: 'role', label: out.q, field: 'q', value: out.q, matched: out.q })
  }

  return out
}

/** Turn parsed intent into the query string /api/search already understands. */
export function intentToParams(intent: ParsedIntent): URLSearchParams {
  const p = new URLSearchParams()
  if (intent.q) p.set('q', intent.q)
  if (intent.remote) p.set('remote', 'true')
  if (intent.earlyCareer) p.set('earlyCareer', intent.earlyCareer)
  if (intent.country) p.set('country', intent.country)
  if (intent.city) p.set('city', intent.city)
  if (intent.region) p.set('country', (REGIONS[intent.region] ?? []).join(','))
  if (intent.postedWithinDays) p.set('postedWithinDays', String(intent.postedWithinDays))
  if (intent.minSalary) p.set('minSalary', String(intent.minSalary))
  if (intent.skills?.length) p.set('q', [intent.q, ...intent.skills].filter(Boolean).join(' '))
  return p
}
