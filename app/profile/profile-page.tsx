// app/profile/page.tsx
"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Briefcase,
  GraduationCap,
  Award,
  FileText,
  Settings,
  LogOut,
  ChevronDown,
  Edit,
  Save,
  X,
  Bell,
  HelpCircle,
  Flag,
  Sparkles,
  Building2,
  Heart,
  Clock,
  Github,
  Linkedin,
  Twitter,
  Globe,
  Plus,
  Trash2,
  Upload,
  Wand2,
  ExternalLink,
  Image as ImageIcon,
  Video,
  Link as LinkIcon,
  Eye,
  EyeOff,
  Copy,
  Check,
  Share2,
  Download
} from "lucide-react"
import { getSupabaseClient } from "@/lib/supabase"
import { getCompanyLogo, isValidWebsiteUrl, extractDomain } from "@/lib/company-logo"
import ExperienceForm from "@/components/experience-form"
import EducationForm, { Education } from "@/components/education-form"

interface SocialLinks {
  github?: string
  linkedin?: string
  twitter?: string
  website?: string
  [key: string]: string | undefined
}

interface PortfolioProject {
  id: string
  title: string
  description: string
  url?: string
  image_url?: string
  video_url?: string
  technologies: string[]
  created_at: string
}

interface Experience {
  id: string
  user_id: string
  job_title: string
  company_name: string
  company_website?: string
  company_logo_url?: string
  location?: string
  start_date?: string
  end_date?: string
  is_current_job: boolean
  years_of_experience?: number
  description?: string
  created_at: string
  updated_at: string
}

interface UserProfile {
  id: string
  name: string
  email: string
  phone: string
  location: string
  title: string
  company: string
  bio: string
  experience: string
  education: string
  skills: string[]
  joinDate: string
  avatar_url?: string | null
  social_links?: SocialLinks
  portfolio_projects?: PortfolioProject[]
  experiences?: Experience[]
  profile_completion?: number
  website?: string | null
  github_url?: string | null
  linkedin_url?: string | null
  twitter_url?: string | null
  cv_url?: string | null
  username?: string | null
  profile_visibility?: 'public' | 'recruiters' | 'private'
  public_profile_url?: string | null
}

