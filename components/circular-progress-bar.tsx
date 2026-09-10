"use client"

import { useEffect, useRef, useState } from "react"

interface CircularProgressBarProps {
  value: number // 0-100
  size?: number // px
  strokeWidth?: number
  gradientColors?: [string, string]
  label?: string
  duration?: number // ms
}

export default function CircularProgressBar({
  value,
  size = 180,
  strokeWidth = 12,
  gradientColors = ["#3b82f6", "#ec4899"],
  label = "Score",
  duration = 1200,
}: CircularProgressBarProps) {
  const [animatedValue, setAnimatedValue] = useState(0)
  const requestRef = useRef<number>()
  const startTimeRef = useRef<number>()

  useEffect(() => {
    setAnimatedValue(0)
    startTimeRef.current = undefined
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      setAnimatedValue(value * progress)
      if (progress < 1) {
        requestRef.current = requestAnimationFrame(animate)
      }
    }
    requestRef.current = requestAnimationFrame(animate)
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
    }
  }, [value, duration])

  // SVG calculations
  const radius = (size - strokeWidth) / 2
  const center = size / 2
  const circumference = 2 * Math.PI * radius
  const arcLength = (animatedValue / 100) * circumference

  // Label color logic
  let badgeColor = "bg-gray-200 text-gray-700"
  if (value >= 80) badgeColor = "bg-green-100 text-green-700"
  else if (value >= 60) badgeColor = "bg-blue-100 text-blue-700"
  else if (value >= 40) badgeColor = "bg-yellow-100 text-yellow-700"
  else badgeColor = "bg-pink-100 text-pink-700"

  let labelText = "Needs Improvement"
  if (value >= 80) labelText = "Excellent"
  else if (value >= 60) labelText = "Good"
  else if (value >= 40) labelText = "Average"

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="circular-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={gradientColors[0]} />
            <stop offset="100%" stopColor={gradientColors[1]} />
          </linearGradient>
        </defs>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="url(#circular-gradient)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - arcLength}
          style={{ transition: 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      <div className="absolute left-0 right-0 top-0 bottom-0 flex flex-col items-center justify-center">
        <div className="text-sm text-gray-500 mb-1">{label}</div>
        <div className="text-4xl font-bold text-gray-900 dark:text-white">{animatedValue.toFixed(1)}%</div>
        <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold ${badgeColor}`}>{labelText}</span>
      </div>
    </div>
  )
}
