'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, CheckCircle2, Chrome, Loader2, Linkedin } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SyncStatusBannerProps {
  status: 'idle' | 'waiting' | 'connected' | 'syncing' | 'synced' | 'error'
  extensionDetected: boolean
  linkedInTabDetected: boolean
  error: string | null
  profileName?: string
  /** Null while the extension has no published Web Store listing. */
  extensionInstallUrl: string | null
}

export function SyncStatusBanner({
  status,
  extensionDetected,
  linkedInTabDetected,
  error,
  profileName,
  extensionInstallUrl
}: SyncStatusBannerProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={status + (extensionDetected ? 'ext-yes' : 'ext-no')}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="w-full mb-6"
      >
        {!extensionDetected ? (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Chrome className="w-6 h-6 text-blue-500" />
              <div>
                <h3 className="font-semibold text-blue-900 dark:text-blue-100">LinkedIn Sync Extension Required</h3>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {extensionInstallUrl
                    ? 'Install our Chrome extension to automatically sync LinkedIn profiles.'
                    : 'Load the extension from disk to sync LinkedIn profiles — the steps are below.'}
                </p>
              </div>
            </div>
            {extensionInstallUrl && (
              <Button asChild variant="default">
                <a href={extensionInstallUrl} target="_blank" rel="noopener noreferrer">
                  Install Extension
                </a>
              </Button>
            )}
          </div>
        ) : !linkedInTabDetected && status !== 'synced' ? (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-lg p-4 flex items-center space-x-3">
            <Linkedin className="w-6 h-6 text-amber-500" />
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-100">Open LinkedIn</h3>
              <p className="text-sm text-amber-700 dark:text-amber-300">Open LinkedIn in another tab and navigate to a profile to sync data.</p>
            </div>
          </div>
        ) : status === 'waiting' || status === 'syncing' ? (
          <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-900 rounded-lg p-4 flex items-center space-x-3">
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            <div>
              <h3 className="font-semibold text-indigo-900 dark:text-indigo-100">Listening for LinkedIn profile...</h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-300">Navigate to a LinkedIn profile to extract insights.</p>
            </div>
          </div>
        ) : status === 'synced' ? (
          <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 rounded-lg p-4 flex items-center space-x-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            <div>
              <h3 className="font-semibold text-emerald-900 dark:text-emerald-100">Profile Synced</h3>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Successfully synced from LinkedIn: {profileName}</p>
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-lg p-4 flex items-center space-x-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-100">Sync Error</h3>
              <p className="text-sm text-red-700 dark:text-red-300">{error || 'An unknown error occurred while syncing.'}</p>
            </div>
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  )
}
