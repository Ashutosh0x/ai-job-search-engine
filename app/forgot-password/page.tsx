import AuthForm from "@/components/auth-form"
import { ToastProvider } from "@/components/toast-provider"

export default function ForgotPasswordPage() {
  return (
    <ToastProvider>
      <AuthForm mode="forgot-password" />
    </ToastProvider>
  )
} 