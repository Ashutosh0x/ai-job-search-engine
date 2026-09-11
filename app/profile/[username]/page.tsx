"use client"

import { useEffect, useState } from "react"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { 
  MapPin, 
  Building2, 
  Globe, 
  Github, 
  Linkedin, 
  Twitter, 
  ExternalLink,
  Calendar,
  Briefcase,
  User,
  EyeOff,
  GraduationCap,
  FileText,
  Download
} from "lucide-react"
import { extractDomain } from "@/lib/company-logo"

interface PublicProfile {
  id: string
  username: string
  full_name: string
  title?: string
  company?: string
  bio?: string
  education?: string
  location?: string
  avatar_url?: string
  website?: string
  github_url?: string
  linkedin_url?: string
  twitter_url?: string
  skills?: string[]
  portfolio_projects?: PortfolioProject[]
  cv_url?: string
  profile_visibility: 'public' | 'recruiters' | 'private'
  created_at: string
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
}

export default function PublicProfilePage({ params }: { params: { username: string } }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = getSupabaseClientSafe()

  useEffect(() => {
    async function fetchPublicProfile() {
      try {
        // Fetch profile by username
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('username', params.username)
          .eq('profile_visibility', 'public')
          .single()

        if (profileError) {
          if (profileError.code === 'PGRST116') {
            setError('Profile not found or not public')
          } else {
            setError('Failed to load profile')
          }
          return
        }

        if (!profileData) {
          setError('Profile not found')
          return
        }

        setProfile(profileData)

        // Fetch experiences for this user
        const { data: experiencesData, error: experiencesError } = await supabase
          .from('experiences')
          .select('*')
          .eq('user_id', profileData.id)
          .order('start_date', { ascending: false })

        if (!experiencesError && experiencesData) {
          setExperiences(experiencesData)
        }

      } catch (err) {
        console.error('Error fetching profile:', err)
        setError('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }

    fetchPublicProfile()
  }, [params.username, supabase])

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-32 bg-gray-200 rounded-lg mb-6"></div>
            <div className="space-y-4">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-8">
            <EyeOff className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-red-800 mb-2">Profile Not Found</h1>
            <p className="text-red-600 mb-4">{error || 'This profile is not available'}</p>
            <Button onClick={() => window.history.back()}>
              Go Back
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const getAvatarUrl = async (avatarUrl: string) => {
    try {
      const { data } = await supabase.storage
        .from('resume')
        .createSignedUrl(avatarUrl, 3600)
      return data?.signedUrl
    } catch (error) {
      console.error('Error getting avatar URL:', error)
      return null
    }
  }

  const handleDownloadCV = () => {
    if (!profile) return
    
    // Prefer explicit CV URL if available
    if (profile.cv_url && profile.cv_url.trim() !== '') {
      const url = profile.cv_url.startsWith('http') ? profile.cv_url : `https://${profile.cv_url}`
      window.open(url, '_blank')
      return
    }
    
    // Create CV content based on profile data
    const cvContent = `
${profile.full_name}
${profile.title || ''} ${profile.company ? `at ${profile.company}` : ''}
${profile.location || ''}

${profile.bio ? `ABOUT\n${profile.bio}\n` : ''}

${profile.education ? `EDUCATION\n${profile.education}\n` : ''}

${experiences.length > 0 ? `EXPERIENCE\n${experiences.map(exp => 
  `${exp.job_title} at ${exp.company_name}\n${exp.start_date ? new Date(exp.start_date).toLocaleDateString() : ''} - ${exp.is_current_job ? 'Present' : (exp.end_date ? new Date(exp.end_date).toLocaleDateString() : '')}\n${exp.description || ''}\n`
).join('\n')}\n` : ''}

${profile.skills && profile.skills.length > 0 ? `SKILLS\n${profile.skills.join(', ')}\n` : ''}

${profile.portfolio_projects && profile.portfolio_projects.length > 0 ? `PORTFOLIO PROJECTS\n${profile.portfolio_projects.map((project: PortfolioProject) => 
  `${project.title}\n${project.description}\n${project.url ? `URL: ${project.url}` : ''}\n`
).join('\n')}\n` : ''}

${profile.github_url ? `GitHub: ${profile.github_url}\n` : ''}
${profile.linkedin_url ? `LinkedIn: ${profile.linkedin_url}\n` : ''}
${profile.twitter_url ? `Twitter: ${profile.twitter_url}\n` : ''}
${profile.website ? `Website: ${profile.website}\n` : ''}
    `.trim()

    // Create and download the file
    const blob = new Blob([cvContent], { type: 'text/plain' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${profile.full_name.replace(/\s+/g, '_')}_CV.txt`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-start space-x-6">
              <Avatar className="w-24 h-24">
                <AvatarImage src={profile.avatar_url || undefined} alt={profile.full_name} />
                <AvatarFallback className="text-2xl">
                  {profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h1 className="text-3xl font-bold mb-2">{profile.full_name}</h1>
                {profile.title && (
                  <p className="text-xl text-gray-600 mb-2">{profile.title}</p>
                )}
                {profile.company && (
                  <p className="text-lg text-gray-500 mb-2">{profile.company}</p>
                )}
                {profile.location && (
                  <div className="flex items-center text-gray-500 mb-4">
                    <MapPin className="w-4 h-4 mr-2" />
                    {profile.location}
                  </div>
                )}
                {profile.bio && (
                  <p className="text-gray-700 mb-4">{profile.bio}</p>
                )}
                
                                 {/* Social Links */}
                 <div className="flex space-x-4">
                   {profile.website && (
                     <Button variant="outline" size="sm" asChild>
                       <a href={profile.website} target="_blank" rel="noopener noreferrer">
                         <Globe className="w-4 h-4 mr-2" />
                         Website
                       </a>
                     </Button>
                   )}
                   {profile.github_url && (
                     <Button variant="outline" size="sm" asChild>
                       <a href={profile.github_url} target="_blank" rel="noopener noreferrer">
                         <Github className="w-4 h-4 mr-2" />
                         GitHub
                       </a>
                     </Button>
                   )}
                   {profile.linkedin_url && (
                     <Button variant="outline" size="sm" asChild>
                       <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer">
                         <Linkedin className="w-4 h-4 mr-2" />
                         LinkedIn
                       </a>
                     </Button>
                   )}
                   {profile.twitter_url && (
                     <Button variant="outline" size="sm" asChild>
                       <a href={profile.twitter_url} target="_blank" rel="noopener noreferrer">
                         <Twitter className="w-4 h-4 mr-2" />
                         Twitter
                       </a>
                     </Button>
                   )}
                   <Button 
                     variant="outline" 
                     size="sm"
                     onClick={handleDownloadCV}
                     className="bg-gray-100 hover:bg-gray-200 text-gray-700"
                   >
                     <Download className="w-4 h-4 mr-2" />
                     Download CV
                   </Button>
                 </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About Section */}
        {profile.bio && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <User className="w-5 h-5 mr-2" />
                About
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 leading-relaxed">{profile.bio}</p>
            </CardContent>
          </Card>
        )}

        {/* Education Section */}
        {profile.education && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <GraduationCap className="w-5 h-5 mr-2" />
                Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700">{profile.education}</p>
            </CardContent>
          </Card>
        )}

        {/* Experience Section */}
        {experiences.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Briefcase className="w-5 h-5 mr-2" />
                Experience
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {experiences.map((experience) => (
                  <div key={experience.id} className="flex space-x-4">
                    {experience.company_logo_url && (
                      <img 
                        src={experience.company_logo_url} 
                        alt={`${experience.company_name} logo`}
                        className="w-12 h-12 rounded object-contain flex-shrink-0"
                      />
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{experience.job_title}</h3>
                      <div className="flex items-center space-x-2 mb-2">
                        <Building2 className="w-4 h-4 text-gray-500" />
                        <span className="font-medium">{experience.company_name}</span>
                        {experience.company_website && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={experience.company_website} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </Button>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-500 mb-2">
                        {experience.location && (
                          <div className="flex items-center">
                            <MapPin className="w-3 h-3 mr-1" />
                            {experience.location}
                          </div>
                        )}
                        <div className="flex items-center">
                          <Calendar className="w-3 h-3 mr-1" />
                          {experience.start_date && new Date(experience.start_date).toLocaleDateString()}
                          {experience.end_date && !experience.is_current_job && (
                            <> - {new Date(experience.end_date).toLocaleDateString()}</>
                          )}
                          {experience.is_current_job && " - Present"}
                        </div>
                        {experience.years_of_experience && (
                          <Badge variant="outline">
                            {experience.years_of_experience} years
                          </Badge>
                        )}
                        {experience.is_current_job && (
                          <Badge variant="default">Current</Badge>
                        )}
                      </div>
                      {experience.description && (
                        <p className="text-gray-700 text-sm">{experience.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Portfolio Projects Section */}
        {profile.portfolio_projects && profile.portfolio_projects.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="w-5 h-5 mr-2" />
                Portfolio Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {profile.portfolio_projects.map((project) => (
                  <div key={project.id} className="p-4 border rounded-lg">
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
                      {project.technologies && project.technologies.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {project.technologies.map((tech, index) => (
                            <Badge key={index} variant="secondary">
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Skills Section */}
        {profile.skills && profile.skills.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill, index) => (
                  <Badge key={index} variant="secondary">
                    {skill}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
