"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ChevronDown, FileText, TrendingUp, CheckCircle, AlertCircle, Download, Share2 } from "lucide-react"
import { generateResumeAnalysisPDF } from "@/utils/pdf-export"

interface ResumeScoreCardProps {
  score?: number
  isAnalyzing?: boolean
  fileName?: string
}

export default function ResumeScoreCard({
  score = 75.52,
  isAnalyzing = false,
  fileName = "resume.pdf",
}: ResumeScoreCardProps) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    setIsVisible(true)
    if (!isAnalyzing) {
      const duration = 2000 // 2 seconds
      const steps = 60
      const increment = score / steps
      let currentScore = 0

      const timer = setInterval(() => {
        currentScore += increment
        if (currentScore >= score) {
          currentScore = score
          clearInterval(timer)
        }
        setAnimatedScore(currentScore)
      }, duration / steps)

      return () => clearInterval(timer)
    }
  }, [score, isAnalyzing])

  const getScoreColor = (score: number) => {
    if (score >= 80) return "from-green-400 to-emerald-500"
    if (score >= 60) return "from-blue-400 to-purple-500"
    return "from-pink-400 to-red-500"
  }

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excellent"
    if (score >= 60) return "Good"
    return "Needs Improvement"
  }

  const handleExportPDF = async () => {
    setIsExporting(true)

    try {
      // Sample data - in a real app, this would come from your analysis API
      const analysisData = {
        score: score,
        fileName: fileName,
        analysisDate: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        sections: [
          {
            name: "Contact Information",
            score: 95,
            feedback: [
              "Complete contact information provided",
              "Professional email address used",
              "Phone number format is correct",
            ],
            recommendations: [
              "Consider adding LinkedIn profile URL",
              "Include location (city, state) for better local job matching",
            ],
          },
          {
            name: "Professional Experience",
            score: 78,
            feedback: ["Good use of action verbs", "Relevant work experience included", "Proper chronological order"],
            recommendations: [
              "Add more quantified achievements (numbers, percentages)",
              "Include specific technologies and tools used",
              "Expand on leadership and team collaboration experiences",
            ],
          },
          {
            name: "Skills & Keywords",
            score: 65,
            feedback: ["Technical skills section present", "Some industry-relevant keywords included"],
            recommendations: [
              "Add more job-specific keywords from target job descriptions",
              "Include both hard and soft skills",
              "Organize skills by category (Technical, Leadership, etc.)",
            ],
          },
          {
            name: "Education & Certifications",
            score: 85,
            feedback: ["Education information complete", "Relevant degree for target roles"],
            recommendations: [
              "Add relevant certifications if available",
              "Include GPA if above 3.5 and recent graduate",
            ],
          },
        ],
        keywordAnalysis: {
          found: ["JavaScript", "React", "Node.js", "Python", "AWS", "Git", "Agile", "Team Leadership"],
          missing: ["TypeScript", "Docker", "Kubernetes", "CI/CD", "Microservices", "REST APIs"],
          suggestions: [
            "Add 'TypeScript' to your technical skills if you have experience",
            "Include 'Docker' and 'Kubernetes' for containerization experience",
            "Mention 'CI/CD' pipeline experience in your project descriptions",
            "Add 'REST APIs' and 'Microservices' to highlight backend development skills",
          ],
        },
        overallFeedback: {
          strengths: [
            "Strong technical background with relevant programming languages",
            "Good progression in career responsibilities",
            "Clear and professional formatting",
            "Appropriate length for experience level",
          ],
          improvements: [
            "Add more quantified achievements with specific numbers and metrics",
            "Include more industry-specific keywords for better ATS compatibility",
            "Expand on leadership and collaboration experiences",
            "Add a professional summary or objective statement",
          ],
          tips: [
            "Tailor your resume for each job application by including specific keywords from the job description",
            "Use the STAR method (Situation, Task, Action, Result) to describe your achievements",
            "Keep your resume to 1-2 pages maximum",
            "Use a clean, ATS-friendly format without complex graphics or tables",
            "Proofread carefully for spelling and grammar errors",
            "Update your resume regularly with new skills and experiences",
          ],
        },
      }

      const pdf = generateResumeAnalysisPDF(analysisData)
      pdf.save(`Resume_Analysis_Report_${new Date().toISOString().split("T")[0]}.pdf`)
    } catch (error) {
      console.error("Error generating PDF:", error)
      // You could show a toast notification here
    } finally {
      setIsExporting(false)
    }
  }

  const circumference = 2 * Math.PI * 45 // radius = 45
  const strokeDasharray = circumference
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference

  return (
    <Card
      className={`card-glow transition-all duration-500 ${isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
    >
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Resume Analysis</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">ATS Compatibility Score</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportPDF}
              disabled={isExporting || isAnalyzing}
              className="text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
            >
              <Download className="w-4 h-4 mr-1" />
              {isExporting ? "Exporting..." : "Export PDF"}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-gray-500 dark:text-gray-400">
                  This analysis
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>This analysis</DropdownMenuItem>
                <DropdownMenuItem>Previous analysis</DropdownMenuItem>
                <DropdownMenuItem>All analyses</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Resume Info */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="flex -space-x-2">
              <Avatar className="w-8 h-8 border-2 border-white dark:border-gray-800">
                <AvatarFallback className="bg-purple-500 text-white text-xs">AJ</AvatarFallback>
              </Avatar>
              <Avatar className="w-8 h-8 border-2 border-white dark:border-gray-800">
                <AvatarFallback className="bg-blue-500 text-white text-xs">AI</AvatarFallback>
              </Avatar>
              <Avatar className="w-8 h-8 border-2 border-white dark:border-gray-800">
                <AvatarFallback className="bg-green-500 text-white text-xs">AT</AvatarFallback>
              </Avatar>
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Software Engineer Resume</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">4 sections analyzed</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-gray-400">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportPDF} disabled={isExporting}>
                <Download className="w-4 h-4 mr-2" />
                Export PDF Report
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Share2 className="w-4 h-4 mr-2" />
                Share Analysis
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Animated Score Circle */}
        <div className="flex justify-center mb-8">
          <div className="relative w-48 h-48">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                className="text-gray-200 dark:text-gray-700"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="45"
                stroke="url(#gradient)"
                strokeWidth="8"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-1000 ease-out"
              />
              {/* Gradient definition */}
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" className="text-pink-400" stopColor="currentColor" />
                  <stop offset="50%" className="text-purple-500" stopColor="currentColor" />
                  <stop offset="100%" className="text-blue-500" stopColor="currentColor" />
                </linearGradient>
              </defs>
            </svg>

            {/* Score text in center */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Score</div>
              <div className="text-3xl font-bold text-gray-900 dark:text-white">
                {isAnalyzing ? (
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                ) : (
                  `${animatedScore.toFixed(1)}%`
                )}
              </div>
              {!isAnalyzing && (
                <Badge
                  variant="secondary"
                  className={`mt-2 bg-gradient-to-r ${getScoreColor(score)} text-white border-none`}
                >
                  {getScoreLabel(score)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Score indicators */}
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-6">
          <span>0</span>
          <span>100%</span>
        </div>

        {/* Quick insights */}
        {!isAnalyzing && (
          <div className="space-y-3 mb-6">
            <div className="flex items-center space-x-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-300">Strong keyword optimization</p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  Your resume contains relevant industry keywords
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Add quantified achievements</p>
                <p className="text-xs text-yellow-600 dark:text-yellow-400">Include specific numbers and metrics</p>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex space-x-3">
          <Button
            variant="ghost"
            className="flex-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            {isAnalyzing ? "Analyzing resume..." : "View detailed analysis"}
          </Button>

          {!isAnalyzing && (
            <Button
              onClick={handleExportPDF}
              disabled={isExporting}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? "Exporting..." : "Export PDF"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
