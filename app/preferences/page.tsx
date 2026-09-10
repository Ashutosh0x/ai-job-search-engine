import PreferencesOnboarding from "@/components/preferences-onboarding"
import ProtectedRoute from "@/components/protected-route"

export default function PreferencesPage() {
  return (
    <ProtectedRoute>
      <PreferencesOnboarding />
    </ProtectedRoute>
  )
}
