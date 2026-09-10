import { type NextRequest, NextResponse } from "next/server"
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

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
  try {
    const body: AnalysisRequest = await request.json()
    const { resumeId, parsedText, parsedInfo } = body

    if (!resumeId || !parsedText) {
      return NextResponse.json(
        { error: "Missing resumeId or parsedText" },
        { status: 400 }
      )
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
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" })
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
      console.error('Failed to get valid analysis from Gemini:', lastError)
      analysis = {
        overallScore: 70,
        sections: {
          contactInfo: { score: 80, feedback: ["Contact information present"], recommendations: ["Add more details"] },
          experience: { score: 70, feedback: ["Experience section found"], recommendations: ["Add more details"] },
          skills: { score: 60, feedback: ["Skills section present"], recommendations: ["Add more skills"] },
          education: { score: 80, feedback: ["Education information present"], recommendations: ["Add more details"] },
          formatting: { score: 75, feedback: ["Basic formatting present"], recommendations: ["Improve formatting"] }
        },
        keywordAnalysis: { found: [], missing: [], suggestions: ["Add more industry-specific keywords"] },
        strengths: ["Resume uploaded successfully"],
        improvements: ["Add more detailed information"],
        tips: ["Provide more specific details in each section"]
      }
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

    // Update status to failed if resumeId is available
    if (request.body) {
      try {
        const body = await request.json()
        const resumeId = body.resumeId
        if (resumeId) {
          await supabase
            .from('resumes')
            .update({ status: 'failed' })
            .eq('id', resumeId)
        }
      } catch (e) {
        console.error('Failed to update status to failed:', e)
      }
    }

    return NextResponse.json(
      {
        error: "Failed to analyze resume",
        details: error instanceof Error ? error.message : "Unknown error occurred"
      },
      { status: 500 }
    )
  }
} 