export default function Profile() {
  const [isEditing, setIsEditing] = useState(false)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [editForm, setEditForm] = useState<Partial<UserProfile> | null>(null)
  const [loading, setLoading] = useState(true)
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [educations, setEducations] = useState<Education[]>([])
  const [showExperienceForm, setShowExperienceForm] = useState(false)
  const [editingExperience, setEditingExperience] = useState<Experience | null>(null)
  const [showEducationForm, setShowEducationForm] = useState(false)
  const [editingEducation, setEditingEducation] = useState<Education | null>(null)
  const [error, setError] = useState("")
  // Audit logs are now hidden from the profile UI
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [showPortfolioForm, setShowPortfolioForm] = useState(false)
  const [newProject, setNewProject] = useState<Partial<PortfolioProject>>({
    title: '',
    description: '',
    url: '',
    technologies: []
  })
  const [profileVisibility, setProfileVisibility] = useState<'public' | 'recruiters' | 'private'>('private')
  const [copiedLink, setCopiedLink] = useState(false)
  const [showVisibilitySettings, setShowVisibilitySettings] = useState(false)
  const [showPublicLinkCard, setShowPublicLinkCard] = useState(false)
  const publicLinkTimer = useRef<number | null>(null)

  const showLinkCardBriefly = () => {
    setShowPublicLinkCard(true)
    if (publicLinkTimer.current) {
      window.clearTimeout(publicLinkTimer.current)
    }
    publicLinkTimer.current = window.setTimeout(() => {
      setShowPublicLinkCard(false)
      publicLinkTimer.current = null
    }, 3000)
  }

  const hideLinkCard = () => {
    setShowPublicLinkCard(false)
    if (publicLinkTimer.current) {
      window.clearTimeout(publicLinkTimer.current)
      publicLinkTimer.current = null
    }
  }
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = getSupabaseClient()

  // Calculate profile completion percentage
  const calculateProfileCompletion = (profile: Partial<UserProfile>): number => {
    let completion = 0
    
    // Basic info (40% total)
    if (profile.name && profile.name.trim() !== '' && profile.name !== 'Updated Name') completion += 10
    if (profile.title && profile.title.trim() !== '') completion += 15
    if (profile.company && profile.company.trim() !== '') completion += 10
    if (profile.bio && profile.bio.trim() !== '') completion += 5
    
    // Experience & Education (20% total)
    const hasAnyExperience = (Array.isArray((profile as any).experiences) && ((profile as any).experiences as unknown as Experience[]).length > 0) ||
      (typeof profile.experience === 'string' && profile.experience.trim() !== '')
    if (hasAnyExperience) completion += 10
    if (profile.education && profile.education.trim() !== '') completion += 10
    
    // Skills & Contact (25% total)
    if (profile.skills && profile.skills.length > 0) completion += 10
    if (profile.location && profile.location.trim() !== '') completion += 10
    if (profile.phone && profile.phone.trim() !== '') completion += 5
    
    // Social Media & Links (15% total)
    if (profile.github_url && profile.github_url.trim() !== '') completion += 5
    if (profile.linkedin_url && profile.linkedin_url.trim() !== '') completion += 5
    if (profile.twitter_url && profile.twitter_url.trim() !== '') completion += 5
    
    // Additional links
    if (profile.website && profile.website.trim() !== '') completion += 5
    if (profile.social_links && Object.keys(profile.social_links).length > 0) completion += 5
    
    return Math.min(completion, 100)
  }

  // Get completion hints
  const getCompletionHints = (profile: Partial<UserProfile>): string[] => {
    const hints = []
    if (!profile.name) hints.push("Add your full name")
    if (!profile.title) hints.push("Add your job title")
    if (!profile.company) hints.push("Add your company")
    if (!profile.bio) hints.push("Add a bio about yourself")
    const hasExperiencesArr = Array.isArray((profile as any).experiences) && ((profile as any).experiences as unknown as Experience[]).length > 0
    if (!profile.experience && !hasExperiencesArr) hints.push("Add your experience")
    if (!profile.education) hints.push("Add your education")
    if (!profile.skills || profile.skills.length === 0) hints.push("Add your skills")
    if (!profile.location) hints.push("Add your location")
    if (!profile.phone) hints.push("Add your phone number")
    if (!profile.social_links || Object.keys(profile.social_links || {}).length === 0) hints.push("Add social media links")
    return hints
  }

  // Auth check and fetch profile
  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (!user) {
        router.push("/login")
        return
      }
      
      console.log('Fetching profile for user:', user.id)
      
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()
      
      if (error) {
        console.error('Profile fetch error:', error)
        setError("Profile not found.")
        setLoading(false)
        return
      }
      
      console.log('Profile data from database:', data)
      
      const profile: UserProfile = {
        id: (data.id as string) || user.id,
        name: (data.full_name as string) || user.email?.split('@')[0] || "User",
        email: user.email || "",
        phone: (data.phone as string) || "",
        location: (data.location as string) || "",
        title: (data.title as string) || "",
        company: (data.company as string) || "",
        bio: (data.bio as string) || "",
        experience: (data.experience as string) || "",
        education: (data.education as string) || "",
        skills: (data.skills as string[]) || [],
        joinDate: data.created_at ? new Date(data.created_at as string).toLocaleString('default', { month: 'long', year: 'numeric' }) : "",
        avatar_url: (data.avatar_url as string) || null,
        social_links: (data.social_links as SocialLinks) || {},
        portfolio_projects: (data.portfolio_projects as PortfolioProject[]) || [],
        profile_completion: (data.profile_completion as number) || 0,
        website: (data.website as string) || null,
        github_url: (data.github_url as string) || null,
        linkedin_url: (data.linkedin_url as string) || null,
        twitter_url: (data.twitter_url as string) || null,
        cv_url: (data.cv_url as string) || null,
        username: (data.username as string) || null,
        profile_visibility: (data.profile_visibility as 'public' | 'recruiters' | 'private') || 'private',
        public_profile_url: (data.public_profile_url as string) || null
      }
      
      // If the name is "Updated Name", try to get a better name
      if (profile.name === "Updated Name" || !profile.name || profile.name.trim() === "") {
        profile.name = user.email?.split('@')[0] || "User"
        console.log('Fixed name to:', profile.name)
      }
      
      // Recalculate completion after fixing the name
      const finalCompletion = calculateProfileCompletion(profile)
      profile.profile_completion = finalCompletion
      
      console.log('Final completion after name fix:', finalCompletion)
      
      setUserProfile(profile)
      setEditForm(profile)
      setProfileVisibility(profile.profile_visibility || 'private')
      
      // Fetch experiences
      const { data: experiencesData, error: experiencesError } = await supabase
        .from("experiences")
        .select("*")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false })
      
      if (experiencesError) {
        console.error('Experiences fetch error:', experiencesError)
      } else {
        const typedExperiences = (experiencesData || []).map(exp => ({
          id: exp.id as string,
          user_id: exp.user_id as string,
          job_title: exp.job_title as string,
          company_name: exp.company_name as string,
          company_website: exp.company_website as string | undefined,
          company_logo_url: exp.company_logo_url as string | undefined,
          location: exp.location as string | undefined,
          start_date: exp.start_date as string | undefined,
          end_date: exp.end_date as string | undefined,
          is_current_job: exp.is_current_job as boolean,
          years_of_experience: exp.years_of_experience as number | undefined,
          description: exp.description as string | undefined,
          created_at: exp.created_at as string,
          updated_at: exp.updated_at as string
        })) as Experience[]
        setExperiences(typedExperiences)
        // Update profile with experiences
        profile.experiences = typedExperiences
        // Sync into edit form for completion calc
        setEditForm((curr) => {
          const merged = { ...(curr || profile), experiences: typedExperiences }
          return { ...merged, profile_completion: calculateProfileCompletion(merged) }
        })
      }
      // Fetch educations
      const { data: educationsData, error: educationsError } = await supabase
        .from("educations")
        .select("*")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false })
      if (educationsError) {
        console.error('Educations fetch error:', educationsError)
      } else {
        setEducations((educationsData || []) as unknown as Education[])
      }

      // Audit logs fetching removed from UI
      setLoading(false)
    }
    fetchProfile()
  }, [router, supabase])

  // Real-time completion calculation
  useEffect(() => {
    if (editForm) {
      const completion = calculateProfileCompletion(editForm)
      setEditForm(prev => prev ? { ...prev, profile_completion: completion } : prev)
    }
  }, [editForm?.name, editForm?.title, editForm?.company, editForm?.bio, editForm?.experience, editForm?.education, editForm?.skills, editForm?.location, editForm?.phone, editForm?.github_url, editForm?.linkedin_url, editForm?.twitter_url, editForm?.website])

  // Recalculate completion when experiences list changes
  useEffect(() => {
    setEditForm(prev => {
      if (!prev) return prev
      const merged = { ...prev, experiences }
      return { ...merged, profile_completion: calculateProfileCompletion(merged) }
    })
  }, [experiences])

  // Auto-save draft functionality
  useEffect(() => {
    if (isEditing && editForm) {
      const timeoutId = setTimeout(() => {
        localStorage.setItem('profile-draft', JSON.stringify(editForm))
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [editForm, isEditing])

  // Load draft on edit start
  const handleStartEdit = () => {
    const draft = localStorage.getItem('profile-draft')
    if (draft) {
      try {
        const parsedDraft = JSON.parse(draft)
        setEditForm({ ...userProfile, ...parsedDraft })
      } catch (error) {
        console.error('Error loading draft:', error)
        setEditForm(userProfile)
      }
    } else {
      setEditForm(userProfile)
    }
    setIsEditing(true)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const validateProfile = (profile: Partial<UserProfile>): string => {
    if (!profile.name || profile.name.length < 2) return "Name is required."
    if (!profile.email || !profile.email.includes("@")) return "Valid email is required."
    return ""
  }

  const handleSave = async () => {
    if (!editForm) return
    
    setError("")
    const validationError = validateProfile(editForm)
    if (validationError) {
      setError(validationError)
      return
    }
    
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError("Not authenticated.")
      setLoading(false)
      return
    }

    // Calculate profile completion
    const completion = calculateProfileCompletion(editForm)
    
    // Prepare update data with all available columns
    const updateData: Record<string, any> = {
      full_name: editForm.name || '',
      phone: editForm.phone || null,
      location: editForm.location || null,
      title: editForm.title || null,
      company: editForm.company || null,
      bio: editForm.bio || null,
      experience: editForm.experience || null,
      education: editForm.education || null,
      skills: editForm.skills || [],
      profile_completion: completion,
      avatar_url: editForm.avatar_url || null,
      social_links: editForm.social_links || {},
      portfolio_projects: editForm.portfolio_projects || [],
      website: editForm.website || null,
      github_url: editForm.github_url || null,
      linkedin_url: editForm.linkedin_url || null,
      twitter_url: editForm.twitter_url || null
    }

    // Only include cv_url when the column exists (post-migration)
    if (typeof (editForm as any).cv_url !== 'undefined') {
      updateData.cv_url = (editForm as any).cv_url || null
    }
    
    console.log('Updating profile with data:', updateData)
    console.log('Calculated completion:', completion)
    
    // Update profile in Supabase
    const { error: updateError } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", user.id)
    
    if (updateError) {
      console.error('Profile update error:', updateError)
      setError(`Failed to update profile: ${updateError.message}`)
      setLoading(false)
      return
    }
    
    console.log('Profile updated successfully')
    
    // Audit log
    try {
      await supabase.from("audit_logs").insert({
        user_id: user.id,
        action: "profile_update",
        details: {
          updated_fields: Object.keys(updateData).filter(key => updateData[key as keyof typeof updateData] !== null && updateData[key as keyof typeof updateData] !== ''),
          completion_percentage: completion
        },
        created_at: new Date().toISOString()
      })
    } catch (auditError) {
      console.error('Audit log error:', auditError)
      // Don't fail the entire update if audit log fails
    }
    
    setUserProfile({ 
      ...editForm, 
      joinDate: userProfile?.joinDate || "", 
      id: user.id, 
      profile_completion: completion,
      name: editForm?.name || userProfile?.name || "User",
      email: editForm?.email || userProfile?.email || "",
      phone: editForm?.phone || userProfile?.phone || "",
      location: editForm?.location || userProfile?.location || "",
      title: editForm?.title || userProfile?.title || "",
      company: editForm?.company || userProfile?.company || "",
      bio: editForm?.bio || userProfile?.bio || "",
      experience: editForm?.experience || userProfile?.experience || "",
      education: editForm?.education || userProfile?.education || "",
      skills: editForm?.skills || userProfile?.skills || [],
      avatar_url: editForm?.avatar_url || userProfile?.avatar_url || null,
      social_links: editForm?.social_links || userProfile?.social_links || {},
      portfolio_projects: editForm?.portfolio_projects || userProfile?.portfolio_projects || [],
      website: editForm?.website || userProfile?.website || null,
      github_url: editForm?.github_url || userProfile?.github_url || null,
      linkedin_url: editForm?.linkedin_url || userProfile?.linkedin_url || null,
      twitter_url: editForm?.twitter_url || userProfile?.twitter_url || null,
      cv_url: editForm?.cv_url || userProfile?.cv_url || null
    } as UserProfile)
    setIsEditing(false)
    setLoading(false)
  }

  const handleCancel = () => {
    setEditForm(userProfile)
    setIsEditing(false)
    setError("")
  }

  // Get avatar URL with fallback
  const getAvatarUrl = async (avatarUrl: string | null | undefined): Promise<string | null> => {
    if (!avatarUrl) return null
    
    // If it's already a signed URL, return it
    if (avatarUrl.includes('signedUrl=')) {
      return avatarUrl
    }
    
    // If it's a file path, generate a new signed URL
    if (avatarUrl.includes(userProfile?.id || '')) {
      try {
        const { data, error } = await supabase.storage
          .from('resume')
          .createSignedUrl(avatarUrl, 60 * 60 * 24 * 365)
        
        if (!error && data?.signedUrl) {
          return data.signedUrl
        }
      } catch (error) {
        console.error('Error generating signed URL:', error)
      }
    }
    
    return avatarUrl
  }

  // Avatar upload handler
  const handleAvatarUpload = async (file: File) => {
    if (!userProfile) return
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      setError("Please select a valid image file.")
      return
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      setError("File size must be less than 5MB.")
      return
    }
    
    setUploadingAvatar(true)
    setError("")
    
    try {
      // Ensure user is authenticated
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        throw new Error("Authentication required")
      }
      
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `avatar-${Date.now()}.${fileExt}`
      
      // Use a simple path structure that works with the updated policies
      const filePath = `avatars/${user.id}/${fileName}`
      
      console.log('Uploading avatar to path:', filePath)
      
      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('resume')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw new Error(uploadError.message)
      }

      console.log('Upload successful, generating signed URL...')

      // Generate signed URL for secure access
      const { data, error: signedUrlError } = await supabase.storage
        .from('resume')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year expiry

      if (signedUrlError || !data?.signedUrl) {
        console.error('Signed URL error:', signedUrlError)
        throw new Error(signedUrlError?.message || 'Failed to generate access URL')
      }

      console.log('Signed URL generated:', data.signedUrl)

      setEditForm(curr => (curr ? { ...curr, avatar_url: data.signedUrl } : curr))
    } catch (error) {
      console.error('Avatar upload error:', error)
      setError(error instanceof Error ? error.message : "Failed to upload avatar. Please try again.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Generate random avatar
  const generateRandomAvatar = () => {
    const avatars = [
      'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
      'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
      'https://api.dicebear.com/7.x/avataaars/svg?seed=Jasper',
      'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna',
      'https://api.dicebear.com/7.x/avataaars/svg?seed=Max'
    ]
    const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)]
    setEditForm(curr => (curr ? { ...curr, avatar_url: randomAvatar } : curr))
  }

  // Alternative avatar upload using base64 (fallback)
  const handleAvatarUploadBase64 = async (file: File) => {
    if (!userProfile) return
    
    setUploadingAvatar(true)
    setError("")
    
    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        const base64String = e.target?.result as string
        setEditForm(curr => (curr ? { ...curr, avatar_url: base64String } : curr))
        setUploadingAvatar(false)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Base64 avatar upload error:', error)
      setError("Failed to process image. Please try again.")
      setUploadingAvatar(false)
    }
  }

  // Add portfolio project
  const addPortfolioProject = () => {
    if (!newProject.title || !newProject.description) return
    if (!editForm) return
    const project: PortfolioProject = {
      id: Date.now().toString(),
      title: newProject.title!,
      description: newProject.description!,
      url: newProject.url,
      image_url: newProject.image_url,
      video_url: newProject.video_url,
      technologies: newProject.technologies || [],
      created_at: new Date().toISOString()
    }

    setEditForm({
      ...editForm,
      portfolio_projects: [...(editForm.portfolio_projects || []), project]
    })
    
    setNewProject({ title: '', description: '', url: '', technologies: [] })
    setShowPortfolioForm(false)
  }

  // Remove portfolio project
  const removePortfolioProject = (projectId: string) => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      portfolio_projects: (editForm.portfolio_projects || []).filter(p => p.id !== projectId)
    })
  }

  // Handle skill addition with better UX
  const handleSkillAdd = (skill: string) => {
    if (skill.trim() && editForm) {
      const newSkills = [...(editForm.skills || []), skill.trim()]
      setEditForm({ ...editForm, skills: newSkills })
    }
  }

  // Handle skill removal
  const handleSkillRemove = (skillToRemove: string) => {
    if (editForm) {
      const newSkills = (editForm.skills || []).filter(skill => skill !== skillToRemove)
      setEditForm({ ...editForm, skills: newSkills })
    }
  }

  // Experience management functions
  const addExperience = async (experienceData: Omit<Experience, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const newExperience: Omit<Experience, 'id' | 'created_at' | 'updated_at'> = {
      user_id: user.id,
      ...experienceData
    }

    const { data, error } = await supabase
      .from('experiences')
      .insert([newExperience])
      .select()
      .single()

    if (error) {
      console.error('Error adding experience:', error)
      return
    }

    const typedExperience = (data as unknown) as Experience
    setExperiences(prev => [typedExperience, ...prev])
    setShowExperienceForm(false)
    setEditingExperience(null)
  }

  const updateExperience = async (id: string, experienceData: Partial<Experience>) => {
    const { data, error } = await supabase
      .from('experiences')
      .update(experienceData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating experience:', error)
      return
    }

    const typedExperience = (data as unknown) as Experience
    setExperiences(prev => prev.map(exp => exp.id === id ? typedExperience : exp))
    setShowExperienceForm(false)
    setEditingExperience(null)
  }

  const deleteExperience = async (id: string) => {
    const { error } = await supabase
      .from('experiences')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting experience:', error)
      return
    }

    setExperiences(prev => prev.filter(exp => exp.id !== id))
  }

  // Education CRUD
  const addEducation = async (educationData: Omit<Education, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const newEducation = { user_id: user.id, ...educationData }
    const { data, error } = await supabase.from('educations').insert([newEducation]).select().single()
    if (error) { console.error('Error adding education:', error); return }
    setEducations(prev => [{ ...(data as any) }, ...prev])
    setShowEducationForm(false)
    setEditingEducation(null)
  }

  const updateEducation = async (id: string, educationData: Partial<Education>) => {
    const { data, error } = await supabase.from('educations').update(educationData).eq('id', id).select().single()
    if (error) { console.error('Error updating education:', error); return }
    setEducations(prev => prev.map(ed => ed.id === id ? ({ ...(data as any) }) : ed))
    setShowEducationForm(false)
    setEditingEducation(null)
  }

  const deleteEducation = async (id: string) => {
    const { error } = await supabase.from('educations').delete().eq('id', id)
    if (error) { console.error('Error deleting education:', error); return }
    setEducations(prev => prev.filter(ed => ed.id !== id))
  }

  const handleCompanyWebsiteChange = async (website: string) => {
    if (isValidWebsiteUrl(website)) {
      const logoUrl = await getCompanyLogo(website)
      return logoUrl
    }
    return null
  }

  // Profile completion celebration
  const showCompletionCelebration = editForm?.profile_completion === 100 && userProfile?.profile_completion !== 100

  // Profile visibility functions
  const handleVisibilityChange = async (visibility: 'public' | 'recruiters' | 'private') => {
    if (!userProfile) return
    
    setProfileVisibility(visibility)
    
    // Update in database
    const publicUrl = visibility === 'public' ? `${window.location.origin}/profile/${userProfile.username || userProfile.id}` : null
    const { error } = await supabase
      .from('profiles')
      .update({ 
        profile_visibility: visibility,
        public_profile_url: publicUrl
      })
      .eq('id', userProfile.id)
    
    if (error) {
      console.error('Error updating visibility:', error)
      setError('Failed to update profile visibility')
    } else {
      // Update local state
      setUserProfile(prev => prev ? { ...prev, profile_visibility: visibility, public_profile_url: publicUrl } : prev)
      setEditForm(prev => prev ? { ...prev, profile_visibility: visibility, public_profile_url: publicUrl } : prev)
    }
  }

  const copyProfileLink = async () => {
    if (!userProfile?.public_profile_url) return
    
    try {
      await navigator.clipboard.writeText(userProfile.public_profile_url)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch (error) {
      console.error('Failed to copy link:', error)
      setError('Failed to copy link')
    }
  }

  const generateProfileLink = () => {
    if (!userProfile) return ''
    return `${window.location.origin}/profile/${userProfile.username || userProfile.id}`
  }

  const handleDownloadCV = () => {
    if (!userProfile) return
    
    // If a CV URL is provided, open it directly
    if (userProfile.cv_url && userProfile.cv_url.trim() !== '') {
      const url = userProfile.cv_url.startsWith('http') ? userProfile.cv_url : `https://${userProfile.cv_url}`
      window.open(url, '_blank')
      return
    }
    
    // Create CV content based on profile data
    const cvContent = `
${userProfile.name}
${userProfile.title || ''} ${userProfile.company ? `at ${userProfile.company}` : ''}
${userProfile.location || ''}
${userProfile.email || ''}
${userProfile.phone || ''}

${userProfile.bio ? `ABOUT\n${userProfile.bio}\n` : ''}

${userProfile.education ? `EDUCATION\n${userProfile.education}\n` : ''}

${experiences.length > 0 ? `EXPERIENCE\n${experiences.map(exp => 
  `${exp.job_title} at ${exp.company_name}\n${exp.start_date ? new Date(exp.start_date).toLocaleDateString() : ''} - ${exp.is_current_job ? 'Present' : (exp.end_date ? new Date(exp.end_date).toLocaleDateString() : '')}\n${exp.description || ''}\n`
).join('\n')}\n` : ''}

${userProfile.skills && userProfile.skills.length > 0 ? `SKILLS\n${userProfile.skills.join(', ')}\n` : ''}

${userProfile.portfolio_projects && userProfile.portfolio_projects.length > 0 ? `PORTFOLIO PROJECTS\n${userProfile.portfolio_projects.map((project: PortfolioProject) => 
  `${project.title}\n${project.description}\n${project.url ? `URL: ${project.url}` : ''}\n`
).join('\n')}\n` : ''}

${userProfile.github_url ? `GitHub: ${userProfile.github_url}\n` : ''}
${userProfile.linkedin_url ? `LinkedIn: ${userProfile.linkedin_url}\n` : ''}
${userProfile.twitter_url ? `Twitter: ${userProfile.twitter_url}\n` : ''}
${userProfile.website ? `Website: ${userProfile.website}\n` : ''}
    `.trim()

    // Create and download the file
    const blob = new Blob([cvContent], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${userProfile.name.replace(/\s+/g, '_')}_CV.txt`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading profile...</p>
        </div>
      </div>
    )
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>
  }
  if (!userProfile) return null

  const completionHints = getCompletionHints({ ...(editForm || userProfile), experiences })

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
              <Button variant="ghost" className="text-purple-600 font-medium">
                <User className="w-4 h-4 mr-2" />
                Profile
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
                      {userProfile.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-300 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem>
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
        {/* Profile Header */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex items-start space-x-4 min-w-0 flex-1">
                <div className="relative flex-shrink-0">
                  <Avatar className="w-20 h-20 bg-purple-500">
                    <AvatarImage src={(editForm?.avatar_url || userProfile.avatar_url) || undefined} />
                    <AvatarFallback className="bg-purple-500 text-white text-2xl font-bold">
                      {userProfile.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  {isEditing && (
                    <div className="absolute -bottom-2 -right-2 flex space-x-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-8 h-8 p-0"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingAvatar}
                      >
                        {uploadingAvatar ? (
                          <div className="w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Upload className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-8 h-8 p-0"
                        onClick={generateRandomAvatar}
                        disabled={uploadingAvatar}
                      >
                        <Wand2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        try {
                          // Try the main upload first
                          await handleAvatarUpload(file)
                        } catch (error) {
                          console.log('Main upload failed, trying base64 fallback...')
                          // If main upload fails, use base64 fallback
                          handleAvatarUploadBase64(file)
                        }
                      }
                    }}
                  />
                  {error && (
                    <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      {error}
                    </div>
                  )}
                </div>
                <div className="space-y-2 min-w-0 flex-1">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
                      {editForm?.name || userProfile.name}
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-400 truncate">
                      {editForm?.title || userProfile.title} at {editForm?.company || userProfile.company}
                    </p>
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-gray-500 flex-wrap gap-2">
                    <div className="flex items-center">
                      <MapPin className="w-4 h-4 mr-1" />
                      {editForm?.location || userProfile.location}
                    </div>
                    <div className="flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      Joined {userProfile.joinDate}
                    </div>
                  </div>
                </div>
              </div>
              
              {!isEditing ? (
                <div className="flex space-x-2 flex-wrap gap-2 flex-shrink-0">
                  <Button onClick={handleStartEdit} className="bg-purple-600 hover:bg-purple-700">
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Profile
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => router.push("/settings")}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Settings
                  </Button>
                  <div 
                    className="relative"
                    onMouseEnter={showLinkCardBriefly}
                    onFocus={showLinkCardBriefly}
                  >
                    <Button 
                      onClick={() => handleVisibilityChange(profileVisibility === 'public' ? 'private' : 'public')}
                      variant={profileVisibility === 'public' ? 'default' : 'outline'}
                      className={profileVisibility === 'public' ? 'bg-green-600 hover:bg-green-700' : ''}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      {profileVisibility === 'public' ? 'Public' : 'Private'}
                    </Button>
                    {profileVisibility === 'public' && userProfile?.public_profile_url && showPublicLinkCard && (
                      <div className="absolute top-full left-0 mt-2 p-3 bg-green-50 border border-green-200 rounded-lg shadow-lg z-10 min-w-80" onClick={hideLinkCard}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-green-800">Public Profile Link</p>
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
                        <p className="text-xs text-green-600 mb-2 break-all">{userProfile.public_profile_url}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => userProfile.public_profile_url && window.open(userProfile.public_profile_url, '_blank')}
                          className="text-xs"
                        >
                          <Share2 className="w-3 h-3 mr-1" />
                          View Public Profile
                        </Button>
                      </div>
                    )}
                  </div>
                  <Button 
                    variant="outline"
                    onClick={handleDownloadCV}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download CV
                  </Button>
                </div>
              ) : (
                <div className="flex space-x-2 flex-wrap gap-2 flex-shrink-0">
                  <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
                    <Save className="w-4 h-4 mr-2" />
                    Save
                  </Button>
                  <Button onClick={handleCancel} variant="outline">
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Profile Completion Meter */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Profile Completion</span>
              <span className="text-2xl font-bold text-purple-600">
                {editForm?.profile_completion || userProfile.profile_completion || 0}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress 
              value={editForm?.profile_completion || userProfile.profile_completion || 0} 
              className="w-full mb-4"
            />
            {showCompletionCelebration && (
              <div className="mb-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-800">🎉 Congratulations! Your profile is 100% complete!</span>
                </div>
                <p className="text-sm text-green-700 mt-1">Your profile is now fully optimized for job matching.</p>
              </div>
            )}
            {completionHints.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">Complete your profile:</p>
                <div className="flex flex-wrap gap-2">
                  {completionHints.slice(0, 3).map((hint, index) => (
                    <TooltipProvider key={index}>
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge variant="outline" className="text-xs">
                            {hint}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Click "Edit Profile" to add this information</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Profile Information */}
          <div className="lg:col-span-2 space-y-6 min-w-0">
            <Tabs defaultValue="about" className="w-full">
               <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-1">
                 <TabsTrigger value="about" className="text-xs md:text-sm truncate">About</TabsTrigger>
                 <TabsTrigger value="experience" className="text-xs md:text-sm truncate">Experience</TabsTrigger>
                 <TabsTrigger value="education" className="text-xs md:text-sm truncate">Education</TabsTrigger>
                 <TabsTrigger value="portfolio" className="text-xs md:text-sm truncate">Portfolio</TabsTrigger>
                 <TabsTrigger value="social" className="text-xs md:text-sm truncate">Social</TabsTrigger>
              </TabsList>

              <TabsContent value="about" className="space-y-6">
                {/* About Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <User className="w-5 h-5 mr-2" />
                      About
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isEditing ? (
                      <Textarea
                        value={editForm?.bio || ""}
                        onChange={(e) => setEditForm({...editForm, bio: e.target.value})}
                        className="w-full p-3 border border-gray-300 rounded-lg resize-none"
                        rows={4}
                        placeholder="Tell us about yourself..."
                      />
                    ) : (
                      <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                        {userProfile.bio}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Education inline moved to its own tab */}
              </TabsContent>

              <TabsContent value="education" className="space-y-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center">
                        <GraduationCap className="w-5 h-5 mr-2" />
                        Education
                      </CardTitle>
                      {isEditing && (
                        <Button onClick={() => setShowEducationForm(true)} className="bg-blue-600 hover:bg-blue-700">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Education
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {educations.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <GraduationCap className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                          <p>No education entries yet.</p>
                          {isEditing && (
                            <Button onClick={() => setShowEducationForm(true)} variant="outline" className="mt-2">
                              Add Your First Education
                            </Button>
                          )}
                        </div>
                      ) : (
                        educations.map((edu) => (
                          <div key={edu.id} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
                            <div className="flex items-start space-x-4">
                              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                                {edu.education_logo_url ? (
                                  <img src={edu.education_logo_url} alt={edu.school_name} className="w-8 h-8 rounded" />
                                ) : (
                                  <GraduationCap className="w-6 h-6 text-purple-600" />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900 dark:text-white">{edu.school_name}</h3>
                                    <p className="text-gray-600 dark:text-gray-400">
                                      {[edu.degree, edu.field_of_study].filter(Boolean).join(', ')}
                                    </p>
                                    {edu.education_website && (
                                      <a
                                        href={edu.education_website.startsWith('http') ? edu.education_website : `https://${edu.education_website}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                                      >
                                        <Globe className="w-3 h-3 mr-1" />
                                        {edu.education_website}
                                        <ExternalLink className="w-3 h-3 ml-1" />
                                      </a>
                                    )}
                                    <div className="flex items-center space-x-4 text-sm text-gray-500 mt-2">
                                      {edu.location && (
                                        <div className="flex items-center"><MapPin className="w-4 h-4 mr-1" />{edu.location}</div>
                                      )}
                                      {(edu.start_date || edu.end_date || edu.is_current) && (
                                        <div className="flex items-center">
                                          <Calendar className="w-4 h-4 mr-1" />
                                          {edu.start_date && new Date(edu.start_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                                          {edu.end_date && !edu.is_current ? (
                                            <>
                                              {' - '}
                                              {new Date(edu.end_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                                            </>
                                          ) : edu.is_current ? ' - Present' : null}
                                        </div>
                                      )}
                                      {typeof edu.years_of_education === 'number' && (
                                        <Badge variant="outline" className="text-xs">{edu.years_of_education} years</Badge>
                                      )}
                                    </div>
                                    {edu.description && (
                                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{edu.description}</p>
                                    )}
                                  </div>
                                  {isEditing && (
                                    <div className="flex space-x-2">
                                      <Button variant="ghost" size="sm" onClick={() => { setEditingEducation(edu); setShowEducationForm(true) }}>
                                        <Edit className="w-4 h-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" onClick={() => deleteEducation(edu.id)} className="text-red-600 hover:text-red-800">
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="experience" className="space-y-6">
                {/* Experience Section */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center">
                        <Briefcase className="w-5 h-5 mr-2" />
                        Experience
                      </CardTitle>
                      {isEditing && (
                        <Button onClick={() => setShowExperienceForm(true)} className="bg-blue-600 hover:bg-blue-700">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Experience
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {experiences.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          <Briefcase className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                          <p>No experiences added yet.</p>
                          {isEditing && (
                            <Button 
                              onClick={() => setShowExperienceForm(true)} 
                              variant="outline" 
                              className="mt-2"
                            >
                              Add Your First Experience
                            </Button>
                          )}
                        </div>
                      ) : (
                        experiences.map((experience) => (
                          <div key={experience.id} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
                            <div className="flex items-start space-x-4">
                              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                {experience.company_logo_url ? (
                                  <img 
                                    src={experience.company_logo_url} 
                                    alt={`${experience.company_name} logo`}
                                    className="w-8 h-8 rounded"
                                  />
                                ) : (
                                  <Building2 className="w-6 h-6 text-blue-600" />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900 dark:text-white">
                                      {experience.job_title}
                                    </h3>
                                    <p className="text-gray-600 dark:text-gray-400">
                                      {experience.company_name}
                                    </p>
                                    {experience.company_website && (
                                      <a 
                                        href={experience.company_website.startsWith('http') ? experience.company_website : `https://${experience.company_website}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                                      >
                                        <Globe className="w-3 h-3 mr-1" />
                                        {extractDomain(experience.company_website)}
                                        <ExternalLink className="w-3 h-3 ml-1" />
                                      </a>
                                    )}
                                    <div className="flex items-center space-x-4 text-sm text-gray-500 mt-2">
                                      {experience.location && (
                                        <div className="flex items-center">
                                          <MapPin className="w-4 h-4 mr-1" />
                                          {experience.location}
                                        </div>
                                      )}
                                      {experience.start_date && (
                                        <div className="flex items-center">
                                          <Calendar className="w-4 h-4 mr-1" />
                                          {new Date(experience.start_date).toLocaleDateString('en-US', { 
                                            year: 'numeric', 
                                            month: 'short' 
                                          })}
                                          {experience.end_date && !experience.is_current_job ? (
                                            <>
                                              {' - '}
                                              {new Date(experience.end_date).toLocaleDateString('en-US', { 
                                                year: 'numeric', 
                                                month: 'short' 
                                              })}
                                            </>
                                          ) : experience.is_current_job ? (
                                            ' - Present'
                                          ) : null}
                                        </div>
                                      )}
                                      {experience.years_of_experience && (
                                        <Badge variant="outline" className="text-xs">
                                          {experience.years_of_experience} years
                                        </Badge>
                                      )}
                                      {experience.is_current_job && (
                                        <Badge className="bg-green-100 text-green-800 text-xs">
                                          Current
                                        </Badge>
                                      )}
                                    </div>
                                    {experience.description && (
                                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                                        {experience.description}
                                      </p>
                                    )}
                                  </div>
                                  {isEditing && (
                                    <div className="flex space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setEditingExperience(experience)
                                          setShowExperienceForm(true)
                                        }}
                                      >
                                        <Edit className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => deleteExperience(experience.id)}
                                        className="text-red-600 hover:text-red-800"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="portfolio" className="space-y-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center">
                        <FileText className="w-5 h-5 mr-2" />
                        Portfolio Projects
                      </CardTitle>
                      {isEditing && (
                        <Button onClick={() => setShowPortfolioForm(true)} className="bg-purple-600 hover:bg-purple-700">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Project
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {(editForm?.portfolio_projects || userProfile.portfolio_projects || []).map((project) => (
                        <div key={project.id} className="p-4 border rounded-lg">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h3 className="font-semibold text-gray-900 dark:text-white">{project.title}</h3>
                              <p className="text-gray-600 dark:text-gray-400 mt-1">{project.description}</p>
                              {project.url && (
                                <a 
                                  href={project.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center text-purple-600 hover:text-purple-700 mt-2"
                                >
                                  <ExternalLink className="w-4 h-4 mr-1" />
                                  View Project
                                </a>
                              )}
                              {project.technologies.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {project.technologies.map((tech, index) => (
                                    <Badge key={index} variant="secondary">
                                      {tech}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            {isEditing && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => removePortfolioProject(project.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {showPortfolioForm && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Add New Project</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Input
                        placeholder="Project Title"
                        value={newProject.title}
                        onChange={(e) => setNewProject({...newProject, title: e.target.value})}
                      />
                      <Textarea
                        placeholder="Project Description"
                        value={newProject.description}
                        onChange={(e) => setNewProject({...newProject, description: e.target.value})}
                      />
                      <Input
                        placeholder="Project URL (optional)"
                        value={newProject.url}
                        onChange={(e) => setNewProject({...newProject, url: e.target.value})}
                      />
                      <Input
                        placeholder="Technologies (comma-separated)"
                        value={newProject.technologies?.join(', ')}
                        onChange={(e) => setNewProject({
                          ...newProject, 
                          technologies: e.target.value.split(',').map(t => t.trim()).filter(t => t)
                        })}
                      />
                      <div className="flex gap-2">
                        <Button onClick={addPortfolioProject} className="bg-purple-600 hover:bg-purple-700">
                          Add Project
                        </Button>
                        <Button onClick={() => setShowPortfolioForm(false)} variant="outline">
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="social" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Globe className="w-5 h-5 mr-2" />
                      Social Media & Links
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">GitHub</label>
                        {isEditing ? (
                          <Input
                            value={editForm?.github_url || ""}
                            onChange={(e) => setEditForm({...editForm, github_url: e.target.value})}
                            placeholder="https://github.com/username"
                            className="flex-1"
                          />
                        ) : (
                          <div className="flex items-center space-x-2">
                            <Github className="w-4 h-4 text-gray-400" />
                            {userProfile.github_url ? (
                              <a 
                                href={userProfile.github_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-purple-600 hover:text-purple-700"
                              >
                                {userProfile.github_url}
                              </a>
                            ) : (
                              <span className="text-gray-400">Not added</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">LinkedIn</label>
                        {isEditing ? (
                          <Input
                            value={editForm?.linkedin_url || ""}
                            onChange={(e) => setEditForm({...editForm, linkedin_url: e.target.value})}
                            placeholder="https://linkedin.com/in/username"
                            className="flex-1"
                          />
                        ) : (
                          <div className="flex items-center space-x-2">
                            <Linkedin className="w-4 h-4 text-gray-400" />
                            {userProfile.linkedin_url ? (
                              <a 
                                href={userProfile.linkedin_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-purple-600 hover:text-purple-700"
                              >
                                {userProfile.linkedin_url}
                              </a>
                            ) : (
                              <span className="text-gray-400">Not added</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Twitter</label>
                        {isEditing ? (
                          <Input
                            value={editForm?.twitter_url || ""}
                            onChange={(e) => setEditForm({...editForm, twitter_url: e.target.value})}
                            placeholder="https://twitter.com/username"
                            className="flex-1"
                          />
                        ) : (
                          <div className="flex items-center space-x-2">
                            <Twitter className="w-4 h-4 text-gray-400" />
                            {userProfile.twitter_url ? (
                              <a 
                                href={userProfile.twitter_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-purple-600 hover:text-purple-700"
                              >
                                {userProfile.twitter_url}
                              </a>
                            ) : (
                              <span className="text-gray-400">Not added</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Website</label>
                        {isEditing ? (
                          <Input
                            value={editForm?.website || ""}
                            onChange={(e) => setEditForm({...editForm, website: e.target.value})}
                            placeholder="https://yourwebsite.com"
                            className="flex-1"
                          />
                        ) : (
                          <div className="flex items-center space-x-2">
                            <Globe className="w-4 h-4 text-gray-400" />
                            {userProfile.website ? (
                              <a 
                                href={userProfile.website} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-purple-600 hover:text-purple-700"
                              >
                                {userProfile.website}
                              </a>
                            ) : (
                              <span className="text-gray-400">Not added</span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">CV URL</label>
                        {isEditing ? (
                          <Input
                            value={editForm?.cv_url || ""}
                            onChange={(e) => setEditForm({...editForm, cv_url: e.target.value})}
                            placeholder="https://example.com/your-cv.pdf"
                            className="flex-1"
                          />
                        ) : (
                          <div className="flex items-center space-x-2">
                            <FileText className="w-4 h-4 text-gray-400" />
                            {userProfile.cv_url ? (
                              <a 
                                href={userProfile.cv_url.startsWith('http') ? userProfile.cv_url : `https://${userProfile.cv_url}`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-purple-600 hover:text-purple-700"
                              >
                                {userProfile.cv_url}
                              </a>
                            ) : (
                              <span className="text-gray-400">Not added</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6 lg:col-span-1">
            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  {isEditing ? (
                    <Input
                      value={editForm?.email || ""}
                      onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                      placeholder="Email"
                      className="flex-1 min-w-0"
                    />
                  ) : (
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {userProfile.email}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center space-x-3">
                  <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  {isEditing ? (
                    <Input
                      value={editForm?.phone || ""}
                      onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                      placeholder="Phone"
                      className="flex-1 min-w-0"
                    />
                  ) : (
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {userProfile.phone}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center space-x-3">
                  <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  {isEditing ? (
                    <Input
                      value={editForm?.location || ""}
                      onChange={(e) => setEditForm({...editForm, location: e.target.value})}
                      placeholder="Location"
                      className="flex-1 min-w-0"
                    />
                  ) : (
                    <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {userProfile.location}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Skills */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Award className="w-5 h-5 mr-2" />
                  Skills
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(editForm?.skills || userProfile.skills || []).map((skill, index) => (
                    <Badge key={index} variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
                      {skill}
                      {isEditing && (
                        <button
                          onClick={() => handleSkillRemove(skill)}
                          className="ml-1 text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-200"
                        >
                          ×
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
                {isEditing && (
                  <div className="mt-3">
                    <Input
                      placeholder="Add a skill and press Enter"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                          handleSkillAdd((e.target as HTMLInputElement).value.trim());
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>



            {/* Quick Stats hidden */}
          </div>
        </div>
      </div>

      {/* Experience Form Modal */}
      {showExperienceForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <ExperienceForm
              experience={editingExperience}
              onSave={async (experienceData) => {
                if (editingExperience) {
                  await updateExperience(editingExperience.id, experienceData)
                } else {
                  await addExperience(experienceData)
                }
              }}
              onCancel={() => {
                setShowExperienceForm(false)
                setEditingExperience(null)
              }}
            />
          </div>
        </div>
      )}

      {showEducationForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <EducationForm
              education={editingEducation}
              onSave={async (educationData) => {
                if (editingEducation) {
                  await updateEducation(editingEducation.id, educationData)
                } else {
                  await addEducation(educationData)
                }
              }}
              onCancel={() => {
                setShowEducationForm(false)
                setEditingEducation(null)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}