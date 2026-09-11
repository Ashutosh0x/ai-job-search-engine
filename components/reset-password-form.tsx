"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Lock, Eye, EyeOff, ArrowLeft, Check, X } from "lucide-react"
import Link from "next/link"
import Navigation from "@/components/navigation"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { validatePassword } from "@/lib/validation"
import { useToast } from "@/components/toast-provider"

export default function ResetPasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [passwordValidation, setPasswordValidation] = useState(validatePassword("", true))
  const router = useRouter()
  const { addToast } = useToast()
  const supabase = getSupabaseClientSafe()
  const searchParams = useSearchParams()

  // Get access_token and refresh_token from URL params (sent by Supabase)
  const accessToken = searchParams.get('access_token')
  const refreshToken = searchParams.get('refresh_token')

  // Debug: Parse error info from hash fragment (e.g. #error=access_denied&error_code=otp_expired&error_description=...)
  let hashError = null, hashErrorCode = null, hashErrorDescription = null
  if (typeof window !== 'undefined' && window.location.hash) {
    const hash = window.location.hash.substring(1)
    const params = new URLSearchParams(hash)
    hashError = params.get('error')
    hashErrorCode = params.get('error_code')
    hashErrorDescription = params.get('error_description')
  }

  useEffect(() => {
    // Validate new password as user types
    const validation = validatePassword(newPassword, true)
    setPasswordValidation(validation)
    if (!validation.checks.maxLength) {
      setError("Password must not exceed 20 characters")
    } else if (error === "Password must not exceed 20 characters") {
      setError("")
    }
  }, [newPassword, error])

  useEffect(() => {
    // Check if we have the required tokens
    if (!accessToken) {
      setError("Invalid or expired reset link. Please request a new password reset.")
    }
  }, [accessToken])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    // Validate form
    if (!currentPassword) {
      setError("Current password is required")
      setLoading(false)
      return
    }

    const passwordValidation = validatePassword(newPassword, true)
    if (!passwordValidation.isValid) {
      setError(passwordValidation.errors[0])
      setLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match")
      setLoading(false)
      return
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from current password")
      setLoading(false)
      return
    }

    try {
      // Get the current session to get user email
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError || !session?.user?.email) {
        setError("Unable to get user information. Please try requesting a new reset link.")
        setLoading(false)
        return
      }

      // Verify the current password by attempting to sign in
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword
      })

      if (signInError) {
        setError("Current password is incorrect")
        setLoading(false)
        return
      }

      // Update the password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (updateError) {
        setError(`Failed to update password: ${updateError.message}`)
        setLoading(false)
        return
      }

      // Send confirmation email
      const { error: emailError } = await supabase.auth.resend({
        type: 'signup',
        email: user?.email || ''
      })

      if (emailError) {
        console.warn('Failed to send confirmation email:', emailError.message)
      }

      setSuccess(true)
      addToast({
        title: "Password Reset Successful",
        description: "Your password has been updated successfully. A confirmation email has been sent.",
        type: "success",
        duration: 10000,
      })

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login')
      }, 3000)

    } catch (error) {
      console.error('Password reset error:', error)
      setError(`Error resetting password: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <Card className="card-glow">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Password Reset Successful!
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Your password has been updated successfully. You will be redirected to the login page shortly.
                </p>
                <Button 
                  onClick={() => router.push('/login')}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  Go to Login
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Debug Panel for Developers */}
      <div style={{ background: '#f3f3f3', border: '1px solid #ccc', padding: 12, margin: 12, borderRadius: 8, fontSize: 13 }}>
        <strong>Debug Info:</strong><br />
        <div>access_token: <code>{accessToken || <span style={{color:'red'}}>MISSING</span>}</code></div>
        <div>refresh_token: <code>{refreshToken || <span style={{color:'red'}}>MISSING</span>}</code></div>
        {typeof window !== 'undefined' && window.location.hash && (
          <>
            <div>URL Hash: <code>{window.location.hash}</code></div>
            <div>error: <code>{hashError || '-'}</code></div>
            <div>error_code: <code>{hashErrorCode || '-'}</code></div>
            <div>error_description: <code>{hashErrorDescription || '-'}</code></div>
          </>
        )}
      </div>
      <Navigation />
      <div className="min-h-screen flex">
        {/* Left Side - Image */}
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 items-center justify-center p-8 xl:p-12">
          <div className="text-center space-y-6">
            <h2 className="text-3xl xl:text-4xl font-bold text-white">
              Reset Your Password
            </h2>
            <p className="text-purple-200 text-lg max-w-md">
              Enter your current password and choose a new secure password for your account.
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
                  Enter your current password and create a new secure password
                </p>
              </CardHeader>

              <CardContent className="space-y-6 px-4 sm:px-6">
                {/* Error Message */}
                {error && (
                  <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                    <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
                  </div>
                )}

                {/* Form */}
                <form className="space-y-4" onSubmit={handleSubmit}>
                  {/* Current Password */}
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <Input
                      type={showCurrentPassword ? "text" : "password"}
                      placeholder="Current Password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="pl-10 pr-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* New Password */}
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      placeholder="New Password"
                      value={newPassword}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        if (newValue.length <= 20 || newValue.length < newPassword.length) {
                          setNewPassword(newValue);
                        }
                      }}
                      className="pl-10 pr-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      required
                      disabled={!passwordValidation.checks.maxLength}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Confirm Password */}
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm New Password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10 pr-10 bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Password Requirements */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-end text-gray-400">
                      <span>{newPassword.length} / 20</span>
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

                  <Button
                    type="submit"
                    className="w-full btn-primary h-12 text-base"
                    disabled={loading || !passwordValidation.checks.maxLength}
                  >
                    {loading ? "Updating Password..." : "Reset Password"}
                  </Button>
                </form>

                <div className="text-center text-sm text-gray-600 dark:text-gray-400">
                  Remember your password?{" "}
                  <Link
                    href="/login"
                    className="text-purple-600 dark:text-purple-400 hover:text-purple-500"
                  >
                    Back to Login
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
} 