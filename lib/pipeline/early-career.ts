/**
 * Early-career classification.
 *
 * WHY THIS IS NOT A KEYWORD SEARCH
 * --------------------------------
 * Searching the index for "apprentice" returns 45 rows out of 113,416, and
 * that number is wrong in both directions.
 *
 * It is too low because the corpus is global and the words are not English:
 * a German apprenticeship is an `Ausbildung`, a French one an `alternance`, a
 * Dutch internship a `stage`. It also misses the categories employers actually
 * use as headings -- "Emerging Talent", "Future Talent", "Campus", "School
 * Leaver" -- none of which contain the word apprentice or intern.
 *
 * It is also too high, because substring matching is a trap:
 *
 *   "Internal Communications Manager"   contains "intern"
 *   "International Tax Associate"       contains "intern"
 *   "Early Careers Recruiter"           is a job recruiting for the programme,
 *                                       not a place on it
 *   "Apprenticeship Programme Manager"  runs the scheme; it is a senior role
 *   "Graduate Research Assistant"       may be staff, not a graduate scheme
 *
 * So this matches whole words against a curated multilingual vocabulary, and
 * then applies exclusions that veto a match when the title shows the person is
 * running the programme rather than joining it.
 *
 * Deterministic by design: every classification carries the term that fired and
 * where it was found, so a human can check it. No model is involved, because a
 * model cannot show its evidence and this drives a facet people filter on.
 */

export type EarlyCareerCategory =
  | 'apprenticeship'
  | 'graduate'
  | 'internship'
  | 'placement'
  | 'trainee'
  | 'entry-level'
  | 'junior'

export interface EarlyCareerMatch {
  category: EarlyCareerCategory
  /** The term that fired, as written in the vocabulary. */
  term: string
  /** Where it matched. A title hit is far stronger than a description hit. */
  field: 'title' | 'description'
  /** ISO 639-1 of the vocabulary entry, for reporting coverage by language. */
  lang: string
  /** UK apprenticeship level (2-7) when the posting states one. */
  level: number | null
  confidence: 'high' | 'medium' | 'low'
}

/* ------------------------------ vocabulary -------------------------------- */

/**
 * Terms are regex SOURCE fragments, matched at word boundaries.
 *
 * Ordered by specificity within each category: "degree apprenticeship" must be
 * tried before "apprenticeship" so the more informative term is reported.
 */
type Entry = [category: EarlyCareerCategory, lang: string, terms: string[]]

