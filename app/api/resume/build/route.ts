import { type NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { analyze } from '@/lib/resume/analyze'
import { parseResume } from '@/lib/resume/parse'
import { buildLatex, findFabrications } from '@/lib/resume/latex'
import type { TermStats } from '@/lib/resume/requirements'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Build a job-targeted resume as LaTeX source.
 *
 *   POST /api/resume/build
 *   { resumeText, jobDescription, jobTitle?, options? }
 *
 * WHAT THIS RETURNS, AND WHAT IT DELIBERATELY DOES NOT
 * ----------------------------------------------------
 * It returns LaTeX source, the analysis that drove it, and a per-bullet record
 * of what was kept or dropped and why. It does NOT return a PDF, because
 * compiling LaTeX needs a TeX distribution this deployment does not carry.
 * Saying so is better than shipping a "PDF" that is really an HTML print view
 * with different metrics -- the whole point of the LaTeX path is typographic
 * fidelity, and a substitute quietly discards it.
 *
 * It also does not write anything. No model is called, nothing is generated,
 * and every line of prose in the output is the candidate's own: the builder
 * selects and orders their existing bullets by how well each evidences a
 * requirement the posting actually states. `findFabrications` re-reads the
 * finished document and fails the request if anything else appears, so the
 * guarantee is mechanical rather than a matter of trust.
 */

let statsCache: { data: TermStats | null; at: number } | null = null
const STATS_TTL = 10 * 60_000

async function loadStats(): Promise<TermStats | null> {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL) return statsCache.data
  try {
    const p = path.join(process.cwd(), 'public', 'data', 'term-stats.json')
    const data = JSON.parse(await readFile(p, 'utf8')) as TermStats
    statsCache = { data, at: Date.now() }
    return data
  } catch {
    // Missing statistics degrade requirement importance to the posting's own
    // wording. That is a worse analysis, not a failed one, and `unknowns` says so.
    statsCache = { data: null, at: Date.now() }
    return null
  }
}

const MAX_CHARS = 60_000

export async function POST(request: NextRequest) {
  // Identified by IP rather than account: this endpoint stores nothing and
  // reads no database, so a resume never has to be uploaded to use it.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  if (checkRateLimit(`resume-build:${ip}`, { windowMs: 60_000, max: 12 })) {
    return NextResponse.json(
      { error: 'Too many build requests. Please wait a minute and try again.' },
      { status: 429 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    resumeText?: string
    jobDescription?: string
    jobTitle?: string
    options?: { maxBulletsPerRole?: number; dropIrrelevantRoles?: boolean; includeSkills?: boolean }
  } | null

  const resumeText = body?.resumeText?.trim()
  const jobDescription = body?.jobDescription?.trim()

  if (!resumeText) {
    return NextResponse.json({ error: 'resumeText is required.' }, { status: 400 })
  }
  if (resumeText.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Resume text is too long (${resumeText.length} chars, max ${MAX_CHARS}).` },
      { status: 413 },
    )
  }
  if (jobDescription && jobDescription.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Job description is too long (${jobDescription.length} chars, max ${MAX_CHARS}).` },
      { status: 413 },
    )
  }

  const parsed = parseResume(resumeText)

  // Without a job the builder still works, but nothing is prioritised -- and
  // the response says that rather than implying the ordering means something.
  const stats = await loadStats()
  const analysis = jobDescription
    ? analyze({
        resumeText,
        job: { text: jobDescription, title: body?.jobTitle },
        stats,
      })
    : null

  const opts = body?.options ?? {}
  const built = buildLatex(parsed, analysis, {
    maxBulletsPerRole: clampInt(opts.maxBulletsPerRole, 1, 10, 4),
    dropIrrelevantRoles: opts.dropIrrelevantRoles === true,
    includeSkills: opts.includeSkills !== false,
  })

  // The invariant, re-checked on the finished document rather than assumed.
  const fabrications = findFabrications(built.latex, parsed)
  if (fabrications.length) {
    console.error('resume/build produced text not present in the source resume:', fabrications.slice(0, 20))
    return NextResponse.json(
      {
        error:
          'The generated document contained text that is not in your resume, so it was withheld. ' +
          'This is a bug in the builder, not a problem with your resume.',
        fabrications: fabrications.slice(0, 20),
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    latex: built.latex,
    // The shared document model. The client renders the live PDF preview from
    // THIS, not from its own copy of the resume, so the preview and the .tex
    // are guaranteed to describe the same document.
    plan: built.plan,
    filename: suggestFilename(parsed.contact.name, body?.jobTitle),
    parsed: {
      contact: parsed.contact,
      skills: parsed.skills,
      totalExperienceMonths: parsed.totalExperienceMonths,
      sections: parsed.sections.map((s) => ({ kind: s.kind, heading: s.heading })),
      experience: parsed.experience.map((e) => ({
        title: e.title,
        organization: e.organization,
        dates: e.dates?.raw ?? null,
        bulletCount: e.bullets.length,
      })),
      education: parsed.education.map((e) => ({
        institution: e.institution,
        credential: e.credential,
        dates: e.dates?.raw ?? null,
      })),
      warnings: parsed.warnings,
    },
    decisions: built.decisions,
    unevidencedRequirements: built.unevidencedRequirements,
    coverage: analysis?.coverage ?? null,
    requirements: analysis?.requirements?.map((r) => ({
      term: r.term,
      importance: r.importance,
      basis: r.importanceBasis.basis,
      mandatory: r.mandatory,
    })) ?? [],
    unknowns: analysis?.unknowns ?? [],
    warnings: built.warnings,
    // Stated plainly so the client never implies the server produced a PDF.
    output: {
      format: 'latex',
      compiled: false,
      note:
        'The live preview is a PDF rendered in your browser from the same plan as the ' +
        'LaTeX below, so both describe the same document. The .tex gives you TeX line ' +
        'breaking and kerning; compile it in Overleaf or locally. Nothing is compiled server-side.',
    },
    generatedAt: new Date().toISOString(),
  })
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

function suggestFilename(name: string | null, jobTitle?: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const parts = [name ? slug(name) : 'resume']
  if (jobTitle) parts.push(slug(jobTitle))
  return `${parts.filter(Boolean).join('-')}.tex`
}
