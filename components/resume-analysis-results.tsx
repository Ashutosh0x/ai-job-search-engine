"use client"

import { useState, useEffect } from "react"
import Lottie from "lottie-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, AlertCircle, XCircle, TrendingUp, FileText, Target, Zap, Download, RefreshCw } from "lucide-react"

interface AnalysisSection {
  name: string
  score: number
  status: "excellent" | "good" | "needs-improvement"
  feedback: string[]
  recommendations: string[]
}

interface ResumeAnalysisResultsProps {
  isAnalyzing: boolean
  onExportPDF?: () => void
  onReanalyze?: () => void
}

export default function ResumeAnalysisResults({ isAnalyzing, onExportPDF, onReanalyze }: ResumeAnalysisResultsProps) {
  const [overallScore, setOverallScore] = useState(0)
  const [animatedScore, setAnimatedScore] = useState(0)
  const [sections, setSections] = useState<AnalysisSection[]>([])
  const [keywordMatch, setKeywordMatch] = useState(0)
  const [analyzeAnim, setAnalyzeAnim] = useState<any | null>(null)

  // Load the analyzer lottie once
  useEffect(() => {
    let mounted = true
    const candidates = [
      '/resume_lottie.json',
      '/resume-lottie.json',
      '/resume%20lottie.json',
      '/resume%20analyzer%20lottie.json',
    ]
    ;(async () => {
      for (const path of candidates) {
        try {
          const res = await fetch(path)
          if (res.ok) {
            const data = await res.json()
            if (mounted) setAnalyzeAnim(data)
            break
          }
        } catch {}
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Simulate analysis results
  useEffect(() => {
    if (!isAnalyzing) {
      const finalScore = 78
      const analysisResults: AnalysisSection[] = [
        {
          name: "Contact Information",
          score: 95,
          status: "excellent",
          feedback: ["Complete contact details provided", "Professional email format"],
          recommendations: ["Add LinkedIn profile URL", "Include portfolio website"],
        },
        {
          name: "Professional Experience",
          score: 75,
          status: "good",
          feedback: ["Good use of action verbs", "Relevant experience included"],
          recommendations: ["Add more quantified achievements", "Include specific technologies used"],
        },
        {
          name: "Skills & Keywords",
          score: 65,
          status: "needs-improvement",
          feedback: ["Some relevant keywords present"],
          recommendations: ["Add more industry-specific keywords", "Include both hard and soft skills"],
        },
        {
          name: "Education & Certifications",
          score: 85,
          status: "excellent",
          feedback: ["Relevant degree included", "Good academic performance"],
          recommendations: ["Add relevant certifications", "Include relevant coursework"],
        },
      ]

      setOverallScore(finalScore)
      setSections(analysisResults)
      setKeywordMatch(72)

      // Animate score
      let currentScore = 0
      const increment = finalScore / 60
      const timer = setInterval(() => {
        currentScore += increment
        if (currentScore >= finalScore) {
          currentScore = finalScore
          clearInterval(timer)
        }
        setAnimatedScore(currentScore)
      }, 50)

      return () => clearInterval(timer)
    }
  }, [isAnalyzing])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "excellent":
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case "good":
        return <AlertCircle className="w-5 h-5 text-yellow-500" />
      case "needs-improvement":
        return <XCircle className="w-5 h-5 text-red-500" />
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "excellent":
        return "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300"
      case "good":
        return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300"
      case "needs-improvement":
        return "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300"
      default:
        return "bg-gray-100 dark:bg-gray-900/20 text-gray-800 dark:text-gray-300"
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-500"
    if (score >= 60) return "text-yellow-500"
    return "text-red-500"
  }

  if (isAnalyzing) {
    return (
      <Card className="card-glow">
        <CardContent className="p-8">
          <div className="text-center space-y-6">
            <div className="w-40 h-40 md:w-48 md:h-48 mx-auto rounded-2xl flex items-center justify-center bg-gray-100 ring-1 ring-gray-200 shadow-sm dark:bg-transparent dark:ring-0">
              {analyzeAnim ? (
                <Lottie animationData={analyzeAnim} loop autoplay />
              ) : (
                <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto">
                  <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Analyzing Your Resume</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Our AI is examining your resume for ATS compatibility, keyword optimization, and formatting...
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                <span>Parsing document content...</span>
                <span>100%</span>
              </div>
              <Progress value={100} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Overall Score Card */}
      <Card className="card-glow">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-900 dark:text-white flex items-center">
              <Target className="w-5 h-5 mr-2 text-purple-400" />
              Resume Analysis Results
            </CardTitle>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" onClick={onReanalyze}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Re-analyze
              </Button>
              <Button onClick={onExportPDF} className="bg-purple-600 hover:bg-purple-700 text-white">
                <Download className="w-4 h-4 mr-1" />
                Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Overall Score */}
            <div className="text-center">
              <div className="relative w-48 h-24 mx-auto mb-6">
                {/* Semi-circular background */}
                <svg className="w-full h-full" viewBox="0 0 200 100" style={{ overflow: "visible" }}>
                  {/* Background arc */}
                  <path
                    d="M 20 80 A 60 60 0 0 1 180 80"
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="none"
                    className="text-gray-200 dark:text-gray-700"
                    strokeLinecap="round"
                  />
                  {/* Progress arc with gradient */}
                  <defs>
                    <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ec4899" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 20 80 A 60 60 0 0 1 180 80"
                    stroke="url(#scoreGradient)"
                    strokeWidth="12"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="188.5"
                    strokeDashoffset={188.5 - (animatedScore / 100) * 188.5}
                    className="transition-all duration-2000 ease-out"
                  />
                </svg>

                {/* Score text in center */}
                <div className="absolute inset-0 flex flex-col items-center justify-center mt-4">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Score</div>
                  <div className="text-3xl font-bold text-gray-900 dark:text-white">
                    {Math.round(animatedScore * 100) / 100}%
                  </div>
                </div>

                {/* Scale labels */}
                <div className="absolute bottom-0 left-0 text-xs text-gray-400">0</div>
                <div className="absolute bottom-0 right-0 text-xs text-gray-400">100%</div>
              </div>

              <Badge
                className={`${getStatusColor(
                  overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : "needs-improvement",
                )} px-4 py-1`}
              >
                {overallScore >= 80 ? "Excellent" : overallScore >= 60 ? "Good" : "Needs Improvement"}
              </Badge>
            </div>

            {/* Key Metrics */}
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600 dark:text-gray-400">Keyword Match</span>
                  <span className="font-medium text-gray-900 dark:text-white">{keywordMatch}%</span>
                </div>
                <Progress value={keywordMatch} className="h-2" />
              </div>
              {/*
                "Format Score: 85%" and "Content Quality: 72%" used to live here
                as literal constants -- <Progress value={85} /> -- so every
                resume scored identically forever. They are removed rather than
                re-pointed at a variable, because nothing in the pipeline
                computes either quantity yet. A metric is added back when
                something measures it; see docs/resume-intelligence-audit.md §3.2
                for what replaces "Format Score" (the extraction itself, which
                the user can actually check).
              */}
              {sections.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600 dark:text-gray-400">{s.name}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{s.score}%</span>
                  </div>
                  <Progress value={s.score} className="h-2" />
                </div>
              ))}
            </div>

            {/* Quick Stats */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">8 Keywords Found</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Strong keyword presence</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">3 Areas to Improve</p>
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Minor optimizations needed</p>
                </div>
              </div>
              <div className="flex items-center space-x-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">+23% Improvement</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">Potential score increase</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section Analysis */}
      <Card className="card-glow">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white flex items-center">
            <FileText className="w-5 h-5 mr-2 text-purple-400" />
            Section Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {sections.map((section, index) => (
            <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(section.status)}
                  <h4 className="font-semibold text-gray-900 dark:text-white">{section.name}</h4>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-lg font-bold ${getScoreColor(section.score)}`}>{section.score}%</span>
                  <Badge className={getStatusColor(section.status)}>{section.status.replace("-", " ")}</Badge>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Feedback</h5>
                  <ul className="space-y-1">
                    {section.feedback.map((item, i) => (
                      <li key={i} className="text-sm text-gray-600 dark:text-gray-400 flex items-start">
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 mr-2 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recommendations</h5>
                  <ul className="space-y-1">
                    {section.recommendations.map((item, i) => (
                      <li key={i} className="text-sm text-purple-600 dark:text-purple-400 flex items-start">
                        <Zap className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}