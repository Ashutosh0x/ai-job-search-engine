/**
 * Shared, provider-neutral contracts for the AI interview feature.
 *
 * The browser only receives the public session fields it needs to render. Job
 * context, resume excerpts, prompts, provider credentials, and evaluation
 * instructions remain server-side.
 */

export const INTERVIEW_MODES = ["technical", "behavioral", "role-specific", "mixed"] as const
export type InterviewMode = (typeof INTERVIEW_MODES)[number]

export const INTERVIEW_STATES = [
  "idle",
  "starting",
  "speaking",
  "listening",
  "thinking",
  "interrupted",
  "reconnecting",
  "completed",
  "error",
] as const
export type InterviewVisualState = (typeof INTERVIEW_STATES)[number]

export type InterviewSessionStatus = "active" | "completing" | "completed" | "failed"

export type InterviewContext = {
  jobId: string
  jobTitle: string
  companyName: string
  description: string
  skills: string[]
  interviewType: InterviewMode
  durationMinutes: 10 | 20 | 30
  candidate: {
    profileSummary: string
    skills: string[]
    resumeText: string
  }
}

export type InterviewDimension = {
  id: string
  label: string
  skills: string[]
  targetQuestions: number
}

export type InterviewPlan = {
  questionsTarget: number
  dimensions: InterviewDimension[]
  topicsRemaining: string[]
  openingQuestion: string
}

export type InterviewTurn = {
  id?: string
  sequence: number
  speaker: "interviewer" | "candidate"
  transcript: string
  createdAt?: string
  questionId?: string | null
  skills: string[]
  metadata?: Record<string, unknown>
}

export type NextInterviewTurn = {
  question: string
  skills: string[]
  coveredSkills: string[]
  followUp: boolean
}

export type RequirementAssessment = {
  skill: string
  score: number
  level: "strong" | "developing" | "needs-practice"
  evidence: string
}

export type InterviewEvaluation = {
  overallReadiness: number
  scores: {
    technical: number
    communication: number
    problemSolving: number
    roleFit: number
    behavioral: number
  }
  requirementAssessments: RequirementAssessment[]
  strengths: string[]
  weaknesses: string[]
  recommendedPractice: string[]
  bestAnswer: {
    transcript: string
    explanation: string
  } | null
  biggestGap: string
  disclaimer: string
}

/** A provider can be swapped without changing routes, persistence, or UI. */
export interface InterviewProvider {
  createPlan(context: InterviewContext): Promise<InterviewPlan>
  nextTurn(input: {
    context: InterviewContext
    plan: InterviewPlan
    turns: InterviewTurn[]
    answer: string
  }): Promise<NextInterviewTurn>
  evaluate(input: {
    context: InterviewContext
    plan: InterviewPlan
    turns: InterviewTurn[]
  }): Promise<InterviewEvaluation>
}

const ALLOWED_TRANSITIONS: Record<InterviewVisualState, InterviewVisualState[]> = {
  idle: ["starting", "error"],
  starting: ["speaking", "listening", "error", "reconnecting"],
  speaking: ["listening", "interrupted", "thinking", "completed", "error", "reconnecting"],
  listening: ["thinking", "speaking", "completed", "error", "reconnecting"],
  thinking: ["speaking", "listening", "completed", "error", "reconnecting"],
  interrupted: ["listening", "thinking", "error", "completed"],
  reconnecting: ["speaking", "listening", "error", "completed"],
  completed: ["starting", "idle"],
  error: ["starting", "idle", "completed"],
}

/** Pure guard used by transport implementations and covered without a microphone. */
export function canTransitionInterviewState(
  from: InterviewVisualState,
  to: InterviewVisualState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}
