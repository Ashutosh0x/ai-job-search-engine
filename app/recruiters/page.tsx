import { Suspense } from "react"
import type { Metadata } from "next"
import RecruitersPage from "@/components/recruiters-page"

export const metadata: Metadata = {
  title: "Recruiter directory",
  description:
    "Who to contact at every employer in the index: recruiting inboxes the companies published " +
    "themselves, publicly identified recruiters with their sources, and each company's observed " +
    "address pattern. Refreshed daily.",
  alternates: { canonical: "/recruiters" },
}

/**
 * Search state lives in the URL, so the page reads useSearchParams and has to
 * sit under a Suspense boundary — without one the whole route opts out of
 * static rendering and the build fails on `missing-suspense-with-csr-bailout`.
 * The fallback mirrors the page's own shape so the layout does not jump.
 */
export default function Recruiters() {
  return (
    <Suspense fallback={<RecruitersFallback />}>
      <RecruitersPage />
    </Suspense>
  )
}

function RecruitersFallback() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 h-16 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
          <div className="mx-auto h-8 w-72 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    </div>
  )
}
