import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { scoreJob, type JobMatch, type UserProfile } from './job-scoring'

export { scoreJob, parseSalary, parseExperience } from './job-scoring'
export type { JobMatch, UserProfile } from './job-scoring'

/* -------------------------------------------------------------------------- */
/* Engine                                                                      */
/* -------------------------------------------------------------------------- */

export interface RecommendOptions {
  limit?: number
  /** Rows pulled from Postgres before ranking. */
  candidatePoolSize?: number
  /** Drop results below this score rather than padding the list with noise. */
  minScore?: number
}

export class JobMatchingEngine {
  private supabase: SupabaseClient

  /**
   * Accepts an injected client so callers can pass a request-scoped,
   * RLS-respecting client. Falls back to the service-role client only when
   * nothing is supplied, which keeps this usable from trusted server contexts
   * without making service-role the default everywhere.
   */
  constructor(client?: SupabaseClient) {
    this.supabase =
      client ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
  }

  async calculateJobMatch(job: any, userProfile: UserProfile): Promise<JobMatch> {
    return scoreJob(job, userProfile)
  }

  async getRecommendedJobs(userId: string, options: RecommendOptions = {}): Promise<JobMatch[]> {
    const { limit = 20, candidatePoolSize = 500, minScore = 1 } = options

    const { data: profile } = await this.supabase
      .from('profiles')
      .select('preferences, skills, experience, location')
      .eq('id', userId)
      .maybeSingle()

    if (!profile) return []

    const { data: resumes } = await this.supabase
      .from('resumes')
      .select('parsed_info, ats_analysis')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    const userSkills: string[] = resumes?.[0]?.parsed_info?.skills || (profile as any).skills || []
    const userExperience: string = resumes?.[0]?.parsed_info?.experience || (profile as any).experience || ''
    const preferences = (profile as any).preferences || {}

    // ---- Stage 1: retrieval -------------------------------------------------
    // Bounded, ordered, and filtered in the database. The old code fetched the
    // entire table.
    let query = this.supabase
      .from('jobs')
      .select('*')
      .order('posted_time', { ascending: false })
      .limit(candidatePoolSize)

    // Hard filters from explicit preferences. These are constraints, not
    // signals, so they belong in retrieval rather than in the score.
    if (preferences.workType && preferences.workType !== 'any') {
      query = query.ilike('work_type', `%${preferences.workType}%`)
    }
    if (preferences.jobType && preferences.jobType !== 'any') {
      query = query.ilike('type', `%${preferences.jobType}%`)
    }

    const { data: jobs, error } = await query
    if (error || !jobs) return []

    // ---- Stage 2: ranking ---------------------------------------------------
    const userProfile: UserProfile = {
      skills: userSkills,
      experience: userExperience,
      location: (profile as any).location || '',
      salary: Number(preferences?.minimumSalary) || 0,
      preferences,
    }

    return jobs
      .map((job) => scoreJob(job, userProfile))
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
