"use client"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

const LOGOS = [
  "amazon.png",
  "google.jpg",
  "Microsoft.png",
  "netflix.png",
  "Meta_logo.png",
  "stripe.png",
  "VISA-logo.png",
  "Mastercard-logo.svg.png",
  "Capital_One_logo_PNG1.png",
  "J.P.-Morgan-Chase-Logo.png",
  "american express.png",
  "adobe.png",
]

// Per-logo class overrides to ensure visibility on dark backgrounds
const LOGO_CLASS_OVERRIDES: Record<string, string> = {
  // Add per-logo tweaks here if needed (e.g., brightness adjustments)
}

function readableAlt(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, "")
  return base
    .replace(/[._-]+/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

export function LogoMarquee({ className }: { className?: string }) {
  // Duplicate the array for a seamless loop
  const scrollingLogos = [...LOGOS, ...LOGOS]

  return (
    <div className={cn("relative overflow-hidden", className)}>

      <motion.div
        className="flex items-center gap-10 sm:gap-16 will-change-transform"
        initial={{ x: 0 }}
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        style={{ width: "max-content" }}
      >
        {scrollingLogos.map((file, idx) => {
          const commonClass = cn(
            "h-8 sm:h-10 w-auto object-contain",
            LOGO_CLASS_OVERRIDES[file] ?? ""
          )

          const buildCandidates = (name: string) => {
            const base = name.replace(/\.[^/.]+$/, "")
            const ext = name.split('.').pop() || 'svg'
            return [
              `/logos/${name}`,
              `/logos/${name.toLowerCase()}`,
              `/logos/${base.replaceAll('_', '-')}.$
{ext}`,
              `/logos/${base.replaceAll('_', ' ')}.${ext}`,
              `/logos/${base}.png`,
              `/logos/${base.toLowerCase()}.png`,
            ]
          }

          const onImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
            const el = e.currentTarget
            const tried = el.getAttribute('data-tried')?.split('|') ?? []
            const candidates = buildCandidates(file).map((p) => encodeURI(p))
            const next = candidates.find((c) => !tried.includes(c) && c !== el.src)
            if (next) {
              tried.push(next)
              el.setAttribute('data-tried', tried.join('|'))
              el.src = next
            } else {
              // As a last resort, show text logo style
              el.style.display = 'none'
              const parent = el.parentElement
              if (parent && !parent.querySelector('[data-fallback]')) {
                const span = document.createElement('span')
                span.dataset.fallback = 'true'
                span.textContent = readableAlt(file)
                span.className = 'text-sm sm:text-base opacity-70'
                parent.appendChild(span)
              }
            }
          }

          return (
            <div key={`${file}-${idx}`} className="shrink-0 opacity-100">
              <img
                src={encodeURI(`/logos/${file}`)}
                alt={readableAlt(file)}
                className={commonClass}
                loading="lazy"
                onError={onImgError}
                data-tried={encodeURI(`/logos/${file}`)}
              />
            </div>
          )
        })}
      </motion.div>
    </div>
  )
}

export default LogoMarquee


