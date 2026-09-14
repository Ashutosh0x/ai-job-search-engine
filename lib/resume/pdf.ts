/**
 * Client-side PDF rendering of a resume plan.
 *
 * WHY A SECOND RENDERER RATHER THAN COMPILING THE LATEX
 * -----------------------------------------------------
 * Compiling LaTeX needs a TeX distribution. Doing it server-side means
 * shipping one into the deployment; doing it in the browser means loading a
 * multi-megabyte WebAssembly TeX that fetches its packages from a third-party
 * package server at compile time. Neither is a reasonable price for a preview
 * that has to update as the user types.
 *
 * So this draws the SAME plan directly to a PDF. Two things make that honest
 * rather than a substitute:
 *
 *   1. Both renderers consume `ResumePlan`. Neither decides what goes in the
 *      document, so the preview cannot show different content from the .tex.
 *
 *   2. The output is a real PDF with a real text layer -- which is the thing
 *      an ATS actually reads. For parsing purposes it is not an approximation
 *      of the LaTeX output; it is arguably more predictable, because the text
 *      layer is written directly and no ligature substitution ever happens.
 *
 * What differs is typography: TeX's line-breaking and kerning are better than
 * anything done here. Users who want that download the .tex. The UI says so.
 *
 * This module imports jspdf and therefore only runs in the browser.
 */

import type { ResumePlan } from './plan'

/* ----------------------------- page geometry ------------------------------ */

// US Letter in points, matching the LaTeX \documentclass[letterpaper].
const PAGE_W = 612
const PAGE_H = 792
// The LaTeX preamble widens the text block to about 7.5in; mirror it here so
// the two documents break lines in roughly the same places.
const MARGIN_X = 42
const MARGIN_TOP = 40
const MARGIN_BOTTOM = 44
const CONTENT_W = PAGE_W - MARGIN_X * 2

const FS_NAME = 20
const FS_CONTACT = 8.5
const FS_SECTION = 11.5
const FS_BODY = 9.5

/** Vertical space, in points, matching the LaTeX macros' rhythm. */
const GAP_AFTER_NAME = 12
const GAP_SECTION_TOP = 13
const GAP_SECTION_RULE = 4
const GAP_ENTRY = 9
const LINE_H = 11.5

export interface PdfResult {
  blob: Blob
  pageCount: number
  /** True when content ran past one page, so the UI can warn. */
  overflowed: boolean
}

/**
 * Render the plan to a PDF.
 *
 * Uses Helvetica rather than a Computer Modern lookalike: Helvetica is one of
 * the PDF base-14 fonts, so it needs no embedding, always extracts cleanly and
 * cannot introduce the ligature problem the LaTeX preamble works around.
 */
export async function renderPdf(plan: ResumePlan): Promise<PdfResult> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })

  let y = MARGIN_TOP
  let pages = 1

  /** Start a new page when the next block would not fit. */
  const need = (h: number) => {
    if (y + h <= PAGE_H - MARGIN_BOTTOM) return
    doc.addPage()
    pages++
    y = MARGIN_TOP
  }

  const setFont = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
  }

  /* ------------------------------ heading ------------------------------- */
  if (plan.contact.name) {
    setFont(FS_NAME, 'bold')
    doc.text(plan.contact.name.toUpperCase(), PAGE_W / 2, y + FS_NAME, { align: 'center' })
    y += FS_NAME + 6

    const bits = [
      plan.contact.location,
      plan.contact.phone,
      plan.contact.email,
      ...plan.contact.links,
    ].filter((x): x is string => Boolean(x && x.trim()))

    if (bits.length) {
      setFont(FS_CONTACT)
      // Joined into ONE text run rather than separate positioned pieces, so
      // extraction keeps the contact details together on a single line.
      const line = bits.join('  |  ')
      const wrapped = doc.splitTextToSize(line, CONTENT_W) as string[]
      for (const l of wrapped) {
        doc.text(l, PAGE_W / 2, y + FS_CONTACT, { align: 'center' })
        y += FS_CONTACT + 2
      }
    }
    y += GAP_AFTER_NAME
  }

  /** A section heading: name, then a rule, matching \titleformat. */
  const section = (title: string) => {
    need(GAP_SECTION_TOP + LINE_H * 2)
    y += GAP_SECTION_TOP - 6
    setFont(FS_SECTION, 'bold')
    doc.text(title.toUpperCase(), MARGIN_X, y + FS_SECTION)
    y += FS_SECTION + GAP_SECTION_RULE
    doc.setLineWidth(0.6)
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y)
    y += 8
  }

  /* ------------------------------- skills -------------------------------- */
  if (plan.skills.length) {
    section('Skills')
    setFont(FS_BODY)
    const wrapped = doc.splitTextToSize(plan.skills.join(', '), CONTENT_W) as string[]
    for (const l of wrapped) {
      need(LINE_H)
      doc.text(l, MARGIN_X, y + FS_BODY)
      y += LINE_H
    }
  }

  /* ----------------------------- experience ------------------------------ */
  const shown = plan.roles.filter((r) => r.bullets.length > 0)
  if (shown.length) {
    section('Experience')
    for (const role of shown) {
      need(LINE_H * 3)

      // Title left, dates right, on ONE baseline. The date is a separate draw
      // call but the same text line, which is what keeps an extractor from
      // attaching it to the wrong entry -- the failure mode that table-based
      // LaTeX templates have.
      setFont(FS_BODY + 0.5, 'bold')
      doc.text(role.title ?? '', MARGIN_X, y + FS_BODY)
      if (role.dates) {
        setFont(FS_BODY, 'normal')
        doc.text(role.dates, PAGE_W - MARGIN_X, y + FS_BODY, { align: 'right' })
      }
      y += LINE_H

      if (role.organization || role.location) {
        setFont(FS_BODY, 'italic')
        doc.text(role.organization ?? '', MARGIN_X, y + FS_BODY)
        if (role.location) {
          setFont(FS_BODY, 'normal')
          doc.text(role.location, PAGE_W - MARGIN_X, y + FS_BODY, { align: 'right' })
        }
        y += LINE_H
      }

      setFont(FS_BODY)
      for (const b of role.bullets) {
        // A hyphen, not a bullet glyph: "•" is outside WinAnsi and extracts
        // unpredictably. The LaTeX path has the same constraint.
        const wrapped = doc.splitTextToSize(b.text, CONTENT_W - 14) as string[]
        wrapped.forEach((l, i) => {
          need(LINE_H)
          if (i === 0) doc.text('-', MARGIN_X + 4, y + FS_BODY)
          doc.text(l, MARGIN_X + 14, y + FS_BODY)
          y += LINE_H
        })
      }
      y += GAP_ENTRY - 3
    }
  }

  /* ------------------------------ education ------------------------------ */
  if (plan.education.length) {
    section('Education')
    for (const e of plan.education) {
      need(LINE_H * 2)
      setFont(FS_BODY + 0.5, 'bold')
      doc.text(e.institution ?? '', MARGIN_X, y + FS_BODY)
      if (e.dates) {
        setFont(FS_BODY, 'normal')
        doc.text(e.dates, PAGE_W - MARGIN_X, y + FS_BODY, { align: 'right' })
      }
      y += LINE_H
      if (e.credential) {
        setFont(FS_BODY, 'italic')
        doc.text(e.credential, MARGIN_X, y + FS_BODY)
        y += LINE_H
      }
      y += GAP_ENTRY - 4
    }
  }

  return {
    blob: doc.output('blob') as Blob,
    pageCount: pages,
    overflowed: pages > 1,
  }
}
