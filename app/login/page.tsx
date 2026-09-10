import AuthForm from "@/components/auth-form"
import { ToastProvider } from "@/components/toast-provider"

export default function LoginPage() {
  return (
    <ToastProvider>
      <AuthForm mode="login" />
    </ToastProvider>
  )
}
