/**
 * Structured resume parsing.
 *
 * WHY THIS REPLACES THE REGEX IN /api/parse-resume
 * ------------------------------------------------
 * That extractor asks five questions of the whole document at once -- one
 * regex for the name, one for skills, one for experience -- and every one of
 * them is a guess about layout. `(skills|technical skills)\s*\n([\s\S]+?)` takes
 * everything from the word "skills" to the next blank line, which on a
 * two-column PDF extraction is whatever text happened to land there. It cannot
 * tell a section heading from a job title, so it cannot report where anything
 * came from, and a caller has no way to check it.
 *
 * This parser does the one thing that makes the rest possible: it finds the
 * section boundaries first, then reads inside each section with rules that
 * only have to be right for that section. Every field it returns carries the
 * line range it came from, so the UI can show the user the source text and the
 * LaTeX builder can quote rather than paraphrase.
 *
 * It is deliberately model-free. A resume is the user's own factual record;
 * inferring its contents with a language model introduces exactly the failure
 * this product cannot afford -- a plausible sentence the user never wrote.
 */

/* ------------------------------- shapes ---------------------------------- */

export interface Span {
  /** 0-based, inclusive. Indexes into the line array the parse ran on. */
  startLine: number
  endLine: number
}

export type SectionKind =
  | 'contact'
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'publications'
  | 'awards'
  | 'other'

export interface Section {
  kind: SectionKind
  /** The heading exactly as written, or null for the implicit opening block. */
  heading: string | null
  span: Span
  lines: string[]
}

export interface DateRange {
  /** Verbatim, as printed on the resume. */
  raw: string
  startYear: number | null
  endYear: number | null
  current: boolean
  /** Whole months, null when either endpoint is unknown. */
  months: number | null
}

export interface ExperienceEntry {
  /** Best guess at the role title. Null when the line could not be split. */
  title: string | null
  organization: string | null
  dates: DateRange | null
  location: string | null
  bullets: string[]
  span: Span
  /** The unmodified header line, so a caller can show what was interpreted. */
  headerLine: string
}

export interface EducationEntry {
  institution: string | null
  credential: string | null
  dates: DateRange | null
  span: Span
  headerLine: string
}

export interface Contact {
  name: string | null
  email: string | null
  phone: string | null
  location: string | null
  links: { kind: 'linkedin' | 'github' | 'website' | 'other'; url: string }[]
}

export interface ParsedResume {
  contact: Contact
  sections: Section[]
  experience: ExperienceEntry[]
  education: EducationEntry[]
  /** Individual skill terms, split from skill-section lines. */
  skills: string[]
  /** Every bullet in the document, with its section, for evidence lookup. */
  bullets: { text: string; section: SectionKind; line: number }[]
  totalExperienceMonths: number | null
  lines: string[]
  /** Things the parse could not determine. Stated, never guessed around. */
  warnings: string[]
}

/* ------------------------------ headings --------------------------------- */

/**
 * Section heading vocabulary.
 *
 * Matching is on the WHOLE line, not a substring: "Experience" is a heading,
 * "5 years of experience building payment systems" is a sentence that contains
 * the word. The old extractor could not tell those apart.
 */
const HEADINGS: { kind: SectionKind; patterns: RegExp[] }[] = [
  { kind: 'summary', patterns: [/^(professional\s+)?summary$/i, /^profile$/i, /^objective$/i, /^about(\s+me)?$/i] },
  {
    kind: 'experience',
    patterns: [
      /^(work|professional|relevant|industry)?\s*experience$/i,
      /^employment(\s+history)?$/i,
      /^work\s+history$/i,
      /^career\s+history$/i,
    ],
  },
  {
    kind: 'education',
    patterns: [/^education(\s+(and|&)\s+training)?$/i, /^academic\s+background$/i, /^qualifications$/i],
  },
  {
    kind: 'skills',
    patterns: [
      /^(technical\s+|core\s+|key\s+)?skills$/i,
      /^(technical\s+)?competencies$/i,
      /^proficiencies$/i,
      /^technologies$/i,
      /^technical\s+summary$/i,
      /^tech\s+stack$/i,
    ],
  },
  { kind: 'projects', patterns: [/^(personal\s+|side\s+|selected\s+)?projects$/i, /^portfolio$/i] },
  { kind: 'certifications', patterns: [/^certifications?$/i, /^licenses?(\s+(and|&)\s+certifications?)?$/i] },
  { kind: 'publications', patterns: [/^publications?$/i, /^papers$/i, /^research$/i] },
  { kind: 'awards', patterns: [/^awards?(\s+(and|&)\s+honou?rs)?$/i, /^honou?rs$/i, /^achievements$/i] },
]

