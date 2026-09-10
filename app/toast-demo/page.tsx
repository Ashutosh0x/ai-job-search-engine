"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import Navigation from "@/components/navigation"
import { useWelcomeToast } from "@/components/welcome-toast"

export default function ToastDemoPage() {
  const { showWelcomeToast, showSuccessToast, showErrorToast, showInfoToast, showWarningToast } = useWelcomeToast()

  return (
    <>
      <Navigation />
      <div className="pt-16 min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto p-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Toast Notifications with Avatars</CardTitle>
              <p className="text-gray-600 dark:text-gray-400">
                Test personalized toast notifications with user avatars and enhanced visual design
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs bg-purple-500 text-white">👋</AvatarFallback>
                    </Avatar>
                    Welcome Toasts with Avatars
                  </h3>
                  <div className="space-y-3">
                    <Button
                      onClick={() =>
                        showWelcomeToast("John Doe", "john@example.com", true, "/placeholder.svg?height=32&width=32")
                      }
                      className="w-full"
                    >
                      New User Welcome (with photo)
                    </Button>
                    <Button
                      onClick={() => showWelcomeToast("Sarah Smith", "sarah@example.com", false)}
                      className="w-full"
                      variant="outline"
                    >
                      Returning User (initials only)
                    </Button>
                    <Button
                      onClick={() =>
                        showWelcomeToast("Alex Chen", "alex@example.com", false, "/placeholder.svg?height=32&width=32")
                      }
                      className="w-full"
                      variant="outline"
                    >
                      Welcome Back (with photo)
                    </Button>
                    <Button
                      onClick={() => showWelcomeToast(undefined, "developer@example.com", true)}
                      className="w-full"
                      variant="secondary"
                    >
                      Welcome (email only)
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Other Toast Types with Avatars</h3>
                  <div className="space-y-3">
                    <Button
                      onClick={() =>
                        showSuccessToast(
                          "Profile Updated Successfully",
                          "Your profile photo and information have been saved",
                          {
                            src: "/placeholder.svg?height=32&width=32",
                            fallback: "JD",
                            name: "John Doe",
                          },
                        )
                      }
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      Success with Avatar
                    </Button>
                    <Button
                      onClick={() =>
                        showErrorToast("Upload Failed", "Please check your internet connection and try again", {
                          fallback: "⚠️",
                          name: "System",
                        })
                      }
                      className="w-full bg-red-600 hover:bg-red-700"
                    >
                      Error with Icon Avatar
                    </Button>
                    <Button
                      onClick={() =>
                        showInfoToast("New Message from Recruiter", "TechCorp Inc. is interested in your profile", {
                          src: "/placeholder.svg?height=32&width=32",
                          fallback: "TC",
                          name: "TechCorp Recruiter",
                        })
                      }
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      Info with Company Avatar
                    </Button>
                    <Button
                      onClick={() =>
                        showWarningToast(
                          "Profile Incomplete",
                          "Add a profile photo to increase your visibility by 40%",
                          {
                            fallback: "📸",
                            name: "Profile Assistant",
                          },
                        )
                      }
                      className="w-full bg-yellow-600 hover:bg-yellow-700"
                    >
                      Warning with Emoji Avatar
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">Avatar Toast Features</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-2">Visual Enhancements</h4>
                    <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                      <li>✅ User profile photos in welcome toasts</li>
                      <li>✅ Gradient fallback avatars with initials</li>
                      <li>✅ Success indicator badge on avatars</li>
                      <li>✅ Company/system avatars for notifications</li>
                      <li>✅ Emoji avatars for system messages</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Smart Fallbacks</h4>
                    <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                      <li>✅ Auto-generates initials from names</li>
                      <li>✅ Uses email first letter if no name</li>
                      <li>✅ Graceful handling of missing images</li>
                      <li>✅ Consistent sizing and styling</li>
                      <li>✅ Dark mode compatible</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
                <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">💡 Pro Tip</h4>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Avatar toasts create a more personal connection with users. The success indicator badge on welcome
                  toasts reinforces the positive action, while company avatars help users identify the source of
                  notifications.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
