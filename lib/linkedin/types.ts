export interface LinkedInExperience {
  title: string
  company: string
  companyLogo?: string
  location?: string
  dateRange: string
  duration?: string
  description?: string
  isCurrent?: boolean
}

export interface LinkedInEducation {
  school: string
  degree?: string
  fieldOfStudy?: string
  dateRange?: string
  description?: string
  logo?: string
}

export interface LinkedInSkill {
  name: string
  endorsements?: number
}

export interface LinkedInCertification {
  name: string
  issuer: string
  dateIssued?: string
  credentialUrl?: string
}

export interface LinkedInProfile {
  name: string
  headline: string
  location: string
  about: string
  photoUrl: string
  profileUrl: string
  connectionCount: number | string
  experience: LinkedInExperience[]
  education: LinkedInEducation[]
  skills: LinkedInSkill[]
  certifications: LinkedInCertification[]
  languages: string[]
  recommendationCount: number
  parsedAt: string
}

export interface ProfileAnalysis {
  overallScore: number
  strengths: string[]
  improvements: string[]
  salaryEstimate: { min: number; max: number; currency: string; confidence: string }
  careerTrajectory: { currentLevel: string; nextRole: string; timeframe: string; skills_to_develop: string[] }
  recruiterInsights: {
    hiringLikelihood: string
    idealRoles: string[]
    redFlags: string[]
    standoutFactors: string[]
  }
  jobFitSummary: string
  industryBenchmark: string
}

export interface LinkedInInsightResult {
  profile: LinkedInProfile
  analysis: ProfileAnalysis
  contactDiscovery?: {
    emails: Array<{ address: string; confidence: number; source: string; verified: boolean }>
  }
  savedAt?: string
}
