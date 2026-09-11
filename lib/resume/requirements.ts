import type { Requirement, Provenance } from './types'

/**
 * Requirement discovery from a target job description.
 *
 * WHY IMPORTANCE IS NOT A CONSTANT
 * --------------------------------
 * The brief forbids "all skills are worth 5 points", and rightly: whether
 * Kubernetes matters depends entirely on the job. So importance here is read
 * from two places, in priority order, and the winner records which one it was:
 *
 *   1. THE POSTING'S OWN LANGUAGE. An employer writing "must have" is telling
 *      us the importance directly. This outranks statistics, because it is the
 *      employer speaking about this specific role rather than an average over
 *      other people's roles.
 *
 *   2. CORPUS LIFT. Absent explicit language, we fall back to how distinctive
 *      the term is for this kind of role across 225k real postings. A term that
 *      appears in 60% of postings for this family and 2% overall is load-bearing;
 *      one that appears everywhere is not.
 *
 * If neither is available the requirement is emitted with `basis: 'unscored'`
 * and importance 0, rather than a made-up default. An unscored requirement is
 * still worth showing -- we just must not pretend to rank it.
 */

export interface TermStats {
  generatedAt: string
  postingsWithText: number
  vocab: Record<string, { df: number; rate: number }>
  families: Record<string, { n: number; terms: Record<string, { n: number; rate: number; lift: number }> }>
}

/**
 * Phrases employers use to mark a requirement as mandatory or optional.
 *
 * This is linguistic, not domain knowledge -- it is about how English marks
 * obligation, which does not change when the job market does. That is the line:
 * grammar can be enumerated, importance cannot.
 */
const MANDATORY_MARKERS = [
  /\bmust\s+have\b/i, /\brequired?\b/i, /\bessential\b/i, /\bmandatory\b/i,
  /\byou\s+(?:will\s+)?need\b/i, /\bminimum\s+(?:of\s+)?\b/i, /\bproven\b/i,
  /\bdemonstrated\b/i, /\bstrong\s+(?:experience|background)\b/i,
]
const OPTIONAL_MARKERS = [
  /\bnice\s+to\s+have\b/i, /\bpreferred\b/i, /\bplus\b/i, /\bbonus\b/i,
  /\bdesirable\b/i, /\badvantageous\b/i, /\bideally\b/i, /\bfamiliarity\b/i,
]

/** Section headings that signal the requirement block, in any casing. */
const REQ_SECTION = /\b(requirements?|qualifications?|what\s+you'?ll\s+need|who\s+you\s+are|skills?|experience|about\s+you|we'?re\s+looking\s+for)\b/i
const OPT_SECTION = /\b(nice\s+to\s+have|preferred|bonus|desirable|pluses?)\b/i

