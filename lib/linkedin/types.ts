import { z } from 'zod'

/**
 * The LinkedIn Insight data contract.
 *
 * ZOD IS THE SOURCE OF TRUTH, and every exported type is inferred from a schema
 * rather than declared alongside one. The previous version declared hand-written
 * interfaces and the API validated with `profile: z.any()`, so the interface was
 * a description of what someone hoped would arrive — the route cast whatever it
 * got with `as LinkedInProfile` and the analyzer read fields off it. Inferring
 * makes that drift impossible: if a field is not in the schema it is not in the
 * type, and nothing can be cast past the parser.
 *
 * WHAT CROSSES WHICH BOUNDARY
 *
 *   extension content script  →  RawProfilePayload   (untrusted, loose)
 *   validation                →  LinkedInProfile     (normalized, bounded)
 *   analyzer                  →  Analysis*           (validated model output)
 *   API                       →  InsightResponse     (what the page renders)
 *
 * EVERYTHING FROM LINKEDIN IS UNTRUSTED TEXT. A profile's About section, a job
 * description and a role title are all attacker-influenced: anyone can write
 * anything on their own LinkedIn profile, and this product reads other people's
 * profiles. That is why the bounds below exist and why the analyzer delimits
 * this content rather than interpolating it into instructions.
 */

/* ------------------------------------------------------------------ limits -- */

/**
 * Field and collection caps.
 *
 * These bound cost and blast radius rather than expressing a belief about real
 * profiles. An unbounded `about` goes straight into an LLM prompt, so a 2 MB
 * one is a bill and a latency spike; an unbounded `experience` array is the
 * same multiplied by rows. Generous enough that a real profile is never
 * truncated in a way a user would notice.
 */
export const LIMITS = {
  shortText: 300,
  mediumText: 1_000,
  longText: 5_000,
  url: 2_048,
  experience: 40,
  education: 20,
  skills: 150,
  certifications: 60,
  languages: 30,
  posts: 20,
  awards: 40,
  /** Hard cap on the raw JSON body, enforced before parsing. */
  requestBytes: 256 * 1_024,
} as const

/* --------------------------------------------------------------- primitives -- */

/**
 * Text arriving from LinkedIn.
 *
 * Trims, collapses runs of whitespace, and truncates. Collapsing matters for
 * more than tidiness: `innerText` on LinkedIn's markup produces long runs of
 * newlines and non-breaking spaces, and a prompt built from it wastes tokens on
 * whitespace and makes the delimiters harder for the model to see.
 */
const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max))

/** Optional text: absent, empty and whitespace-only all normalize to undefined. */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((s) => {
      if (typeof s !== 'string') return undefined
      const cleaned = s.replace(/\s+/g, ' ').trim()
      return cleaned.length ? cleaned.slice(0, max) : undefined
    })
    .pipe(z.string().max(max).optional())

/**
 * A URL we are willing to store or render.
 *
 * https only, and length-capped. Rejecting other schemes here is what stops a
 * `javascript:` or `data:` value reaching an `href` or `img src` in the panel —
 * the parser reads these straight off the page, so they are attacker-supplied.
 * Anything unacceptable becomes undefined rather than an error: one odd image
 * URL should not fail a whole profile.
 */
const httpsUrl = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return undefined
    const value = raw.trim().slice(0, LIMITS.url)
    try {
      const parsed = new URL(value)
      return parsed.protocol === 'https:' ? parsed.toString() : undefined
    } catch {
      return undefined
    }
  })
  .pipe(z.string().max(LIMITS.url).optional())

/**
 * Connection count.
 *
 * LinkedIn renders this as "500+ connections", "1,204 followers", or nothing at
 * all. A number when one can be read, otherwise undefined — never 0, because a
 * stored 0 reads back as "this person has no connections", which is a different
 * and wrong statement.
 */
const connectionCount = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((raw) => {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : undefined
    if (typeof raw !== 'string') return undefined
    const digits = raw.replace(/[,\s]/g, '').match(/\d+/)
    if (!digits) return undefined
    const n = Number(digits[0])
    return Number.isFinite(n) && n >= 0 ? n : undefined
  })
  .pipe(z.number().int().nonnegative().optional())

