import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle /docs routes by proxying to the API route
  // In development, avoid proxying to prevent Next.js HMR conflicts between two dev servers.
  // We will render an iframe page at /docs that points to the Mintlify dev server instead.
  if (process.env.NODE_ENV === 'production' && pathname.startsWith('/docs')) {
    // Remove /docs prefix and proxy to /api/docs
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
