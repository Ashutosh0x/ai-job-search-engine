import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Protected routes that require authentication.
 * Unauthenticated visitors are redirected to /login.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/resume',
  '/resume-builder',
  '/preferences',
];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Auth guard for protected routes ──────────────────────────────
  // Check for the Supabase auth token in cookies. The anon client stores
  // the session in `sb-<ref>-auth-token`. We check for any cookie whose
  // name contains "auth-token" to remain config-agnostic.
  if (isProtectedRoute(pathname)) {
    const hasAuthCookie = [...request.cookies.getAll()].some(
      (c) => c.name.includes('auth-token') && c.value.length > 10
    );

    if (!hasAuthCookie) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Docs proxy (production only) ─────────────────────────────────
  if (process.env.NODE_ENV === 'production' && pathname.startsWith('/docs')) {
    const newPathname = pathname.replace('/docs', '/api/docs');
    const url = request.nextUrl.clone();
    url.pathname = newPathname;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

