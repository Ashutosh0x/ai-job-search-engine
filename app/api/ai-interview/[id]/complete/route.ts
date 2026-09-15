import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/api-auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getServiceClient, supabaseUnavailable } from "@/lib/supabase-admin"
import { getInterviewProvider } from "@/lib/ai-interview/interviewer"
import { contextForSession, getOwnedInterview, getTurns, isInterviewPersistenceConfigured, parsePlan } from "@/lib/ai-interview/server"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isInterviewPersistenceConfigured()) return supabaseUnavailable()
  const auth = await requireUser(request)
  if ("response" in auth) return auth.response
  if (checkRateLimit(`ai-interview:complete:${auth.user.id}`, { windowMs: 60_000, max: 8 })) {
    return NextResponse.json({ error: "Too many completion attempts. Please try again in a minute." }, { status: 429 })
  }
  const route = paramsSchema.safeParse(params)
  if (!route.success) return NextResponse.json({ error: "Invalid interview id." }, { status: 400 })

  let session
  try {
    session = await getOwnedInterview(route.data.id, auth.user.id)
  } catch (error) {
    console.error("Could not read AI interview", error)
    return NextResponse.json({ error: "Could not complete the interview." }, { status: 503 })
  }
  if (!session) return NextResponse.json({ error: "Interview not found." }, { status: 404 })
  if (session.status === "completed" && session.evaluation) return NextResponse.json({ evaluation: session.evaluation })

  const [context, turns] = await Promise.all([contextForSession(session), getTurns(session.id)])
  const plan = parsePlan(session.interview_plan)
  if (!context || !plan) return NextResponse.json({ error: "Interview context is unavailable." }, { status: 409 })

  const supabase = getServiceClient()
  if (!supabase) return supabaseUnavailable()
  await supabase.from("interview_sessions").update({ status: "completing" }).eq("id", session.id).eq("user_id", auth.user.id)
  const evaluationStartedAt = performance.now()
  const evaluation = await getInterviewProvider().evaluate({ context, plan, turns })
  const evaluationLatencyMs = Math.round(performance.now() - evaluationStartedAt)
  const previousState = session.interview_state && typeof session.interview_state === "object" ? session.interview_state : {}
  const { error: updateError } = await supabase
    .from("interview_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      evaluation,
      interview_state: {
        ...previousState,
        metrics: { ...(previousState.metrics && typeof previousState.metrics === "object" ? previousState.metrics : {}), evaluationLatencyMs },
      },
    })
    .eq("id", session.id)
    .eq("user_id", auth.user.id)
  if (updateError) {
    console.error("Could not save AI interview assessment", updateError)
    return NextResponse.json({ error: "Could not save the assessment. Please try again." }, { status: 503 })
  }
  return NextResponse.json({ evaluation })
}
