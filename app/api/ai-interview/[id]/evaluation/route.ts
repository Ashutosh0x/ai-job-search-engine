import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/api-auth"
import { getOwnedInterview, isInterviewPersistenceConfigured } from "@/lib/ai-interview/server"
import { supabaseUnavailable } from "@/lib/supabase-admin"

const paramsSchema = z.object({ id: z.string().uuid() })

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isInterviewPersistenceConfigured()) return supabaseUnavailable()
  const auth = await requireUser(request)
  if ("response" in auth) return auth.response
  const route = paramsSchema.safeParse(params)
  if (!route.success) return NextResponse.json({ error: "Invalid interview id." }, { status: 400 })
  try {
    const session = await getOwnedInterview(route.data.id, auth.user.id)
    if (!session) return NextResponse.json({ error: "Interview not found." }, { status: 404 })
    if (session.status !== "completed" || !session.evaluation) {
      return NextResponse.json({ error: "Your assessment is not ready yet." }, { status: 409 })
    }
    return NextResponse.json({ evaluation: session.evaluation })
  } catch (error) {
    console.error("Could not read AI interview evaluation", error)
    return NextResponse.json({ error: "Could not read the assessment." }, { status: 503 })
  }
}