const VOCAB: Entry[] = [
  // ---------------------------------------------------------- apprenticeship
  ['apprenticeship', 'en', [
    'degree apprenticeship', 'higher apprenticeship', 'advanced apprenticeship',
    'intermediate apprenticeship', 'graduate apprenticeship', 'technical apprenticeship',
    'apprenticeship programme', 'apprenticeship program', 'apprenticeship scheme',
    'apprenticeship', 'apprentice',
  ]],
  ['apprenticeship', 'de', ['ausbildung', 'auszubildende[rn]?', 'azubi', 'lehrling', 'lehrstelle', 'duales studium']],
  ['apprenticeship', 'fr', ['alternance', 'apprenti[e]?', 'apprentissage', 'contrat de professionnalisation']],
  ['apprenticeship', 'es', ['aprendiz', 'formaci[oó]n dual', 'contrato de formaci[oó]n']],
  ['apprenticeship', 'it', ['apprendistato', 'apprendista']],
  ['apprenticeship', 'nl', ['leerwerkplek', 'bbl[- ]traject', 'leerling']],
  ['apprenticeship', 'pt', ['aprendiz', 'aprendizagem']],
  ['apprenticeship', 'pl', ['praktyki zawodowe', 'przyuczenie']],

  // ---------------------------------------------------------------- graduate
  ['graduate', 'en', [
    'graduate scheme', 'graduate programme', 'graduate program', 'graduate trainee',
    'graduate development', 'graduate analyst', 'graduate engineer', 'graduate consultant',
    'new grad', 'new graduate', 'recent graduate', 'university graduate',
    'campus hire', 'campus recruiting', 'campus program',
    'emerging talent', 'future talent', 'early careers', 'early career',
    'school leaver', 'college leaver', 'university leaver',
  ]],
  ['graduate', 'de', ['absolvent[en]?', 'berufseinsteiger', 'trainee[- ]programm', 'hochschulabsolvent']],
  ['graduate', 'fr', ['jeune dipl[oô]m[ée]', 'programme jeunes dipl[oô]m[ée]s']],
  ['graduate', 'es', ['reci[eé]n titulado', 'reci[eé]n graduado', 'programa de graduados']],
  ['graduate', 'nl', ['starters?functie', 'traineeship']],
  ['graduate', 'ja', ['新卒']],
  ['graduate', 'ko', ['신입']],

  // -------------------------------------------------------------- internship
  ['internship', 'en', [
    'summer internship', 'winter internship', 'spring internship', 'fall internship',
    'research internship', 'software internship', 'technical internship',
    'internship', 'intern',
  ]],
  ['internship', 'de', ['praktikum', 'praktikant[in]?', 'werkstudent[in]?']],
  ['internship', 'fr', ['stage', 'stagiaire']],
  ['internship', 'es', ['pr[aá]cticas', 'becario', 'pasant[ií]a']],
  ['internship', 'it', ['tirocinio', 'stagista']],
  ['internship', 'nl', ['stage', 'stagiair[e]?']],
  ['internship', 'pt', ['est[aá]gio', 'estagi[aá]rio']],
  ['internship', 'pl', ['sta[zż]', 'praktykant']],
  ['internship', 'ja', ['インターン']],

  // --------------------------------------------------------------- placement
  ['placement', 'en', [
    'placement year', 'industrial placement', 'year in industry', 'sandwich placement',
    'student placement', 'work placement', 'industrial year', 'placement student',
    // "12 Month Placement", "2-year placement". Real UK/EU postings state the
    // duration rather than the word "industrial", and a bare "placement" is
    // unusable -- the index contains "Sensor Placement Engineer", "Data
    // Placement", "Replacement Parts" and "Parental Leave Replacement".
    '\\d{1,2}[- ]?(?:month|year)s?[- ]placement',
    'placement[- ]\\(?\\d{1,2}[-– ]',
  ]],

  // ----------------------------------------------------------------- trainee
  ['trainee', 'en', [
    'management trainee', 'trainee programme', 'trainee program',
    'trainee engineer', 'trainee accountant', 'trainee developer', 'trainee consultant',
    'trainee',
  ]],
  ['trainee', 'de', ['trainee']],
  ['trainee', 'es', ['aprendiz de gesti[oó]n']],

  // ------------------------------------------------------------- entry-level
  ['entry-level', 'en', [
    'entry[- ]level', 'career starter', 'no experience required',
    'graduates welcome', 'students welcome', 'level 1 engineer',
  ]],
  ['entry-level', 'de', ['einstiegsposition', 'berufseinstieg']],

  // ---------------------------------------------------------------- junior
  ['junior', 'en', ['junior']],
  ['junior', 'de', ['junior']],
  ['junior', 'es', ['junior']],
]

/**
 * Titles that CONTAIN an early-career term but describe running the programme,
 * hiring for it, or a senior role that merely mentions it.
 *
 * This is the difference between "Software Apprentice" and "Apprenticeship
 * Programme Manager", and between "Graduate Engineer" and "Early Careers
 * Recruiter". Without it, every scheme's own staff is classified as a
 * candidate for the scheme.
 */
