import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/api-auth'
import { guard, EXPENSIVE_READ } from '@/lib/api-guard'
import {
  AnalyzerFailedError,
  AnalyzerUnavailableError,
  analyzeProfile,
  estimateSalary,
  generateRecruiterBrief,
  matchToJobs,
  predictCareer,
} from '@/lib/linkedin/analyzer'
import {
  LIMITS,
  assessCompleteness,
  insightRequestSchema,
  type AnalysisKind,
  type AnalysisWarning,
  type InsightResponse,
  type LinkedInProfile,
} from '@/lib/linkedin/types'
import { discoverContact } from '@/lib/contacts/enricher'

/**
 * LinkedIn Insight.
 *
 * TWO IDOR BUGS WERE FIXED HERE, and they are worth stating because the shape
 * that produced them is easy to reintroduce:
 *
 *   GET  ?userId=<anyone>   — no authentication at all, then queried
 *                             `linkedin_profiles` with the SERVICE-ROLE key,
 *                             which bypasses RLS. Any unauthenticated caller
 *                             could read any user's saved LinkedIn dossiers by
 *                             changing one query parameter.
 *   POST { userId, ... }    — same, for writes: upserted into whatever user_id
 *                             the body named.
 *
 * `lib/api-auth.ts` already existed to prevent exactly this, and says so in its
 * own comment ("Several routes used to take a `userId` from the request body and
 * then act on it with the service-role key"). This route predated or missed that
 * fix. Identity now comes only from a verified access token; the request schema
 * is `.strict()` and has no `userId` field, so a client cannot express one and a
 * stale client that still sends one fails loudly rather than being ignored.
 *
 * The service-role client remains, because the table is written on the user's
 * behalf — but every statement is scoped by `user.id` from the token, never from
 * input.
 */

/**
 * Resolved per request, never at module scope.
 *
 * `createClient('', '')` throws "supabaseUrl is required", and a module-level
 * call runs at IMPORT time — during `next build` that is the "Collecting page
 * data" phase, which has no env vars in CI or on a fresh Vercel project. A
 * top-level client therefore fails the whole build rather than one request.
 */
function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/** Analyses run when the client does not ask for a specific set. */
const DEFAULT_ANALYSES: AnalysisKind[] = ['profile', 'salary', 'career', 'recruiterBrief', 'contacts']

/**
 * Read the body with a hard size cap, before it is parsed.
 *
 * `req.json()` on a 50 MB body buffers all of it first. The cap is applied to
 * the declared length when the client sends one and to the actual text either
 * way, because Content-Length is a client claim.
 */
async function readBoundedJson(
  req: NextRequest
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > LIMITS.requestBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body too large' }, { status: 413 }),
    }
  }

  const text = await req.text()
  if (text.length > LIMITS.requestBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body too large' }, { status: 413 }),
    }
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body is not valid JSON' }, { status: 400 }),
    }
  }
}

export async function POST(req: NextRequest) {
  // Rate limit first: the analyses behind this route are billed model calls, so
  // the cheapest possible refusal has to come before any work. The middleware
  // matcher excludes `api`, so this is the only limiter in front of it.
  const limited = guard(req, 'linkedin-insight', EXPENSIVE_READ)
  if (limited) return limited

  const auth = await requireUser(req)
  if ('response' in auth) return auth.response
  const user = auth.user

  const body = await readBoundedJson(req)
  if (!body.ok) return body.response

  const parsed = insightRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    // Field paths only — never `parsed.error`, whose issues echo the submitted
    // VALUES back to the caller and describe our internal schema.
    return NextResponse.json(
      {
        error: 'Invalid request body',
        fields: parsed.error.issues.slice(0, 20).map((i) => i.path.join('.') || '(root)'),
      },
      { status: 400 }
    )
  }

  const { profile, saveProfile, profileType, savedJobs } = parsed.data
  const requested = new Set<AnalysisKind>(parsed.data.analyses ?? DEFAULT_ANALYSES)
  const completeness = assessCompleteness(profile)
  const warnings: AnalysisWarning[] = []

  // Refuse rather than analyse a profile that is almost empty. With no headline
  // and no roles there is nothing to reason from, and the panel would render a
  // score out of 100 that came from a name.
  if (completeness.tooSparseToAnalyze) {
    return NextResponse.json(
      {
        error:
          'Not enough of this profile was captured to analyse. Open the full profile on LinkedIn and sync again.',
        completeness,
      },
      { status: 422 }
    )
  }

  /**
   * Run one analysis, converting failure into a warning.
   *
   * A single failing analysis must not fail the request: the panel shows five
   * independent cards, and losing the salary estimate is not a reason to lose
   * the profile analysis too. The reason reaches the user through `warnings`
   * rather than being swallowed into a null the UI cannot explain.
   */
  async function attempt<T>(kind: AnalysisKind, run: () => Promise<T>): Promise<T | null> {
    if (!requested.has(kind)) return null
    try {
      return await run()
    } catch (error) {
      // Both analyzer errors carry messages written to be shown to a user.
      // Anything else is unexpected — logged, and replaced with a generic line,
      // because an arbitrary thrown value may embed provider or query detail.
      if (error instanceof AnalyzerUnavailableError || error instanceof AnalyzerFailedError) {
        warnings.push({ kind, message: error.message })
      } else {
        console.error(`[linkedin-insight] ${kind} failed`, error)
        warnings.push({ kind, message: `${kind} could not be completed` })
      }
      return null
    }
  }

  const [analysis, salaryEstimate, careerPrediction, recruiterBrief, jobFitResults, contactDiscovery] =
    await Promise.all([
      attempt('profile', () => analyzeProfile(profile)),
      attempt('salary', () => estimateSalary(profile)),
      attempt('career', () => predictCareer(profile)),
      attempt('recruiterBrief', () => generateRecruiterBrief(profile)),
      attempt('jobFit', () =>
        savedJobs.length ? matchToJobs(profile, savedJobs) : Promise.resolve([])
      ),
      attempt('contacts', () => discoverEmails(profile)),
    ])

  let savedAt: string | null = null
  if (saveProfile) {
    savedAt = await persistProfile({
      userId: user.id,
      profile,
      profileType,
      analysis,
      salaryEstimate,
      careerPrediction,
      recruiterBrief,
      jobFitResults,
      contactDiscovery,
    })
    if (!savedAt) {
      warnings.push({ kind: 'profile', message: 'Analysis completed but could not be saved' })
    }
  }

  const response: InsightResponse = {
    profile,
    completeness,
    analysis,
    salaryEstimate,
    careerPrediction,
    jobFitResults: jobFitResults && jobFitResults.length ? jobFitResults : null,
    recruiterBrief,
    contactDiscovery,
    warnings,
    savedAt,
  }

  return NextResponse.json(response)
}

