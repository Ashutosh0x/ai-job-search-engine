"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { useTheme } from "next-themes"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Mail, 
  Lock, 
  Moon, 
  Sun, 
  Shield, 
  Link2, 
  Bell, 
  Trash2, 
  User, 
  Settings,
  LogOut,
  ChevronDown,
  Edit,
  Save,
  X,
  Sparkles,
  Building2,
  Heart,
  Calendar,
  Clock,
  FileText,
  HelpCircle,
  Flag,
  Eye,
  EyeOff,
  Copy,
  Check,
  Share2,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Minus,
  Globe,
  Smartphone,
  Monitor,
  SmartphoneIcon,
  Info
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import LocalizationDemo from "@/components/localization-demo"

interface UserPreferences {
  theme?: "light" | "dark" | "system"
  twoFactorEnabled?: boolean
  emailNotifications?: boolean
  newsletter?: boolean
  blockedUsernames?: string[]
  jobAlerts?: boolean
  marketingEmails?: boolean
  profileVisibility?: 'public' | 'recruiters' | 'private'
  availabilityStatus?: 'available' | 'busy' | 'unavailable'
  availabilityMessage?: string
  timezone?: string
  language?: string
  dateFormat?: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
  timeFormat?: '12h' | '24h'
  currency?: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'INR'
  locale?: string
}

interface UserProfile {
  id: string
  full_name: string
  email: string
  phone: string
  location: string
  title: string
  company: string
  bio: string
  avatar_url?: string | null
  username?: string | null
  profile_visibility?: 'public' | 'recruiters' | 'private'
  public_profile_url?: string | null
  preferences?: UserPreferences
}

