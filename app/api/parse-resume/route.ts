import { getServiceClient, supabaseUnavailable } from '@/lib/supabase-admin'
import { type NextRequest, NextResponse } from "next/server"
// Import the library directly rather than the package root. pdf-parse@1.1.1's
// index.js runs a debug branch guarded by `!module.parent`, which is always
// true once webpack bundles it -- it then reads ./test/data/05-versions-space.pdf,
// a fixture that is not shipped, and `next build` dies with ENOENT.
import pdf from "pdf-parse/lib/pdf-parse.js"
import mammoth from "mammoth"
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { safeFetch, UnsafeUrlError } from '@/lib/safe-fetch'

// Ensure this route runs on the Node.js runtime (required for pdf-parse/mammoth)
export const runtime = 'nodejs'

// Initialize Supabase client
// Built per request, never at module scope: `createClient(undefined!, ...)`
// throws while Next collects page data during `next build`, so one missing env
// var made the whole app unbuildable. See lib/supabase-admin.ts.
const supabase = getServiceClient()

/** Resumes are documents, not archives. */
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

// Helper function to extract information from parsed text
const extractInfoFromText = (text: string) => {
  // Anchoring at ^ with a required trailing \n missed resumes that begin with a
  // blank line or leading whitespace, which is most PDF extractions.
  const nameMatch = text.trimStart().match(/^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,2})\s*(?:\n|$)/);
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const phoneMatch = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  // NOTE: these used to end with (?:\n\n|\Z). JavaScript has no \Z anchor -- it
  // is parsed as a literal "Z" -- so a section running to the end of the
  // document only terminated if it happened to contain a capital Z.
  const skillsMatch = text.match(/(skills|technical skills|proficiencies)\s*\n([\s\S]+?)(?:\n\s*\n|$)/i);
  const experienceMatch = text.match(/(experience|work experience|employment history)\s*\n([\s\S]+?)(?:\n\s*\n|$)/i);

  const skills = skillsMatch ? skillsMatch[2].split(/\n|\s*•\s*/).map(s => s.trim()).filter(s => s.length > 0) : [];
  const experience = experienceMatch ? experienceMatch[2].trim() : "";

  return {
    name: nameMatch ? nameMatch[1].trim() : "N/A",
    email: emailMatch ? emailMatch[0] : "N/A",
    phone: phoneMatch ? phoneMatch[0] : "N/A",
    location: "N/A", // This is harder to extract reliably without more advanced NLP
    skills: skills,
    experience: experience,
    fullText: text,
  };
};

export async function POST(request: NextRequest) {
  // Configuration absent -> this endpoint is unavailable, and says so. Every
  // other route, including all of job search, is unaffected.
  if (!supabase) return supabaseUnavailable()

  try {
    // This endpoint performs server-side fetches and CPU-heavy parsing, so it
    // must not be reachable anonymously.
    const auth = await requireUser(request)
    if ('response' in auth) return auth.response

    if (checkRateLimit(`parse-resume:${auth.user.id}`, { windowMs: 60 * 60 * 1000, max: 30 })) {
      return NextResponse.json(
        { error: 'Too many parse requests. Please try again later.' },
        { status: 429 }
      )
    }

    let parsedText = ""

    // Support both multipart/form-data uploads and JSON payload with fileUrl
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `File is too large. Maximum size is ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
          { status: 413 }
        )
      }
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const fileType = file.type

      if (fileType.includes('pdf') || fileExtension === 'pdf') {
        const data = await pdf(buffer)
        parsedText = data.text
      } else if (fileType.includes('word') || fileExtension === 'doc' || fileExtension === 'docx') {
        const result = await mammoth.extractRawText({ buffer })
        parsedText = result.value
      } else {
        return NextResponse.json({ error: 'Unsupported file format. Only PDF, DOC, or DOCX are supported.' }, { status: 400 })
      }
    } else {
      // JSON mode: { fileUrl: string }
      const body = await request.json().catch(() => null) as { fileUrl?: string } | null
      const fileUrl = body?.fileUrl
      if (!fileUrl) {
        return NextResponse.json({ error: 'fileUrl missing' }, { status: 400 })
      }
      // fileUrl comes straight from the request body. Fetching it directly made
      // this an SSRF proxy: a caller could aim it at cloud instance metadata
      // (169.254.169.254, which hands out credentials) or any internal service
      // the server can reach. safeFetch resolves the host, rejects private and
      // link-local targets, refuses redirects and caps the response size.
      let buffer: Buffer
      let ct: string
      try {
        const fetched = await safeFetch(fileUrl, { maxBytes: MAX_FILE_BYTES })
        buffer = fetched.buffer
        ct = fetched.contentType
      } catch (e) {
        if (e instanceof UnsafeUrlError) {
          return NextResponse.json({ error: e.message }, { status: 400 })
        }
        throw e
      }
      const isPdf = ct.includes('pdf') || fileUrl.toLowerCase().endsWith('.pdf')
      const isDoc = fileUrl.toLowerCase().endsWith('.doc') || fileUrl.toLowerCase().endsWith('.docx') || ct.includes('word')
      if (isPdf) {
        const data = await pdf(buffer)
        parsedText = data.text
      } else if (isDoc) {
        const result = await mammoth.extractRawText({ buffer })
        parsedText = result.value
      } else {
        return NextResponse.json({ error: 'Unsupported file type from URL' }, { status: 400 })
      }
    }

    const resumeInfo = extractInfoFromText(parsedText)

    return NextResponse.json({
      success: true,
      message: "Resume parsed successfully",
      data: resumeInfo,
    })
  } catch (error) {
    console.error("Error processing resume parsing request:", error)

    return NextResponse.json(
      {
        error: "Failed to process resume parsing",
        details: error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    )
  }
}