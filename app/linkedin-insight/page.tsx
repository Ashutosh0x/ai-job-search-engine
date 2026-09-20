'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getSupabaseClientSafe } from '@/lib/supabase'
import { useLinkedInSync } from '@/hooks/use-linkedin-sync'
import { ProfileAnalysis, LinkedInProfile } from '@/lib/linkedin/types'
import { SyncStatusBanner } from '@/components/linkedin-insight/SyncStatusBanner'
import { ProfileHeader } from '@/components/linkedin-insight/ProfileHeader'
import { ExperienceTimeline } from '@/components/linkedin-insight/ExperienceTimeline'
import { SkillsCloud } from '@/components/linkedin-insight/SkillsCloud'
import { AIAnalysisPanel } from '@/components/linkedin-insight/AIAnalysisPanel'
import { ContactDiscoveryCard } from '@/components/linkedin-insight/ContactDiscoveryCard'
import { EducationSection } from '@/components/linkedin-insight/EducationSection'
import { SavedProfilesList } from '@/components/linkedin-insight/SavedProfilesList'
import { ExtensionInstallPrompt } from '@/components/linkedin-insight/ExtensionInstallPrompt'
import { Sparkles } from 'lucide-react'

export default function LinkedInInsightPage() {
  const syncState = useLinkedInSync()
  const supabase = getSupabaseClientSafe()

  const [analysis, setAnalysis] = useState<ProfileAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const [contacts, setContacts] = useState<any[] | null>(null)
  const [contactsLoading, setContactsLoading] = useState(false)

  const [savedProfiles, setSavedProfiles] = useState<any[]>([])
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

  const loadSavedProfiles = async () => {
    if (!userId) return
    try {
      setProfilesLoading(true)
      const res = await fetch(`/api/linkedin-insight?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        setSavedProfiles(data.profiles || [])
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
      const res = await fetch('/api/linkedin-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: syncState.profile,
          userId: userId || undefined,
          saveProfile: false
        })
      })
      if (!res.ok) throw new Error('Analysis failed')
      const data = await res.json()
      setAnalysis(data.analysis)
      if (data.contactDiscovery?.emails?.length) {
        setContacts(data.contactDiscovery.emails)
      }
    } catch (e: any) {
      setAnalysisError(e.message || 'Failed to analyze profile')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const handleDiscoverContacts = async () => {
    if (!syncState.profile) return
    try {
      setContactsLoading(true)
      const res = await fetch('/api/linkedin-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: syncState.profile,
          userId: userId || undefined,
          saveProfile: false
        })
      })
      if (!res.ok) throw new Error('Discovery failed')
      const data = await res.json()
      setContacts(data.contactDiscovery?.emails || [])
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
      const res = await fetch('/api/linkedin-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: syncState.profile,
          userId,
          saveProfile: true
        })
      })
      if (res.ok) {
        loadSavedProfiles()
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

  const handleSelectSavedProfile = async (id: string) => {
    const saved = savedProfiles.find(p => p.id === id)
    if (saved?.ai_analysis) {
      setAnalysis(saved.ai_analysis)
    }
    if (saved?.contact_discovery?.emails) {
      setContacts(saved.contact_discovery.emails)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950/50 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-indigo-500" />
            LinkedIn Profile Insights
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            AI-powered analysis and contact discovery — free for all recruiters
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
                  ✨ 100% Free for Recruiters
                </div>
                <h2 className="text-2xl md:text-3xl font-bold mb-4 text-slate-900 dark:text-white">
                  Unlock Deep Insights from Any LinkedIn Profile
                </h2>
                <p className="text-slate-500 dark:text-slate-400 max-w-2xl mx-auto mb-10">
                  Get AI-generated career analysis, salary estimates, recruiter perspectives,
                  and contact discovery — all from a single LinkedIn profile view.
                </p>
                <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
                  {[
                    { step: '1', title: 'Install Extension', desc: 'Get our secure Chrome extension to bridge LinkedIn data.' },
                    { step: '2', title: 'Open LinkedIn', desc: 'Navigate to any profile on LinkedIn in another tab.' },
                    { step: '3', title: 'View Insights', desc: 'Come back here for AI-powered profile intelligence.' }
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

              {/* Step 1 in full, with the actual install route, until the bridge answers. */}
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
                  { icon: '💰', title: 'Salary Insights', desc: 'Location-adjusted salary ranges' },
                  { icon: '📧', title: 'Contact Discovery', desc: 'Find verified email addresses' },
                  { icon: '🚀', title: 'Career Trajectory', desc: 'Predict next role & growth path' }
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
                </div>

                {/* Right column — 1/3 width */}
                <div className="space-y-8">
                  <AIAnalysisPanel
                    analysis={analysis}
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
  )
}
