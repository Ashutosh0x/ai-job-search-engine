import { Suspense } from "react"
import type { Metadata } from "next"
import JobListings from "@/components/job-listings"

export const metadata: Metadata = {
  title: "Job search",
  description:
    "Search jobs by title, skill, company and location across employers' own applicant " +
    "tracking systems, with salary, seniority and remote filters.",
  alternates: { canonical: "/jobs" },
}

/**
 * The search is restored from the query string, so JobListings reads
 * useSearchParams and must sit under a Suspense boundary -- without one Next
 * fails the build with `missing-suspense-with-csr-bailout`.
 */
export default function JobsPage() {
  return (
    <Suspense fallback={<JobsFallback />}>
      <JobListings />
    </Suspense>
  )
}

function JobsFallback() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="h-10 flex-1 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800" />
          <div className="h-10 animate-pulse rounded-md bg-slate-200 dark:bg-slate-800 sm:w-64" />
        </div>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    </div>
  )
}
