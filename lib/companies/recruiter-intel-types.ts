/**
 * Types for the recruiter-intelligence layer, plus a typed re-export of the
 * pure core so the app imports one thing with full type coverage.
 *
 * The runtime logic lives in recruiter-intel-core.mjs (shared with the node
 * build script and the tsx test suite). This file only adds types over it.
 */

export type EmailStatus = 'published' | 'company_published' | 'not_found'
export type IdentityStatus = 'confirmed' | 'corroborated' | 'uncertain'
export type Confidence = 'high' | 'medium' | 'low'
export type SourceType =
  | 'linkedin'
  | 'company_site'
  | 'press_release'
  | 'conference'
  | 'public_document'
  | 'other'

/** One publicly-identified recruiting/talent professional. */
export interface RecruitingContact {
  id: string
  companySlug: string
  companyName: string
  fullName: string
  firstName?: string
  lastName?: string
  currentTitle?: string
  /** Role-family key (e.g. "technology", "campus") -- drives UI filters. */
  department?: string
  location?: string
  linkedinUrl?: string
  officialCompanyProfileUrl?: string
  otherPublicSourceUrls?: string[]
  /** Only ever set when an exact address is explicitly published with a source. */
  email?: string
  emailSourceUrl?: string
  emailStatus: EmailStatus
  identityStatus: IdentityStatus
  sourceType: SourceType
  sourceUrls: string[]
  evidence: string[]
  lastVerifiedAt: string
  confidence: Confidence
  notes?: string
}

export interface CompanyRecruitingMetadata {
  generatedAt: string
  companySlug: string
  discoveredCount: number
  confirmed: number
  corroborated: number
  uncertain: number
  publicDirectEmails: number
  duplicatesRemoved: number
  recordsRejected: number
  /** Deterministic public-search queries this company's discovery would run. */
  discoveryQueries: string[]
  sources: string[]
}

export interface CompanyRecruitingIntelFile {
  slug: string
  name: string
  recruiters: RecruitingContact[]
  metadata: CompanyRecruitingMetadata
}

// Typed re-exports of the pure core (see recruiter-intel-core.mjs).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- .mjs has no d.ts; the signatures are declared below.
import * as core from './recruiter-intel-core.mjs'

export const isRecruitingTitle: (t?: string) => boolean = core.isRecruitingTitle
export const roleFamily: (t?: string) => string | null = core.roleFamily
export const normalizeName: (n?: string) => string = core.normalizeName
export const isFullName: (n?: string) => boolean = core.isFullName
export const canonicalLinkedin: (u?: string) => string | null = core.canonicalLinkedin
export const classifyPersonEmail: (e?: string, hasSource?: boolean) => EmailStatus =
  core.classifyPersonEmail
export const discoveryQueries: (name: string, domain?: string) => string[] = core.discoveryQueries
export const ROLE_FAMILIES: { key: string; label: string }[] = core.ROLE_FAMILIES