/** Strip decoration people put around headings: "— EXPERIENCE —", "## Skills". */
function headingCore(line: string): string {
  return line
    .replace(/^[\s#*_=~>-]+/, '')
    .replace(/[\s#*_=~:-]+$/, '')
    .trim()
}

function classifyHeading(line: string): SectionKind | null {
  const core = headingCore(line)
  if (!core || core.length > 44) return null
  // A heading does not end in a sentence terminator and is not a bullet.
  if (/[.!?,;]$/.test(core)) return null
  for (const { kind, patterns } of HEADINGS) {
    if (patterns.some((p) => p.test(core))) return kind
  }
  return null
}

/* -------------------------------- dates ---------------------------------- */

const MONTHS =
  '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*'
const YEAR = '(19|20)\\d{2}'
const CURRENT = '(present|current|now|ongoing|to\\s+date)'

const DATE_RANGE = new RegExp(
  `((?:${MONTHS}\\.?\\s*,?\\s*)?${YEAR})\\s*(?:-|–|—|to|until|through)\\s*((?:${MONTHS}\\.?\\s*,?\\s*)?${YEAR}|${CURRENT})`,
  'i',
)

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

function parseEndpoint(s: string): { year: number; month: number | null } | null {
  const y = s.match(/(19|20)\d{2}/)
  if (!y) return null
  const m = s.toLowerCase().match(new RegExp(MONTHS))
  return {
    year: Number(y[0]),
    month: m ? MONTH_INDEX[m[0].slice(0, 3)] ?? null : null,
  }
}

export function parseDateRange(line: string): DateRange | null {
  const m = line.match(DATE_RANGE)
  if (!m) return null

  const raw = m[0].trim()
  const start = parseEndpoint(m[1])
  const endText = m[4] ?? ''
  const current = new RegExp(CURRENT, 'i').test(endText)
  const end = current ? null : parseEndpoint(endText)

  let months: number | null = null
  if (start) {
    const now = new Date()
    const endYear = current ? now.getFullYear() : end?.year ?? null
    const endMonth = current ? now.getMonth() : end?.month ?? null
    if (endYear !== null) {
      // Month precision only when BOTH endpoints have it; otherwise year-only
      // arithmetic, which is honest about what the document actually said.
      const sm = start.month ?? 0
      const em = endMonth ?? 11
      months = Math.max(0, (endYear - start.year) * 12 + (em - sm) + 1)
    }
  }

  return {
    raw,
    startYear: start?.year ?? null,
    endYear: current ? null : end?.year ?? null,
    current,
    months,
  }
}

/* ------------------------------- contact --------------------------------- */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
// International-tolerant: optional +CC, then 7-14 digits with common separators.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,4}/

function looksLikeName(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 60) return false
  if (EMAIL.test(t) || /\d/.test(t)) return false
  if (/[@|•·]/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length < 2 || words.length > 5) return false
  // Accept "Ashutosh Kumar Singh" and "ASHUTOSH KUMAR SINGH", reject sentences.
  return words.every((w) => /^[A-Z][a-zA-Z'’.-]*$/.test(w) || /^[A-Z.'’-]+$/.test(w))
}

function extractContact(lines: string[], warnings: string[]): Contact {
  // The contact block is at the top in every resume convention. Searching the
  // whole document finds a referee's email or a project URL instead.
  const head = lines.slice(0, 15)
  const joined = head.join('\n')

  const email = joined.match(EMAIL)?.[0] ?? null

  // Only accept a phone from a line that is plausibly contact info -- a bare
  // digit run matches dates, ZIP codes and bullet metrics otherwise.
  let phone: string | null = null
  for (const l of head) {
    if (/\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present)/i.test(l)) continue
    const m = l.match(PHONE)
    if (m) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length >= 7 && digits.length <= 15) { phone = m[0].trim(); break }
    }
  }

  let name: string | null = null
  for (const l of head) {
    if (looksLikeName(l)) { name = l.trim(); break }
  }
  if (!name) warnings.push('No name line could be identified in the first 15 lines.')

  const links: Contact['links'] = []
  // Strip email addresses BEFORE scanning for URLs. The domain half of
  // "jane@example.com" matches any sane URL pattern, so without this every
  // resume gains a phantom website link pointing at its own mail provider.
  const withoutEmails = joined.replace(new RegExp(EMAIL.source, 'gi'), ' ')
  const urlRe = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z.]{2,}(?:\/[^\s,;)]*)?)/gi
  for (const m of withoutEmails.matchAll(urlRe)) {
    const url = m[0]
    if (EMAIL.test(url)) continue
    const low = url.toLowerCase()
    const kind = low.includes('linkedin.') ? 'linkedin'
      : low.includes('github.') ? 'github'
      : /\.(com|dev|io|me|net|org|ai)\b/.test(low) ? 'website' : 'other'
    if (!links.some((x) => x.url === url)) links.push({ kind, url })
  }

  // A location line: "City, ST" or "City, Country", no digits, near the top.
  let location: string | null = null
  for (const l of head) {
    const t = l.trim()
    if (/^[A-Z][a-zA-Z .'’-]+,\s*[A-Z][a-zA-Z .'’-]{1,}$/.test(t) && t.length < 48 && !/\d/.test(t)) {
      location = t
      break
    }
  }

  return { name, email, phone, location, links }
}

