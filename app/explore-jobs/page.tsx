import { Suspense } from "react"
import type { Metadata } from "next"
import ExploreJobsPage from "@/components/explore-jobs-page"

export const metadata: Metadata = {
  title: "Explore open roles",
  description:
    "Browse every role in the index, filtered by department and early-career category. " +
    "Each listing links to the employer's own application page.",
  alternates: { canonical: "/explore-jobs" },
}

/**
 * The search state lives in the URL, so the page reads useSearchParams.
 *
 * Next requires that to sit under a Suspense boundary: without one the whole
 * route opts out of static rendering and the build fails on
 * `missing-suspense-with-csr-bailout`. The fallback is the page's own skeleton
 * shape rather than a spinner, so the layout does not jump when it resolves.
 */
export default function ExploreJobs() {
  return (
    <Suspense fallback={<ExploreJobsFallback />}>
      <ExploreJobsPage />
    </Suspense>
  )
}

function ExploreJobsFallback() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 h-16 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
          <div className="mx-auto h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    </div>
  )
}
