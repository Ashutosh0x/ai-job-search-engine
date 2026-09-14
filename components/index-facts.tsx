"use client"

import { useEffect, useState } from "react"
import { Building2, Briefcase, ExternalLink } from "lucide-react"

/**
 * What is actually in the job index, read from the index.
 *
 * WHY THIS REPLACED THE TESTIMONIALS
 * ----------------------------------
 * The block that used to sit here claimed "over 1,000,000 candidates" hearing
 * back "25% more", above seven testimonials attributed to named people at
 * Blackrock and Deloitte -- and, elsewhere on the page, four more quotes
 * praising "Simplify", a different product entirely. None of it was measurable
 * and none of it was ours. On a page behind a login that was merely bad; the
 * page is public now.
 *
 * Everything here is fetched from /api/jobs and is true at the moment it
 * renders. It also cannot rot: when the crawl grows, these numbers grow with
 * it, which a hardcoded "2 million resumes" never could.
 *
 * If the fetch fails, this renders nothing rather than falling back to a
 * plausible number. An invented statistic is worse than an absent one.
 */

interface Facet {
  value: string
  count: number
  label?: string
}

interface Snapshot {
  total: number
  departments: Facet[]
  companies: Facet[]
  countries: Facet[]
  deployment?: { companies?: number; corpusTotal?: number; bounded?: boolean }
  generatedAt?: string
}

export default function IndexFacts() {
  const [data, setData] = useState<Snapshot | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/jobs?pageSize=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.success) setData(j as Snapshot)
      })
      .catch(() => {
        /* Silence is the correct fallback here. See the note above. */
      })
    return () => { alive = false }
  }, [])

  if (!data) return null

  const employers = data.deployment?.companies ?? data.companies?.length ?? 0
  const topEmployers = (data.companies ?? []).slice(0, 12)
  const built = data.generatedAt ? new Date(data.generatedAt) : null

  return (
    <div>
      <div className="mb-10 text-center">
        <h2 className="mb-3 text-3xl font-bold text-gray-900 dark:text-white">
          What you are actually searching
        </h2>
        <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
          Every posting is crawled from the employer&rsquo;s own careers system and links
          straight to their application page. No reposts, no aggregator redirects.
        </p>
      </div>

      <div className="mx-auto mb-10 grid max-w-3xl gap-6 sm:grid-cols-3">
        <div className="text-center">
          <Briefcase className="mx-auto mb-2 h-6 w-6 text-purple-600 dark:text-purple-400" />
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {data.total.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">indexed roles</div>
        </div>
        <div className="text-center">
          <Building2 className="mx-auto mb-2 h-6 w-6 text-purple-600 dark:text-purple-400" />
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {employers.toLocaleString()}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">employers</div>
        </div>
        <div className="text-center">
          <ExternalLink className="mx-auto mb-2 h-6 w-6 text-purple-600 dark:text-purple-400" />
          <div className="text-3xl font-bold text-gray-900 dark:text-white">100%</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">direct to employer</div>
        </div>
      </div>

      {topEmployers.length > 0 && (
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">
            Employers with the most open roles right now
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {topEmployers.map((c) => (
              <span
                key={c.value}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {c.label ?? c.value}
                <span className="ml-1.5 text-gray-400">{c.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {built && (
        <p className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
          Index built {built.toLocaleDateString()}
          {data.deployment?.bounded && data.deployment.corpusTotal
            ? ` — a ${data.total.toLocaleString()}-role slice of ${data.deployment.corpusTotal.toLocaleString()} crawled, bounded to fit the deployment`
            : ""}
        </p>
      )}
    </div>
  )
}
