'use client'

import { useState, useEffect, useCallback } from 'react'
import { LinkedInProfile } from '@/lib/linkedin/types'

export interface LinkedInSyncState {
  status: 'idle' | 'waiting' | 'connected' | 'syncing' | 'synced' | 'error'
  extensionDetected: boolean
  linkedInTabDetected: boolean
  profile: LinkedInProfile | null
  error: string | null
  lastSyncAt: Date | null
}

/**
 * Null until the extension is actually published. A placeholder store URL sends
 * people to a 404 that looks like a broken install rather than an unpublished
 * one — the UI offers sideload instructions instead while this is null.
 */
export const EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL ?? null

export function useLinkedInSync() {
  const [state, setState] = useState<LinkedInSyncState>({
    status: 'idle',
    extensionDetected: false,
    linkedInTabDetected: false,
    profile: null,
    error: null,
    lastSyncAt: null,
  })

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security check: ensure it's from our own window or known source
      if (event.source !== window) return

      const data = event.data

      if (data && data.type === 'LINKEDIN_EXTENSION_READY') {
        setState(s => ({ ...s, extensionDetected: true, status: s.status === 'idle' ? 'waiting' : s.status }))
      }

      if (data && data.type === 'LINKEDIN_TAB_DETECTED') {
        setState(s => ({ ...s, linkedInTabDetected: true }))
      }

      if (data && data.type === 'LINKEDIN_PROFILE_SYNC') {
        setState(s => ({
          ...s,
          profile: data.payload,
          status: 'synced',
          lastSyncAt: new Date(),
          error: null
        }))
      }
      
      if (data && data.type === 'LINKEDIN_SYNC_ERROR') {
        setState(s => ({
          ...s,
          status: 'error',
          error: data.payload || 'Failed to sync profile'
        }))
      }
    }

    window.addEventListener('message', handleMessage)
    
    // Check if extension is already injected
    if (document.documentElement.getAttribute('data-linkedin-extension-installed')) {
        setState(s => ({ ...s, extensionDetected: true, status: 'waiting' }))
    }

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  const requestProfile = useCallback(() => {
    setState(s => ({ ...s, status: 'syncing', error: null }))
    window.postMessage({ type: 'REQUEST_LINKEDIN_PROFILE' }, '*')
  }, [])

  const clearProfile = useCallback(() => {
    setState(s => ({
      ...s,
      profile: null,
      status: s.extensionDetected ? 'waiting' : 'idle',
      error: null,
      lastSyncAt: null
    }))
  }, [])

  // Auto-request profile on mount if extension is detected
  useEffect(() => {
    if (state.extensionDetected && state.status === 'waiting') {
      requestProfile()
    }
  }, [state.extensionDetected, state.status, requestProfile])

  return {
    ...state,
    requestProfile,
    clearProfile,
    extensionInstallUrl: EXTENSION_INSTALL_URL
  }
}
