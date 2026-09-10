import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Use service role on the server for privileged operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Simple in-memory rate limiter (best-effort; use Redis/Upstash in production)
type WindowConfig = { windowMs: number; max: number }
const emailAttempts = new Map<string, number[]>()
const ipAttempts = new Map<string, number[]>()

function isRateLimited(key: string, store: Map<string, number[]>, cfg: WindowConfig) {
  const now = Date.now()
  const cutoff = now - cfg.windowMs
  const arr = store.get(key) || []
  const recent = arr.filter((t) => t > cutoff)
  if (recent.length >= cfg.max) return true
  recent.push(now)
  store.set(key, recent)
  return false
}

function getClientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for') || ''
  const ip = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  return ip
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function verifyTurnstileToken(req: NextRequest, tokenFromBody?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  const token = tokenFromBody || req.headers.get('cf-turnstile-response') || ''
  // In development, allow missing token to simplify local testing
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

export async function POST(req: NextRequest) {
  const { email, turnstileToken } = await req.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Verify Turnstile (blocks bots)
  const captchaOk = await verifyTurnstileToken(req, turnstileToken)
  if (!captchaOk) {
    return NextResponse.json({ error: 'Captcha verification failed' }, { status: 400 })
  }

  // Basic rate limits
  const ip = getClientIp(req)
  if (isRateLimited(email.toLowerCase(), emailAttempts, { windowMs: 10 * 60 * 1000, max: 5 })) {
    return NextResponse.json({ error: 'Too many OTP requests for this email. Try again later.' }, { status: 429 })
  }
  if (isRateLimited(ip, ipAttempts, { windowMs: 60 * 60 * 1000, max: 20 })) {
    return NextResponse.json({ error: 'Too many requests from this IP. Try again later.' }, { status: 429 })
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  // Upsert OTP
  const { error: upsertError } = await supabase
    .from('otp_resets')
    .upsert({ email, otp, expires_at: expiresAt });

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to store OTP' }, { status: 500 });
  }

  // Send OTP email using Resend
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    await resend.emails.send({
      from: 'jobspark@resend.dev',
      to: email,
      subject: 'Your JobSpark AI OTP Code',
      text: `Your OTP code is: ${otp}\nIt is valid for 10 minutes. If you did not request this, please ignore this email.`,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to send OTP email' }, { status: 500 });
  }

  // Audit log (best-effort)
  try {
    await supabase.from('audit_logs').insert({
      user_id: null,
      action: 'request_otp',
      details: { email, ip },
    })
  } catch {}

  return NextResponse.json({ success: true });
}
