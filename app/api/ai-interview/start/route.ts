import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/api-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getJobById } from "@/lib/job-index"
import { getServiceClient, supabaseUnavailable } from "@/lib/supabase-admin"
import { getInterviewProvider } from "@/lib/ai-interview/interviewer"
import { contextForSession, isInterviewPersistenceConfigured, publicSession } from "@/lib/ai-interview/server"

export const runtime = "nodejs"

const bodySchema = z.object({
  jobId: z.string().trim().min(1).max(300),
  durationMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20),
  interviewType: z.enum(["technical", "behavioral", "role-specific", "mixed"]).default("mixed"),
})

export async function POST(request: NextRequest) {
  if (!isInterviewPersistenceConfigured()) return supabaseUnavailable()
  const auth = await requireUser(request)
  if ("response" in auth) return auth.response
  if (checkRateLimit(`ai-interview:start:${auth.user.id}`, { windowMs: 60_000, max: 8 })) {
    return NextResponse.json({ error: "Too many interview starts. Please try again in a minute." }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "A valid job, duration, and interview type are required." }, { status: 400 })

  const found = await getJobById(parsed.data.jobId)
  if (!found) return NextResponse.json({ error: "Job not found." }, { status: 404 })

  const supabase = getServiceClient()
  if (!supabase) return supabaseUnavailable()
  const { jobId, durationMinutes, interviewType } = parsed.data
  const startedAt = new Date().toISOString()
  const { data: inserted, error: insertError } = await supabase
    .from("interview_sessions")
    .insert({
      user_id: auth.user.id,
      job_id: jobId,
      job_title: found.job.title,
      company_name: found.job.companyName,
      job_snapshot: { description: found.job.descriptionText, skills: found.job.skills?.slice(0, 8) ?? [] },
      status: "active",
      interview_type: interviewType,
      duration_seconds: durationMinutes * 60,
      started_at: startedAt,
      interview_plan: {},
      interview_state: { questionCount: 0, topicsCovered: [], metrics: {} },
    })
    .select("*")
    .single()
  if (insertError || !inserted) {
    console.error("Could not create AI interview", insertError)
    return NextResponse.json({ error: "Could not start the interview. Please try again." }, { status: 503 })
  }

  const context = await contextForSession(inserted)
  if (!context) {
    await supabase.from("interview_sessions").delete().eq("id", inserted.id).eq("user_id", auth.user.id)
    return NextResponse.json({ error: "The selected job is no longer available." }, { status: 404 })
  }

  const planningStartedAt = performance.now()
  const plan = await getInterviewProvider().createPlan(context)
  const plannerLatencyMs = Math.round(performance.now() - planningStartedAt)
  const { data: session, error: planError } = await supabase
    .from("interview_sessions")
    .update({
      interview_plan: plan,
      interview_state: { questionCount: 1, topicsCovered: [], metrics: { plannerLatencyMs } },
    })
    .eq("id", inserted.id)
    .eq("user_id", auth.user.id)
    .select("*")
    .single()
  if (planError || !session) {
    console.error("Could not save AI interview plan", planError)
    return NextResponse.json({ error: "Could not prepare the interview. Please try again." }, { status: 503 })
  }

  const { error: openingError } = await supabase.from("interview_turns").insert({
    interview_id: session.id,
    sequence: 1,
    speaker: "interviewer",
    transcript: plan.openingQuestion,
    question_id: "opening",
    skills: plan.dimensions[0]?.skills ?? [],
    metadata: { source: "planner", plannerLatencyMs },
  })
  if (openingError) {
    console.error("Could not persist opening interview turn", openingError)
    return NextResponse.json({ error: "Could not prepare the interview. Please try again." }, { status: 503 })
  }

  return NextResponse.json({
    session: publicSession(session),
    openingQuestion: plan.openingQuestion,
    questionNumber: 1,
    questionsTarget: plan.questionsTarget,
  })
}