/** Contact discovery from the profile's current employer. */
async function discoverEmails(
  profile: LinkedInProfile
): Promise<InsightResponse['contactDiscovery']> {
  const company = profile.experience[0]?.company
  if (!company) return null

  // A single-token name has no surname to pattern against, and guessing one
  // produces a plausible address for a person who may not exist.
  const parts = profile.name.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')

  const result = await discoverContact({ firstName, lastName, company })
  const emails = result?.contact?.emails
  return emails?.length ? { emails } : null
}

/** Persist under the AUTHENTICATED user's id. Returns the timestamp, or null. */
async function persistProfile(input: {
  userId: string
  profile: LinkedInProfile
  profileType: 'self' | 'contact'
  analysis: unknown
  salaryEstimate: unknown
  careerPrediction: unknown
  recruiterBrief: unknown
  jobFitResults: unknown
  contactDiscovery: unknown
}): Promise<string | null> {
  const supabase = getServiceClient()
  if (!supabase) return null

  const { profile } = input
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('linkedin_profiles')
    .upsert(
      {
        // From the verified token. Never from the request body.
        user_id: input.userId,
        linkedin_url: profile.profileUrl ?? null,
        full_name: profile.name,
        headline: profile.headline ?? null,
        location: profile.location ?? null,
        about: profile.about ?? null,
        photo_url: profile.photoUrl ?? null,
        // Null, not 0, when LinkedIn did not show a count — a stored 0 reads
        // back as "this person has no connections".
        connection_count: profile.connectionCount ?? null,
        experience: profile.experience,
        education: profile.education,
        skills: profile.skills.map((s) => s.name),
        certifications: profile.certifications,
        languages: profile.languages,
        recommendation_count: profile.recommendationCount ?? null,
        ai_analysis: {
          ...(input.analysis && typeof input.analysis === 'object' ? input.analysis : {}),
          salaryEstimate: input.salaryEstimate,
          careerPrediction: input.careerPrediction,
          recruiterBrief: input.recruiterBrief,
          jobFitResults: input.jobFitResults,
        },
        contact_discovery: input.contactDiscovery,
        profile_type: input.profileType,
        synced_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,linkedin_url' }
    )
    .select('updated_at')
    .single()

  if (error) {
    console.error('[linkedin-insight] save failed', error)
    return null
  }
  return data?.updated_at ?? null
}

/**
 * The caller's own saved profiles.
 *
 * No `userId` parameter exists any more. The rows returned are those belonging
 * to the token holder, and a caller cannot ask about anyone else.
 */
export async function GET(req: NextRequest) {
  const limited = guard(req, 'linkedin-insight-list', EXPENSIVE_READ)
  if (limited) return limited

  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const supabase = getServiceClient()
  if (!supabase) {
    // Fail closed and say so, rather than returning an empty list that reads as
    // "this user has saved no profiles".
    return NextResponse.json(
      { error: 'Profile storage is not configured on this deployment' },
      { status: 503 }
    )
  }

  const { data, error } = await supabase
    .from('linkedin_profiles')
    .select(
      'id, linkedin_url, full_name, headline, location, photo_url, profile_type, synced_at, updated_at'
    )
    .eq('user_id', auth.user.id)
    .order('updated_at', { ascending: false })
    .limit(200)

  if (error) {
    // The Postgres message can name columns and constraints; log it, do not ship it.
    console.error('[linkedin-insight] list failed', error)
    return NextResponse.json({ error: 'Could not load saved profiles' }, { status: 500 })
  }

  return NextResponse.json({ profiles: data ?? [] })
}
