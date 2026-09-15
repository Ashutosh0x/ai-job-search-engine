'use client'

import { useEffect, useRef } from 'react'
import { track } from '@/lib/analytics/client'
import type { ClientEvent } from '@/lib/analytics/events'

/**
 * Fire one event when this mounts.
 *
 * Renders nothing, so it can be dropped into a server-rendered page without
 * making that page a client component -- the page stays server-rendered and
 * only this marker hydrates. That matters here: the job detail page is the SEO
 * surface, and turning it into a client component to record a view would trade
 * the thing being measured for the measurement.
 *
 * The guard ref is load-bearing. React 18 Strict Mode mounts, unmounts and
 * remounts every component in development, so without it every view is counted
 * twice locally and the numbers disagree with production for no visible reason.
 */
export function TrackView({ event }: { event: ClientEvent }) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    track(event)
    // Deliberately mount-only: this records "the page was opened", which happens
    // once. Re-firing on prop changes would count a re-render as a visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
