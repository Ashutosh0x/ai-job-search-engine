import { type NextRequest, NextResponse } from "next/server"
import pdf from "pdf-parse"
import mammoth from "mammoth"
import { createClient } from '@supabase/supabase-js'

// Ensure this route runs on the Node.js runtime (required for pdf-parse/mammoth)
export const runtime = 'nodejs'

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase URL or Anon Key environment variables.')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Helper function to extract information from parsed text
const extractInfoFromText = (text: string) => {
  const nameMatch = text.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})\n/);
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const phoneMatch = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const skillsMatch = text.match(/(skills|technical skills|proficiencies)\n([\s\S]+?)(?:\n\n|\Z)/i);
  const experienceMatch = text.match(/(experience|work experience)\n([\s\S]+?)(?:\n\n|\Z)/i);

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
  try {
    let parsedText = ""

    // Support both multipart/form-data uploads and JSON payload with fileUrl
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
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
      const resp = await fetch(fileUrl)
      if (!resp.ok) {
        return NextResponse.json({ error: `Failed to fetch file: ${resp.status}` }, { status: 404 })
      }
      const arrayBuf = await resp.arrayBuffer()
      const buffer = Buffer.from(arrayBuf)
      const ct = resp.headers.get('content-type') || ''
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