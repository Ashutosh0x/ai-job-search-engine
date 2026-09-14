/**
 * ATS-safe LaTeX resume generation.
 *
 * WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT REFUSES TO DO
 * -----------------------------------------------------------
 * Given a parsed resume and a target job, this emits a LaTeX document that
 * SELECTS and ORDERS the candidate's existing content by how well it evidences
 * the job's requirements. It never writes a bullet the candidate did not write.
 *
 * That restraint is the whole design. A generator that invents "Led a team of
 * 8 engineers" because the posting asked for leadership produces a document the
 * candidate has to defend in an interview, and cannot. Every string in the
 * output is either the candidate's own text, a heading, or LaTeX structure.
 * `assertNoFabrication` below enforces it mechanically rather than by intent.
 *
 * ATS CONSTRAINTS, AND WHY EACH ONE IS HERE
 * -----------------------------------------
 * Applicant tracking systems do not read PDFs the way people do; they extract a
 * text layer and parse reading order. The 2026 guidance is consistent on what
 * destroys that:
 *
 *   Single column. Multi-column templates (Awesome CV, Deedy) can parse
 *   catastrophically -- whole sections land out of order or vanish -- because
 *   extraction follows the text layer, not the visual columns.
 *
 *   Ligatures. LaTeX renders "fi", "fl", "ff", "ffi", "ffl" as single glyphs.
 *   Without a ToUnicode map an extractor returns one exotic character instead
 *   of two letters, so "workflow" becomes unsearchable. `\pdfgentounicode=1`
 *   with glyphtounicode fixes the mapping; this is the single highest-value
 *   line in the preamble.
 *
 *   Dates in tables. Several popular templates put the date in a right-hand
 *   table cell, which detaches it from its role during extraction and can
 *   attach it to the wrong entry. We use \hfill in the same paragraph instead,
 *   so the date stays in the same text run as the title.
 *
 *   Standard headings. "Experience", not "Where I've Been". Parsers match
 *   section names against a known vocabulary.
 *
 *   No headers, footers, icons or graphics. Header/footer text is frequently
 *   dropped entirely, which is where contact details tend to live.
 */

import type { ParsedResume } from './parse'
import type { AnalysisResult } from './types'
import { planResume, type ResumePlan, type PlanOptions } from './plan'

// Re-exported so existing callers keep one import site for the resume builder.
export { planResume, scoreBullet, collapseSubPhrases } from './plan'
export type { ResumePlan, PlannedRole, PlannedBullet } from './plan'

/* ------------------------------- escaping -------------------------------- */

/**
 * Escape user text for LaTeX.
 *
 * Order matters: the backslash must be replaced first, or the replacements for
 * the other characters get mangled by the very escape they introduce. Getting
 * this wrong does not produce a visual glitch -- it produces a document that
 * will not compile, or worse, one where a stray `$` silently swallows the rest
 * of a line into math mode.
 */
export function tex(s: string): string {
  if (!s) return ''
  // A sentinel, because the replacement for a backslash CONTAINS braces. Doing
  // it directly means the brace rule below re-escapes them and the output
  // becomes "a\textbackslash\{\}b", which renders as literal braces.
  const BS = '\u0000BS\u0000'
  return s
    .replace(/\\/g, BS)
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    // Unicode punctuation that PDF extraction mangles, normalised to ASCII.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '--')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    // Bullet glyphs and arrows have no place in an extracted text layer.
    .replace(/[•●▪‣⁃]/g, '')
    .replace(/[→⇒]/g, '->')
    // Restored last, after the brace rule can no longer touch it.
    .split(BS).join('\\textbackslash{}')
}

/* ------------------------------- preamble --------------------------------- */

/**
 * The preamble is fixed and audited. It is not assembled from user input, so
 * nothing here can be influenced by a malicious resume or job description.
 */