/* ------------------------------- bullets --------------------------------- */

const BULLET = /^[\s]*[-•*·‣▪◦▸>]\s+|^\s*\d+[.)]\s+/

export function isBullet(line: string): boolean {
  return BULLET.test(line)
}

function stripBullet(line: string): string {
  return line.replace(BULLET, '').trim()
}

/* ------------------------------ experience -------------------------------- */

const LOCATION_TAIL = /\b([A-Z][a-zA-Z .'’-]+,\s*(?:[A-Z]{2}|[A-Z][a-zA-Z .'’-]+))\s*$/

/**
 * Split an entry header into title / organization.
 *
 * Resumes use a handful of conventions and no standard. We handle explicit
 * separators, and otherwise return the whole line as the title rather than
 * splitting on a guess -- a wrong split is worse than an unsplit line, because
 * it silently attributes a role to the wrong employer.
 */
function splitHeader(line: string): { title: string | null; organization: string | null } {
  let s = line.trim()
  s = s.replace(DATE_RANGE, '').replace(/[|,·•\-–—]\s*$/, '').trim()
  const loc = s.match(LOCATION_TAIL)
  if (loc) s = s.slice(0, loc.index).trim().replace(/[|,·•\-–—]\s*$/, '').trim()

  for (const sep of [' | ', ' — ', ' – ', ' @ ', ' at ', ' - ', ', ']) {
    const i = s.indexOf(sep)
    if (i > 0 && i < s.length - sep.length) {
      return { title: s.slice(0, i).trim() || null, organization: s.slice(i + sep.length).trim() || null }
    }
  }
  return { title: s || null, organization: null }
}

function parseExperience(section: Section, warnings: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = []
  const { lines, span } = section
  let cur: ExperienceEntry | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const abs = span.startLine + i
    if (!line.trim()) continue

    if (isBullet(line)) {
      if (cur) {
        cur.bullets.push(stripBullet(line))
        cur.span.endLine = abs
      }
      // A bullet before any header belongs to no entry. Recorded as a warning
      // rather than silently attached to whatever comes next.
      else warnings.push(`Bullet at line ${abs + 1} appears before any job header.`)
      continue
    }

    // A non-bullet line inside experience starts a new entry, UNLESS it is a
    // continuation carrying only dates/location for the entry just opened.
    const dates = parseDateRange(line)
    const bare = line.replace(DATE_RANGE, '').replace(LOCATION_TAIL, '').trim()
    if (cur && !cur.dates && dates && bare.length <= 3) {
      cur.dates = dates
      cur.span.endLine = abs
      continue
    }

    const { title, organization } = splitHeader(line)
    cur = {
      title,
      organization,
      dates,
      location: line.match(LOCATION_TAIL)?.[1] ?? null,
      bullets: [],
      span: { startLine: abs, endLine: abs },
      headerLine: line.trim(),
    }
    entries.push(cur)
  }

  return entries
}

function parseEducation(section: Section): EducationEntry[] {
  const out: EducationEntry[] = []
  const { lines, span } = section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || isBullet(line)) continue
    const abs = span.startLine + i
    const dates = parseDateRange(line)
    const { title, organization } = splitHeader(line)
    // On an education line the institution is usually the longer, proper-noun
    // half; credential wording ("BSc", "Bachelor") is distinctive enough to test.
    const credentialRe = /\b(b\.?s\.?c?|b\.?a|b\.?tech|b\.?e|m\.?s\.?c?|m\.?a|m\.?tech|mba|ph\.?d|bachelor|master|doctor|diploma|associate)\b/i
    const titleIsCredential = title ? credentialRe.test(title) : false
    out.push({
      institution: titleIsCredential ? organization : title,
      credential: titleIsCredential ? title : organization,
      dates,
      span: { startLine: abs, endLine: abs },
      headerLine: line.trim(),
    })
  }
  return out
}