const TOKEN = /[a-z][a-z0-9+#.\-]{1,28}[a-z0-9+#]|[a-z]{2,}/g

/**
 * Structural English. Same rationale as MANDATORY_MARKERS: this is a statement
 * about grammar, not about which skills matter.
 */
const STOP = new Set(`a an the and or but if then else for to of in on at by with from as is are was were
be been being this that these those we you they it our your their its will would can could should may
might must have has had do does did not no all any some each more most such own same so than too very
just about into over under again once here there when where why how what which who whom whose i me my
role job work working position opportunity team company please apply candidate candidates applicant
experience experienced years year new join looking seeking required require requirements responsibilities
qualifications benefits salary including include includes etc via across within without per also well
strong ability able help make made making using use used offer offers offering support supporting
provide provides providing ensure ensuring day days week weeks month months full time part remote hybrid
onsite office based plus preferred nice you'll we're we'll don't it's their they're`.split(/\s+/))

/** Split a posting into lines that plausibly each carry one requirement. */
function requirementLines(text: string): { line: string; index: number; optionalSection: boolean }[] {
  const lines = text.split(/\r?\n/)
  const out: { line: string; index: number; optionalSection: boolean }[] = []
  let inReqSection = false
  let inOptSection = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    // A bullet is content, never a heading -- test this FIRST.
    //
    // Getting the order wrong silently drops requirements: the line
    // "- Must have strong experience with Kubernetes in production" is 58
    // characters and contains the word "experience", so a heading test that
    // runs first matches it as a section header and `continue`s past it. The
    // two most important requirements in the posting vanished that way, and
    // nothing failed loudly -- extraction just quietly returned fewer terms.
    const isBullet = /^[\s]*[-•*·‣▪>]|^\s*\d+[.)]\s/.test(lines[i])

    // A short non-bullet line that reads like a heading switches section context.
    const isHeading = !isBullet && raw.length < 60 && !/[.!?]$/.test(raw)
    if (isHeading) {
      if (OPT_SECTION.test(raw)) { inOptSection = true; inReqSection = true; continue }
      if (REQ_SECTION.test(raw)) { inReqSection = true; inOptSection = false; continue }
      // A heading that is neither ends the requirement block.
      if (/^[A-Z][\w\s&/'-]{2,}$/.test(raw)) { inReqSection = false; inOptSection = false; continue }
    }

    // Bullets are requirements wherever they appear; prose counts only inside a
    // requirements section, or the company blurb floods the result.
    if (isBullet || inReqSection) {
      out.push({ line: raw.replace(/^[\s]*[-•*·‣▪>]\s*/, ''), index: i, optionalSection: inOptSection })
    }
  }
  return out
}

/** The role family key used by term-stats, derived the same way. */
export function familyKeyOf(title: string): string | null {
  if (!title) return null
  const toks = (title.toLowerCase().match(/[a-z][a-z0-9+#.\-]{1,20}/g) ?? []).filter(
    (w) => !STOP.has(w) && !/^(i|ii|iii|iv|senior|sr|junior|jr|staff|principal|lead|associate)$/.test(w)
  )
  return toks.slice(0, 3).sort().join(' ') || null
}

/** Pick the best-matching family, by token overlap with the requested title. */
function resolveFamily(title: string, stats: TermStats): string | null {
  const key = familyKeyOf(title)
  if (!key) return null
  if (stats.families[key]) return key

  const want = new Set(key.split(' '))
  let best: string | null = null
  let bestScore = 0
  for (const fam of Object.keys(stats.families)) {
    const toks = fam.split(' ')
    const overlap = toks.filter((t) => want.has(t)).length
    if (!overlap) continue
    // Favour overlap, then the larger sample -- a family measured on 200
    // postings is a better estimator than one measured on 41.
    const score = overlap * 1000 + Math.min(stats.families[fam].n, 999)
    if (score > bestScore) { bestScore = score; best = fam }
  }
  return bestScore >= 1000 ? best : null
}

/**
 * Words that MARK a requirement rather than BEING one.
 *
 * "Must have proven experience with Kubernetes in production" states one
 * requirement -- Kubernetes. Without this list the extractor also emits
 * `proven`, `proficiency`, `track record` and `production` as though the
 * employer were asking for skills by those names, which then generates
 * questions like "Do you have experience with proven?" and dilutes coverage
 * with terms no resume can ever match.
 *
 * This is the same category as the STOP list: a statement about how English
 * marks obligation and degree, not about which skills matter. Grammar can be
 * enumerated; importance cannot.
 */
const REQUIREMENT_LANGUAGE = new Set(`must proven demonstrated proficiency proficient expertise expert
track record background solid hands-on hands on deep extensive significant excellent outstanding
production practical working thorough comprehensive robust successful relevant prior previous
familiarity familiar exposure understanding knowledge competence competency capability capabilities
ability skills skill experience experiences qualified qualification qualifications essential
mandatory desirable advantageous ideally bonus nice preferred plus minimum least equivalent
similar related various multiple several strong good great`.split(/\s+/))

function isRequirementLanguage(term: string): boolean {
  // A multi-word term is noise only if EVERY token is marker language --
  // "production kubernetes" must survive, "proven track" must not.
  return term.split(' ').every((t) => REQUIREMENT_LANGUAGE.has(t))
}

function extractTerms(line: string): string[] {
  const words = (line.toLowerCase().match(TOKEN) ?? []).map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
  const out = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w)
    if (i + 1 < words.length) {
      const n = words[i + 1]
      if (n && n.length >= 2 && !STOP.has(n) && !/^\d+$/.test(n)) out.add(`${w} ${n}`)
    }
  }
  return [...out]
}

export interface ExtractOptions {
  /** Corpus statistics. Omit and every requirement is emitted `unscored`. */
  stats?: TermStats | null
  /** Target job title, used to pick the role family. */
  title?: string
  /** Cap on returned requirements. Not a quality threshold -- just a page size. */
  limit?: number
}

/**
 * Extract requirements with an importance estimate and its basis.
 *
 * Returns them ranked by importance, but every entry carries `importanceBasis`
 * so a caller can display, audit or override the ranking.
 */
export function extractRequirements(
  jobText: string,
  opts: ExtractOptions = {}
): Requirement[] {
  const { stats = null, title = '', limit = 40 } = opts
  if (!jobText?.trim()) return []

  const family = stats && title ? resolveFamily(title, stats) : null
  const famTerms = family ? stats!.families[family].terms : null
  const famN = family ? stats!.families[family].n : 0

  const corpusProvenance = (): Provenance => ({
    kind: 'corpus',
    sampleSize: famN,
    generatedAt: stats?.generatedAt ?? 'unknown',
  })

  const lines = requirementLines(jobText)
  // term -> best candidate seen so far
  const byTerm = new Map<string, Requirement & { _hits: number }>()

  for (const { line, index, optionalSection } of lines) {
    const mandatoryMarker = MANDATORY_MARKERS.some((re) => re.test(line))
    const optionalMarker = OPTIONAL_MARKERS.some((re) => re.test(line)) || optionalSection
    const mandatory = mandatoryMarker ? true : optionalMarker ? false : null

    for (const term of extractTerms(line)) {
      const existing = byTerm.get(term)
      if (existing) {
        existing._hits++
        // Repetition across lines is itself an importance signal, and an
        // explicit "must have" anywhere outranks an earlier unmarked mention.
        if (mandatory === true) existing.mandatory = true
        continue
      }

      // --- importance, in priority order -------------------------------------
      let importance = 0
      let basis: Requirement['importanceBasis']

      const fam = famTerms?.[term]
      if (mandatory === true) {
        // The employer said so. Nothing beats that for THIS role.
        importance = 0.9
        basis = {
          basis: 'explicit-language',
          provenance: { kind: 'job-posting', location: `line ${index + 1}` },
          detail: 'The posting marks this as required',
        }
      } else if (fam) {
        // Lift is unbounded; squash it so a 200x term does not swamp everything.
        // The shape is a choice; the VALUE is measured, which is the point.
        const lifted = Math.min(1, Math.log10(1 + fam.lift) / 2)
        importance = Number((0.3 + 0.6 * lifted * fam.rate + 0.1 * fam.rate).toFixed(3))
        basis = {
          basis: 'corpus-lift',
          provenance: corpusProvenance(),
          detail:
            `Appears in ${Math.round(fam.rate * 100)}% of ${famN} postings for this ` +
            `role family, ${fam.lift}x more often than across all postings`,
        }
      } else if (mandatory === false) {
        importance = 0.25
        basis = {
          basis: 'explicit-language',
          provenance: { kind: 'job-posting', location: `line ${index + 1}` },
          detail: 'The posting marks this as preferred rather than required',
        }
      } else {
        // Honest zero. We have no basis, so we claim none -- rather than
        // inventing a default that would silently become a ranking.
        importance = 0
        basis = {
          basis: 'unscored',
          provenance: { kind: 'job-posting', location: `line ${index + 1}` },
          detail: 'No explicit requirement language and no corpus statistics for this term',
        }
      }

      byTerm.set(term, {
        term,
        normalized: term,
        importance,
        importanceBasis: basis,
        mandatory,
        sourceQuote: line.slice(0, 240),
        _hits: 1,
      })
    }
  }

  // Repetition bump, applied last so it composes with the basis above and is
  // recorded rather than silently folded in.
  for (const r of byTerm.values()) {
    if (r._hits > 1 && r.importanceBasis.basis !== 'explicit-language') {
      const bumped = Math.min(1, r.importance + 0.05 * (r._hits - 1))
      if (bumped > r.importance) {
        r.importance = Number(bumped.toFixed(3))
        r.importanceBasis = {
          ...r.importanceBasis,
          basis: 'repetition',
          detail: `${r.importanceBasis.detail}; repeated in ${r._hits} requirement lines`,
        }
      }
    }
  }

  return [...byTerm.values()]
    .filter((r) => !isRequirementLanguage(r.normalized))
    .filter((r) => r.importance > 0 || r.mandatory !== null)
    .sort((a, b) => b.importance - a.importance || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map(({ _hits, ...r }) => r)
}
