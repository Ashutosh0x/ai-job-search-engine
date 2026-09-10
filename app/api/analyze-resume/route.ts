import { type NextRequest, NextResponse } from "next/server"
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { requireUser } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Model id is configurable so a retirement does not require a code change.
 * gemini-1.5-pro (the previous hard-coded value) is retired -- calls against it
 * now fail, which is why every analysis was silently falling back to the
 * canned result below.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

/** Keep prompt size bounded: cost and latency scale with it, and a huge resume
 *  is usually a sign of a bad parse rather than a real document. */
const MAX_RESUME_CHARS = 24_000

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase URL or Anon Key environment variables.')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

interface AnalysisRequest {
  resumeId: string
  parsedText: string
  parsedInfo: any
}

interface ATSAnalysis {
  overallScore: number
  sections: {
    contactInfo: { score: number; feedback: string[]; recommendations: string[] }
    experience: { score: number; feedback: string[]; recommendations: string[] }
    skills: { score: number; feedback: string[]; recommendations: string[] }
    education: { score: number; feedback: string[]; recommendations: string[] }
    formatting: { score: number; feedback: string[]; recommendations: string[] }
  }
  keywordAnalysis: {
    found: string[]
    missing: string[]
    suggestions: string[]
  }
  strengths: string[]
  improvements: string[]
  tips: string[]
}

