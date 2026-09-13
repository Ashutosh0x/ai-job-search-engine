import { getSupabaseClientSafe } from "./supabase"
import { getSupabaseServerClient } from "./supabase"

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
      const { data: signInData, error: signInError } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError || !signInData.user) {
        return { success: false, error: signInError?.message || "Invalid email or password" }
      }
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

  /**
   * Reset a user's password using the Supabase Auth Admin API.
   *
   * WHY THIS CHANGED
   * ----------------
   * The old implementation had two critical bugs:
   * 1. `bcrypt` was referenced but never imported — ReferenceError at runtime.
   * 2. It hashed into a custom `users` table, but signUp/signIn use Supabase
   *    Auth. The two stores diverge: the Auth password stays stale, and next
   *    login uses Auth, so the reset never actually takes effect.
   *
   * The fix uses `auth.admin.updateUserById()` which updates the canonical
   * Supabase Auth store. This requires the service-role key (server-side only),
   * which is correct — password resets are always server-initiated after OTP
   * verification.
   */
  async resetPassword(email: string, newPassword: string): Promise<AuthResult> {
    try {
      // Use the admin client (service-role) to update the password in Supabase Auth
      const adminClient = getSupabaseServerClient()

      // Find the user by email via Supabase Auth admin API
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      })

      if (listError || !listData?.users) {
        return { success: false, error: "Failed to look up user" }
      }

      const authUser = listData.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      )

      if (!authUser) {
        // Don't reveal whether the email exists (timing-safe)
        return { success: false, error: "Failed to reset password" }
      }

      // Update the password through Supabase Auth — the single source of truth
      const { error: updateError } = await adminClient.auth.admin.updateUserById(
        authUser.id,
        { password: newPassword }
      )

      if (updateError) {
        console.error("Password update error:", updateError.message)
        return { success: false, error: "Failed to reset password" }
      }

      // Fetch profile info for the response
      const { data: profile } = await this.supabase
        .from("profiles")
        .select("full_name, created_at")
        .eq("id", authUser.id)
        .single()

      return {
        success: true,
        user: {
          id: authUser.id,
          email: authUser.email!,
          full_name: profile?.full_name || authUser.user_metadata?.full_name || undefined,
          created_at: profile?.created_at || authUser.created_at || new Date().toISOString(),
        },
      }
    } catch (error) {
      console.error("Reset password error:", error)
      return { success: false, error: "An unexpected error occurred" }
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const { data, error } = await this.supabase
        .from("profiles")
        .select("id, full_name, created_at")
        .limit(1000)

      if (error || !data) {
        return null
      }

      // Use admin API to find by email (profiles table may not have email)
      try {
        const adminClient = getSupabaseServerClient()
        const { data: listData } = await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        })
        const authUser = listData?.users?.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        )
        if (!authUser) return null

        const profile = data.find((p: any) => p.id === authUser.id)
        return {
          id: authUser.id,
          email: authUser.email!,
          full_name: profile?.full_name || authUser.user_metadata?.full_name,
          created_at: profile?.created_at || authUser.created_at,
        }
      } catch {
        return null
      }
    } catch (error) {
      console.error("Get user error:", error)
      return null
    }
  }
}

export const authService = new AuthService()
