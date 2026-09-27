'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSupabaseClientSafe } from '@/lib/supabase'
import { useLinkedInSync } from '@/hooks/use-linkedin-sync'
import type {
  AnalysisWarning,
  CareerPrediction,
  InsightResponse,
  JobFitResult,
  LinkedInProfile,
  ProfileAnalysis,
  ProfileCompleteness,
  RecruiterBrief,
  SalaryEstimate,
} from '@/lib/linkedin/types'
import { SyncStatusBanner } from '@/components/linkedin-insight/SyncStatusBanner'
import { ProfileHeader } from '@/components/linkedin-insight/ProfileHeader'
import { ExperienceTimeline } from '@/components/linkedin-insight/ExperienceTimeline'
import { SkillsCloud } from '@/components/linkedin-insight/SkillsCloud'
import { AIAnalysisPanel } from '@/components/linkedin-insight/AIAnalysisPanel'
import { ContactDiscoveryCard } from '@/components/linkedin-insight/ContactDiscoveryCard'
import { EducationSection } from '@/components/linkedin-insight/EducationSection'
import { SavedProfilesList } from '@/components/linkedin-insight/SavedProfilesList'
import { ExtensionInstallPrompt } from '@/components/linkedin-insight/ExtensionInstallPrompt'
import Navigation from '@/components/navigation'
import {
  Sparkles, Radio, Database, User, Users, DollarSign, Briefcase,
  TrendingUp, Shield, ChevronDown, ChevronUp, Loader2
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export default function LinkedInInsightPage() {
  const syncState = useLinkedInSync()
  const supabase = getSupabaseClientSafe()

  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null)
  const [salaryEstimate, setSalaryEstimate] = useState<SalaryEstimate | null>(null)
  const [careerPrediction, setCareerPrediction] = useState<CareerPrediction | null>(null)
  const [recruiterBrief, setRecruiterBrief] = useState<RecruiterBrief | null>(null)
  const [jobFitResults, setJobFitResults] = useState<JobFitResult[] | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  /** Which analyses were requested and did not produce a result, and why. */
  const [warnings, setWarnings] = useState<AnalysisWarning[]>([])
  /** What the extension actually managed to read, so the page can say so. */
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null)

  /** Matches ContactDiscoveryCard's EmailData and the API's contactDiscovery.emails. */
  type DiscoveredEmail = NonNullable<InsightResponse['contactDiscovery']>['emails'][number]
  /** The columns the list endpoint actually selects — not `any`, and not the full row. */
  interface SavedProfileRow {
    id: string
    full_name: string
    headline: string
    photo_url: string
    linkedin_url: string
    synced_at: string
  }

  const [contacts, setContacts] = useState<DiscoveredEmail[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(false)

  const [savedProfiles, setSavedProfiles] = useState<SavedProfileRow[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user?.id) {
          setUserId(session.user.id)
        }
      } catch (e) {
        console.error('Auth error:', e)
      }
    }
    getUser()
  }, [supabase])

  // Load saved profiles when userId is available
  useEffect(() => {
    if (userId) {
      loadSavedProfiles()
    } else {
      setProfilesLoading(false)
    }
  }, [userId])

  // Auto-analyze when a profile is synced
  useEffect(() => {
    if (syncState.status === 'synced' && syncState.profile) {
      handleAnalyzeProfile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncState.status])

  /**
   * Every call to this API carries the caller's access token.
   *
   * The route derives identity from that token alone. It used to accept a
   * `userId` in the body and query string and act on it with the service-role
   * key, so any caller could read or write another account's saved profiles by
   * changing a string. The client no longer sends one -- and the request schema
   * is `.strict()`, so a stale build that still does gets a 400 rather than
   * being quietly ignored.
   */
  const authedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Please sign in to analyse a profile.')
      return fetch(url, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      })
    },
    [supabase]
  )

  /** Turn a failed response into a message worth showing. */
  const readError = async (res: Response, fallback: string): Promise<string> => {
    if (res.status === 401) return 'Your session expired. Sign in again to continue.'
    if (res.status === 429) return 'Too many requests. Wait a moment and try again.'
    if (res.status === 413) return 'That profile is too large to analyse.'
    try {
      const body = await res.json()
      return typeof body?.error === 'string' ? body.error : fallback
    } catch {
      return fallback
    }
  }

  const loadSavedProfiles = async () => {
    if (!userId) return
    try {
      setProfilesLoading(true)
      // No userId parameter: the route returns the token holder's own rows.
      const res = await authedFetch('/api/linkedin-insight')
      if (res.ok) {
        const data = await res.json()
        setSavedProfiles(Array.isArray(data.profiles) ? data.profiles : [])
      }
    } catch (e) {
      console.error('Failed to load saved profiles:', e)
    } finally {
      setProfilesLoading(false)
    }
  }

  const handleAnalyzeProfile = async () => {
    if (!syncState.profile) return
    try {
      setAnalysisLoading(true)
      setAnalysisError(null)
      const res = await authedFetch('/api/linkedin-insight', {
        method: 'POST',
        body: JSON.stringify({
          profile: syncState.profile,
          profileType: syncState.profileType || 'contact',
          saveProfile: false,
          analyses: ['profile', 'salary', 'career', 'recruiterBrief', 'contacts'],
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Could not analyse this profile.'))
      const data: InsightResponse = await res.json()
      // Assigned unconditionally. Guarding each with `if (data.x)` left the
      // previous run's values on screen when a later analysis returned nothing,
      // so a stale salary band sat beside a freshly analysed profile.
      setAnalysis(data.analysis)
      setSalaryEstimate(data.salaryEstimate)
      setCareerPrediction(data.careerPrediction)
      setRecruiterBrief(data.recruiterBrief)
      setJobFitResults(data.jobFitResults)
      setCompleteness(data.completeness ?? null)
      setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
      if (data.contactDiscovery?.emails?.length) setContacts(data.contactDiscovery.emails)
    } catch (e: unknown) {
      setAnalysisError(e instanceof Error ? e.message : 'Could not analyse this profile.')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const handleDiscoverContacts = async () => {
    if (!syncState.profile) return
    try {
      setContactsLoading(true)
      const res = await authedFetch('/api/linkedin-insight', {
        method: 'POST',
        body: JSON.stringify({
          profile: syncState.profile,
          saveProfile: false,
          analyses: ['contacts'],
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Contact discovery failed.'))
      const data: InsightResponse = await res.json()
      setContacts(data.contactDiscovery?.emails ?? [])
    } catch (e) {
      console.error('Contact discovery failed:', e)
    } finally {
      setContactsLoading(false)
    }
  }

  const handleSaveProfile = async () => {
    if (!syncState.profile || !userId) return
    try {
      setSaving(true)
      const res = await authedFetch('/api/linkedin-insight', {
        method: 'POST',
        body: JSON.stringify({
          profile: syncState.profile,
          profileType: syncState.profileType || 'contact',
          saveProfile: true,
          analyses: ['profile', 'salary', 'career', 'recruiterBrief', 'contacts'],
        }),
      })
      if (res.ok) {
        loadSavedProfiles()
      } else {
        setAnalysisError(await readError(res, 'Could not save this profile.'))
      }
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const handleExportPDF = () => {
    window.print()
  }

  const handleDeleteProfile = async (id: string) => {
    try {
      const { error } = await supabase
        .from('linkedin_profiles')
        .delete()
        .eq('id', id)
      if (!error) {
        setSavedProfiles(prev => prev.filter(p => p.id !== id))
      }
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  /**
   * Open a saved profile.
   *
   * The list endpoint deliberately returns only the columns this list renders --
   * name, headline, photo, timestamps -- not the stored analysis or the
   * discovered email addresses. Sending every saved dossier in full just to
   * populate a sidebar is more customer data over the wire than the screen
   * needs, so selecting one opens it on LinkedIn to re-sync rather than
   * reading fields that are no longer in the payload.
   */
  const handleSelectSavedProfile = async (id: string) => {
    const saved = savedProfiles.find((p) => p.id === id)
    if (saved?.linkedin_url) {
      window.open(saved.linkedin_url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950/50 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-indigo-500" />
              LinkedIn Profile Insights
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              AI-powered analysis and contact discovery, from the LinkedIn profile you have open
            </p>
          </div>

          <SyncStatusBanner
            status={syncState.status}
            extensionDetected={syncState.extensionDetected}
            linkedInTabDetected={syncState.linkedInTabDetected}
            error={syncState.error}
            profileName={syncState.profile?.name}
            extensionInstallUrl={syncState.extensionInstallUrl}
          />

          {/*
            What the analysis is based on, and what it could not read.

            This replaces a panel that dumped raw intercepted API JSON on screen.
            The reader needs to know how complete the input was -- an assessment
            built from a headline alone should not look like one built from a full
            work history -- and does not need our internal payloads.
          */}
          {syncState.profile && completeness && (
            <div className="mb-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Database className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300">
                  Read from the profile page:{' '}
                  <span className="font-medium text-slate-900 dark:text-white">
                    {completeness.present.length} of{' '}
                    {completeness.present.length + completeness.missing.length} sections
                  </span>
                </span>
                {completeness.missing.length > 0 && (
                  <span className="text-slate-500 dark:text-slate-400">
                    (missing: {completeness.missing.join(', ')})
                  </span>
                )}
              </div>
              {completeness.ratio < 0.5 && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  Little of this profile was captured, so the analysis below is
                  correspondingly uncertain. Scroll the whole profile on LinkedIn and sync
                  again for a fuller read.
                </p>
              )}
            </div>
          )}

          {/*
            Analyses that were requested and returned nothing, with the reason.
            Previously these failed silently into nulls and the card simply did
            not appear, which reads as "this profile has no salary data" rather
            than "the estimate did not run".
          */}
          {warnings.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Some analyses did not complete
              </p>
              <ul className="mt-1 space-y-0.5">
                {warnings.map((w) => (
                  <li key={w.kind} className="text-xs text-amber-700 dark:text-amber-400">
                    <span className="font-medium">{w.kind}</span>: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Profile Type Selector */}
          {syncState.profile && (
            <div className="mb-6 flex items-center gap-3">
              <span className="text-sm text-slate-500 dark:text-slate-400">Profile type:</span>
              <button
                onClick={() => syncState.setProfileType('self')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  syncState.profileType === 'self'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
                }`}
              >
                <User className="w-3.5 h-3.5" /> My Profile
              </button>
              <button
                onClick={() => syncState.setProfileType('contact')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  syncState.profileType === 'contact' || !syncState.profileType
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Contact Intel
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            {!syncState.profile ? (
              <motion.div
                key="hero"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-12"
              >
                {/* Hero onboarding section */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 md:p-12 shadow-sm border border-slate-200 dark:border-slate-800 text-center">
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-sm font-medium mb-6">
                    ✨ 100% Free — SignalHire Alternative
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-4 text-slate-900 dark:text-white">
                    Unlock Deep Insights from Any LinkedIn Profile
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-10">
                    Get AI-generated career analysis, salary estimates, recruiter perspectives,
                    contact discovery, and LinkedIn Voyager API data interception — all free.
                  </p>
                  <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
                    {[
                      { step: '1', title: 'Install Extension', desc: 'Secure Chrome extension bridges LinkedIn data + intercepts Voyager API.' },
                      { step: '2', title: 'Open LinkedIn', desc: 'Navigate to any profile — XHR interceptor captures API data automatically.' },
                      { step: '3', title: 'View Insights', desc: 'AI analysis, salary estimation, career prediction, and contact discovery.' }
                    ].map(({ step, title, desc }) => (
                      <div key={step} className="flex flex-col items-center">
                        <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center font-bold text-xl mb-4 shadow-lg">
                          {step}
                        </div>
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extension install prompt when extension not detected */}
                {!syncState.extensionDetected && (
                  <ExtensionInstallPrompt
                    installUrl={syncState.extensionInstallUrl}
                    onRetry={syncState.requestProfile}
                  />
                )}

                {/* Features grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { icon: '🎯', title: 'Profile Scoring', desc: 'AI rates profile strength 0-100' },
                    { icon: '💰', title: 'Salary Insights', desc: 'Location-adjusted salary ranges with market comparisons' },
                    { icon: '📧', title: 'Contact Discovery', desc: 'Find verified email addresses via pattern analysis + GitHub mining' },
                    { icon: '🚀', title: 'Career Trajectory', desc: 'Predict next role, growth path, and industry trends' },
                    { icon: '🔍', title: 'Voyager API Interception', desc: "Capture LinkedIn's internal API data automatically" },
                    { icon: '🤝', title: 'Recruiter Brief', desc: 'Outreach score, talking points, and compensation leverage' },
                    { icon: '📊', title: 'Job Fit Matching', desc: 'Match profiles against your saved job listings' },
                    { icon: '🏢', title: 'Company Intel', desc: 'Competitor analysis and retention risk assessment' }
                  ].map(({ icon, title, desc }) => (
                    <div key={title} className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                      <div className="text-2xl mb-3">{icon}</div>
                      <h3 className="font-semibold text-slate-900 dark:text-white mb-1">{title}</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{desc}</p>
                    </div>
                  ))}
                </div>

                {/* Saved profiles */}
                {savedProfiles.length > 0 && (
                  <SavedProfilesList
                    profiles={savedProfiles}
                    loading={profilesLoading}
                    onSelect={handleSelectSavedProfile}
                    onDelete={handleDeleteProfile}
                  />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="space-y-8"
              >
                <ProfileHeader
                  profile={syncState.profile}
                  onSave={handleSaveProfile}
                  onExport={handleExportPDF}
                  saving={saving}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left column — 2/3 width */}
                  <div className="lg:col-span-2 space-y-8">
                    <ExperienceTimeline experience={syncState.profile.experience || []} />
                    <EducationSection education={syncState.profile.education || []} />
                    <SkillsCloud skills={syncState.profile.skills || []} />

                    {/* Enhanced Salary Panel */}
                    {salaryEstimate && (
                      <SalaryPanel estimate={salaryEstimate} />
                    )}

                    {/* Career Prediction Panel */}
                    {careerPrediction && (
                      <CareerPanel prediction={careerPrediction} />
                    )}

                    {/* Recruiter Brief Panel */}
                    {recruiterBrief && (
                      <RecruiterBriefPanel brief={recruiterBrief} />
                    )}

                    {/* Job Fit Results */}
                    {jobFitResults && jobFitResults.length > 0 && (
                      <JobFitPanel results={jobFitResults} />
                    )}
                  </div>

                  {/* Right column — 1/3 width */}
                  <div className="space-y-8">
                    <AIAnalysisPanel
                      analysis={analysis}
                      salaryEstimate={salaryEstimate}
                      loading={analysisLoading}
                      error={analysisError}
                      onRetry={handleAnalyzeProfile}
                    />
                    <ContactDiscoveryCard
                      emails={contacts}
                      loading={contactsLoading}
                      onDiscover={handleDiscoverContacts}
                    />
                  </div>
                </div>

                {/* Saved profiles at bottom */}
                {savedProfiles.length > 0 && (
                  <div className="pt-12 border-t border-slate-200 dark:border-slate-800">
                    <SavedProfilesList
                      profiles={savedProfiles}
                      loading={profilesLoading}
                      onSelect={handleSelectSavedProfile}
                      onDelete={handleDeleteProfile}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

// ── Inline sub-components for enhanced panels ───────────────────────────────

function SalaryPanel({ estimate }: { estimate: SalaryEstimate }) {
  const primary = estimate.ranges?.[0]
  if (!primary) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-500" />
          Detailed Salary Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {estimate.ranges.map((range, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">{range.currency} Range</span>
              <Badge variant="outline">{range.source}</Badge>
            </div>
            <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
              <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: '70%' }} />
              <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
            </div>
            <div className="flex justify-between text-sm font-medium">
              <span className="text-slate-500">{range.currency} {range.min?.toLocaleString()}</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{range.currency} {range.median?.toLocaleString()}</span>
              <span className="text-slate-500">{range.currency} {range.max?.toLocaleString()}</span>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Confidence:</span>
          <Badge variant={estimate.confidence === 'High' ? 'default' : 'outline'}>
            {estimate.confidence}
          </Badge>
        </div>
        {estimate.factors?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Key Factors</h4>
            <ul className="space-y-1">
              {estimate.factors.map((f, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400 flex items-start gap-2">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {estimate.comparableRoles?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Comparable Roles</h4>
            <div className="flex flex-wrap gap-2">
              {estimate.comparableRoles.map((r, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CareerPanel({ prediction }: { prediction: CareerPrediction }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-500" />
          Career Trajectory Prediction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
          <Badge variant="secondary">{prediction.currentLevel}</Badge>
          <span className="text-slate-400">→</span>
          <span className="text-sm text-slate-600 dark:text-slate-400">Predicted next moves</span>
        </div>

        {prediction.nextRoles?.map((role, i) => (
          <div key={i} className="flex items-start justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-lg">
            <div>
              <p className="font-medium text-slate-900 dark:text-white">{role.title}</p>
              <p className="text-xs text-slate-500 mt-1">Timeframe: {role.timeframe}</p>
              {role.requiredSkills?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {role.requiredSkills.map((s, j) => (
                    <Badge key={j} variant="outline" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              )}
            </div>
            <Badge variant={role.probability === 'High' ? 'default' : 'outline'} className="shrink-0">
              {role.probability}
            </Badge>
          </div>
        ))}

        {prediction.longTermTrajectory && (
          <div className="p-4 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg">
            <h4 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2">5-10 Year Outlook</h4>
            <p className="text-sm text-indigo-600 dark:text-indigo-400">{prediction.longTermTrajectory}</p>
          </div>
        )}

        {prediction.industryTrends?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Industry Trends</h4>
            <ul className="space-y-1">
              {prediction.industryTrends.map((t, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400">📈 {t}</li>
              ))}
            </ul>
          </div>
        )}

        {prediction.recommendations?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Recommendations</h4>
            <ul className="space-y-1">
              {prediction.recommendations.map((r, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400">💡 {r}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecruiterBriefPanel({ brief }: { brief: RecruiterBrief }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-500" />
          Recruiter Intelligence Brief
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-700 dark:text-slate-300">{brief.summary}</p>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium text-slate-900 dark:text-white">Outreach Response Score</span>
              <span className="text-sm font-bold text-indigo-600">{brief.reachOutScore}/100</span>
            </div>
            <Progress value={brief.reachOutScore} className="h-2" />
          </div>
        </div>

        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg">
          <h4 className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400 mb-1">Best Approach</h4>
          <p className="text-sm text-indigo-700 dark:text-indigo-300">{brief.bestApproach}</p>
        </div>

        {brief.talkingPoints?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Talking Points</h4>
            <ol className="space-y-1.5 list-decimal list-inside">
              {brief.talkingPoints.map((t, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{t}</li>
              ))}
            </ol>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {brief.competitorCompanies?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Competing For</h4>
              <div className="flex flex-wrap gap-1.5">
                {brief.competitorCompanies.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                ))}
              </div>
            </div>
          )}
          {brief.retentionRisk && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-500 mb-2">Retention Risk</h4>
              <p className="text-sm text-slate-700 dark:text-slate-300">{brief.retentionRisk}</p>
            </div>
          )}
        </div>

        {brief.compensationLeverage?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Compensation Leverage</h4>
            <ul className="space-y-1">
              {brief.compensationLeverage.map((l, i) => (
                <li key={i} className="text-sm text-slate-600 dark:text-slate-400">💰 {l}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function JobFitPanel({ results }: { results: JobFitResult[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-amber-500" />
          Job Fit Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {results.map((result, i) => (
          <div key={i} className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{result.jobTitle}</p>
                <p className="text-xs text-slate-500">{result.company}</p>
              </div>
              <div className={`text-lg font-bold ${
                result.fitScore >= 70 ? 'text-emerald-600' :
                result.fitScore >= 40 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {result.fitScore}%
              </div>
            </div>
            <Progress value={result.fitScore} className="h-1.5 mb-2" />
            <p className="text-xs text-slate-600 dark:text-slate-400">{result.fitReason}</p>
            {result.missingSkills?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {result.missingSkills.map((s, j) => (
                  <Badge key={j} variant="outline" className="text-[10px] text-red-600 border-red-200 dark:border-red-800">
                    Missing: {s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
