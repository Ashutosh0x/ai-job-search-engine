import { NextRequest, NextResponse } from 'next/server';

const MINTLIFY_SERVER = 'http://localhost:3001';

function buildTargetUrl(request: NextRequest, params: { path: string[] }) {
  const path = params.path?.join('/') || '';
  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const targetUrl = `${MINTLIFY_SERVER}/${path}${searchParams ? `?${searchParams}` : ''}`;
  return targetUrl;
}

function forwardHeaders(request: NextRequest) {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'host') return;
    headers.set(key, value);
  });
  headers.set('X-Forwarded-Host', request.headers.get('host') || 'localhost:3000');
  headers.set('X-Forwarded-Proto', 'http');
  headers.set('Connection', 'keep-alive');
  return headers;
}

async function proxy(request: NextRequest, context: { params: { path: string[] } }) {
  const targetUrl = buildTargetUrl(request, context.params);
  const method = request.method;
  const headers = forwardHeaders(request);

  let body: BodyInit | undefined = undefined;
  if (!['GET', 'HEAD'].includes(method)) {
    // Forward body as-is for non-GET/HEAD
    body = request.body as any;
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
      // Important for streaming (HMR, RSC, SSE)
      duplex: 'half' as any,
    } as RequestInit);

    // For HTML, rewrite absolute links to the proxied path to avoid cross-origin fetches
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const rewritten = html
        // absolute dev origin → proxied base
        .replaceAll('http://localhost:3001', '/docs')
        .replaceAll('http://127.0.0.1:3001', '/docs')
        // ensure Next assets and paths go through /docs
        .replaceAll('href="/_next/', 'href="/docs/_next/')
        .replaceAll('src="/_next/', 'src="/docs/_next/')
        .replaceAll('fetch("/_next/', 'fetch("/docs/_next/')
        .replaceAll("fetch('/_next/", "fetch('/docs/_next/");

      const headersOut = new Headers(response.headers);
      headersOut.set('Cache-Control', 'no-store');
      headersOut.set('Content-Type', 'text/html; charset=utf-8');
      headersOut.delete('Content-Length'); // changed body size
      return new NextResponse(rewritten, { status: response.status, headers: headersOut });
    }

    // Stream all other content (RSC, HMR, JS, CSS, images, SSE)
    const headersOut = new Headers(response.headers);
    return new NextResponse(response.body, {
      status: response.status,
      headers: headersOut,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new NextResponse('Mintlify server is not reachable. Ensure it is running: npx mintlify dev --port 3001', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

export async function GET(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function POST(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function PUT(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function PATCH(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function DELETE(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function HEAD(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
export async function OPTIONS(request: NextRequest, context: { params: { path: string[] } }) {
  return proxy(request, context);
}
