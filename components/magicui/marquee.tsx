"use client"
import * as React from "react"
import { cn } from "@/lib/utils"

type MarqueeProps = React.HTMLAttributes<HTMLDivElement> & {
  pauseOnHover?: boolean
  reverse?: boolean
}

export function Marquee({
  className,
  children,
  pauseOnHover = false,
  reverse = false,
  ...props
}: MarqueeProps) {
  const content = React.Children.toArray(children)
  return (
    <div
      className={cn("relative w-full overflow-hidden", className)}
      {...props}
    >
      <div
        className={cn(
          "flex w-max gap-4 will-change-transform",
          pauseOnHover && "[animation-play-state:running] hover:[animation-play-state:paused]"
        )}
        style={{
          animation: `marquee var(--duration, 20s) linear infinite`,
          animationDirection: reverse ? ("reverse" as const) : ("normal" as const),
        }}
      >
        {/* duplicate for seamless loop */}
        <div className="flex w-max gap-4">
          {content}
        </div>
        <div className="flex w-max gap-4" aria-hidden>
          {content}
        </div>
      </div>

      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>
    </div>
  )
}

export default Marquee