const RUNS_THE_PROGRAMME = new RegExp(
  '\\b(' +
    // "management" is deliberately NOT here. "Management Trainee" is a standard
    // early-career title -- the trainee is being trained INTO management, not
    // running the scheme. "manager" still catches "Apprenticeship Programme
    // Manager", which is the case this list exists for.
    'manager|lead|leader|head|director|partner|principal|chief|vp|vice president|' +
    'recruiter|recruitment|talent acquisition|coordinator|administrator|advisor|adviser|' +
    'mentor|coach|trainer|instructor|tutor|assessor|supervisor|officer|specialist|' +
    'consultant to|owner|architect|strategist' +
  ')\\b',
  'i',
)

/**
 * Words that make "intern" a false positive. Checked as a prefix test, because
 * "internal" and "international" both begin with "intern" and neither is one.
 */
const INTERN_FALSE_FRIENDS = /\b(internal|international|internation|interns(hip)?[- ]?(manager|program manager|coordinator))\b/i

/** Seniority words that contradict an early-career reading outright. */
const SENIOR_CONTRADICTION = /\b(senior|sr\.?|staff|principal|distinguished|fellow|expert|lead)\b/i

/* ------------------------------- matching --------------------------------- */

/** Word-boundary match that tolerates the punctuation job titles use. */
function wordRe(term: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${term})([^a-z0-9]|$)`, 'i')
}

/** UK apprenticeship levels are stated explicitly and are worth keeping. */
function extractLevel(text: string): number | null {
  const m = text.match(/\blevel\s*([2-7])\b/i)
  return m ? Number(m[1]) : null
}

/**
 * Classify one posting.
 *
 * Returns null when nothing matched -- which is the correct answer for most
 * postings, and far better than assigning a weak category to everything.
 */
export function classifyEarlyCareer(
  title: string,
  description = '',
): EarlyCareerMatch | null {
  const t = (title || '').trim()
  if (!t) return null

  // A title that names a senior role is not early-career, whatever else it
  // says. "Senior Manager, Graduate Programmes" must not classify.
  const titleIsSenior = SENIOR_CONTRADICTION.test(t) && !/\bjunior\b/i.test(t)
  const titleRunsProgramme = RUNS_THE_PROGRAMME.test(t)

  // Pass 1: the title. This is the strong signal.
  for (const [category, lang, terms] of VOCAB) {
    for (const term of terms) {
      if (!wordRe(term).test(t)) continue
      if (category === 'internship' && INTERN_FALSE_FRIENDS.test(t)) continue
      if (titleRunsProgramme || titleIsSenior) continue

      return {
        category,
        term,
        field: 'title',
        lang,
        level: extractLevel(`${t} ${description.slice(0, 400)}`),
        // A multi-word term in the title is about as certain as this gets.
        confidence: term.includes(' ') ? 'high' : 'medium',
      }
    }
  }

  // Pass 2: the description, and only for terms specific enough to survive
  // there. A description mentioning "junior" or "intern" proves nothing -- a
  // senior posting says "you will mentor our interns" all the time.
  const d = (description || '').slice(0, 2500)
  if (!d) return null
  if (titleIsSenior || titleRunsProgramme) return null

  for (const [category, lang, terms] of VOCAB) {
    for (const term of terms) {
      // Single words are too weak in free text.
      if (!term.includes(' ') && !/[äöüßéèêáóçźżł　-鿿]/i.test(term)) continue
      if (!wordRe(term).test(d)) continue
      if (category === 'internship' && INTERN_FALSE_FRIENDS.test(d)) continue

      return {
        category,
        term,
        field: 'description',
        lang,
        level: extractLevel(d),
        confidence: 'low',
      }
    }
  }

  return null
}

/** Every category, for building a complete report with explicit zeros. */
export const EARLY_CAREER_CATEGORIES: EarlyCareerCategory[] = [
  'apprenticeship', 'graduate', 'internship', 'placement', 'trainee', 'entry-level', 'junior',
]

/** Languages the vocabulary covers, for reporting blind spots honestly. */
export const VOCAB_LANGUAGES = [...new Set(VOCAB.map(([, lang]) => lang))].sort()
