"use client"

import { useEffect, useRef, useState } from "react"

interface SemiCircularProgressBarProps {
  value: number // 0-100
  size?: number // px
  strokeWidth?: number
  gradientColors?: [string, string]
  label?: string
  badgeText?: string
  duration?: number // ms
}

export default function SemiCircularProgressBar({
  value,
  size = 220,
  strokeWidth = 14,
  gradientColors = ["#ec4899", "#8b5cf6"],
  label = "Score",
  badgeText = "Good",
  duration = 1200,
}: SemiCircularProgressBarProps) {
  const [animatedValue, setAnimatedValue] = useState(0)
  const requestRef = useRef<number>()
  const startTimeRef = useRef<number>()

  useEffect(() => {
    setAnimatedValue(0)
    startTimeRef.current = undefined
    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp
      const elapsed = timestamp - startTimeRef.current
      // Use easeOutCubic for smoother animation
      const t = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setAnimatedValue(value * ease)
      if (t < 1) {
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
  const startAngle = 180
  const endAngle = 0
  const angle = (animatedValue / 100) * 180

  // Helper to get arc path for a given angle
  function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
    const start = polarToCartesian(cx, cy, r, endAngle)
    const end = polarToCartesian(cx, cy, r, startAngle)
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1"
    return [
      "M", start.x, start.y,
      "A", r, r, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ")
  }
  function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    const rad = (angle - 90) * Math.PI / 180.0
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    }
  }

  // Badge color logic (yellow for 'Good')
  let badgeColor = "bg-yellow-200 text-yellow-800"
  if (value >= 80) badgeColor = "bg-green-200 text-green-800"
  else if (value < 60) badgeColor = "bg-pink-200 text-pink-700"

  let labelText = badgeText
  if (!badgeText) {
    if (value >= 80) labelText = "Excellent"
    else if (value >= 60) labelText = "Good"
    else if (value >= 40) labelText = "Average"
    else labelText = "Needs Improvement"
  }

  // For 0 and 100% label positions
  const labelYOffset = 32
  const leftLabelX = center - radius
  const rightLabelX = center + radius
  const labelY = center + radius / 1.2 + labelYOffset / 2

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size / 1.3 }}>
      <svg width={size} height={size / 1.1}>
        <defs>
          <linearGradient id="semi-circular-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={gradientColors[0]} />
            <stop offset="100%" stopColor={gradientColors[1]} />
          </linearGradient>
        </defs>
        {/* Background arc (full semi-circle) */}
        <path
          d={describeArc(center, center, radius, 180, 0)}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        {/* Animated arc (score only) */}
        {animatedValue > 0 && (
          <path
            d={describeArc(center, center, radius, 180, 180 - angle)}
            stroke="url(#semi-circular-gradient)"
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.2s linear' }}
          />
        )}
        {/* 0 and 100 labels */}
        <text x={leftLabelX} y={labelY} textAnchor="middle" className="text-xs fill-gray-400" style={{ fontSize: 16, fontWeight: 600 }}>
          0
        </text>
        <text x={rightLabelX} y={labelY} textAnchor="middle" className="text-xs fill-gray-400" style={{ fontSize: 16, fontWeight: 600 }}>
          100
        </text>
      </svg>
      <div className="absolute left-0 right-0 top-0 flex flex-col items-center justify-center" style={{ height: size / 2.1 }}>
        <div className="text-base text-gray-400 mb-1" style={{ fontWeight: 500 }}>{label}</div>
        <div className="text-5xl font-extrabold text-white" style={{ letterSpacing: -2 }}>{Math.round(animatedValue)}%</div>
      </div>
      <div className="flex flex-col items-center mt-4">
        <span className={`px-7 py-2 rounded-full text-lg font-semibold shadow ${badgeColor}`}>{labelText}</span>
      </div>
    </div>
  )
}
