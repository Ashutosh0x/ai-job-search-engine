"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  MessageSquare, 
  FileText, 
  Sparkles, 
  Copy, 
  Download, 
  Send,
  CheckCircle,
  Loader2
} from "lucide-react"
import { useToast } from "@/components/toast-provider"

interface JobApplicationAssistantProps {
  job: any
  userResume: any
  userProfile: any
}

export default function JobApplicationAssistant({ 
  job, 
  userResume, 
  userProfile 
}: JobApplicationAssistantProps) {
  const [coverLetter, setCoverLetter] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [applicationScore, setApplicationScore] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const { addToast } = useToast()

  const generateCoverLetter = async () => {
    setIsGenerating(true)
    try {
      const response = await fetch("/api/generate-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job,
          resume: userResume,
          profile: userProfile
        })
      })

      if (!response.ok) throw new Error("Failed to generate cover letter")
      
      const data = await response.json()
      setCoverLetter(data.coverLetter)
      setApplicationScore(data.score)
      setSuggestions(data.suggestions)
      
      addToast({
        title: "Cover Letter Generated",
        description: "Your personalized cover letter is ready!",
        type: "success"
      })
    } catch (error) {
      addToast({
        title: "Generation Failed",
        description: "Failed to generate cover letter. Please try again.",
        type: "error"
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(coverLetter)
      addToast({
        title: "Copied!",
        description: "Cover letter copied to clipboard",
        type: "success"
      })
    } catch (error) {
      addToast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard",
        type: "error"
      })
    }
  }

  const downloadCoverLetter = () => {
    const blob = new Blob([coverLetter], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `cover-letter-${job.company}-${job.title}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-600" />
            AI Application Assistant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="cover-letter" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="cover-letter">Cover Letter</TabsTrigger>
              <TabsTrigger value="application-score">Application Score</TabsTrigger>
              <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
            </TabsList>

            <TabsContent value="cover-letter" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Personalized Cover Letter</h3>
                <Button 
                  onClick={generateCoverLetter} 
                  disabled={isGenerating}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Cover Letter
                    </>
                  )}
                </Button>
              </div>

              {coverLetter ? (
                <div className="space-y-4">
                  <Textarea
                    value={coverLetter}
                    onChange={(e) => setCoverLetter(e.target.value)}
                    placeholder="Your personalized cover letter will appear here..."
                    className="min-h-[400px] resize-none"
                  />
                  <div className="flex gap-2">
                    <Button onClick={copyToClipboard} variant="outline">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                    <Button onClick={downloadCoverLetter} variant="outline">
                      <Download className="w-4 h-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>Click "Generate Cover Letter" to create a personalized cover letter for this position.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="application-score" className="space-y-4">
              <div className="text-center">
                <div className="relative w-32 h-32 mx-auto mb-4">
                  <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="3"
                      strokeDasharray={`${applicationScore}, 100`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      {applicationScore}%
                    </span>
                  </div>
                </div>
                <h3 className="text-lg font-semibold mb-2">Application Score</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Your application strength for this position
                </p>
              </div>
            </TabsContent>

            <TabsContent value="suggestions" className="space-y-4">
              <h3 className="text-lg font-semibold">Application Suggestions</h3>
              {suggestions.length > 0 ? (
                <div className="space-y-2">
                  {suggestions.map((suggestion, index) => (
                    <div key={index} className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-blue-800 dark:text-blue-200">{suggestion}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>Generate a cover letter to see personalized suggestions for your application.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
