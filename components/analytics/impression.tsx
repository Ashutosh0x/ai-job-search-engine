'use client'

import { useEffect, useRef } from 'react'
import { track } from '@/lib/analytics/client'

/**
 * Record a search result as seen — only when it actually was.
 *
 * WHY THIS IS NOT "COUNT WHAT THE API RETURNED"
 * ---------------------------------------------
 * The obvious implementation counts every row in the response. It is wrong, and
 * wrong in the direction that quietly ruins every rate on the dashboard.
 *
 * A search returning 50 results where the visitor reads the first 8 is 8
 * impressions, not 50. Counting 50 divides every click-through rate by six and
 * makes well-performing jobs look ignored. Worse, it is not a constant factor:
 * it depends on page size and scroll depth, so the distortion moves whenever
 * the layout changes.
 *
 * So an impression here means: this card intersected the viewport, by at least
 * half its area, for at least half a second. That is defensible as "a person
 * had the opportunity to read it", which is what the metric claims.
 *
 * THE DWELL REQUIREMENT
 * ---------------------
 * Without it, flinging a long list past the screen records every card on the
 * way. The timer is cancelled if the card leaves before it elapses, so fast
 * scrolling records nothing and reading records everything.
 */

/** Fraction of the card that must be visible. */
const VISIBLE_RATIO = 0.5
/** How long it must stay that way. */
const DWELL_MS = 500

export function TrackImpression({
  jobId,
  companySlug,
  position,
  query,
  children,
}: {
  jobId: string
  companySlug?: string | null
  /** 1-based rank in the list the user is looking at. */
  position?: number
  query?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || fired.current) return

    /**
     * No IntersectionObserver means no impression.
     *
     * Falling back to "count it immediately" would mean older browsers report
     * impressions on a completely different definition from everyone else, and
     * a metric that means two things is worse than one with a known gap. Support
     * is near-universal; the gap is small and honest.
     */
    if (typeof IntersectionObserver === 'undefined') return

    let dwell: ReturnType<typeof setTimeout> | null = null

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
            if (dwell || fired.current) continue
            dwell = setTimeout(() => {
              if (fired.current) return
              fired.current = true
              track({
                type: 'search_result_impression',
                jobId,
                companySlug: companySlug ?? undefined,
                position,
                query,
              })
              // One impression per card per render. Stop observing so a card
              // scrolled past repeatedly is not counted repeatedly.
              observer.disconnect()
            }, DWELL_MS)
          } else if (dwell) {
            // Left the viewport before dwelling: not an impression.
            clearTimeout(dwell)
            dwell = null
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    )

    observer.observe(el)
    return () => {
      if (dwell) clearTimeout(dwell)
      observer.disconnect()
    }
  }, [jobId, companySlug, position, query])

  // `display: contents` so this wrapper takes part in no layout: dropping it
  // around a grid child must not break the grid.
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
