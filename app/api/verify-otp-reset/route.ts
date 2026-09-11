import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { timingSafeEqual } from 'crypto';
import { findUserByEmail, getServiceClient, supabaseUnavailable } from '@/lib/supabase-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { validatePassword } from '@/lib/validation';

export const runtime = 'nodejs';

// Built per request, never at module scope: `createClient(undefined!, ...)`
// throws while Next collects page data during `next build`, so one missing env
// var made the whole app unbuildable. See lib/supabase-admin.ts.
const supabase = getServiceClient();

/** Max wrong OTP guesses before the code is burned. */
const MAX_OTP_ATTEMPTS = 5;

function getClientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for') || ''
  const ip = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  return ip
}

/**
 * Compare two OTPs without leaking their contents through timing. Lengths are
 * compared first because timingSafeEqual throws on a length mismatch.
 */
function otpMatches(expected: string, supplied: string): boolean {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Configuration absent -> this endpoint is unavailable, and says so. Every
  // other route, including all of job search, is unaffected.
  if (!supabase) return supabaseUnavailable()

  const { email, otp, newPassword } = await req.json();
  if (!email || !otp || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const ip = getClientIp(req);

  // A six-digit code is only 10^6 wide, so verification MUST be rate limited or
  // it can simply be enumerated. Limit by email and by IP.
  if (checkRateLimit(`verify-otp:email:${normalizedEmail}`, { windowMs: 15 * 60 * 1000, max: 10 })) {
    return NextResponse.json(
      { error: 'Too many attempts. Please request a new code and try again later.' },
      { status: 429 }
    );
  }
  if (checkRateLimit(`verify-otp:ip:${ip}`, { windowMs: 60 * 60 * 1000, max: 50 })) {
    return NextResponse.json(
      { error: 'Too many attempts from this network. Try again later.' },
      { status: 429 }
    );
  }

  // Enforce the same password policy the client shows, server-side. The client
  // check is a convenience; this is the one that counts.
  const passwordCheck = validatePassword(String(newPassword), true);
  if (!passwordCheck.isValid) {
    return NextResponse.json(
      { error: passwordCheck.errors[0] || 'Password does not meet the requirements.' },
      { status: 400 }
    );
  }

  // 1. Check OTP
  const { data, error } = await supabase
    .from('otp_resets')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
  }

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('otp_resets').delete().eq('email', normalizedEmail);
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
  }

  if (!otpMatches(data.otp, String(otp))) {
    // Burn the code after repeated failures so a slow drip cannot enumerate it.
    const attempts = (data.attempts ?? 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await supabase.from('otp_resets').delete().eq('email', normalizedEmail);
    } else {
      await supabase.from('otp_resets').update({ attempts }).eq('email', normalizedEmail);
    }
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
  }

  // 2. Look up the user by email.
  //
  // This previously called listUsers({ email }). supabase-js takes only
  // { page, perPage } there and silently ignores unknown keys, so that returned
  // the first page of ALL users and users[0] was an arbitrary account -- the
  // reset then changed the wrong user's password. Resolve the address properly.
  const user = await findUserByEmail(supabase, normalizedEmail);
  if (!user) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
  }
  const userId = user.id;

  // 3. Update password (admin API)
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updateError) {
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }

  // 4. Delete OTP entry so the code is single-use
  await supabase.from('otp_resets').delete().eq('email', normalizedEmail);

  // 5. Send confirmation email using Resend
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'jobspark@resend.dev',
      to: user.email!,
      subject: 'Your JobSpark AI password was changed',
      text: `Hello,\n\nYour password for JobSpark AI was successfully changed. If you did not perform this action, please contact support immediately.\n\nIf this was you, you can now log in with your new password.`,
    });
  } catch (e) {
    console.error('Failed to send confirmation email:', e);
    // Don't fail the reset if email fails, but log or handle as needed
  }

  // 6. Audit log (best-effort)
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'password_reset',
      details: { email: normalizedEmail, ip },
    })
  } catch {}

  return NextResponse.json({ success: true, message: 'Password successfully changed. Confirmation email sent.' });
}