/** ISO timestamp, defaulting to now when the client omits or mangles it. */
const isoTimestamp = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((raw) => {
    if (typeof raw === 'string') {
      const t = Date.parse(raw)
      if (Number.isFinite(t)) return new Date(t).toISOString()
    }
    return new Date().toISOString()
  })

/* ------------------------------------------------------------ profile parts -- */

export const experienceSchema = z.object({
  title: text(LIMITS.shortText),
  company: text(LIMITS.shortText),
  companyLogo: httpsUrl,
  location: optionalText(LIMITS.shortText),
  dateRange: optionalText(LIMITS.shortText),
  duration: optionalText(LIMITS.shortText),
  description: optionalText(LIMITS.longText),
  isCurrent: z.boolean().optional(),
})

export const educationSchema = z.object({
  school: text(LIMITS.shortText),
  degree: optionalText(LIMITS.shortText),
  fieldOfStudy: optionalText(LIMITS.shortText),
  dateRange: optionalText(LIMITS.shortText),
  description: optionalText(LIMITS.mediumText),
  logo: httpsUrl,
})

export const skillSchema = z.object({
  name: text(LIMITS.shortText),
  endorsements: z.number().int().nonnegative().max(100_000).optional(),
})

export const certificationSchema = z.object({
  name: text(LIMITS.shortText),
  issuer: optionalText(LIMITS.shortText),
  dateIssued: optionalText(LIMITS.shortText),
  credentialUrl: httpsUrl,
})

export const postSchema = z.object({
  text: text(LIMITS.mediumText),
  date: optionalText(LIMITS.shortText),
  likes: z.number().int().nonnegative().max(10_000_000).optional(),
  comments: z.number().int().nonnegative().max(10_000_000).optional(),
  reposts: z.number().int().nonnegative().max(10_000_000).optional(),
})

/**
 * A normalized profile.
 *
 * Only `name` is required. Everything else is genuinely optional on LinkedIn —
 * plenty of real profiles have no About section, no listed skills and no dates —
 * and a schema that demanded them would reject the profiles this product most
 * needs to handle gracefully. Arrays default to empty so no consumer has to
 * guard, which is what removes the `profile.skills.map` crash the old route had
 * when a payload omitted the field.
 */
export const profileSchema = z.object({
  name: text(LIMITS.shortText),
  headline: optionalText(LIMITS.mediumText),
  location: optionalText(LIMITS.shortText),
  about: optionalText(LIMITS.longText),
  pronouns: optionalText(LIMITS.shortText),
  photoUrl: httpsUrl,
  bannerUrl: httpsUrl,
  profileUrl: httpsUrl,
  connectionCount,
  recommendationCount: z.number().int().nonnegative().max(100_000).optional(),
  experience: z.array(experienceSchema).max(LIMITS.experience).default([]),
  education: z.array(educationSchema).max(LIMITS.education).default([]),
  skills: z.array(skillSchema).max(LIMITS.skills).default([]),
  certifications: z.array(certificationSchema).max(LIMITS.certifications).default([]),
  languages: z.array(text(LIMITS.shortText)).max(LIMITS.languages).default([]),
  recentPosts: z.array(postSchema).max(LIMITS.posts).default([]),
  volunteerExperience: z
    .array(
      z.object({
        role: text(LIMITS.shortText),
        organization: optionalText(LIMITS.shortText),
        dateRange: optionalText(LIMITS.shortText),
      })
    )
    .max(LIMITS.awards)
    .default([]),
  honorsAwards: z
    .array(
      z.object({
        title: text(LIMITS.shortText),
        issuer: optionalText(LIMITS.shortText),
        date: optionalText(LIMITS.shortText),
      })
    )
    .max(LIMITS.awards)
    .default([]),
  parsedAt: isoTimestamp,
  /**
   * Where this came from. Only 'dom' exists: the profile is read from the page
   * the user is looking at. The previous contract also allowed 'voyager' and
   * 'merged', for data captured by monkey-patching `fetch` on linkedin.com to
   * read its private API — that mechanism is gone (see CHANGELOG in the route),
   * and the field is kept as a one-member union so provenance stays explicit
   * and a future legitimate source has somewhere to go.
   */
  source: z.literal('dom').default('dom'),
  /** Contract version, so a stale extension is detectable rather than confusing. */
  schemaVersion: z.literal(2).default(2),
})

