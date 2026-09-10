import { NextResponse } from "next/server"

interface GreenhouseJob {
  id: number
  title: string
  location: string
  department: string
  absolute_url: string
}

export async function GET() {
  try {
    const response = await fetch("https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=true", {
      headers: {
        Accept: "application/json",
        "User-Agent": "JobSpark-AI/1.0",
      },
      // Add cache control to prevent too frequent requests
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch jobs: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // The Greenhouse API returns jobs directly as an array, not wrapped in a jobs property
    const jobs: GreenhouseJob[] = Array.isArray(data) ? data : []

    // Ensure all job properties are strings to prevent rendering objects
    const sanitizedJobs = jobs.map((job) => ({
      id: Number(job.id) || 0,
      title: String(job.title || "Untitled Position"),
      location: String(job.location || "Location TBD"),
      department: String(job.department || "General"),
      absolute_url: String(job.absolute_url || "#"),
    }))

    return NextResponse.json({
      success: true,
      jobs: sanitizedJobs,
      total: sanitizedJobs.length,
    })
  } catch (error) {
    console.error("Error fetching jobs:", error)

    // Return fallback data in case of API failure
    const fallbackJobs: GreenhouseJob[] = [
      {
        id: 1,
        title: "Software Engineer",
        location: "San Francisco, CA",
        department: "Engineering",
        absolute_url: "https://boards.greenhouse.io/cloudflare",
      },
      {
        id: 2,
        title: "Product Manager",
        location: "Austin, TX",
        department: "Product",
        absolute_url: "https://boards.greenhouse.io/cloudflare",
      },
      {
        id: 3,
        title: "Sales Engineer",
        location: "Remote - US",
        department: "Sales",
        absolute_url: "https://boards.greenhouse.io/cloudflare",
      },
    ]

    return NextResponse.json({
      success: true,
      jobs: fallbackJobs,
      total: fallbackJobs.length,
      fallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
