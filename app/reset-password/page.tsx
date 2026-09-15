"use client"
import React, { Suspense, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Navigation from "@/components/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClientSafe } from "@/lib/supabase";

/**
 * Resolved inside the component, not at module scope.
 *
 * Next prerenders this page at build time, and a module-scope
 * `createClient(undefined!, undefined!)` throws "supabaseUrl is required"
 * during that prerender -- failing the whole build on a host that has not been
 * given Supabase env vars, even though every other page is fine.
 *
 * `getSupabaseClientSafe()` is already a lazy singleton; calling it from an event
 * handler defers construction to the browser, where the public env var is
 * inlined and actually present.
 */

/**
 * `useSearchParams` must sit under a Suspense boundary.
 *
 * Without one Next fails the build with `missing-suspense-with-csr-bailout`.
 * This page hit it the moment server rendering was restored: the root layout
 * used to return null on the server for every route, so nothing here was ever
 * prerendered and the error had no opportunity to fire. Fixing SSR surfaced it
 * rather than caused it.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

/** The page's own frame, so the layout does not shift when the form resolves. */
function ResetPasswordSkeleton() {
  return (
    <>
      <Navigation />
      <div className="min-h-screen flex">
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900" />
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md space-y-4">
            <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          </div>
        </div>
      </div>
    </>
  );
}

function ResetPasswordForm() {
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLinkMode, setMagicLinkMode] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Detect magic link mode
  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const type = searchParams.get('type');
    if (accessToken && type === 'recovery') {
      setMagicLinkMode(true);
    } else {
      setMagicLinkMode(false);
    }
  }, [searchParams]);

  // Load Turnstile script
  useEffect(() => {
    if (!magicLinkMode && typeof window !== 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        setTimeout(() => {
          const turnstileElement = document.querySelector('.cf-turnstile');
          if (turnstileElement && (window as any).turnstile) {
            (window as any).turnstile.render(turnstileElement, {
              sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
              callback: (token: string) => setTurnstileToken(token),
            });
          }
        }, 100);
      };
      document.head.appendChild(script);

      return () => {
        const existingScript = document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
        if (existingScript) {
          existingScript.remove();
        }
      };
    }
  }, [magicLinkMode]);

  // Magic link: set new password
  async function handleMagicLinkReset(e: React.FormEvent) {
    e.preventDefault();
    setMagicLinkLoading(true);
    setError('');
    setMessage('');
    const accessToken = searchParams.get('access_token');
    if (!accessToken) {
      setError('Invalid or expired reset link.');
      setMagicLinkLoading(false);
      return;
    }
    // Use Supabase to update password with access token
    const { error: updateError } = await getSupabaseClientSafe().auth.updateUser({
      password: newPassword,
    }, { accessToken });
    setMagicLinkLoading(false);
    if (updateError) {
      setError(updateError.message || 'Failed to reset password.');
    } else {
      setMessage('Password reset successful! You can now log in.');
      setTimeout(() => router.push('/login'), 2000);
    }
  }

  // OTP flow: request OTP
  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    
    if (!turnstileToken) {
      setError('Please complete the security check');
      setLoading(false);
      return;
    }
    
    const res = await fetch('/api/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setMessage('OTP sent to your email.');
      setStep('verify');
    } else {
      setError(data.error || 'Failed to send OTP.');
    }
  }

  // OTP flow: verify OTP and reset password
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    const res = await fetch('/api/verify-otp-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword }),
    });
    // Typed, because `{}` makes every property access an error and that is what
    // `ignoreBuildErrors` was hiding here.
    let data: { success?: boolean; error?: string } = {};
    try {
      data = await res.json();
    } catch (e) {
      setError('Unexpected server error. Please try again.');
      setLoading(false);
      return;
    }
    setLoading(false);
    if (data.success) {
      setMessage('Password reset successful! You can now log in.');
      setStep('request');
      setEmail('');
      setOtp('');
      setNewPassword('');
    } else {
      setError(data.error || 'Failed to reset password.');
    }
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen flex">
        {/* Left Side - Image/Gradient */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 items-center justify-center p-8 xl:p-12">
          <div className="text-center space-y-6">
            <h2 className="text-3xl xl:text-4xl font-bold text-white">
              Reset Your Password
            </h2>
            <p className="text-purple-200 text-lg max-w-md">
              {magicLinkMode
                ? 'Set a new password for your account.'
                : 'Enter your email to receive a 6-digit OTP and set a new password for your account.'}
            </p>
          </div>
        </div>
        {/* Right Side - Form */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md space-y-6">
            <Link
              href="/login"
              className="inline-flex items-center text-gray-400 hover:text-white mb-6 sm:mb-8"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Login
            </Link>
            <Card className="card-glow">
              <CardHeader className="text-center px-4 sm:px-6">
                <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                  Reset Password
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  {magicLinkMode
                    ? 'Enter your new password below.'
                    : step === 'request'
                    ? 'Enter your email to receive a 6-digit OTP.'
                    : 'Enter the OTP sent to your email and your new password.'}
                </p>
              </CardHeader>
              <CardContent className="space-y-6 px-4 sm:px-6">
                {message && (
                  <div className="p-3 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-800 rounded-lg flex items-center space-x-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-green-700 dark:text-green-400 text-sm">{message}</span>
                  </div>
                )}
                {error && (
                  <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                    <span className="text-red-700 dark:text-red-400 text-sm">{error}</span>
                  </div>
                )}
                {magicLinkMode ? (
                  <form className="space-y-4" onSubmit={handleMagicLinkReset}>
                    <div className="relative">
                      <Input
                        type="password"
                        placeholder="New Password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        required
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full btn-primary h-12 text-base"
                      disabled={magicLinkLoading}
                    >
                      {magicLinkLoading ? 'Resetting...' : 'Set New Password'}
                    </Button>
                  </form>
                ) : step === 'request' ? (
                  <form className="space-y-4" onSubmit={handleRequestOtp}>
                    <div className="relative">
                      <Input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      />
                    </div>
                    <div className="flex justify-center">
                      <div className="cf-turnstile"></div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full btn-primary h-12 text-base"
                      disabled={loading}
                    >
                      {loading ? 'Sending OTP...' : 'Send OTP'}
                    </Button>
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={handleVerifyOtp}>
                    <div className="relative">
                      <Input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                        disabled
                      />
                    </div>
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder="6-digit OTP"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        required
                        maxLength={6}
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      />
                    </div>
                    <div className="relative">
                      <Input
                        type="password"
                        placeholder="New Password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        required
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full btn-primary h-12 text-base"
                      disabled={loading}
                    >
                      {loading ? 'Resetting...' : 'Reset Password'}
                    </Button>
                  </form>
                )}
                {!magicLinkMode && step === 'verify' && (
                  <Button
                    type="button"
                    onClick={() => setStep('request')}
                    className="w-full mt-2"
                    variant="secondary"
                  >
                    Back to Request OTP
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
} 