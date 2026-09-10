import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Resolve the caller's identity from their Supabase access token.
 *
 * Several routes used to take a `userId` from the request body or form data and
 * then act on it with the service-role key, which bypasses RLS. That let anyone
 * upload a resume as another user, read another user's analysis, or start a
 * checkout for another account. Identity must come from a signed token, never
 * from the request payload.
 *
 * The token is read from `Authorization: Bearer <token>` or the `sb-access-token`
 * cookie, and validated against Supabase.
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const header = req.headers.get('authorization') || req.headers.get('Authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const token = bearer || req.cookies.get('sb-access-token')?.value || ''

  if (!token) return null

  // A per-request client carrying the caller's token: getUser() then verifies it
  // against the auth server rather than trusting anything we were handed.
  const scoped: SupabaseClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await scoped.auth.getUser()
  if (error || !data?.user) return null
  return data.user
}

/** 401 response used by every route that requires a signed-in caller. */
export function unauthorized(message = 'Authentication required') {
  return NextResponse.json({ error: message }, { status: 401 })
}

/**
 * Guard helper: returns the user, or a ready-to-return 401 response.
 *
 *   const auth = await requireUser(req)
 *   if ('response' in auth) return auth.response
 *   const user = auth.user
 */
export async function requireUser(
  req: NextRequest
): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getAuthenticatedUser(req)
  if (!user) return { response: unauthorized() }
  return { user }
}