/* -------------------------------- skills ---------------------------------- */

/**
 * Split skill lines into terms.
 *
 * Handles "Languages: Go, Rust, TypeScript" by dropping the category label,
 * and splits on the separators resumes actually use. Multi-word skills
 * ("machine learning") survive because we never split on spaces.
 */
export function splitSkillLine(line: string): string[] {
  let s = stripBullet(line)
  const colon = s.indexOf(':')
  if (colon > 0 && colon < 40) s = s.slice(colon + 1)
  return s
    .split(/[,;|•·/]|\s{2,}|\s+[-–—]\s+/)
    .map((t) => t.trim().replace(/\.$/, ''))
    .filter((t) => t.length > 1 && t.length <= 40)
}

/* ------------------------------ the parser -------------------------------- */

export function parseResume(text: string): ParsedResume {
  const warnings: string[] = []
  // Normalise line endings and the non-breaking spaces PDF extraction emits.
  const lines = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n')

  const contact = extractContact(lines, warnings)

  /* --- section boundaries, before anything else --- */
  const marks: { kind: SectionKind; heading: string; line: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isBullet(lines[i])) continue
    const kind = classifyHeading(lines[i])
    if (kind) marks.push({ kind, heading: headingCore(lines[i]), line: i })
  }

  const sections: Section[] = []
  // Everything above the first heading is the contact block.
  const firstHeading = marks.length ? marks[0].line : lines.length
  if (firstHeading > 0) {
    sections.push({
      kind: 'contact', heading: null,
      span: { startLine: 0, endLine: firstHeading - 1 },
      lines: lines.slice(0, firstHeading),
    })
  }
  for (let m = 0; m < marks.length; m++) {
    const start = marks[m].line + 1
    const end = m + 1 < marks.length ? marks[m + 1].line - 1 : lines.length - 1
    sections.push({
      kind: marks[m].kind,
      heading: marks[m].heading,
      span: { startLine: start, endLine: end },
      lines: lines.slice(start, end + 1),
    })
  }

  if (!marks.length) {
    warnings.push(
      'No section headings were recognised, so experience, education and skills ' +
      'could not be separated. The text may be from a multi-column PDF, where ' +
      'extraction interleaves columns and destroys the layout.',
    )
  }

  /* --- read inside each section --- */
  const experience: ExperienceEntry[] = []
  const education: EducationEntry[] = []
  const skills: string[] = []
  const bullets: ParsedResume['bullets'] = []

  for (const sec of sections) {
    if (sec.kind === 'experience' || sec.kind === 'projects') {
      experience.push(...parseExperience(sec, warnings))
    } else if (sec.kind === 'education') {
      education.push(...parseEducation(sec))
    } else if (sec.kind === 'skills') {
      for (const l of sec.lines) {
        if (l.trim()) skills.push(...splitSkillLine(l))
      }
    }
    for (let i = 0; i < sec.lines.length; i++) {
      const l = sec.lines[i]
      if (isBullet(l)) {
        bullets.push({ text: stripBullet(l), section: sec.kind, line: sec.span.startLine + i })
      }
    }
  }

  /* --- total experience, by union of ranges rather than sum --- */
  // Summing overlapping roles double-counts concurrent work. Merging the
  // intervals is the only way to get a number that is not inflated.
  let totalExperienceMonths: number | null = null
  const ranges = experience
    .map((e) => e.dates)
    .filter((d): d is DateRange => !!d && d.startYear !== null)
    .map((d) => {
      const now = new Date()
      const s = d.startYear! * 12
      const e = d.current ? now.getFullYear() * 12 + now.getMonth() : (d.endYear ?? d.startYear!) * 12 + 11
      return [s, e] as [number, number]
    })
    .sort((a, b) => a[0] - b[0])

  if (ranges.length) {
    let total = 0
    let [cs, ce] = ranges[0]
    for (let i = 1; i < ranges.length; i++) {
      const [s, e] = ranges[i]
      if (s <= ce + 1) ce = Math.max(ce, e)
      else { total += ce - cs + 1; cs = s; ce = e }
    }
    total += ce - cs + 1
    totalExperienceMonths = total
  } else if (experience.length) {
    warnings.push('No parseable date ranges were found, so total experience is unknown.')
  }

  const deduped = [...new Set(skills.map((s) => s.trim()).filter(Boolean))]

  return {
    contact,
    sections,
    experience,
    education,
    skills: deduped,
    bullets,
    totalExperienceMonths,
    lines,
    warnings,
  }
}
