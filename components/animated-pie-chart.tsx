"use client"

import { useState, useEffect, useRef } from "react"

interface ChartData {
  label: string
  score: number
  color: string
}

interface AnimatedPieChartProps {
  data: ChartData[]
  size?: number
  innerRadius?: number
  animationDuration?: number
  showLabels?: boolean
  chartMode?: "equal" | "weighted" | "performance"
}

export function AnimatedPieChart({
  data,
  size = 400,
  innerRadius = 100,
  animationDuration = 2000,
  showLabels = true,
  chartMode = "equal",
}: AnimatedPieChartProps) {
  const [animatedData, setAnimatedData] = useState<ChartData[]>([])
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null)
  const [animationProgress, setAnimationProgress] = useState(0)
  const [currentMode, setCurrentMode] = useState(chartMode)
  const animationRef = useRef<number>()

  const radius = size / 2 - 60
  const center = size / 2

  const categoryWeights: { [key: string]: number } = {
    Overall: 1.0,
    Experience: 1.5,
    Skills: 1.3,
    Projects: 1.2,
    Education: 1.0,
    Impact: 1.1,
    Format: 0.8,
  }

  const getScoreGradient = (score: number, index: number) => {
    if (score >= 90) {
      return {
        id: `gradient-excellent-${index}`,
        colors: [
          { offset: "0%", color: "#22c55e" },
          { offset: "100%", color: "#16a34a" },
        ],
        fallback: "#22c55e",
        intensity: "excellent",
      }
    } else if (score >= 80) {
      return {
        id: `gradient-good-${index}`,
        colors: [
          { offset: "0%", color: "#3b82f6" },
          { offset: "100%", color: "#2563eb" },
        ],
        fallback: "#3b82f6",
        intensity: "good",
      }
    } else if (score >= 70) {
      return {
        id: `gradient-average-${index}`,
        colors: [
          { offset: "0%", color: "#8b5cf6" },
          { offset: "100%", color: "#7c3aed" },
        ],
        fallback: "#8b5cf6",
        intensity: "average",
      }
    } else if (score >= 60) {
      return {
        id: `gradient-below-${index}`,
        colors: [
          { offset: "0%", color: "#f59e0b" },
          { offset: "100%", color: "#d97706" },
        ],
        fallback: "#f59e0b",
        intensity: "below",
      }
    } else {
      return {
        id: `gradient-poor-${index}`,
        colors: [
          { offset: "0%", color: "#ef4444" },
          { offset: "100%", color: "#dc2626" },
        ],
        fallback: "#ef4444",
        intensity: "poor",
      }
    }
  }

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent"
    if (score >= 80) return "Good"
    if (score >= 70) return "Average"
    if (score >= 60) return "Below Average"
    return "Needs Improvement"
  }

  const calculateSegments = () => {
    const totalScore = data.reduce((sum, item) => sum + item.score, 0)
    const averageScore = totalScore / data.length

    return data.map((item, index) => {
      const gradient = getScoreGradient(item.score, index)
      let segmentSize: number
      let displayPercentage: number

      switch (currentMode) {
        case "equal":
          segmentSize = 100 / data.length
          displayPercentage = segmentSize
          break
        case "weighted":
          const weight = categoryWeights[item.label] || 1.0
          const totalWeights = data.reduce((sum, d) => sum + (categoryWeights[d.label] || 1.0), 0)
          const baseSize = (weight / totalWeights) * 100
          const performanceMultiplier = 0.9 + (item.score / 100) * 0.2
          segmentSize = baseSize * performanceMultiplier
          displayPercentage = segmentSize
          break
        case "performance":
          segmentSize = (item.score / totalScore) * 100
          displayPercentage = segmentSize
          break
        default:
          segmentSize = 100 / data.length
          displayPercentage = segmentSize
      }

      return {
        ...item,
        segmentSize,
        displayPercentage,
        angle: (segmentSize / 100) * 360,
        gradient,
        grade: getScoreLabel(item.score),
        weight: categoryWeights[item.label] || 1.0,
        relativePerformance: (item.score / averageScore) * 100,
      }
    })
  }

  const dataWithSegments = calculateSegments()

  useEffect(() => {
    let startTime: number
    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / animationDuration, 1)

      setAnimationProgress(progress)

      const segmentsToShow = Math.floor(progress * data.length) + 1
      const currentSegments = dataWithSegments.slice(0, segmentsToShow)

      if (segmentsToShow <= data.length) {
        const currentSegmentProgress = (progress * data.length) % 1
        if (currentSegments.length > 0) {
          const lastSegment = currentSegments[currentSegments.length - 1]
          currentSegments[currentSegments.length - 1] = {
            ...lastSegment,
            angle: lastSegment.angle * currentSegmentProgress,
            segmentSize: lastSegment.segmentSize * currentSegmentProgress,
            displayPercentage: lastSegment.displayPercentage * currentSegmentProgress,
          }
        }
      }

      setAnimatedData(currentSegments)

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [data, animationDuration, currentMode])

  const createPath = (startAngle: number, endAngle: number, outerRadius: number, innerRadius: number) => {
    const startAngleRad = (startAngle - 90) * (Math.PI / 180)
    const endAngleRad = (endAngle - 90) * (Math.PI / 180)

    const x1 = center + outerRadius * Math.cos(startAngleRad)
    const y1 = center + outerRadius * Math.sin(startAngleRad)
    const x2 = center + outerRadius * Math.cos(endAngleRad)
    const y2 = center + outerRadius * Math.sin(endAngleRad)

    const x3 = center + innerRadius * Math.cos(endAngleRad)
    const y3 = center + innerRadius * Math.sin(endAngleRad)
    const x4 = center + innerRadius * Math.cos(startAngleRad)
    const y4 = center + innerRadius * Math.sin(startAngleRad)

    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0

    return `M ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4} Z`
  }

  const totalScore = data.reduce((sum, item) => sum + item.score, 0)
  const averageScore = Math.round(totalScore / data.length)
  const highestScore = Math.max(...data.map((item) => item.score))
  const lowestScore = Math.min(...data.map((item) => item.score))
  const scoreRange = highestScore - lowestScore

  let currentAngle = 0

  return (
    <div className="flex flex-col items-center space-y-6">
      {/* Chart Mode Selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-600">View Mode:</span>
        <div className="flex bg-gray-100 rounded-lg p-1">
          {[
            { key: "equal", label: "Equal" },
            { key: "weighted", label: "Weighted" },
            { key: "performance", label: "Performance" },
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => setCurrentMode(mode.key as any)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                currentMode === mode.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg width={size} height={size} className="drop-shadow-lg">
          {/* Define gradients */}
          <defs>
            {dataWithSegments.map((segment, index) => (
              <linearGradient key={segment.gradient.id} id={segment.gradient.id} x1="0%" y1="0%" x2="100%" y2="100%">
                {segment.gradient.colors.map((colorStop, colorIndex) => (
                  <stop key={colorIndex} offset={colorStop.offset} stopColor={colorStop.color} />
                ))}
              </linearGradient>
            ))}
            <radialGradient id="center-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </radialGradient>
          </defs>

          {/* Animated segments */}
          {animatedData.map((segment, index) => {
            const startAngle = currentAngle
            const endAngle = currentAngle + segment.angle
            const isHovered = hoveredSegment === index
            const segmentRadius = isHovered ? radius + 12 : radius

            const path = createPath(startAngle, endAngle, segmentRadius, innerRadius)

            currentAngle = endAngle

            return (
              <g key={index}>
                <path
                  d={path}
                  fill={`url(#${segment.gradient.id})`}
                  stroke="#ffffff"
                  strokeWidth="3"
                  className="transition-all duration-300 cursor-pointer"
                  onMouseEnter={() => setHoveredSegment(index)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  style={{
                    filter: isHovered ? "brightness(1.1) drop-shadow(0 6px 12px rgba(0,0,0,0.2))" : "none",
                  }}
                />
                {isHovered && segment.displayPercentage > 3 && (
                  (() => {
                    const midAngle = (startAngle + endAngle) / 2
                    const midAngleRad = (midAngle - 90) * (Math.PI / 180)
                    const labelRadius = segmentRadius + 25
                    const x = center + labelRadius * Math.cos(midAngleRad)
                    const y = center + labelRadius * Math.sin(midAngleRad)
                    return (
                      <g>
                        <rect x={x - 20} y={y - 10} width="40" height="20" rx="10" fill="rgba(0,0,0,0.8)" />
                        <text x={x} y={y + 4} textAnchor="middle" className="text-xs font-bold fill-white">
                          {segment.score}%
                        </text>
                      </g>
                    )
                  })()
                )}
              </g>
            )
          })}

          {/* Center circle */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="url(#center-gradient)"
            stroke="#d1d5db"
            strokeWidth="2"
          />

          {/* Center content */}
          <text x={center} y={center - 20} textAnchor="middle" className="text-sm font-medium fill-gray-600">
            {currentMode === "equal" ? "Average Score" : currentMode === "weighted" ? "Weighted Score" : "Total Score"}
          </text>
          <text x={center} y={center} textAnchor="middle" className="text-3xl font-bold fill-gray-800">
            {averageScore}%
          </text>
          <text x={center} y={center + 20} textAnchor="middle" className="text-sm font-medium fill-gray-500">
            {getScoreLabel(averageScore)}
          </text>
          <text x={center} y={center + 35} textAnchor="middle" className="text-xs fill-gray-400">
            Range: {lowestScore}% - {highestScore}%
          </text>
        </svg>
        {hoveredSegment !== null && (
          <div className="absolute top-4 left-4 bg-white border border-gray-200 text-gray-900 px-4 py-3 rounded-lg shadow-xl z-10 max-w-xs">
            <div className="text-sm font-semibold">{dataWithSegments[hoveredSegment].label}</div>
            <div className="text-xs text-gray-600 mt-1">
              <div>
                Score: {dataWithSegments[hoveredSegment].score}% • {dataWithSegments[hoveredSegment].grade}
              </div>
              {currentMode === "weighted" && <div>Weight: {dataWithSegments[hoveredSegment].weight}x</div>}
              <div>Performance vs Average: {dataWithSegments[hoveredSegment].relativePerformance.toFixed(0)}%</div>
            </div>
          </div>
        )}
      </div>
      <div className="text-center max-w-md">
        <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          {currentMode === "equal" && "Each category has equal visual representation. Colors show performance levels."}
          {currentMode === "weighted" &&
            "Categories sized by importance (Experience > Skills > Projects > Others). Colors show performance."}
          {currentMode === "performance" &&
            "Segments sized proportionally to actual scores. Higher scores = larger segments."}
        </div>
      </div>
      <div className="w-full max-w-2xl">
        <h4 className="text-lg font-semibold text-center mb-4 text-gray-800">Score Breakdown</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {dataWithSegments.map((segment, index) => (
            <div
              key={index}
              className={`flex items-center space-x-3 p-4 rounded-xl cursor-pointer transition-all duration-300 border-2 ${
                hoveredSegment === index
                  ? "bg-white shadow-lg scale-105 border-gray-300"
                  : "bg-gray-50 hover:bg-white hover:shadow-md border-transparent"
              }`}
              onMouseEnter={() => setHoveredSegment(index)}
              onMouseLeave={() => setHoveredSegment(null)}
            >
              <div
                className="w-5 h-5 rounded-full shadow-sm flex-shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${segment.gradient.colors[0].color}, ${segment.gradient.colors[segment.gradient.colors.length - 1].color})`,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{segment.label}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg font-bold" style={{ color: segment.gradient.colors[0].color }}>
                    {segment.score}%
                  </span>
                  <span className="px-2 py-1 bg-gray-200 rounded-full text-xs font-medium text-gray-700">
                    {segment.grade}
                  </span>
                </div>
                {currentMode === "weighted" && (
                  <div className="text-xs text-gray-500 mt-1">Weight: {segment.weight}x</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="w-full max-w-2xl bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
        <h5 className="font-semibold text-gray-800 mb-3">Performance Summary</h5>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-blue-600">{averageScore}%</div>
            <div className="text-xs text-gray-600">Average</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">{highestScore}%</div>
            <div className="text-xs text-gray-600">Highest</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">{lowestScore}%</div>
            <div className="text-xs text-gray-600">Lowest</div>
          </div>
        </div>
        <div className="mt-3 text-center">
          <div className="text-sm text-gray-600">
            Score Consistency: {" "}
            <span className="font-semibold">{scoreRange <= 20 ? "High" : scoreRange <= 40 ? "Medium" : "Low"}</span>
            <span className="text-xs text-gray-500 ml-1">({scoreRange}% range)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
