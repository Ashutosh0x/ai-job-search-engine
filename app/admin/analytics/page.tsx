import type { Metadata } from "next"
import AnalyticsDashboard from "@/components/admin/analytics-dashboard"

/**
 * Admin analytics.
 *
 * The page shell is public; the DATA is not. Authorisation lives on
 * /api/admin/analytics, which verifies the Supabase session server-side and
 * answers 404 to anyone who is not on the ADMIN_EMAILS allowlist.
 *
 * Gating the route itself as well would be defence in depth, but it cannot be
 * the primary control: middleware.ts can only see whether an auth cookie exists,
 * not whose it is or whether that person is an admin. Putting the real check at
 * the data boundary means there is exactly one place to get it right, and no way
 * to reach the numbers by loading the shell directly.
 */
export const metadata: Metadata = {
  title: "Analytics",
  // An internal tool has no reason to be in an index, and every reason not to.
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default function AdminAnalyticsPage() {
  return <AnalyticsDashboard />
}
