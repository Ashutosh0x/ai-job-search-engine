import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Needs service role for admin password update
);

function getClientIp(req: NextRequest) {
  const xff = req.headers.get('x-forwarded-for') || ''
  const ip = xff.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  return ip
}

export async function POST(req: NextRequest) {
  const { email, otp, newPassword } = await req.json();
  if (!email || !otp || !newPassword) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // 1. Check OTP
  const { data, error } = await supabase
    .from('otp_resets')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 400 });
  }

  if (data.otp !== otp) {
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'OTP expired' }, { status: 400 });
  }

  // 2. Look up user by email to get their ID
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers({ email });
  if (userError || !userData || !userData.users || userData.users.length === 0) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const userId = userData.users[0].id;

  // 3. Update password (admin API)
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updateError) {
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }

  // 4. Delete OTP entry
  await supabase.from('otp_resets').delete().eq('email', email);

  // 5. Send confirmation email using Resend
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    await resend.emails.send({
      from: 'jobspark@resend.dev',
      to: email,
      subject: 'Your JobSpark AI password was changed',
      text: `Hello,\n\nYour password for JobSpark AI was successfully changed. If you did not perform this action, please contact support immediately.\n\nIf this was you, you can now log in with your new password.`,
    });
  } catch (e) {
    console.error('Failed to send confirmation email:', e);
    // Don't fail the reset if email fails, but log or handle as needed
  }

  // 6. Audit log (best-effort)
  try {
    const ip = getClientIp(req)
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'password_reset',
      details: { email, ip },
    })
  } catch {}

  return NextResponse.json({ success: true, message: 'Password successfully changed. Confirmation email sent.' });
}
