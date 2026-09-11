import { getServiceClient, supabaseUnavailable } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { randomInt } from 'crypto';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Built per request, never at module scope: `createClient(undefined!, ...)`
// throws while Next collects page data during `next build`, so one missing env
// var made the whole app unbuildable. See lib/supabase-admin.ts.
const supabase = getServiceClient();

function getClientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for') || ''
  const ip = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  return ip
}

function generateOTP() {
  // Math.random() is not a CSPRNG: its output is predictable from prior values,
  // which for an account-recovery code means it can be guessed rather than
  // brute-forced. randomInt() draws from the OS entropy source.
  return randomInt(100000, 1000000).toString();
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
  // Configuration absent -> this endpoint is unavailable, and says so. Every
  // other route, including all of job search, is unaffected.
  if (!supabase) return supabaseUnavailable()

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
  const normalizedEmail = String(email).trim().toLowerCase()
  if (checkRateLimit(`request-otp:email:${normalizedEmail}`, { windowMs: 10 * 60 * 1000, max: 5 })) {
    return NextResponse.json({ error: 'Too many OTP requests for this email. Try again later.' }, { status: 429 })
  }
  if (checkRateLimit(`request-otp:ip:${ip}`, { windowMs: 60 * 60 * 1000, max: 20 })) {
    return NextResponse.json({ error: 'Too many requests from this IP. Try again later.' }, { status: 429 })
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  // Upsert OTP
  const { error: upsertError } = await supabase
    .from('otp_resets')
    .upsert({ email: normalizedEmail, otp, expires_at: expiresAt, attempts: 0 });

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to store OTP' }, { status: 500 });
  }

  // Send OTP email using Resend
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'jobspark@resend.dev',
      to: normalizedEmail,
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
      details: { email: normalizedEmail, ip },
    })
  } catch {}

  return NextResponse.json({ success: true });
}
