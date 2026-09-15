import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedUser } from '../api-auth'

/**
 * Admin authorisation for the analytics surface.
 *
 * WHY THIS HAD TO BE WRITTEN
 * --------------------------
 * There was no admin authorisation in this project to reuse. Audited before
 * building: no /admin route existed, `requireUser()` only answers "is there a
 * signed-in user", and the sole admin artefact was one RLS policy,
 * supabase/migrations/20250806124748_jobs-rls-admin-only.sql:
 *
 *     USING (EXISTS (SELECT 1 FROM auth.users u
 *                    WHERE u.id = auth.uid() AND u.role = 'admin'))
 *
 * `auth.users.role` in Supabase is the Postgres role the request runs as -- it
 * is 'authenticated' for every signed-in user and 'anon' otherwise. It is never
 * 'admin'. That policy therefore matches NOBODY, which means it reads as an
 * access control and functions as a deny-all. It is not something to build on.
 *
 * THIS IS AUTHORISATION, NOT A SECOND AUTHENTICATION SYSTEM
 * ---------------------------------------------------------
 * Identity still comes from the existing Supabase session, verified against the
 * auth server by lib/api-auth.ts. This adds only the question "is that verified
 * identity an administrator", answered by an explicit allowlist of email
 * addresses in ADMIN_EMAILS.
 *
 * An allowlist rather than a database role because the database is the thing
 * being reported on and, at the time of writing, is unreachable -- an
 * authorisation check that fails open when the database is down is not an
 * authorisation check. An environment variable is available to every instance,
 * costs no round trip, and cannot be edited by anyone who compromises an account.
 *
 * FAIL CLOSED
 * -----------
 * With ADMIN_EMAILS unset, NOBODY is an admin and the dashboard is unreachable.
 * The alternative -- treating "unconfigured" as "open" -- would publish every
 * visitor's search history the first time someone deployed without reading the
 * docs.
 */

/** Parsed once; a comma or whitespace separated list, compared case-insensitively. */
function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? ''
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export interface AdminCheck {
  ok: boolean
  /** Why access was refused, for logging. Never returned to the caller. */
  reason?: 'not_configured' | 'not_authenticated' | 'not_admin'
  email?: string
}

export async function checkAdmin(req: NextRequest): Promise<AdminCheck> {
  const allowed = adminEmails()
  if (allowed.size === 0) return { ok: false, reason: 'not_configured' }

  const user = await getAuthenticatedUser(req)
  if (!user) return { ok: false, reason: 'not_authenticated' }

  const email = (user.email ?? '').toLowerCase()
  /**
   * A verified address only.
   *
   * Supabase lets an account exist with an unverified address, and some flows
   * allow setting one without proving control of it. Admitting an unverified
   * address would let anyone who can type an admin's email into a signup form
   * become an admin.
   */
  const verified = Boolean(user.email_confirmed_at ?? (user as { confirmed_at?: string }).confirmed_at)
  if (!email || !verified) return { ok: false, reason: 'not_admin', email }

  return allowed.has(email) ? { ok: true, email } : { ok: false, reason: 'not_admin', email }
}

/**
 * Guard for an admin API route.
 *
 *   const denied = await requireAdmin(req)
 *   if (denied) return denied
 *
 * Answers 404, not 403, for an authenticated non-admin.
 *
 * A 403 confirms the route exists and that admin analytics are available here,
 * which is a free hint to anyone probing. 404 tells them nothing they did not
 * already have. The real reason is logged server-side, so operators debugging
 * their own access are not left guessing.
 */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const check = await checkAdmin(req)
  if (check.ok) return null

  if (check.reason === 'not_configured') {
    console.warn(
      '[admin] ADMIN_EMAILS is not set, so no one can reach the analytics dashboard. ' +
        'Set it to a comma-separated list of verified admin email addresses.',
    )
  } else {
    console.warn(`[admin] denied (${check.reason})${check.email ? ` for ${check.email}` : ''}`)
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** Is admin access configured at all? Used by the UI to explain a dead dashboard. */
export function isAdminConfigured(): boolean {
  return adminEmails().size > 0
}
