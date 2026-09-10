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
