import { getSupabaseClientSafe } from "./supabase"
import { createClient } from "@supabase/supabase-js"

export interface User {
  id: string
  email: string
  full_name?: string
  created_at: string
}

export interface AuthResult {
  success: boolean
  user?: User
  error?: string
}

export class AuthService {
  private supabase = getSupabaseClientSafe()

  async signUp(email: string, password: string, fullName: string): Promise<AuthResult> {
    try {
      // Use Supabase Auth for signup
      const { data: signUpData, error: signUpError } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      })
      if (signUpError || !signUpData.user) {
        return { success: false, error: signUpError?.message || "Failed to create account" }
      }
      // Insert extra user info into 'profiles' table
      await this.supabase.from("profiles").upsert({
        id: signUpData.user.id,
        full_name: fullName,
        created_at: new Date().toISOString(),
      })
      return {
        success: true,
        user: {
          id: signUpData.user.id,
          email: signUpData.user.email!,
          full_name: fullName,
          created_at: signUpData.user.created_at || new Date().toISOString(),
        },
      }
    } catch (error) {
      console.error("Signup error:", error)
      return { success: false, error: "An unexpected error occurred" }
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    try {
      // Use Supabase Auth for sign in
      const { data: signInData, error: signInError } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError || !signInData.user) {
        return { success: false, error: signInError?.message || "Invalid email or password" }
      }
      // Fetch extra user info from 'profiles' table
      const { data: profile } = await this.supabase
        .from("profiles")
        .select("full_name, created_at")
        .eq("id", signInData.user.id)
        .single()
      return {
        success: true,
        user: {
          id: signInData.user.id,
          email: signInData.user.email!,
          full_name: profile?.full_name || undefined,
          created_at: profile?.created_at || signInData.user.created_at || new Date().toISOString(),
        },
      }
    } catch (error) {
      console.error("Signin error:", error)
      return { success: false, error: "An unexpected error occurred" }
    }
  }

  async resetPassword(email: string, newPassword: string): Promise<AuthResult> {
    try {
      // Hash new password
      const saltRounds = 12
      const passwordHash = await bcrypt.hash(newPassword, saltRounds)

      // Update password in database
      const { data, error } = await this.supabase
        .from("users")
        .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
        .eq("email", email)
        .select("id, email, full_name, created_at")
        .single()

      if (error) {
        return { success: false, error: "Failed to reset password" }
      }

      return { success: true, user: data }
    } catch (error) {
      console.error("Reset password error:", error)
      return { success: false, error: "An unexpected error occurred" }
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const { data, error } = await this.supabase
        .from("users")
        .select("id, email, full_name, created_at")
        .eq("email", email)
        .single()

      if (error || !data) {
        return null
      }

      return data
    } catch (error) {
      console.error("Get user error:", error)
      return null
    }
  }
}

export const authService = new AuthService()