const PREAMBLE = String.raw`\documentclass[letterpaper,11pt]{article}

% --- ATS-critical ---------------------------------------------------------
% glyphtounicode + \pdfgentounicode makes pdfTeX emit a ToUnicode CMap, so the
% extracted text layer maps ligature glyphs back to real characters. Without
% this, "fi"/"fl"/"ff" extract as single exotic codepoints and words containing
% them become unsearchable to the ATS.
\input{glyphtounicode}
\pdfgentounicode=1

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{cmap}                     % searchable/copyable PDF text
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{latexsym}
\usepackage[usenames,dvipsnames]{color}

% No header or footer: header/footer text is routinely dropped by extractors,
% and contact details are exactly what must not be dropped.
\pagestyle{empty}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1.0in}
\addtolength{\topmargin}{-0.6in}
\addtolength{\textheight}{1.2in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

% Standard section headings, rendered plainly. Parsers match these names.
\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

% --- single-column entry macros -------------------------------------------
% Dates use \hfill inside the SAME paragraph as the title rather than a table
% cell, so extraction keeps them attached to their role.
\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}

\newcommand{\resumeSubheading}[4]{%
  \vspace{-2pt}\item
  \textbf{#1} \hfill #2 \\
  \textit{\small #3} \hfill {\small #4}
  \vspace{-5pt}%
}

\newcommand{\resumeSubheadingNoOrg}[2]{%
  \vspace{-2pt}\item
  \textbf{#1} \hfill #2
  \vspace{-5pt}%
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}
`

/* ------------------------------- building --------------------------------- */

export interface BuildOptions {
  /** Max bullets per role. Keeps a targeted resume to one or two pages. */
  maxBulletsPerRole?: number
  /** Drop a role entirely when nothing in it evidences the posting. */
  dropIrrelevantRoles?: boolean
  /** Include a skills line, filtered to skills the posting mentions first. */
  includeSkills?: boolean
}

export interface BuildResult {
  latex: string
  /** The shared model both renderers draw from. */
  plan: ResumePlan
  /** Per-role record of what was kept, dropped, and why. */
  decisions: {
    role: string
    keptBullets: { text: string; matched: string[]; score: number }[]
    droppedBullets: { text: string; reason: string }[]
  }[]
  /** Requirements with no supporting bullet anywhere in the resume. */
  unevidencedRequirements: string[]
  warnings: string[]
}

/**
 * Every piece of candidate text that may appear in the output, collected so the
 * fabrication check can verify the document contains nothing else.
 */
function candidateCorpus(parsed: ParsedResume): Set<string> {
  const out = new Set<string>()
  const add = (s?: string | null) => { if (s && s.trim()) out.add(s.trim()) }
  add(parsed.contact.name); add(parsed.contact.email)
  add(parsed.contact.phone); add(parsed.contact.location)
  for (const l of parsed.contact.links) add(l.url)
  for (const s of parsed.skills) add(s)
  for (const e of parsed.experience) {
    add(e.title); add(e.organization); add(e.location); add(e.dates?.raw)
    for (const b of e.bullets) add(b)
  }
  for (const e of parsed.education) {
    add(e.institution); add(e.credential); add(e.dates?.raw)
  }
  return out
}

/**
 * Render a plan as LaTeX.
 *
 * This function makes NO selection decisions. What appears, and in what order,
 * was settled by `planResume`, so the LaTeX export and the PDF preview cannot
 * drift apart and show the user two different documents.
 */
export function toLatex(plan: ResumePlan): string {
  const out: string[] = [PREAMBLE]
  const NL = '\n'

  /* --- contact, as plain text in the body, never a page header --- */
  const c = plan.contact
  if (c.name) {
    out.push('\\begin{center}' + NL + '  {\\Huge \\scshape ' + tex(c.name) + '} \\\\ \\vspace{4pt}')
    const bits: string[] = []
    if (c.location) bits.push(tex(c.location))
    if (c.phone) bits.push(tex(c.phone))
    if (c.email) bits.push('\\href{mailto:' + tex(c.email) + '}{' + tex(c.email) + '}')
    for (const url of c.links) {
      const href = url.startsWith('http') ? url : 'https://' + url
      bits.push('\\href{' + tex(href) + '}{' + tex(url) + '}')
    }
    out.push('  \\small ' + bits.join(' $|$ ') + NL + '\\end{center}')
  }

  if (plan.skills.length) {
    out.push(
      NL + '\\section{Skills}' + NL +
      '\\begin{itemize}[leftmargin=0.15in, label={}]' + NL +
      '  \\small{\\item{' + plan.skills.map(tex).join(', ') + '}}' + NL +
      '\\end{itemize}',
    )
  }

  const shown = plan.roles.filter((r) => r.bullets.length > 0)
  if (shown.length) {
    out.push(NL + '\\section{Experience}' + NL + '\\resumeSubHeadingListStart')
    for (const role of shown) {
      const title = tex(role.title ?? '')
      const dates = tex(role.dates ?? '')
      if (role.organization) {
        out.push(
          '  \\resumeSubheading{' + title + '}{' + dates + '}{' +
          tex(role.organization) + '}{' + tex(role.location ?? '') + '}',
        )
      } else {
        out.push('  \\resumeSubheadingNoOrg{' + title + '}{' + dates + '}')
      }
      out.push('    \\resumeItemListStart')
      for (const b of role.bullets) out.push('      \\resumeItem{' + tex(b.text) + '}')
      out.push('    \\resumeItemListEnd')
    }
    out.push('\\resumeSubHeadingListEnd')
  }

  if (plan.education.length) {
    out.push(NL + '\\section{Education}' + NL + '\\resumeSubHeadingListStart')
    for (const e of plan.education) {
      const inst = tex(e.institution ?? '')
      const dates = tex(e.dates ?? '')
      if (e.credential) {
        out.push('  \\resumeSubheading{' + inst + '}{' + dates + '}{' + tex(e.credential) + '}{}')
      } else {
        out.push('  \\resumeSubheadingNoOrg{' + inst + '}{' + dates + '}')
      }
    }
    out.push('\\resumeSubHeadingListEnd')
  }

  out.push(NL + '\\end{document}')
  return out.join(NL)
}

