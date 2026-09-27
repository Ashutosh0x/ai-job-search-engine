'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { profileSchema, type LinkedInProfile } from '@/lib/linkedin/types'

/**
 * The web app's half of the extension bridge.
 *
 * WHAT ARRIVES HERE IS NOT TRUSTED. `window.postMessage` is readable and
 * writable by any script running in this page — an injected ad script, a
 * malicious dependency, a browser extension a user installed for something else.
 * So every payload is validated against `profileSchema` before it reaches state,
 * and a message that fails is dropped rather than rendered.
 *
 * Previously the payload was assigned straight into `profile` as a
 * `LinkedInProfile`, so anything on the page could put arbitrary values — an
 * attacker-chosen photo URL, a name containing markup — into the panel and into
 * the body of the next API call.
 *
 * `event.source !== window` is necessary but not sufficient: the content-script
 * bridge relays into this same window, so same-window is exactly what a
 * page-level attacker also has. Validation is what does the work.
 */

export interface LinkedInSyncState {
  status: 'idle' | 'waiting' | 'connected' | 'syncing' | 'synced' | 'error'
  extensionDetected: boolean
  linkedInTabDetected: boolean
  profile: LinkedInProfile | null
  error: string | null
  lastSyncAt: Date | null
  profileType: 'self' | 'contact' | null
}

/**
 * Null until the extension is actually published. A placeholder store URL sends
 * people to a 404 that looks like a broken install rather than an unpublished
 * one — the UI offers sideload instructions instead while this is null.
 */
export const EXTENSION_INSTALL_URL: string | null =
  process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL ?? null

/** Message types this hook will act on. Anything else is ignored. */
const INBOUND = {
  ready: 'LINKEDIN_EXTENSION_READY',
  tab: 'LINKEDIN_TAB_DETECTED',
  profile: 'LINKEDIN_PROFILE_SYNC',
  error: 'LINKEDIN_SYNC_ERROR',
} as const

/**
 * How many times a sync request may be retried before giving up.
 *
 * The previous version had an effect that called `requestProfile()` whenever
 * status was 'waiting', and `requestProfile` set status to 'syncing' — but
 * nothing moved it back, so a bridge that never answered left the page spinning,
 * and any path that returned to 'waiting' re-fired immediately. A bounded count
 * plus a timeout makes "the extension is not answering" a state the user can see.
 */
const MAX_SYNC_ATTEMPTS = 3
const SYNC_TIMEOUT_MS = 8_000