export async function POST(request: NextRequest) {
  // Read the body exactly once. The previous version called request.json()
  // again inside the catch block to mark the row failed; a request body is a
  // single-use stream, so that second read always threw and the status was
  // never updated.
  let resumeId: string | undefined

  try {
    const auth = await requireUser(request)
    if ('response' in auth) return auth.response
    const userId = auth.user.id

    if (checkRateLimit(`analyze-resume:${userId}`, { windowMs: 60 * 60 * 1000, max: 30 })) {
      return NextResponse.json(
        { error: 'Too many analysis requests. Please try again later.' },
        { status: 429 }
      )
    }

    const body: AnalysisRequest = await request.json()
    const { parsedInfo } = body
    let { parsedText } = body
    resumeId = body.resumeId

    if (!resumeId || !parsedText) {
      return NextResponse.json(
        { error: "Missing resumeId or parsedText" },
        { status: 400 }
      )
    }

    // This route holds the service-role key, which bypasses RLS. Without an
    // explicit ownership check any caller could analyse -- and overwrite -- any
    // other user's resume row by guessing its id.
    const { data: ownedResume, error: ownershipError } = await supabase
      .from('resumes')
      .select('id')
      .eq('id', resumeId)
      .eq('user_id', userId)
      .maybeSingle()

    if (ownershipError || !ownedResume) {
      return NextResponse.json({ error: 'Resume not found' }, { status: 404 })
    }

    if (parsedText.length > MAX_RESUME_CHARS) {
      parsedText = parsedText.slice(0, MAX_RESUME_CHARS)
    }

    // Update status to analyzing
    await supabase
      .from('resumes')
      .update({ status: 'analyzing' })
      .eq('id', resumeId)

    // Prepare the analysis prompt for Gemini
    const analysisPrompt = `
You are an expert ATS (Applicant Tracking System) resume analyzer. Analyze the following resume and provide a comprehensive assessment.

Resume Text:
${parsedText}

Extracted Information:
${JSON.stringify(parsedInfo, null, 2)}

Please provide a detailed analysis in the following JSON format:

{
  "overallScore": 85,
  "sections": {
    "contactInfo": {
      "score": 95,
      "feedback": ["Complete contact information provided", "Professional email address used"],
      "recommendations": ["Consider adding LinkedIn profile URL", "Include location for better local job matching"]
    },
    "experience": {
      "score": 75,
      "feedback": ["Good use of action verbs", "Relevant work experience included"],
      "recommendations": ["Add more quantified achievements", "Include specific technologies used"]
    },
    "skills": {
      "score": 65,
      "feedback": ["Technical skills section present", "Some industry-relevant keywords included"],
      "recommendations": ["Add more job-specific keywords", "Include both hard and soft skills"]
    },
    "education": {
      "score": 85,
      "feedback": ["Education information complete", "Relevant degree for target roles"],
      "recommendations": ["Add relevant certifications", "Include GPA if above 3.5"]
    },
    "formatting": {
      "score": 80,
      "feedback": ["Clean and professional formatting", "Good use of bullet points"],
      "recommendations": ["Ensure consistent spacing", "Use standard fonts"]
    }
  },
  "keywordAnalysis": {
    "found": ["JavaScript", "React", "Node.js"],
    "missing": ["TypeScript", "Docker", "Kubernetes"],
    "suggestions": ["Add TypeScript to technical skills", "Include Docker and Kubernetes experience"]
  },
  "strengths": ["Strong technical background", "Good career progression", "Professional formatting"],
  "improvements": ["Add quantified achievements", "Include more keywords", "Expand on leadership"],
  "tips": ["Tailor resume for each application", "Use STAR method for achievements", "Keep to 1-2 pages"]
}

Focus on:
1. ATS compatibility and keyword optimization
2. Quantified achievements and specific metrics
3. Relevant skills and technologies
4. Professional formatting and structure
5. Industry-specific best practices

Provide realistic scores (0-100) and actionable recommendations.
`

    // Generate analysis using Gemini with structured output and retries
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
    let analysis: ATSAnalysis | null = null
    const maxAttempts = 2
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await model.generateContent(analysisPrompt)
        const response = await result.response
        const analysisText = response.text()
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('No valid JSON found in response')
        const parsed = JSON.parse(jsonMatch[0])
        // Basic shape validation
        if (
          typeof parsed.overallScore === 'number' &&
          parsed.sections && parsed.keywordAnalysis
        ) {
          analysis = parsed as ATSAnalysis
          break
        }
        throw new Error('Invalid schema in AI response')
      } catch (err) {
        lastError = err
        if (attempt === maxAttempts) break
      }
    }
    if (!analysis) {
      // Previously this substituted a hard-coded "score 70" analysis and saved
      // it as though the model had produced it. That is worse than an error:
      // the user acts on advice nobody generated, and the failure is invisible.
      // Fail loudly instead and leave the row marked failed.
      console.error('Failed to get valid analysis from Gemini:', lastError)
      await supabase.from('resumes').update({ status: 'failed' }).eq('id', resumeId)
      return NextResponse.json(
        {
          error: 'Analysis is temporarily unavailable',
          details: 'The analysis service did not return a usable result. Your resume was saved -- please try analysing it again in a moment.',
        },
        { status: 503 }
      )
    }

    // Calculate insights
    const insights = {
      score: analysis.overallScore,
      analysis: analysis,
      recommendations: analysis.improvements,
      strengths: analysis.strengths,
      tips: analysis.tips,
      keywordMatch: analysis.keywordAnalysis.found.length,
      keywordMissing: analysis.keywordAnalysis.missing.length,
      lastAnalyzed: new Date().toISOString()
    }

    // Update the resume record with analysis results
    const { error: updateError } = await supabase
      .from('resumes')
      .update({
        ats_score: analysis.overallScore,
        ats_analysis: analysis,
        insights: insights,
        status: 'analyzed'
      })
      .eq('id', resumeId)

    if (updateError) {
      console.error('Failed to update resume with analysis:', updateError)
      throw new Error(`Failed to save analysis results: ${updateError.message}`)
    }

    return NextResponse.json({
      success: true,
      data: {
        score: analysis.overallScore,
        analysis: analysis,
        insights: insights
      }
    })

  } catch (error) {
    console.error('Error analyzing resume:', error)

    // resumeId was captured before the body was consumed, so this actually
    // runs -- the old code re-read the request stream here and always threw.
    if (resumeId) {
      try {
        await supabase
          .from('resumes')
          .update({ status: 'failed' })
          .eq('id', resumeId)
      } catch (e) {
        console.error('Failed to update status to failed:', e)
      }
    }

    // Internal error text can carry table names and key fragments; keep it in
    // the logs rather than the response body.
    return NextResponse.json(
      { error: "Failed to analyze resume" },
      { status: 500 }
    )
  }
} 