export default function SettingsPage() {
  const supabase = getSupabaseClientSafe()
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences>({
    theme: "system",
    twoFactorEnabled: false,
    emailNotifications: true,
    newsletter: false,
    blockedUsernames: [],
    jobAlerts: true,
    marketingEmails: false,
    profileVisibility: 'private',
    availabilityStatus: 'available',
    availabilityMessage: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: 'en',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    currency: 'USD',
    locale: 'en-US'
  })

  // Email change
  const [newEmail, setNewEmail] = useState("")
  const [emailChangeLoading, setEmailChangeLoading] = useState(false)

  // Password change
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" })
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false)

  // Username change
  const [usernameInput, setUsernameInput] = useState("")
  const [usernameChangeLoading, setUsernameChangeLoading] = useState(false)
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null)

  // Blocked users
  const [newBlockedUser, setNewBlockedUser] = useState("")
  const [blockedUserLoading, setBlockedUserLoading] = useState(false)

  // Availability
  const [availabilityMessage, setAvailabilityMessage] = useState("")

  // Messages
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  // Linked accounts
  const [identities, setIdentities] = useState<any[]>([])

  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { 
          router.push("/login")
          return 
        }

        setIdentities(user.identities || [])

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (profileError) {
          console.error('Profile fetch error:', profileError)
          setError("Failed to load profile")
          return
        }

        const profileData: UserProfile = {
          id: profile.id as string,
          full_name: (profile.full_name as string) || user.email?.split('@')[0] || "User",
          email: user.email || "",
          phone: (profile.phone as string) || "",
          location: (profile.location as string) || "",
          title: (profile.title as string) || "",
          company: (profile.company as string) || "",
          bio: (profile.bio as string) || "",
          avatar_url: (profile.avatar_url as string) || null,
          username: (profile.username as string) || null,
          profile_visibility: (profile.profile_visibility as 'public' | 'recruiters' | 'private') || 'private',
          public_profile_url: (profile.public_profile_url as string) || null,
          preferences: (profile.preferences as UserPreferences) || {}
        }

        setUserProfile(profileData)
        setUsernameInput(profileData.username || "")
        setAvailabilityMessage(profileData.preferences?.availabilityMessage || "")

        // Load preferences
        const loadedPrefs = profile.preferences || {}
        const mergedPrefs = { ...preferences, ...loadedPrefs }
        setPreferences(mergedPrefs)
        
        if (mergedPrefs.theme) {
          setTheme(mergedPrefs.theme)
        }

      } catch (error) {
        console.error('Settings initialization error:', error)
        setError("Failed to load settings")
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, supabase, setTheme])

  const savePreferences = async (patch: Partial<UserPreferences>) => {
    setSaving(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      
      const newPrefs = { ...preferences, ...patch }
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ preferences: newPrefs })
        .eq('id', user.id)
      
      if (updateError) throw updateError
      
      setPreferences(newPrefs)
      if (patch.theme) setTheme(patch.theme)
      
      setMessage('Settings saved successfully')
      setTimeout(() => setMessage(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const updateEmail = async () => {
    if (!newEmail || newEmail === userProfile?.email) return
    
    setEmailChangeLoading(true)
    setError(null)
    setMessage(null)
    
    try {
      const { data, error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) throw error
      
      setMessage('Verification email sent to confirm new address')
      setNewEmail("")
    } catch (e: any) {
      setError(e.message || 'Failed to update email')
    } finally {
      setEmailChangeLoading(false)
    }
  }

  const updatePassword = async () => {
    if (!passwords.new || passwords.new !== passwords.confirm) {
      setError('New passwords do not match')
      return
    }
    
    if (passwords.new.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }
    
    setPasswordChangeLoading(true)
    setError(null)
    setMessage(null)
    
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.new })
      if (error) throw error
      
      setPasswords({ current: "", new: "", confirm: "" })
      setMessage('Password updated successfully')
    } catch (e: any) {
      setError(e.message || 'Failed to update password')
    } finally {
      setPasswordChangeLoading(false)
    }
  }

  const sanitizeUsername = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

  const updateUsername = async () => {
    const cleaned = sanitizeUsername(usernameInput.trim())
    if (cleaned !== usernameInput) setUsernameInput(cleaned)
    
    if (cleaned.length < 3 || cleaned.length > 24) {
      setUsernameMessage('Username must be 3-24 characters, letters and numbers only')
      return
    }
    
    if (cleaned === userProfile?.username) return
    
    setUsernameChangeLoading(true)
    setError(null)
    setMessage(null)
    setUsernameMessage(null)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      
      // Check availability
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', cleaned)
        .neq('id', user.id)
        .maybeSingle()
      
      if (checkError) throw checkError
      if (existing) {
        setUsernameMessage('Username is already taken')
        return
      }
      
      // Update username and public profile URL
      const publicProfileUrl = preferences.profileVisibility === 'public'
        ? `${window.location.origin}/profile/${cleaned}`
        : null
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          username: cleaned, 
          public_profile_url: publicProfileUrl 
        })
        .eq('id', user.id)
      
      if (updateError) throw updateError
      
      setUserProfile(prev => prev ? { ...prev, username: cleaned, public_profile_url: publicProfileUrl } : null)
      setMessage('Username updated successfully')
    } catch (e: any) {
      setError(e.message || 'Failed to update username')
    } finally {
      setUsernameChangeLoading(false)
    }
  }

  const addBlockedUser = async () => {
    if (!newBlockedUser.trim()) return
    
    const updated = Array.from(new Set([...(preferences.blockedUsernames || []), newBlockedUser.trim()]))
    await savePreferences({ blockedUsernames: updated })
    setNewBlockedUser("")
  }

  const removeBlockedUser = async (username: string) => {
    const updated = (preferences.blockedUsernames || []).filter(u => u !== username)
    await savePreferences({ blockedUsernames: updated })
  }

  const copyProfileLink = async () => {
    if (!userProfile?.public_profile_url) return
    
    try {
      await navigator.clipboard.writeText(userProfile.public_profile_url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch (error) {
      setError('Failed to copy link')
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const deactivateAccount = async () => {
    try {
      // Mark account as deactivated in preferences
      await savePreferences({ ...preferences })
      await supabase.auth.signOut()
      router.push('/login')
    } catch (error) {
      setError('Failed to deactivate account')
    }
  }

  const updateAvailability = async () => {
    await savePreferences({ 
      availabilityStatus: preferences.availabilityStatus,
      availabilityMessage: availabilityMessage 
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading settings...</p>
        </div>
      </div>
    )
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500">
        Failed to load profile
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 sm:space-x-8">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">JobSpark AI</span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center space-x-6">
              <Button 
                variant="ghost" 
                className="text-gray-600 dark:text-gray-300 hover:text-purple-600"
                onClick={() => router.push("/dashboard")}
              >
                <Building2 className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Heart className="w-4 h-4 mr-2" />
                Matches
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Calendar className="w-4 h-4 mr-2" />
                Jobs
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <Clock className="w-4 h-4 mr-2" />
                Job Tracker
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <FileText className="w-4 h-4 mr-2" />
                Documents
              </Button>
              <Button variant="ghost" className="text-gray-600 dark:text-gray-300 hover:text-purple-600">
                <User className="w-4 h-4 mr-2" />
                Profile
              </Button>
              <Button variant="ghost" className="text-purple-600 font-medium">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-300 hidden sm:flex">
              <HelpCircle className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-gray-600 dark:text-gray-300">
              <Bell className="w-4 h-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center space-x-2">
                  <Avatar className="w-8 h-8 bg-purple-500">
                    <AvatarImage src={userProfile.avatar_url || undefined} />
                    <AvatarFallback className="bg-purple-500 text-white font-medium">
                      {userProfile.full_name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-300 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => router.push("/profile")}>
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Flag className="w-4 h-4 mr-2" />
                  Report Issues
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <HelpCircle className="w-4 h-4 mr-2" />
                  Support
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Manage your account preferences and security</p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => router.push("/profile")}
            className="hidden sm:flex flex-shrink-0"
          >
            <User className="w-4 h-4 mr-2" />
            Back to Profile
          </Button>
        </div>

        {/* Messages */}
        {message && (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-700 flex items-center">
            <CheckCircle className="w-5 h-5 mr-2" />
            {message}
          </div>
        )}
        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center">
            <XCircle className="w-5 h-5 mr-2" />
            {error}
          </div>
        )}

        <Tabs defaultValue="account" className="w-full">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 gap-1">
            <TabsTrigger value="account" className="text-xs md:text-sm truncate">Account</TabsTrigger>
            <TabsTrigger value="security" className="text-xs md:text-sm truncate">Security</TabsTrigger>
            <TabsTrigger value="preferences" className="text-xs md:text-sm truncate">Preferences</TabsTrigger>
            <TabsTrigger value="danger" className="text-xs md:text-sm truncate">Danger Zone</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-6">
            {/* Account Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Account Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4 flex-wrap">
                  <Avatar className="w-16 h-16 flex-shrink-0">
                    <AvatarImage src={userProfile.avatar_url || undefined} />
                    <AvatarFallback className="bg-purple-500 text-white text-xl font-bold">
                      {userProfile.full_name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white text-lg truncate">{userProfile.full_name}</div>
                    <div className="text-gray-600 dark:text-gray-400 truncate">{userProfile.email}</div>
                    <div className="text-sm text-gray-500 truncate">{userProfile.title} at {userProfile.company}</div>
                  </div>
                </div>

                <Separator />

                {/* Username */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="text-sm font-medium">Username</label>
                      <p className="text-xs text-gray-500">Your public profile identifier</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => router.push("/profile")}
                      className="flex-shrink-0"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit in Profile
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      value={usernameInput} 
                      onChange={(e) => setUsernameInput(sanitizeUsername(e.target.value))} 
                      placeholder="username" 
                      className="flex-1 min-w-0"
                    />
                    <Button 
                      onClick={updateUsername} 
                      disabled={!usernameInput || usernameInput === userProfile.username || usernameChangeLoading}
                      size="sm"
                    >
                      {usernameChangeLoading ? "Updating..." : "Update"}
                    </Button>
                  </div>
                  {usernameMessage && <p className="text-xs text-red-600">{usernameMessage}</p>}
                  {userProfile.username && (
                    <p className="text-xs text-gray-500">
                      Public profile: {window.location.origin}/profile/{userProfile.username}
                    </p>
                  )}
                </div>

                <Separator />

                {/* Email */}
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Email Address
                    </label>
                    <p className="text-xs text-gray-500">We'll send a verification email to confirm changes</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input 
                      type="email" 
                      placeholder="new@email.com" 
                      value={newEmail} 
                      onChange={(e) => setNewEmail(e.target.value)} 
                      className="flex-1 min-w-0"
                    />
                    <Button 
                      onClick={updateEmail} 
                      disabled={!newEmail || newEmail === userProfile.email || emailChangeLoading}
                      size="sm"
                      className="flex-shrink-0"
                    >
                      {emailChangeLoading ? "Sending..." : "Update"}
                    </Button>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Current: {userProfile.email}</p>
                </div>

                <Separator />

                {/* Password */}
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Change Password
                    </label>
                    <p className="text-xs text-gray-500">Create a strong password with at least 6 characters</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="relative">
                      <Input 
                        type={showPasswords.current ? "text" : "password"}
                        placeholder="Current password" 
                        value={passwords.current} 
                        onChange={(e) => setPasswords({...passwords, current: e.target.value})} 
                        className="min-w-0"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPasswords({...showPasswords, current: !showPasswords.current})}
                      >
                        {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="relative">
                      <Input 
                        type={showPasswords.new ? "text" : "password"}
                        placeholder="New password" 
                        value={passwords.new} 
                        onChange={(e) => setPasswords({...passwords, new: e.target.value})} 
                        className="min-w-0"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                      >
                        {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="relative">
                      <Input 
                        type={showPasswords.confirm ? "text" : "password"}
                        placeholder="Confirm new password" 
                        value={passwords.confirm} 
                        onChange={(e) => setPasswords({...passwords, confirm: e.target.value})} 
                        className="min-w-0"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                      >
                        {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button 
                    onClick={updatePassword} 
                    disabled={!passwords.new || passwords.new !== passwords.confirm || passwordChangeLoading}
                    size="sm"
                  >
                    {passwordChangeLoading ? "Updating..." : "Update Password"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Availability Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Availability Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Current Status</div>
                    <div className="text-sm text-gray-500">Let recruiters know your availability</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={preferences.availabilityStatus === 'available' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ availabilityStatus: 'available' })}
                    >
                      Available
                    </Button>
                    <Button
                      variant={preferences.availabilityStatus === 'busy' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ availabilityStatus: 'busy' })}
                    >
                      Busy
                    </Button>
                    <Button
                      variant={preferences.availabilityStatus === 'unavailable' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ availabilityStatus: 'unavailable' })}
                    >
                      Unavailable
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Availability Message</label>
                  <Input
                    placeholder="e.g., 'Open to new opportunities' or 'Currently employed, not actively looking'"
                    value={availabilityMessage}
                    onChange={(e) => setAvailabilityMessage(e.target.value)}
                  />
                  <Button 
                    onClick={updateAvailability}
                    size="sm"
                    variant="outline"
                  >
                    Update Message
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            {/* Two-Factor Authentication */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Two-Factor Authentication
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">2FA Protection</div>
                    <div className="text-sm text-gray-500">
                      {preferences.twoFactorEnabled 
                        ? "Two-factor authentication is enabled" 
                        : "Add an extra layer of security to your account"
                      }
                    </div>
                  </div>
                  <Switch 
                    checked={!!preferences.twoFactorEnabled} 
                    onCheckedChange={(checked) => savePreferences({ twoFactorEnabled: checked })}
                  />
                </div>
                {!preferences.twoFactorEnabled && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      <span className="text-sm text-yellow-800">
                        Enable 2FA for enhanced account security
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Blocked Users */}
            <Card>
              <CardHeader>
                <CardTitle>Blocked Users</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Enter username to block" 
                    value={newBlockedUser} 
                    onChange={(e) => setNewBlockedUser(e.target.value)} 
                    className="flex-1"
                  />
                  <Button 
                    onClick={addBlockedUser} 
                    disabled={!newBlockedUser.trim() || blockedUserLoading}
                    size="sm"
                  >
                    {blockedUserLoading ? "Adding..." : "Block"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(preferences.blockedUsernames || []).map((username) => (
                    <Badge key={username} variant="secondary" className="flex items-center gap-1">
                      {username}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 text-red-500 hover:text-red-700"
                        onClick={() => removeBlockedUser(username)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </Badge>
                  ))}
                  {(preferences.blockedUsernames || []).length === 0 && (
                    <p className="text-sm text-gray-500">No blocked users</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Linked Accounts */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5" />
                  Linked Accounts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {identities.length === 0 ? (
                  <div className="text-center py-6">
                    <Link2 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p className="text-sm text-gray-500">No linked accounts</p>
                    <p className="text-xs text-gray-400 mt-1">Link your social accounts for easier sign-in</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {identities.map((identity) => (
                      <div key={identity.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                            <Globe className="w-4 h-4 text-gray-600" />
                          </div>
                          <div>
                            <div className="font-medium capitalize">{identity.provider}</div>
                            <div className="text-sm text-gray-500">
                              {identity.identity_data?.email || identity.identity_data?.sub || identity.id}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline">Connected</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-600" />
                    <span className="text-sm text-blue-800">
                      To link/unlink accounts, please contact support
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-6">
            {/* Theme Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Moon className="w-5 h-5" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4" />
                    <span>Theme</span>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant={preferences.theme === 'light' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => savePreferences({ theme: 'light' })}
                    >
                      Light
                    </Button>
                    <Button 
                      variant={preferences.theme === 'dark' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => savePreferences({ theme: 'dark' })}
                    >
                      Dark
                    </Button>
                    <Button 
                      variant={preferences.theme === 'system' ? 'default' : 'outline'} 
                      size="sm"
                      onClick={() => savePreferences({ theme: 'system' })}
                    >
                      System
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Language & Localization Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Language & Localization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Language Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Language</label>
                  <Select 
                    value={preferences.language || 'en'} 
                    onValueChange={(value) => savePreferences({ language: value })}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="ko">한국어</SelectItem>
                      <SelectItem value="pt">Português</SelectItem>
                      <SelectItem value="it">Italiano</SelectItem>
                      <SelectItem value="ru">Русский</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                      <SelectItem value="hi">हिन्दी</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Date Format */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Date Format</label>
                  <Select 
                    value={preferences.dateFormat || 'MM/DD/YYYY'} 
                    onValueChange={(value) => savePreferences({ dateFormat: value as 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' })}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Select date format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (EU)</SelectItem>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Time Format */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Time Format</label>
                  <Select 
                    value={preferences.timeFormat || '12h'} 
                    onValueChange={(value) => savePreferences({ timeFormat: value as '12h' | '24h' })}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Select time format" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12h">12-hour (AM/PM)</SelectItem>
                      <SelectItem value="24h">24-hour</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Currency */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Currency</label>
                  <Select 
                    value={preferences.currency || 'USD'} 
                    onValueChange={(value) => savePreferences({ currency: value as 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'INR' })}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD - US Dollar ($)</SelectItem>
                      <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
                      <SelectItem value="GBP">GBP - British Pound (£)</SelectItem>
                      <SelectItem value="JPY">JPY - Japanese Yen (¥)</SelectItem>
                      <SelectItem value="CAD">CAD - Canadian Dollar (C$)</SelectItem>
                      <SelectItem value="AUD">AUD - Australian Dollar (A$)</SelectItem>
                      <SelectItem value="CHF">CHF - Swiss Franc (CHF)</SelectItem>
                      <SelectItem value="CNY">CNY - Chinese Yuan (¥)</SelectItem>
                      <SelectItem value="INR">INR - Indian Rupee (₹)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Timezone */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Timezone</label>
                  <Select 
                    value={preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} 
                    onValueChange={(value) => savePreferences({ timezone: value })}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                      <SelectItem value="Europe/Paris">Paris (CET/CEST)</SelectItem>
                      <SelectItem value="Europe/Berlin">Berlin (CET/CEST)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                      <SelectItem value="Asia/Shanghai">Shanghai (CST)</SelectItem>
                      <SelectItem value="Asia/Kolkata">Mumbai (IST)</SelectItem>
                      <SelectItem value="Australia/Sydney">Sydney (AEST/AEDT)</SelectItem>
                      <SelectItem value="Pacific/Auckland">Auckland (NZST/NZDT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Preview */}
                <LocalizationDemo preferences={preferences} />
              </CardContent>
            </Card>

            {/* Email Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Email Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Job Alerts</div>
                    <div className="text-sm text-gray-500">Get notified about new job opportunities</div>
                  </div>
                  <Switch 
                    checked={!!preferences.jobAlerts} 
                    onCheckedChange={(checked) => savePreferences({ jobAlerts: checked })}
                    className="flex-shrink-0 ml-4"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Email Notifications</div>
                    <div className="text-sm text-gray-500">Receive important account updates</div>
                  </div>
                  <Switch 
                    checked={!!preferences.emailNotifications} 
                    onCheckedChange={(checked) => savePreferences({ emailNotifications: checked })}
                    className="flex-shrink-0 ml-4"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Newsletter</div>
                    <div className="text-sm text-gray-500">Receive updates about new features</div>
                  </div>
                  <Switch 
                    checked={!!preferences.newsletter} 
                    onCheckedChange={(checked) => savePreferences({ newsletter: checked })}
                    className="flex-shrink-0 ml-4"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Marketing Emails</div>
                    <div className="text-sm text-gray-500">Receive promotional content and offers</div>
                  </div>
                  <Switch 
                    checked={!!preferences.marketingEmails} 
                    onCheckedChange={(checked) => savePreferences({ marketingEmails: checked })}
                    className="flex-shrink-0 ml-4"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Profile Visibility */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Profile Visibility
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">Profile Visibility</div>
                    <div className="text-sm text-gray-500">Control who can see your profile</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant={preferences.profileVisibility === 'public' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ profileVisibility: 'public' })}
                    >
                      Public
                    </Button>
                    <Button
                      variant={preferences.profileVisibility === 'recruiters' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ profileVisibility: 'recruiters' })}
                    >
                      Recruiters Only
                    </Button>
                    <Button
                      variant={preferences.profileVisibility === 'private' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => savePreferences({ profileVisibility: 'private' })}
                    >
                      Private
                    </Button>
                  </div>
                </div>
                
                {preferences.profileVisibility === 'public' && userProfile.username && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-green-800">Public Profile Link</div>
                        <div className="text-sm text-green-600">
                          {window.location.origin}/profile/{userProfile.username}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyProfileLink}
                      >
                        {copiedLink ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger" className="space-y-6">
            {/* Account Deletion */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <Trash2 className="w-5 h-5" />
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <div className="font-medium text-red-800">Deactivate Account</div>
                      <div className="text-sm text-red-700 mt-1">
                        This will sign you out and mark your account as deactivated. 
                        Your data will be preserved but you won't be able to access your account.
                      </div>
                    </div>
                  </div>
                </div>
                
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Deactivate Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently deactivate your account
                        and sign you out immediately. You will need to contact support to reactivate your account.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={deactivateAccount} className="bg-red-600 hover:bg-red-700">
                        Yes, deactivate my account
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}