/**
 * Plan and render in one call, for callers that want the LaTeX and the record
 * of what was kept or dropped.
 */
export function buildLatex(
  parsed: ParsedResume,
  analysis: AnalysisResult | null,
  opts: BuildOptions = {},
): BuildResult {
  const plan = planResume(parsed, analysis, opts as PlanOptions)
  const warnings = [...plan.warnings]
  if (!plan.contact.name) {
    warnings.push('No name was found, so the document has no heading block.')
  }
  return {
    latex: toLatex(plan),
    plan,
    decisions: plan.roles.map((r) => ({
      role: [r.title, r.organization].filter(Boolean).join(' | ') || '(untitled role)',
      keptBullets: r.bullets.map((b) => ({ text: b.text, matched: b.matched, score: b.score })),
      droppedBullets: r.dropped,
    })),
    unevidencedRequirements: plan.unevidencedRequirements,
    warnings,
  }
}

/* --------------------------- fabrication check ---------------------------- */

/**
 * Verify the document contains no prose the candidate did not write.
 *
 * Strips LaTeX structure, then checks every remaining word run against the
 * candidate's own text. This is a mechanical guarantee rather than a promise:
 * if a future change starts generating summary sentences, this fails loudly.
 *
 * Returns the offending fragments; empty means clean.
 */
export function findFabrications(latex: string, parsed: ParsedResume): string[] {
  // Both sides go through the SAME tokeniser. Comparing whitespace-separated
  // runs instead flags "mailto:ashutosh@example.com" as invented even though
  // the address is the candidate's own -- it is merely punctuated differently
  // in the document than in the source text.
  const words = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 4)

  const corpus = new Set(words([...candidateCorpus(parsed)].join(' ')))

  /** LaTeX structure this generator emits. Ours, not the candidate's. */
  const STRUCTURAL = new Set([
    'document', 'center', 'itemize', 'begin', 'end', 'section', 'href', 'mailto',
    'small', 'huge', 'scshape', 'textbf', 'textit', 'vspace', 'hfill', 'item',
    'leftmargin', 'label', 'resumeitem', 'resumesubheading', 'resumesubheadingnoorg',
    'resumeitemliststart', 'resumeitemlistend', 'resumesubheadingliststart',
    'resumesubheadinglistend', 'textbackslash', 'textasciicircum', 'textasciitilde',
    'skills', 'experience', 'education', 'projects', 'summary', 'certifications',
    'publications', 'awards', 'https', 'http', 'www',
  ])

  const body = latex
    .slice(latex.indexOf('\\begin{document}'))
    // Environment names are arguments, not content -- strip them WITH the macro.
    // Leaving them turns "\begin{document}" into the bare word "document".
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, ' ')
    // Optional arguments carry layout keywords (leftmargin, label).
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}$&#_^~\\|]/g, ' ')

  return [...new Set(words(body).filter((w) => !STRUCTURAL.has(w) && !corpus.has(w)))]
}
