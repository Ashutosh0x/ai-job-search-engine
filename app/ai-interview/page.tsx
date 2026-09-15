import type { Metadata } from "next"
import { AIInterviewRoom } from "@/components/ai-interview-room"
import { getJobById } from "@/lib/job-index"

export const metadata: Metadata = {
  title: "AI Interview",
  description: "Practice a focused, voice-first interview for your next role.",
  robots: { index: false, follow: false },
}

type PageProps = {
  searchParams: { jobId?: string | string[] }
}

/**
 * The interview room is intentionally a server page until the visual shell is
 * handed to the browser. This validates the job id against the real served
 * index and prevents query-string text from becoming interview context.
 */
export default async function AIInterviewPage({ searchParams }: PageProps) {
  const rawJobId = typeof searchParams.jobId === "string" ? searchParams.jobId.trim() : ""
  const found = rawJobId && rawJobId.length <= 300 ? await getJobById(rawJobId) : null

  const context = found
    ? {
        jobId: found.job.externalId,
        jobTitle: found.job.title,
        companyName: found.job.companyName,
        skills: (found.job.skills ?? []).filter(Boolean).slice(0, 6),
        // Job postings with explicit skills default to a technical/role-focused
        // session. Sparse postings stay mixed so the interviewer can assess
        // judgement and communication rather than pretending requirements
        // exist that the posting never stated.
        interviewType: found.job.skills?.length ? ("technical" as const) : ("mixed" as const),
      }
    : {
        jobTitle: "Your next opportunity",
        companyName: "AI Job Search",
        skills: [],
        interviewType: "mixed" as const,
      }

  return <AIInterviewRoom context={context} />
}
