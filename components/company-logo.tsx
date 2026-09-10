"use client"

import { useState } from "react"

/**
 * Company logo with a typographic fallback.
 *
 * This replaces the emoji "logos" the jobs page used to hard-code alongside
 * invented employers. A real logo, keyed off the company's domain, is both
 * honest and far more scannable in a dense list -- people recognise marks
 * faster than they read names.
 *
 * When the image fails (no favicon, blocked, offline) it degrades to the
 * company's initials on a stable colour derived from the name, so the grid
 * never shows a broken-image icon and never falls back to a decorative emoji
 * that says nothing about the employer.
 */
export function CompanyLogo({
  name,
  logoUrl,
  size = 40,
  className = "",
}: {
  name: string
  logoUrl?: string | null
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")

  // Deterministic hue per company so the fallback is stable across renders
  // and distinguishable between neighbouring cards.
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const hue = hash % 360

  if (!logoUrl || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-lg font-semibold text-white ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          background: `linear-gradient(135deg, hsl(${hue} 62% 48%), hsl(${(hue + 40) % 360} 62% 38%))`,
        }}
        aria-hidden="true"
      >
        {initials || "?"}
      </div>
    )
  }

  return (
    <img
      src={logoUrl}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg bg-white object-contain ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
