import { type NextRequest, NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase"

export const runtime = 'nodejs'

/**
 * Job search.
 *
 * Two things were wrong with the previous version and both were product bugs
 * rather than style issues:
 *
 *  1. It was hard-coded to a single Greenhouse board (`boards/cloudflare`), so
 *     a "job search engine" only ever returned Cloudflare's openings, ignoring
 *     the `jobs` table the rest of the app reads and writes.
 *  2. On any upstream failure it returned three invented postings -- "Software
 *     Engineer, San Francisco", etc. -- with `success: true` and a link to a
 *     board that does not contain them. Fabricated listings are worse than an
 *     error: a user can apply to a job that does not exist. Failures are now
 *     reported as failures.
 *
 * Results come from our own `jobs` table with real filtering, sorting and
 * pagination. Greenhouse ingestion belongs in a scheduled job that writes into
 * that table, not in the read path.
 */

const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20

export interface JobSearchResult {
  id: string
  title: string
  company: string
  company_logo_url: string | null
  location: string | null
  type: string | null
  work_type: string | null
  salary: string | null
  experience: string | null
  posted_time: string | null
  description: string | null
  job_link: string | null
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const q = (searchParams.get("q") || "").trim()
  const location = (searchParams.get("location") || "").trim()
  const workType = (searchParams.get("workType") || "").trim()
  const jobType = (searchParams.get("type") || "").trim()

  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE)
  )
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  try {
    const supabase = getSupabaseServerClient()

    let query = supabase
      .from("jobs")
      .select(
        "id,title,company,company_logo_url,location,type,work_type,salary,experience,posted_time,description,job_link",
        { count: "exact" }
      )

    if (q) {
      // Escape PostgREST's or() delimiters so a search for "a,b" or "x)" cannot
      // change the shape of the filter expression.
      const safe = q.replace(/[,()\\]/g, " ").trim()
      if (safe) {
        query = query.or(
          `title.ilike.%${safe}%,company.ilike.%${safe}%,description.ilike.%${safe}%`
        )
      }
    }
    if (location) {
      const safe = location.replace(/[,()\\]/g, " ").trim()
      if (safe) query = query.ilike("location", `%${safe}%`)
    }
    if (workType && workType !== "any") query = query.ilike("work_type", `%${workType}%`)
    if (jobType && jobType !== "any") query = query.ilike("type", `%${jobType}%`)

    const { data, error, count } = await query
      .order("posted_time", { ascending: false, nullsFirst: false })
      .range(from, to)

    if (error) {
      console.error("Job search failed:", error)
      return NextResponse.json(
        { success: false, error: "Job search is temporarily unavailable" },
        { status: 503 }
      )
    }

    const total = count ?? 0
    return NextResponse.json({
      success: true,
      jobs: (data ?? []) as JobSearchResult[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: from + (data?.length ?? 0) < total,
    })
  } catch (error) {
    console.error("Error fetching jobs:", error)
    // No invented listings. An empty, explicitly-failed response lets the UI
    // show a retry state instead of pretending it has results.
    return NextResponse.json(
      { success: false, error: "Job search is temporarily unavailable" },
      { status: 503 }
    )
  }
}
