"use client"
import { motion } from "framer-motion"

export default function CTCOverlays() {
  const float = {
    animate: {
      y: [0, -6, 0],
      transition: { duration: 3.5, repeat: Infinity, ease: "easeInOut" as const },
    },
  }
  const items = [
    { key: "hit", text: "89% Hit Rate this year", className: "top-[-32px] left-[40%]" },
    { key: "deals", text: "71% Deals this year", className: "top-[16px] right-[10%]" },
    { key: "growth", text: "254 +1.6%", className: "top-[108px] left-[48%]" },
    { key: "ats", text: "ATS Score 92%", className: "bottom-[80px] left-[28%]" },
    { key: "optimized", text: "100% Optimized", className: "top-[56px] right-[-12px]" },
    { key: "stats", text: "Resume stats", className: "bottom-[-24px] right-[4%]" },
  ]

  return (
    <div className="pointer-events-none absolute inset-0">
      {items.map((i, idx) => (
        <motion.div
          key={i.key}
          variants={float}
          animate="animate"
          initial={{ opacity: 0, y: 8 }}
          transition={{ delay: idx * 0.15 }}
          className={`hidden md:flex items-center gap-2 text-xs md:text-sm bg-white/80 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-700 shadow-lg rounded-xl px-3 py-2 text-gray-900 dark:text-gray-100 backdrop-blur-sm absolute ${i.className}`}
        >
          <span className="font-semibold">{i.text}</span>
        </motion.div>
      ))}
    </div>
  )
}


