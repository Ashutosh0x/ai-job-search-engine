"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Check, Link2, Share2 } from "lucide-react"

/**
 * Share a posting.
 *
 * Uses the Web Share sheet where the browser offers one (every mobile browser,
 * which is where sharing a job actually happens) and falls back to copying the
 * link. Both paths end in visible confirmation -- a share control that silently
 * succeeds reads as broken, and people tap it again.
 *
 * `navigator.share` rejects with AbortError when the user dismisses the sheet.
 * That is a normal outcome, not a failure, so it must not fall through to the
 * clipboard or show an error.
 */
export function ShareJobButton({
  title,
  company,
  path,
  compact = false,
}: {
  title: string
  company: string
  path: string
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const share = async () => {
    // Built in the browser so it is right on every host the page is served
    // from, without the component needing to know the origin.
    const url = new URL(path, window.location.origin).toString()
    const text = `${title} at ${company}`

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: text, url })
        return
      } catch (err) {
        // Dismissing the sheet is a choice, not an error to recover from.
        if ((err as Error)?.name === "AbortError") return
        // Anything else (no permission, unsupported payload): fall through.
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked by permissions policy. Say so rather than
      // leaving a button that appears to do nothing.
      window.prompt("Copy this link", url)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "lg" : "default"}
      onClick={share}
      aria-label={`Share ${title} at ${company}`}
      className={compact ? "shrink-0 px-3" : "w-full"}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : compact ? (
        <Share2 className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
      )}
      {!compact && <span>{copied ? "Link copied" : "Share"}</span>}
      {/* The visual state change above is not announced; this is. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Link copied to clipboard" : ""}
      </span>
    </Button>
  )
}