export type LinkedInExperience = z.infer<typeof experienceSchema>
export type LinkedInEducation = z.infer<typeof educationSchema>
export type LinkedInSkill = z.infer<typeof skillSchema>
export type LinkedInCertification = z.infer<typeof certificationSchema>
export type LinkedInPost = z.infer<typeof postSchema>
export type LinkedInProfile = z.infer<typeof profileSchema>

/**
 * What the extension actually sends, before validation.
 *
 * Deliberately `unknown` rather than a shape. Anything more specific would be a
 * claim about a payload this code does not control, and the only correct thing
 * to do with it is put it through `profileSchema`.
 */
export type RawProfilePayload = unknown

/* ------------------------------------------------------- data completeness -- */

/** Which optional sections a profile actually has, for honest UI copy. */
export interface ProfileCompleteness {
  /** 0-1. How much of the profile the page managed to read. */
  ratio: number
  present: string[]
  missing: string[]
  /**
   * True when too little was captured for analysis to say anything useful. The
   * panel refuses rather than presenting a confident score built on a name.
   */
  tooSparseToAnalyze: boolean
}

const COMPLETENESS_FIELDS: Array<{ key: string; has: (p: LinkedInProfile) => boolean }> = [
  { key: 'headline', has: (p) => Boolean(p.headline) },
  { key: 'location', has: (p) => Boolean(p.location) },
  { key: 'about', has: (p) => Boolean(p.about) },
  { key: 'experience', has: (p) => p.experience.length > 0 },
  { key: 'education', has: (p) => p.education.length > 0 },
  { key: 'skills', has: (p) => p.skills.length > 0 },
  { key: 'dates', has: (p) => p.experience.some((e) => Boolean(e.dateRange)) },
]

/**
 * Describe what was captured.
 *
 * The panel uses this to say what an analysis is based on. Without it a profile
 * where only the name parsed produces the same confident-looking output as a
 * complete one, and the reader has no way to tell the difference.
 */
export function assessCompleteness(profile: LinkedInProfile): ProfileCompleteness {
  const present: string[] = []
  const missing: string[] = []
  for (const field of COMPLETENESS_FIELDS) {
    ;(field.has(profile) ? present : missing).push(field.key)
  }
  const ratio = present.length / COMPLETENESS_FIELDS.length
  // A headline or one role is the floor for saying anything at all. Below that
  // there is nothing to analyse and a score would be invention.
  const tooSparseToAnalyze = !profile.headline && profile.experience.length === 0
  return { ratio, present, missing, tooSparseToAnalyze }
}

/* ------------------------------------------------- analyzer output schemas -- */

/**
 * Model output schemas.
 *
 * Every analyzer function validates against one of these before returning. The
 * previous code did `JSON.parse(text) as ProfileAnalysis` — a cast, not a check
 * — so a model that returned prose, a truncated object, or a 900-element array
 * flowed into the UI and rendered as a result. Bounds are as important as shape
 * here: the model is being asked about untrusted text and could be talked into
 * emitting something enormous.
 */
const scoreSchema = z.number().min(0).max(100)
const bulletList = z.array(z.string().max(LIMITS.shortText)).max(12).default([])
const confidenceSchema = z.enum(['Low', 'Medium', 'High'])

export const profileAnalysisSchema = z.object({
  overallScore: scoreSchema,
  strengths: bulletList,
  improvements: bulletList,
  careerTrajectory: z.object({
    currentLevel: z.string().max(LIMITS.shortText).default('Unknown'),
    nextRole: z.string().max(LIMITS.shortText).default('Unknown'),
    timeframe: z.string().max(LIMITS.shortText).default('Unknown'),
    skillsToDevelop: bulletList,
  }),
  recruiterInsights: z.object({
    hiringLikelihood: z.string().max(LIMITS.shortText).default('Unknown'),
    idealRoles: bulletList,
    redFlags: bulletList,
    standoutFactors: bulletList,
  }),
  jobFitSummary: z.string().max(LIMITS.mediumText).default(''),
  industryBenchmark: z.string().max(LIMITS.mediumText).default(''),
})

