import { type NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { analyze } from '@/lib/resume/analyze'
import type { TermStats } from '@/lib/resume/requirements'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Evidence-based resume ↔ job matching.
 *
 *   POST /api/resume/match
 *   { resumeText, job: { text, title? }, confirmed?: string[] }
 *
 * WHY THIS IS A DIFFERENT ENDPOINT FROM /api/analyze-resume
 * ---------------------------------------------------------
 * The existing analyze route asks a model to produce scores from a resume
 * alone. That is unanswerable -- a resume is not good or bad in the abstract,
 * only well or poorly matched to a target -- and the prompt there carries a
 * worked example, so the model returns numbers anchored to the example rather
 * than to the document.
 *
 * This route takes a target job, extracts its requirements, and maps each one
 * to the resume span that supports it. Everything it returns is either quoted
 * from one of the two documents or computed from those quotes. No model is
 * involved and nothing is generated, so there is nothing to hallucinate.
 *
 * Requirement importance comes from the posting's own language where it is
 * explicit, and from corpus statistics measured over the job index otherwise.
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
    // Absent statistics degrade the result (importance falls back to the
    // posting's own wording) but must never fail the request -- the analysis
    // is still useful and says so in `unknowns`.
    statsCache = { data: null, at: Date.now() }
    return null
  }
}

const MAX_CHARS = 60_000

export async function POST(request: NextRequest) {
  // Identified by IP rather than user: this endpoint stores nothing and reads
  // no database, so it does not need an account. Keeping it unauthenticated is
  // deliberate -- a resume never has to be uploaded to get a match.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
  if (checkRateLimit(`resume-match:${ip}`, { windowMs: 60_000, max: 20 })) {
    return NextResponse.json(
      { success: false, error: 'Too many requests. Please wait a moment.' },
      { status: 429 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const resumeText = typeof body?.resumeText === 'string' ? body.resumeText : ''
  if (!resumeText.trim()) {
    return NextResponse.json(
      { success: false, error: 'resumeText is required' },
      { status: 400 }
    )
  }

  const jobText = typeof body?.job?.text === 'string' ? body.job.text : ''
  const jobTitle = typeof body?.job?.title === 'string' ? body.job.title : undefined
  const confirmed: string[] = Array.isArray(body?.confirmed)
    ? body.confirmed.filter((s: unknown) => typeof s === 'string').slice(0, 100)
    : []

  const stats = await loadStats()

  const result = analyze({
    resumeText: resumeText.slice(0, MAX_CHARS),
    job: jobText.trim() ? { text: jobText.slice(0, MAX_CHARS), title: jobTitle } : null,
    stats,
    confirmed,
  })

  return NextResponse.json({
    success: true,
    ...result,
    // State the basis of the importance estimates so a client can show it.
    importanceSource: stats
      ? { kind: 'corpus', postings: stats.postingsWithText, generatedAt: stats.generatedAt }
      : { kind: 'posting-language-only' },
  })
}
