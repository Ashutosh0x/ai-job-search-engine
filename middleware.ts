import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Protected routes that require authentication.
 * Unauthenticated visitors are redirected to /login.
 *
 * `/resume` is here because it stores uploads and analysis history against an
 * account. `/resume-builder` is deliberately NOT: it keeps nothing, and
 * /api/resume/build is already unauthenticated on the same reasoning -- a
 * resume should never have to be uploaded, or an account created, to find out
 * how it matches a posting.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/resume',
  '/preferences',
];

/**
 * Match on whole path segments, not raw string prefixes.
 *
 * `pathname.startsWith('/resume')` is true for '/resume-builder' and for any
 * future '/resumes' or '/resume-tips', so dropping a route from the list above
 * would not actually unprotect it -- a shorter entry keeps matching. Requiring
 * the next character to be '/' (or end of path) makes this list mean what it
 * appears to mean.
 */
function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
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

  // ── Docs proxy ───────────────────────────────────────────────────
  //
  // This used to fire on `NODE_ENV === 'production'`, which is backwards. The
  // thing it rewrites to is a proxy for a LOCAL Mintlify dev server
  // (`npx mintlify dev --port 3001`) -- it even rewrites HMR asset paths. On
  // Vercel there is no localhost:3001, so every /docs request in production hit
  // a dead proxy while /docs in development was never rewritten at all. The
  // deployed site answered 404 on the entire documentation section.
  //
  // The proxy is now opt-in on an explicitly configured origin. With
  // DOCS_PROXY_ORIGIN unset -- the normal production case -- /docs is left
  // alone rather than rewritten into something that cannot work.
  if (process.env.DOCS_PROXY_ORIGIN && pathname.startsWith('/docs')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace('/docs', '/api/docs');
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

