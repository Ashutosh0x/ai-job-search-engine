import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Basic in-memory rate limiting
const attemptsByEmail = new Map<string, number[]>();
const attemptsByIp = new Map<string, number[]>();

function recordAndCheck(store: Map<string, number[]>, key: string, windowMs: number, max: number) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = store.get(key) || [];
  const recent = arr.filter((t) => t > cutoff);
  if (recent.length >= max) return true;
  recent.push(now);
  store.set(key, recent);
  return false;
}

function getClientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

async function verifyTurnstileToken(req: NextRequest, tokenFromBody?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  const token = tokenFromBody || req.headers.get('cf-turnstile-response') || ''
  if (!secret || !token) return process.env.NODE_ENV !== 'production'
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    })
    const data = await res.json()
    return !!data.success
  } catch {
    return false
  }
}

/**
 * Build the client per request, not at module scope.
 *
 * `createClient(undefined!, undefined!)` throws immediately, and at module
 * scope that throw happens while Next collects page data during `next build` --
 * so ONE missing environment variable made the entire application unbuildable,
 * with an error naming this route rather than the missing config. It built
 * locally only because .env.local happened to be present.
 *
 * A route that needs configuration it does not have should fail at request
 * time, as a 503 that names the problem, and leave every other route working.
 */
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      {
        error: 'Magic-link sign-in is not configured',
        detail:
          'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for this endpoint.',
      },
      { status: 503 }
    );
  }

  const { email, turnstileToken } = await req.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const captchaOk = await verifyTurnstileToken(req, turnstileToken)
  if (!captchaOk) {
    return NextResponse.json({ error: 'Captcha verification failed' }, { status: 400 })
  }

  const ip = getClientIp(req);
  if (recordAndCheck(attemptsByEmail, email.toLowerCase(), 10 * 60 * 1000, 5)) {
    return NextResponse.json({ error: 'Too many requests for this email. Try again later.' }, { status: 429 });
  }
  if (recordAndCheck(attemptsByIp, ip, 60 * 60 * 1000, 20)) {
    return NextResponse.json({ error: 'Too many requests from this IP. Try again later.' }, { status: 429 });
  }

  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password`,
      },
    });
    const actionLink = data?.properties?.action_link;
    if (error || !actionLink) {
      return NextResponse.json({ error: error?.message || 'Failed to generate magic link' }, { status: 500 });
    }
    // Best-effort audit log
    try {
      await supabase.from('audit_logs').insert({
        user_id: null,
        action: 'magic_link_generated',
        details: { email, ip },
      });
    } catch {}
    return NextResponse.json({ link: actionLink });
  } catch (e) {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
