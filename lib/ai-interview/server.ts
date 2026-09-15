import { getServiceClient } from "@/lib/supabase-admin"
import { getJobById } from "@/lib/job-index"
import type { InterviewContext, InterviewPlan, InterviewTurn } from "./types"

type SessionRow = Record<string, any>

/** Interview writes need the service role; an anon key must never be treated as enough. */
export function isInterviewPersistenceConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function text(value: unknown, max = 12_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function strings(value: unknown, max = 20): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, max)
    : []
}

export function parsePlan(value: unknown): InterviewPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const plan = value as Record<string, unknown>
  if (!Array.isArray(plan.dimensions) || typeof plan.openingQuestion !== "string") return null
  const dimensions = plan.dimensions.map((item, index) => {
    const dimension = item && typeof item === "object" ? item as Record<string, unknown> : {}
    return {
      id: text(dimension.id, 32) || `dimension-${index + 1}`,
      label: text(dimension.label, 80) || "Role-specific judgement",
      skills: strings(dimension.skills, 6),
      targetQuestions: Math.max(1, Math.min(6, Number(dimension.targetQuestions) || 1)),
    }
  }).slice(0, 5)
  if (!dimensions.length) return null
  return {
    questionsTarget: Math.max(3, Math.min(14, Number(plan.questionsTarget) || 8)),
    dimensions,
    topicsRemaining: strings(plan.topicsRemaining, 10),
    openingQuestion: text(plan.openingQuestion, 500),
  }
}

export function toInterviewTurn(row: Record<string, any>): InterviewTurn {
  return {
    id: text(row.id, 100) || undefined,
    sequence: Number(row.sequence) || 0,
    speaker: row.speaker === "candidate" ? "candidate" : "interviewer",
    transcript: text(row.transcript, 8_000),
    createdAt: text(row.created_at, 80) || undefined,
    questionId: typeof row.question_id === "string" ? row.question_id : null,
    skills: strings(row.skills, 10),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
  }
}

/** Returns only data belonging to this user. Service-role reads must never skip this filter. */
export async function getOwnedInterview(id: string, userId: string): Promise<SessionRow | null> {
  const supabase = getServiceClient()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("interview_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return data as SessionRow | null
}

export async function getTurns(interviewId: string): Promise<InterviewTurn[]> {
  const supabase = getServiceClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from("interview_turns")
    .select("id, sequence, speaker, transcript, created_at, question_id, skills, metadata")
    .eq("interview_id", interviewId)
    .order("sequence", { ascending: true })
  if (error) throw error
  return (data ?? []).map((turn) => toInterviewTurn(turn as Record<string, any>))
}

/** Re-hydrates trusted job data, then adds the owner's current profile/resume context. */
export async function contextForSession(session: SessionRow): Promise<InterviewContext | null> {
  const jobId = text(session.job_id, 300)
  const found = jobId ? await getJobById(jobId) : null
  const snapshot = session.job_snapshot && typeof session.job_snapshot === "object" ? session.job_snapshot as Record<string, unknown> : {}
  const jobTitle = found?.job.title || text(session.job_title, 200)
  const companyName = found?.job.companyName || text(session.company_name, 200)
  if (!jobTitle || !companyName) return null

  const supabase = getServiceClient()
  if (!supabase) return null
  const userId = text(session.user_id, 100)
  const [{ data: profile }, { data: resume }] = await Promise.all([
    supabase.from("profiles").select("title, company, bio, experience, skills").eq("id", userId).maybeSingle(),
    supabase.from("resumes").select("parsed_text, parsed_info").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  const profileRow = (profile ?? {}) as Record<string, unknown>
  const resumeRow = (resume ?? {}) as Record<string, unknown>
  const profileSummary = [profileRow.title, profileRow.company, profileRow.bio, profileRow.experience]
    .map((item) => text(item, 1_500)).filter(Boolean).join("\n")

  return {
    jobId,
    jobTitle,
    companyName,
    description: found?.job.descriptionText || text(snapshot.description, 1_500),
    skills: found?.job.skills?.slice(0, 8) || strings(snapshot.skills, 8),
    interviewType: session.interview_type === "technical" || session.interview_type === "behavioral" || session.interview_type === "role-specific" || session.interview_type === "mixed"
      ? session.interview_type
      : "mixed",
    durationMinutes: session.duration_seconds === 600 || session.duration_seconds === 1800 ? session.duration_seconds / 60 : 20,
    candidate: {
      profileSummary,
      skills: strings(profileRow.skills, 20),
      resumeText: text(resumeRow.parsed_text, 12_000),
    },
  } as InterviewContext
}

export function publicSession(session: SessionRow) {
  return {
    id: session.id,
    status: session.status,
    jobTitle: session.job_title,
    companyName: session.company_name,
    interviewType: session.interview_type,
    durationSeconds: session.duration_seconds,
    startedAt: session.started_at,
    completedAt: session.completed_at,
    createdAt: session.created_at,
  }
}
