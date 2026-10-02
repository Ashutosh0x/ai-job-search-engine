import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
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
    // The link is EMAILED to the address, never returned to the caller.
    //
    // This route used to call auth.admin.generateLink({ type: 'recovery' }) and
    // answer `{ link: action_link }`, which components/auth-form.tsx rendered as
    // a clickable "reset your password" link. A recovery link signs its holder
    // in as that user, and the only gates were a CAPTCHA and a per-email/IP
    // limit -- nothing tied the caller to the mailbox. Typing someone else's
    // email was enough to take over their account.
    //
    // resetPasswordForEmail sends the same recovery link through Supabase's
    // mailer to the address itself, so only its owner can use it.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password`,
    });
    if (error) {
      // Logged, not returned: the answer must not reveal whether an account
      // exists for this address.
      console.error('Magic link email failed:', error.message);
    }
    // Best-effort audit log
    try {
      await supabase.from('audit_logs').insert({
        user_id: null,
        action: 'magic_link_emailed',
        details: { email, ip },
      });
    } catch {}
    return NextResponse.json({
      ok: true,
      message: 'If an account exists for that email, a sign-in link is on its way. Check your inbox.',
    });
  } catch (e) {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