export const salaryEstimateSchema = z.object({
  ranges: z
    .array(
      z.object({
        currency: z.string().max(8),
        min: z.number().nonnegative().max(100_000_000),
        max: z.number().nonnegative().max(100_000_000),
        median: z.number().nonnegative().max(100_000_000).optional(),
        source: z.string().max(LIMITS.shortText).default('model estimate'),
      })
    )
    .max(5)
    .default([]),
  confidence: confidenceSchema,
  factors: bulletList,
  comparableRoles: bulletList,
})

export const careerPredictionSchema = z.object({
  currentLevel: z.string().max(LIMITS.shortText).default('Unknown'),
  nextRoles: z
    .array(
      z.object({
        title: z.string().max(LIMITS.shortText),
        probability: confidenceSchema,
        timeframe: z.string().max(LIMITS.shortText).default('Unknown'),
        requiredSkills: bulletList,
      })
    )
    .max(8)
    .default([]),
  longTermTrajectory: z.string().max(LIMITS.mediumText).default(''),
  industryTrends: bulletList,
  recommendations: bulletList,
})

export const jobFitResultsSchema = z
  .array(
    z.object({
      jobId: z.string().max(200),
      jobTitle: z.string().max(LIMITS.shortText).default(''),
      company: z.string().max(LIMITS.shortText).default(''),
      fitScore: scoreSchema,
      fitReason: z.string().max(LIMITS.mediumText).default(''),
      missingSkills: bulletList,
    })
  )
  .max(25)

export const recruiterBriefSchema = z.object({
  summary: z.string().max(LIMITS.mediumText).default(''),
  reachOutScore: scoreSchema,
  bestApproach: z.string().max(LIMITS.mediumText).default(''),
  talkingPoints: bulletList,
  competitorCompanies: bulletList,
  retentionRisk: z.string().max(LIMITS.mediumText).default(''),
  compensationLeverage: bulletList,
})

export type ProfileAnalysis = z.infer<typeof profileAnalysisSchema>
export type SalaryEstimate = z.infer<typeof salaryEstimateSchema>
export type CareerPrediction = z.infer<typeof careerPredictionSchema>
export type JobFitResult = z.infer<typeof jobFitResultsSchema>[number]
export type RecruiterBrief = z.infer<typeof recruiterBriefSchema>

/* ---------------------------------------------------------- API contract --- */

export const ANALYSIS_KINDS = [
  'profile',
  'salary',
  'career',
  'jobFit',
  'recruiterBrief',
  'contacts',
] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

export const savedJobSchema = z.object({
  id: z.string().max(200),
  title: text(LIMITS.shortText),
  company: optionalText(LIMITS.shortText),
  description: optionalText(LIMITS.longText),
  requirements: z.array(text(LIMITS.shortText)).max(50).default([]),
})
export type SavedJob = z.infer<typeof savedJobSchema>

/**
 * The POST body.
 *
 * Note what is NOT here: `userId`. The old schema accepted one and the route
 * used it as the row key with the service-role client, so anyone could read or
 * write another account's saved profiles by changing a string. Identity now
 * comes from the verified access token and the client cannot express an opinion
 * about it — `.strict()` makes a stale client that still sends `userId` fail
 * loudly instead of being silently ignored.
 */
export const insightRequestSchema = z
  .object({
    profile: profileSchema,
    saveProfile: z.boolean().default(false),
    profileType: z.enum(['self', 'contact']).default('contact'),
    analyses: z.array(z.enum(ANALYSIS_KINDS)).max(ANALYSIS_KINDS.length).optional(),
    savedJobs: z.array(savedJobSchema).max(25).default([]),
  })
  .strict()

export type InsightRequest = z.infer<typeof insightRequestSchema>

/** Which analyses ran, which failed, and why — surfaced rather than swallowed. */
export interface AnalysisWarning {
  kind: AnalysisKind
  /** Safe for display. Never a stack trace or provider message. */
  message: string
}

export interface InsightResponse {
  profile: LinkedInProfile
  completeness: ProfileCompleteness
  analysis: ProfileAnalysis | null
  salaryEstimate: SalaryEstimate | null
  careerPrediction: CareerPrediction | null
  jobFitResults: JobFitResult[] | null
  recruiterBrief: RecruiterBrief | null
  contactDiscovery: {
    emails: Array<{ address: string; confidence: number; source: string; verified: boolean }>
  } | null
  /** Analyses that were requested and did not produce a result. */
  warnings: AnalysisWarning[]
  savedAt: string | null
}