export function useLinkedInSync() {
  const [state, setState] = useState<LinkedInSyncState>({
    status: 'idle',
    extensionDetected: false,
    linkedInTabDetected: false,
    profile: null,
    error: null,
    lastSyncAt: null,
    profileType: null,
  })

  /** Guards every setState against a message arriving after unmount. */
  const mounted = useRef(true)
  const attempts = useRef(0)
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Monotonic counter, incremented per request.
   *
   * A slow first response and a fast second one can land out of order. Stamping
   * each request and ignoring anything older than the newest stops an earlier,
   * staler profile from overwriting a newer one.
   */
  const requestSeq = useRef(0)
  const latestApplied = useRef(0)

  const clearTimer = useCallback(() => {
    if (timeoutId.current) {
      clearTimeout(timeoutId.current)
      timeoutId.current = null
    }
  }, [])

  const safeSet = useCallback((fn: (s: LinkedInSyncState) => LinkedInSyncState) => {
    if (mounted.current) setState(fn)
  }, [])

  useEffect(() => {
    mounted.current = true

    const handleMessage = (event: MessageEvent) => {
      // Same-window only. The content-script bridge relays into this window, so
      // anything from another frame is not our bridge.
      if (event.source !== window) return

      const data = event.data as { type?: unknown; payload?: unknown } | null
      if (!data || typeof data.type !== 'string') return

      switch (data.type) {
        case INBOUND.ready: {
          safeSet((s) => ({
            ...s,
            extensionDetected: true,
            status: s.status === 'idle' ? 'waiting' : s.status,
          }))
          return
        }

        case INBOUND.tab: {
          safeSet((s) => ({ ...s, linkedInTabDetected: true }))
          return
        }

        case INBOUND.profile: {
          const seq = requestSeq.current
          if (seq < latestApplied.current) return // a newer sync already landed

          // THE VALIDATION BOUNDARY. Anything on this page can post this message.
          const parsed = profileSchema.safeParse(data.payload)
          if (!parsed.success) {
            // Field paths only: the payload may be junk from a hostile script and
            // logging it verbatim puts it in the console for the next reader.
            console.warn(
              '[linkedin-sync] discarded a malformed profile payload',
              parsed.error.issues.slice(0, 5).map((i) => i.path.join('.') || '(root)')
            )
            clearTimer()
            safeSet((s) => ({
              ...s,
              status: 'error',
              error:
                'The extension sent a profile this page could not read. Update the extension and try again.',
            }))
            return
          }

          latestApplied.current = seq
          attempts.current = 0
          clearTimer()
          safeSet((s) => ({
            ...s,
            profile: parsed.data,
            status: 'synced',
            lastSyncAt: new Date(),
            error: null,
          }))
          return
        }

        case INBOUND.error: {
          clearTimer()
          const message =
            typeof data.payload === 'string' && data.payload.length <= 300
              ? data.payload
              : 'Could not read the profile from LinkedIn.'
          safeSet((s) => ({ ...s, status: 'error', error: message }))
          return
        }

        default:
          // Unknown type. Ignored rather than logged: this page receives traffic
          // from unrelated scripts and libraries, and warning on each would be
          // noise that buries the messages that matter.
          return
      }
    }

    window.addEventListener('message', handleMessage)

    // Some builds of the content script set this attribute as well as posting.
    if (document.documentElement.getAttribute('data-linkedin-extension-installed')) {
      safeSet((s) => ({ ...s, extensionDetected: true, status: 'waiting' }))
    }

    return () => {
      mounted.current = false
      clearTimer()
      window.removeEventListener('message', handleMessage)
    }
  }, [safeSet, clearTimer])

  /**
   * Ask the bridge for the profile it last parsed.
   *
   * Bounded and timed. Without the timeout a bridge that never answers leaves
   * the page in 'syncing' indefinitely, which is indistinguishable from slow.
   */
  const requestProfile = useCallback(() => {
    if (attempts.current >= MAX_SYNC_ATTEMPTS) {
      safeSet((s) => ({
        ...s,
        status: 'error',
        error:
          'No response from the extension. Open a LinkedIn profile in another tab, then retry.',
      }))
      return
    }

    attempts.current += 1
    requestSeq.current += 1
    clearTimer()
    safeSet((s) => ({ ...s, status: 'syncing', error: null }))

    timeoutId.current = setTimeout(() => {
      // Only a still-pending request times out; a profile that arrived in the
      // meantime has already moved status to 'synced'.
      safeSet((s) =>
        s.status === 'syncing'
          ? {
              ...s,
              status: attempts.current >= MAX_SYNC_ATTEMPTS ? 'error' : 'waiting',
              error:
                attempts.current >= MAX_SYNC_ATTEMPTS
                  ? 'No response from the extension. Open a LinkedIn profile in another tab, then retry.'
                  : null,
            }
          : s
      )
    }, SYNC_TIMEOUT_MS)

    // Targeted at this exact origin, never '*'. A wildcard target broadcasts to
    // every frame on the page, and the reply carries a person's profile.
    window.postMessage({ type: 'REQUEST_LINKEDIN_PROFILE' }, window.location.origin)
  }, [safeSet, clearTimer])

  const setProfileType = useCallback(
    (type: 'self' | 'contact') => {
      safeSet((s) => ({ ...s, profileType: type }))
      window.postMessage({ type: 'SET_PROFILE_TYPE', payload: type }, window.location.origin)
    },
    [safeSet]
  )

  const clearProfile = useCallback(() => {
    attempts.current = 0
    clearTimer()
    safeSet((s) => ({
      ...s,
      profile: null,
      status: s.extensionDetected ? 'waiting' : 'idle',
      error: null,
      lastSyncAt: null,
      profileType: null,
    }))
  }, [safeSet, clearTimer])

  /**
   * One automatic attempt when the extension first announces itself.
   *
   * Deliberately keyed on `extensionDetected` alone. The previous effect
   * depended on `state.status` and re-ran every time status returned to
   * 'waiting' — including the timeout path above — which is a sync loop.
   */
  const autoRequested = useRef(false)
  useEffect(() => {
    if (state.extensionDetected && !autoRequested.current) {
      autoRequested.current = true
      requestProfile()
    }
  }, [state.extensionDetected, requestProfile])

  return {
    ...state,
    requestProfile,
    setProfileType,
    clearProfile,
    extensionInstallUrl: EXTENSION_INSTALL_URL,
    /** Attempts remaining, so the UI can offer a retry that means something. */
    canRetry: attempts.current < MAX_SYNC_ATTEMPTS,
  }
}
