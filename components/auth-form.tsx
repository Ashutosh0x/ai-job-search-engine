"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Chrome, Linkedin, Mail, Lock, User, ArrowLeft, Check, X } from "lucide-react"
import Link from "next/link"
import Navigation from "@/components/navigation"
import { useRouter } from "next/navigation"
import { authService } from "@/lib/auth-service"
import { validateEmail, validatePassword, validateName } from "@/lib/validation"
import PasswordStrength from './password-strength';
import { useToast } from "@/components/toast-provider"
import { getSupabaseClient } from "@/lib/supabase"

interface AuthFormProps {
  mode: "login" | "signup" | "forgot-password"
}

export default function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const { addToast } = useToast()
  const [passwordValidation, setPasswordValidation] = useState(validatePassword("", true));
  const supabase = getSupabaseClient();
  const [magicLink, setMagicLink] = useState("");
  const [magicLinkError, setMagicLinkError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    if (mode === "signup") {
        const validation = validatePassword(password, true);
        setPasswordValidation(validation);
        if (!validation.checks.maxLength) {
            setError("Password must not exceed 20 characters");
        } else if (error === "Password must not exceed 20 characters") {
            setError("");
        }
    }
  }, [password, mode, error]);

  // Load Turnstile script and initialize widget
  useEffect(() => {
    if (mode === "forgot-password" && typeof window !== 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        // Initialize Turnstile widget after a short delay
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
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    if (!email) {
      setError("Email is required")
      setLoading(false)
      return
    }

    if (mode === "forgot-password" && !turnstileToken) {
      setError("Please complete the security check")
      setLoading(false)
      return
    }

    try {
      if (mode === "forgot-password") {
        // Use the new OTP API with Turnstile
        const response = await fetch("/api/request-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, turnstileToken }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          setError(data.error || "Failed to send OTP");
        } else {
          setSuccess("OTP sent to your email! Check your inbox.");
          addToast({
            title: "OTP Sent",
            description: "Check your email for the OTP code.",
            type: "success",
            duration: 10000,
          });
        }
      } else if (mode === "login") {
        const result = await authService.signIn(email, password)
        if (result.success && result.user) {
          localStorage.setItem("isAuthenticated", "true")
          localStorage.setItem("userEmail", result.user.email)
          localStorage.setItem("userName", result.user.full_name || "")
          localStorage.setItem("userId", result.user.id)
          addToast({
            title: "Login Successful",
            description: `Welcome back, ${result.user.full_name || result.user.email}!`,
            type: "success",
            duration: 10000,
          })
          setTimeout(() => router.push("/preferences"), 2000);
          // Audit log for login
          await supabase.from("audit_logs").insert({
            user_id: result.user.id,
            action: "login",
            details: { email: result.user.email },
            created_at: new Date().toISOString()
          })
        } else {
          setError(result.error || "Invalid credentials")
        }
      } else {
        const result = await authService.signUp(email, password, name)
        if (result.success && result.user) {
          localStorage.setItem("isAuthenticated", "true")
          localStorage.setItem("userEmail", result.user.email)
          localStorage.setItem("userName", result.user.full_name || "")
          localStorage.setItem("userId", result.user.id)
          addToast({
            title: "Signup Successful",
            description: `Welcome to JobSpark AI, ${result.user.full_name || result.user.email}!`,
            type: "success",
            duration: 10000,
          })
          setTimeout(() => router.push("/preferences"), 2000);
        } else {
          setError(result.error || "Signup failed")
        }
      }
    } catch (error) {
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleGetMagicLink() {
    setMagicLink("");
    setMagicLinkError("");
    if (!email) {
      setMagicLinkError("Please enter your email first.");
      return;
    }
    if (!turnstileToken) {
      setMagicLinkError("Please complete the security check");
      return;
    }
    try {
      const res = await fetch("/api/generate-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json();
      if (data.link) {
        setMagicLink(data.link);
      } else {
        setMagicLinkError(data.error || "Failed to generate magic link.");
      }
    } catch (e) {
      setMagicLinkError("Failed to generate magic link.");
    }
  }

  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/preferences",
      },
    });
  };

  const handleLinkedInSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "linkedin",
      options: {
        redirectTo: window.location.origin + "/preferences",
      },
    });
  };

  return (
    <>
      <Navigation />
      <div className="pt-16">
        <div className="min-h-screen flex">
          {/* Left Side - Image */}
          <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 items-center justify-center p-8 xl:p-12">
            <div className="text-center space-y-6">
              <h2 className="text-3xl xl:text-4xl font-bold text-white">
                {mode === "login" ? "Welcome Back!" : 
                 mode === "signup" ? "Join JobSpark AI" : 
                 "Reset Password"}
              </h2>
              <p className="text-purple-200 text-lg max-w-md">
                {mode === "login"
                  ? "Continue your journey to find the perfect job with AI assistance."
                  : mode === "signup"
                  ? "Start your AI-powered job search journey and land your dream role."
                  : "Don't worry, we'll help you get back to your account."}
              </p>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-md space-y-6">
              <Link
                href="/"
                className="inline-flex items-center text-gray-400 hover:text-white mb-6 sm:mb-8"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
              </Link>

              <Card className="card-glow">
                <CardHeader className="text-center px-4 sm:px-6">
                  <CardTitle className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                    {mode === "login" ? "Sign In" : 
                     mode === "signup" ? "Create Account" : 
                     "Forgot Password"}
                  </CardTitle>
                  {mode === "login" && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      Use your registered credentials
                    </p>
                  )}
                  {mode === "forgot-password" && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      Enter your email to receive a password reset link
                    </p>
                  )}
                </CardHeader>

                <CardContent className="space-y-6 px-4 sm:px-6">
                  {/* Social Login - Only show for login and signup */}
                  {mode !== "forgot-password" && (
                    <>
                      <div className="space-y-3">
                        <Button className="w-full btn-secondary flex items-center justify-center space-x-2 text-sm sm:text-base" onClick={handleGoogleSignIn} type="button">
                          <Chrome className="w-4 h-4 sm:w-5 sm:h-5" />{" "}
                          <span>Continue with Google</span>
                        </Button>
                        <Button className="w-full btn-secondary flex items-center justify-center space-x-2 text-sm sm:text-base" onClick={handleLinkedInSignIn} type="button">
                          <Linkedin className="w-4 h-4 sm:w-5 sm:h-5" />{" "}
                          <span>Continue with LinkedIn</span>
                        </Button>
                      </div>

                      <div className="relative">
                        <Separator className="bg-gray-300 dark:bg-gray-700" />
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 px-2 text-sm text-gray-400">
                          or
                        </span>
                      </div>
                    </>
                  )}

                  {/* Error Message */}
                  {error && (
                    <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                      <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
                    </div>
                  )}

                  {/* Form */}
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    {mode === "signup" && (
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          type="text"
                          placeholder="Full Name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                          required
                        />
                      </div>
                    )}
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <Input
                        type="email"
                        placeholder="Email Address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                        required
                      />
                    </div>
                    {mode !== "forgot-password" && (
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          type="password"
                          placeholder="Password"
                          value={password}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            if (newValue.length <= 20 || newValue.length < password.length) {
                              setPassword(newValue);
                            }
                          }}
                          className="pl-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                          required
                          disabled={mode === 'signup' && !passwordValidation.checks.maxLength}
                        />
                      </div>
                    )}
                    
                    {mode === 'signup' && (
                      <div className="space-y-2 text-sm">
                          <div className="flex justify-end text-gray-400">
                              <span>{password.length} / 20</span>
                          </div>
                          <ul className="space-y-1">
                              <li className={`flex items-center ${passwordValidation.checks.length ? 'text-green-500' : 'text-gray-400'}`}>
                                  {passwordValidation.checks.length ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                                  At least 8 characters
                              </li>
                              <li className={`flex items-center ${passwordValidation.checks.uppercase ? 'text-green-500' : 'text-gray-400'}`}>
                                  {passwordValidation.checks.uppercase ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                                  One uppercase letter
                              </li>
                              <li className={`flex items-center ${passwordValidation.checks.lowercase ? 'text-green-500' : 'text-gray-400'}`}>
                                  {passwordValidation.checks.lowercase ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                                  One lowercase letter
                              </li>
                              <li className={`flex items-center ${passwordValidation.checks.number ? 'text-green-500' : 'text-gray-400'}`}>
                                  {passwordValidation.checks.number ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                                  One number
                              </li>
                              <li className={`flex items-center ${passwordValidation.checks.specialChar ? 'text-green-500' : 'text-gray-400'}`}>
                                  {passwordValidation.checks.specialChar ? <Check className="w-4 h-4 mr-2" /> : <X className="w-4 h-4 mr-2" />}
                                  One special character
                              </li>
                          </ul>
                      </div>
                    )}

                    {mode === 'signup' && password.length > 0 && passwordValidation.checks.maxLength && (
                      <PasswordStrength password={password} />
                    )}

                    <Button
                      type="submit"
                      className="w-full btn-primary h-12 text-base"
                      disabled={loading}
                    >
                      {loading ? "Loading..." : 
                       mode === "login" ? "Sign In" : 
                       mode === "signup" ? "Create Account" : 
                       "Send Reset Link"}
                    </Button>
                  </form>

                  {success && (
                    <div className="mt-4 p-3 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-800 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <Check className="w-4 h-4 text-green-500" />
                        <p className="text-green-700 dark:text-green-400 text-sm">{success}</p>
                      </div>
                    </div>
                  )}

                  {mode === "forgot-password" && (
                    <Button type="button" className="w-full btn-secondary h-12 text-base" onClick={handleGetMagicLink} disabled={loading}>
                      Get Magic Link
                    </Button>
                  )}
                  {magicLink && (
                    <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800 rounded-lg">
                      <span className="text-blue-700 dark:text-blue-400 text-sm">Magic Link: <a href={magicLink} className="underline break-all" target="_blank" rel="noopener noreferrer">Click here to reset your password</a></span>
                    </div>
                  )}
                  {magicLinkError && (
                    <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                      <span className="text-red-700 dark:text-red-400 text-sm">{magicLinkError}</span>
                    </div>
                  )}

                  {mode === "forgot-password" && (
                    <div className="flex justify-center">
                      <div className="cf-turnstile"></div>
                    </div>
                  )}

                  <div className="text-center text-sm text-gray-600 dark:text-gray-400">
                    {mode === "login" ? (
                      <>
                        <div className="mb-2">
                          <Link
                            href="/forgot-password"
                            className="text-purple-600 dark:text-purple-400 hover:text-purple-500"
                          >
                            Forgot Password?
                          </Link>
                        </div>
                        Don't have an account?{" "}
                        <Link
                          href="/signup"
                          className="text-purple-600 dark:text-purple-400 hover:text-purple-500"
                        >
                          Sign up
                        </Link>
                      </>
                    ) : mode === "signup" ? (
                      <>
                        Already have an account?{" "}
                        <Link
                          href="/login"
                          className="text-purple-600 dark:text-purple-400 hover:text-purple-500"
                        >
                          Sign in
                        </Link>
                      </>
                    ) : (
                      <>
                        Remember your password?{" "}
                        <Link
                          href="/login"
                          className="text-purple-600 dark:text-purple-400 hover:text-purple-500"
                        >
                          Back to Login
                        </Link>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
