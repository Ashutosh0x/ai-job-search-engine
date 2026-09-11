"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useTheme } from "next-themes"
import { ChevronDown, Moon, Sun, Sparkles, Zap, Target, TrendingUp, BarChart3, Menu, X } from "lucide-react"
import Link from "next/link"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getSupabaseClientSafe } from "@/lib/supabase"

export default function Navigation() {
  const { theme, setTheme } = useTheme()
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabaseClientSafe()

    const fetchUser = async () => {
      try {
        // Prefer Supabase auth
        const { data: { user: sbUser } } = await supabase.auth.getUser()
        if (sbUser?.email) {
          setUser({ email: sbUser.email, name: undefined })
          // Fetch avatar from profiles
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', sbUser.id)
            .single()
          if (profile) {
            if (profile.full_name) setUser({ email: sbUser.email, name: profile.full_name })
            if (profile.avatar_url) {
              let url: string = profile.avatar_url as string
              try {
                // If it's a storage path, sign a short URL
                if (!url.includes('http') && url.includes('avatars/')) {
                  const { data } = await supabase.storage.from('resume').createSignedUrl(url, 3600)
                  url = data?.signedUrl || url
                }
              } catch {}
              setAvatarUrl(url)
            }
          }
        } else {
          // Fallback to localStorage
          const isAuthenticated = localStorage.getItem('isAuthenticated')
          const userEmail = localStorage.getItem('userEmail')
          const userName = localStorage.getItem('userName')
          if (isAuthenticated && userEmail) {
            setUser({ email: userEmail, name: userName || undefined })
          }
        }
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [])

  const handleLogout = async () => {
    try {
      const supabase = getSupabaseClientSafe()
      await supabase.auth.signOut()
    } catch {}
    localStorage.removeItem('isAuthenticated')
    localStorage.removeItem('userEmail')
    localStorage.removeItem('userName')
    localStorage.removeItem('userId')
    setUser(null)
    window.location.href = "/login"
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">JobSpark AI</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-8">
            <DropdownMenu open={featuresOpen} onOpenChange={setFeaturesOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-purple-500/50 rounded-full px-4 py-2 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                >
                  Features
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="flex items-center space-x-3 p-3">
                    <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">AI Dashboard</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Personalized job insights</div>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/resume" className="flex items-center space-x-3 p-3">
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Resume Optimization</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">ATS-friendly resume analysis</div>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/jobs" className="flex items-center space-x-3 p-3">
                    <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                      <Target className="w-4 h-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Smart Job Matching</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">AI-powered job recommendations</div>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/news" className="flex items-center space-x-3 p-3">
                    <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">Industry Insights</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Latest trends and news</div>
                    </div>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link
              href="/pricing"
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Pricing
            </Link>
            <Link
              href="/blog"
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Blog
            </Link>
            <Link
              href="/resume-builder"
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Resume Builder
            </Link>
            <Link
              href="/explore-jobs"
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white font-medium"
            >
              Explore Jobs
            </Link>
          </div>

          {/* Right Side */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white w-9 h-9 p-0"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>

            {/* Desktop Auth Buttons */}
            <div className="hidden md:flex items-center space-x-3">
              {loading ? (
                <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              ) : user ? (
                <div className="flex items-center space-x-3">
                  <a href="/profile" aria-label="Profile">
                    <Avatar className="h-8 w-8 cursor-pointer">
                      {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                      <AvatarFallback>{user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </a>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{user.name || user.email}</span>
                  <Button onClick={handleLogout} variant="outline" size="sm">
                    Sign Out
                  </Button>
                </div>
              ) : (
                <>
                  <Link href="/login">
                    <Button
                      variant="ghost"
                      className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    >
                      Log In
                    </Button>
                  </Link>
                  <Link href="/signup">
                    <Button className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 sm:px-6 py-2 rounded-full transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/25">
                      Get Started
                    </Button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden w-9 h-9 p-0"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {/* Mobile Features */}
              <div className="space-y-1">
                <div className="px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400">Features</div>
                <Link
                  href="/dashboard"
                  className="flex items-center space-x-3 px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <BarChart3 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  <span>AI Dashboard</span>
                </Link>
                <Link
                  href="/resume"
                  className="flex items-center space-x-3 px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <span>Resume Optimization</span>
                </Link>
                <Link
                  href="/jobs"
                  className="flex items-center space-x-3 px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Target className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span>Smart Job Matching</span>
                </Link>
                <Link
                  href="/news"
                  className="flex items-center space-x-3 px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <TrendingUp className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  <span>Industry Insights</span>
                </Link>
              </div>

              {/* Mobile Navigation Links */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                <Link
                  href="/pricing"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </Link>
                <Link
                  href="/blog"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Blog
                </Link>
                <Link
                  href="/resume-builder"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Resume Builder
                </Link>
                <Link
                  href="/explore-jobs"
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Explore Jobs
                </Link>
              </div>

              {/* Mobile Auth Buttons */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2 md:hidden">
                {user ? (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-3 px-3 py-2">
                      <a href="/profile" aria-label="Profile">
                        <Avatar className="h-8 w-8 cursor-pointer">
                          {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                          <AvatarFallback>{user.name?.charAt(0) || user.email.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </a>
                      <span className="text-sm text-gray-700 dark:text-gray-300">{user.name || user.email}</span>
                    </div>
                    <Button onClick={handleLogout} variant="outline" className="w-full bg-transparent">
                      Sign Out
                    </Button>
                  </div>
                ) : (
                  <>
                    <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                      <Button variant="ghost" className="w-full justify-start">
                        Log In
                      </Button>
                    </Link>
                    <Link href="/signup" onClick={() => setMobileMenuOpen(false)}>
                      <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white">Get Started</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
