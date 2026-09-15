import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/api-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getServiceClient, supabaseUnavailable } from "@/lib/supabase-admin"
import { getInterviewProvider } from "@/lib/ai-interview/interviewer"
import { contextForSession, getOwnedInterview, getTurns, isInterviewPersistenceConfigured, parsePlan } from "@/lib/ai-interview/server"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  transcript: z.string().trim().min(1).max(8_000),
  metrics: z.object({ sttLatencyMs: z.number().int().min(0).max(120_000).optional() }).optional(),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isInterviewPersistenceConfigured()) return supabaseUnavailable()
  const auth = await requireUser(request)
  if ("response" in auth) return auth.response
  if (checkRateLimit(`ai-interview:turn:${auth.user.id}`, { windowMs: 60_000, max: 36 })) {
    return NextResponse.json({ error: "Too many interview turns. Please pause briefly and try again." }, { status: 429 })
  }
  const route = paramsSchema.safeParse(params)
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!route.success || !body.success) return NextResponse.json({ error: "A valid interview and transcript are required." }, { status: 400 })

  let session
  try {
    session = await getOwnedInterview(route.data.id, auth.user.id)
  } catch (error) {
    console.error("Could not read AI interview", error)
    return NextResponse.json({ error: "Could not continue the interview." }, { status: 503 })
  }
  if (!session) return NextResponse.json({ error: "Interview not found." }, { status: 404 })
  if (session.status !== "active") return NextResponse.json({ error: "This interview has already ended." }, { status: 409 })

  const [context, turns] = await Promise.all([contextForSession(session), getTurns(session.id)])
  const plan = parsePlan(session.interview_plan)
  if (!context || !plan) return NextResponse.json({ error: "Interview context is unavailable." }, { status: 409 })

  const sequence = turns.length + 1
  const supabase = getServiceClient()
  if (!supabase) return supabaseUnavailable()
  const { error: answerError } = await supabase.from("interview_turns").insert({
    interview_id: session.id,
    sequence,
    speaker: "candidate",
    transcript: body.data.transcript,
    skills: [],
    metadata: body.data.metrics ?? {},
  })
  if (answerError) {
    console.error("Could not save candidate interview turn", answerError)
    return NextResponse.json({ error: "Could not save your answer. Please try again." }, { status: 503 })
  }

  const turnStartedAt = performance.now()
  const next = await getInterviewProvider().nextTurn({
    context,
    plan,
    turns: [...turns, { sequence, speaker: "candidate", transcript: body.data.transcript, skills: [] }],
    answer: body.data.transcript,
  })
  const llmLatencyMs = Math.round(performance.now() - turnStartedAt)
  const candidateCount = turns.filter((turn) => turn.speaker === "candidate").length + 1
  const questionNumber = candidateCount + 1
  const isLastQuestion = candidateCount >= plan.questionsTarget
  const question = isLastQuestion
    ? "Thank you. That concludes our practice interview. I’ll prepare your feedback now."
    : next.question

  const { error: questionError } = await supabase.from("interview_turns").insert({
    interview_id: session.id,
    sequence: sequence + 1,
    speaker: "interviewer",
    transcript: question,
    question_id: isLastQuestion ? "closing" : `question-${questionNumber}`,
    skills: next.skills,
    metadata: { followUp: next.followUp, coveredSkills: next.coveredSkills, llmLatencyMs },
  })
  if (questionError) {
    console.error("Could not save interviewer turn", questionError)
    return NextResponse.json({ error: "Could not continue the interview. Please try again." }, { status: 503 })
  }
  const previousState = session.interview_state && typeof session.interview_state === "object" ? session.interview_state : {}
  await supabase.from("interview_sessions").update({
    interview_state: {
      ...previousState,
      questionCount: Math.min(questionNumber, plan.questionsTarget),
      topicsCovered: Array.from(new Set([...(Array.isArray(previousState.topicsCovered) ? previousState.topicsCovered : []), ...next.coveredSkills])),
      metrics: { ...(previousState.metrics && typeof previousState.metrics === "object" ? previousState.metrics : {}), lastLlmLatencyMs: llmLatencyMs },
    },
  }).eq("id", session.id).eq("user_id", auth.user.id)

  return NextResponse.json({
    question,
    questionNumber: Math.min(questionNumber, plan.questionsTarget),
    questionsTarget: plan.questionsTarget,
    completed: isLastQuestion,
    telemetry: { llmLatencyMs },
  })
}
