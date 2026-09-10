import { createClient } from '@supabase/supabase-js'

interface JobMatch {
  jobId: string
  score: number
  reasons: string[]
  skillMatch: number
  experienceMatch: number
  locationMatch: number
  salaryMatch: number
}

interface UserProfile {
  skills: string[]
  experience: string
  location: string
  salary: number
  preferences: any
}

export class JobMatchingEngine {
  private supabase: any

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  async calculateJobMatch(job: any, userProfile: UserProfile): Promise<JobMatch> {
    const reasons: string[] = []
    let totalScore = 0
    let skillMatch = 0
    let experienceMatch = 0
    let locationMatch = 0
    let salaryMatch = 0

    // Skill matching (40% weight)
    if (job.requirements?.skills && userProfile.skills) {
      const jobSkills = Array.isArray(job.requirements.skills) 
        ? job.requirements.skills 
        : [job.requirements.skills]
      
      const matchedSkills = userProfile.skills.filter(skill =>
        jobSkills.some(jobSkill => 
          jobSkill.toLowerCase().includes(skill.toLowerCase()) ||
          skill.toLowerCase().includes(jobSkill.toLowerCase())
        )
      )
      
      skillMatch = (matchedSkills.length / jobSkills.length) * 100
      totalScore += skillMatch * 0.4
      
      if (matchedSkills.length > 0) {
        reasons.push(`Matched ${matchedSkills.length} skills: ${matchedSkills.join(', ')}`)
      }
    }

    // Experience matching (25% weight)
    if (job.experience && userProfile.experience) {
      const jobExp = this.parseExperience(job.experience)
      const userExp = this.parseExperience(userProfile.experience)
      
      if (userExp >= jobExp.min && userExp <= jobExp.max) {
        experienceMatch = 100
        reasons.push('Experience level matches job requirements')
      } else if (userExp >= jobExp.min) {
        experienceMatch = 80
        reasons.push('Overqualified but suitable')
      } else {
        experienceMatch = Math.max(0, 100 - (jobExp.min - userExp) * 20)
        reasons.push('Experience level below requirements')
      }
      
      totalScore += experienceMatch * 0.25
    }

    // Location matching (20% weight)
    if (job.location && userProfile.location) {
      const distance = this.calculateLocationDistance(job.location, userProfile.location)
      if (distance < 50) {
        locationMatch = 100
        reasons.push('Location is a good match')
      } else if (distance < 100) {
        locationMatch = 75
        reasons.push('Location is within reasonable distance')
      } else {
        locationMatch = Math.max(0, 100 - distance)
        reasons.push('Location may require relocation')
      }
      
      totalScore += locationMatch * 0.2
    }

    // Salary matching (15% weight)
    if (job.salary && userProfile.salary) {
      const jobSalary = this.parseSalary(job.salary)
      if (jobSalary.min >= userProfile.salary) {
        salaryMatch = 100
        reasons.push('Salary meets expectations')
      } else if (jobSalary.max >= userProfile.salary) {
        salaryMatch = 75
        reasons.push('Salary range includes expectations')
      } else {
        salaryMatch = Math.max(0, 100 - (userProfile.salary - jobSalary.max) / 1000)
        reasons.push('Salary below expectations')
      }
      
      totalScore += salaryMatch * 0.15
    }

    return {
      jobId: job.id,
      score: Math.round(totalScore),
      reasons,
      skillMatch: Math.round(skillMatch),
      experienceMatch: Math.round(experienceMatch),
      locationMatch: Math.round(locationMatch),
      salaryMatch: Math.round(salaryMatch)
    }
  }

  private parseExperience(experience: string): { min: number; max: number } {
    const years = experience.match(/(\d+)/g)
    if (years && years.length >= 2) {
      return { min: parseInt(years[0]), max: parseInt(years[1]) }
    } else if (years && years.length === 1) {
      const year = parseInt(years[0])
      return { min: year, max: year + 2 }
    }
    return { min: 0, max: 10 }
  }

  private parseSalary(salary: string): { min: number; max: number } {
    const amounts = salary.match(/\$?([\d,]+)k?/gi)
    if (amounts && amounts.length >= 2) {
      const min = parseInt(amounts[0].replace(/[$,k]/gi, '')) * 1000
      const max = parseInt(amounts[1].replace(/[$,k]/gi, '')) * 1000
      return { min, max }
    } else if (amounts && amounts.length === 1) {
      const amount = parseInt(amounts[0].replace(/[$,k]/gi, '')) * 1000
      return { min: amount * 0.8, max: amount * 1.2 }
    }
    return { min: 50000, max: 150000 }
  }

  private calculateLocationDistance(location1: string, location2: string): number {
    // Simplified distance calculation - in production, use geocoding API
    if (location1.toLowerCase().includes(location2.toLowerCase()) || 
        location2.toLowerCase().includes(location1.toLowerCase())) {
      return 0
    }
    return 50 // Default distance
  }

  async getRecommendedJobs(userId: string, limit: number = 20): Promise<JobMatch[]> {
    // Get user profile and preferences
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('preferences, skills, experience, location')
      .eq('id', userId)
      .single()

    if (!profile) return []

    // Get user's resume for skills extraction
    const { data: resumes } = await this.supabase
      .from('resumes')
      .select('parsed_info, ats_analysis')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    const userSkills = resumes?.[0]?.parsed_info?.skills || profile.skills || []
    const userExperience = resumes?.[0]?.parsed_info?.experience || profile.experience || ''

    // Get all jobs
    const { data: jobs } = await this.supabase
      .from('jobs')
      .select('*')
      .order('posted_time', { ascending: false })

    if (!jobs) return []

    // Calculate matches for all jobs
    const matches = await Promise.all(
      jobs.map(job => this.calculateJobMatch(job, {
        skills: userSkills,
        experience: userExperience,
        location: profile.location || '',
        salary: profile.preferences?.minimumSalary || 50000,
        preferences: profile.preferences
      }))
    )

    // Sort by score and return top matches
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
