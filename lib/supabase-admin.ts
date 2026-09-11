import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Resolve a single auth user by email address.
 *
 * `auth.admin.listUsers()` accepts only `{ page, perPage }`. Passing
 * `{ email }` does not filter -- unknown keys are ignored, so the call returns
 * the first page of every user in the project. Reading `users[0]` from that is
 * how a password reset can land on somebody else's account.
 *
 * `getUserByEmail` does not exist in supabase-js v2 either, so page through
 * explicitly and match the address ourselves. Comparison is case-insensitive
 * because Supabase stores addresses lowercased but callers may not.
 */
export async function findUserByEmail(
  supabase: SupabaseClient,
  email: string,
  { maxPages = 20, perPage = 200 }: { maxPages?: number; perPage?: number } = {}
): Promise<User | null> {
  const target = email.trim().toLowerCase()

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const users = data?.users ?? []
    const found = users.find((u) => (u.email ?? '').toLowerCase() === target)
    if (found) return found

    // A short page means we've reached the end of the list.
    if (users.length < perPage) break
  }

  return null
}

/* -------------------------------------------------------------------------- */

import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client, built lazily and never at module scope.
 *
 * WHY THIS EXISTS
 * ---------------
 * Six API routes each did some variant of:
 *
 *     const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)
 *
 * at module scope. `createClient(undefined!, undefined!)` throws immediately,
 * and Next evaluates route modules while collecting page data during
 * `next build` -- so ONE missing environment variable made the ENTIRE
 * application unbuildable, reporting a route name rather than the missing
 * config. It built locally only because .env.local happened to be present.
 *
 * Returning null instead lets a route answer 503 for itself and leaves every
 * other route working. Configuration that is absent should disable a feature,
 * not the build.
 *
 * The key bypasses row-level security, so any caller holding this client must
 * do its own ownership checks -- see app/api/analyze-resume for the pattern.
 */
export function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/** Standard 503 for a route whose Supabase configuration is missing. */
export function supabaseUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: 'This feature is not configured',
      detail:
        'NEXT_PUBLIC_SUPABASE_URL and a Supabase key are required for this endpoint. ' +
        'Job search does not depend on them and is unaffected.',
    }),
    { status: 503, headers: { 'content-type': 'application/json' } }
  )
}
