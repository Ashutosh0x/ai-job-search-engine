"use client"

import React from "react"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Upload,
  FileText,
  CheckCircle,
  User,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  GraduationCap,
  X,
  AlertCircle,
} from "lucide-react"
import Navigation from "@/components/navigation"
import DocumentPreview from "@/components/document-preview"
import ResumeAnalysisResults from "@/components/resume-analysis-results"
import { generateResumeAnalysisPDF } from "@/utils/pdf-export"
import { getSupabaseClientSafe } from "@/lib/supabase"
import { AnimatedPieChart } from "@/components/animated-pie-chart"
import Lottie from "lottie-react"

interface ParsedResumeInfo {
  name?: string
  email?: string
  phone?: string
  location?: string
  skills?: string[]
  experience?: string
  fullText: string
}

export default function ResumeUpload() {
  const supabase = getSupabaseClientSafe();
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [isUploading, setIsUploading] = useState(false) // New state for upload status
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseSuccess, setParseSuccess] = useState(false)
  const [parsedInfo, setParsedInfo] = useState<ParsedResumeInfo>({
    name: "",
    email: "",
    phone: "",
    location: "",
    skills: [],
    experience: "",
    fullText: "",
  })

  // Previous uploads
  const [previousResumes, setPreviousResumes] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(true)
  const [reparsingId, setReparsingId] = useState<string | null>(null)
  const [analyzeAnim, setAnalyzeAnim] = useState<any | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      setLoadingHistory(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase
        .from('resumes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)
      if (!error) setPreviousResumes(data || [])
    } finally {
      setLoadingHistory(false)
    }
  }, [supabase])

  // Load history on mount
  React.useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Load resume analyzer lottie once, trying several common filenames
  React.useEffect(() => {
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
        } catch {
          // try next candidate
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const extractPathFromFileUrl = (stored: string): string => {
    // stored may be like 'resume/userId/file.pdf' or just 'userId/file.pdf'
    return stored.startsWith('resume/') ? stored.replace(/^resume\//, '') : stored
  }

  const reparseResume = async (row: any) => {
    try {
      setReparsingId(row.id)
      const path = extractPathFromFileUrl(row.file_url as string)
      const { data: signed, error } = await supabase.storage
        .from('resume')
        .createSignedUrl(path, 60 * 10)
      if (error || !signed?.signedUrl) throw new Error(error?.message || 'Failed to sign URL')
      const resp = await fetch('/api/parse-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: signed.signedUrl })
      })
      if (!resp.ok) throw new Error(`Parse failed: ${resp.status}`)
      const result = await resp.json()
      if (!result.success) throw new Error(result.error || 'Parse error')
      await supabase
        .from('resumes')
        .update({ parsed_text: result.data.fullText, parsed_info: result.data, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      refreshHistory()
    } catch (e) {
      console.error('Reparse error:', e)
    } finally {
      setReparsingId(null)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files[0])
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleFileUpload = async (file: File) => {
    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]

    const fileExtension = file.name.toLowerCase().split(".").pop()
    const allowedExtensions = ["pdf", "doc", "docx"]

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension || "")) {
      setParseError("Please upload a PDF, DOC, or DOCX file")
      return
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setParseError("File size must be less than 10MB")
      return
    }

    setUploadedFile(file)
    setShowAnalysis(false)
    setParseError(null)
    setParseSuccess(false)
    setIsUploading(true) // Start uploading indicator

    try {
      // 1. Upload to Supabase Storage
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error("User not authenticated. Please log in to upload resumes.");
      }
      const user = userData.user;

      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('resume')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Supabase Storage Upload Error: ${uploadError.message}`);
      }

      // Generate a signed URL for private preview
      const { data: signed, error: signedError } = await supabase.storage
        .from('resume')
        .createSignedUrl(filePath, 60 * 60) // 1 hour
      if (signedError || !signed?.signedUrl) {
        throw new Error(`Failed to generate preview URL: ${signedError?.message || 'Unknown error'}`)
      }
      const fileUrl = signed.signedUrl
      setIsUploading(false); // Upload complete, set uploading to false
      setIsParsing(true); // Start parsing indicator

      // 2. Parse the document via API
      const formData = new FormData();
      formData.append("file", file);

      const parseResponse = await fetch("/api/parse-resume", {
        method: "POST",
        body: formData,
      });

      if (!parseResponse.ok) {
        let errorMessage = "Failed to parse resume";
        try {
          const errorData = await parseResponse.json();
          errorMessage = errorData.error || `Server error: ${parseResponse.status} ${parseResponse.statusText}`;
        } catch {
          errorMessage = `Server error: ${parseResponse.status} ${parseResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const parseResult = await parseResponse.json();

      if (!parseResult.success || !parseResult.data) {
        throw new Error(parseResult.error || "Invalid parsing response format");
      }

      const parsedData = parseResult.data;
      setParsedInfo(parsedData);
      setParseSuccess(true);

      // 3. Save to Supabase Database
      const { data: insertData, error: insertError } = await supabase
        .from('resumes')
        .insert({
          user_id: user.id,
          file_name: file.name,
          file_url: `resume/${filePath}`,
          parsed_text: parsedData.fullText,
          parsed_info: parsedData, // Store the entire parsed object as JSONB
          status: 'parsed',
          source: 'upload', // Or 'web' or 'manual' etc.
        });

      if (insertError) {
        throw new Error(`Supabase Database Insert Error: ${insertError.message}`);
      }
      // Refresh history
      refreshHistory()

    } catch (error) {
      console.error("Error during file upload or parsing:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setParseError(errorMessage);
      setParseSuccess(false); // Ensure success is false on error
    } finally {
      setIsUploading(false);
      setIsParsing(false);
    }
  }

  const handleOptimize = () => {
    setIsAnalyzing(true)
    setShowAnalysis(true)

    // Simulate analysis time
    setTimeout(() => {
      setIsAnalyzing(false)
    }, 3000)
  }

  const handleReanalyze = () => {
    setIsAnalyzing(true)
    setTimeout(() => {
      setIsAnalyzing(false)
    }, 2000)
  }

  const handleExportPDF = () => {
    const analysisData = {
      score: 78,
      fileName: uploadedFile?.name || "resume.pdf",
      analysisDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      sections: [
        {
          name: "Contact Information",
          score: 95,
          feedback: ["Complete contact information provided", "Professional email address used"],
          recommendations: ["Consider adding LinkedIn profile URL", "Include location for better local job matching"],
        },
        {
          name: "Professional Experience",
          score: 75,
          feedback: ["Good use of action verbs", "Relevant work experience included"],
          recommendations: ["Add more quantified achievements", "Include specific technologies used"],
        },
        {
          name: "Skills & Keywords",
          score: 65,
          feedback: ["Technical skills section present", "Some industry-relevant keywords included"],
          recommendations: ["Add more job-specific keywords", "Include both hard and soft skills"],
        },
        {
          name: "Education & Certifications",
          score: 85,
          feedback: ["Education information complete", "Relevant degree for target roles"],
          recommendations: ["Add relevant certifications", "Include GPA if above 3.5"],
        },
      ],
      keywordAnalysis: {
        found:
          parsedInfo.skills && parsedInfo.skills.length > 0 ? parsedInfo.skills : ["JavaScript", "React", "Node.js", "Python", "AWS", "Git"],
        missing: ["TypeScript", "Docker", "Kubernetes", "CI/CD", "Microservices"],
        suggestions: ["Add TypeScript to technical skills", "Include Docker and Kubernetes experience"],
      },
      overallFeedback: {
        strengths: ["Strong technical background", "Good career progression", "Professional formatting"],
        improvements: ["Add quantified achievements", "Include more keywords", "Expand on leadership"],
        tips: ["Tailor resume for each application", "Use STAR method for achievements", "Keep to 1-2 pages"],
      },
    }

    const pdf = generateResumeAnalysisPDF(analysisData)
    pdf.save(`Resume_Analysis_Report_${new Date().toISOString().split("T")[0]}.pdf`)
  }

  const removeFile = () => {
    setUploadedFile(null)
    setShowAnalysis(false)
    setParseError(null)
    setParseSuccess(false)
    setParsedInfo({
      name: "",
      email: "",
      phone: "",
      location: "",
      skills: [],
      experience: "",
      fullText: "",
    })
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen p-6">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Resume Analysis & Optimization</h1>
            <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Upload your resume to get instant preview, ATS feedback, and detailed optimization recommendations.
            </p>
          </div>

          {!uploadedFile ? (
            /* Upload Section */
            <div className="max-w-2xl mx-auto">
              <Card className="card-glow">
                <CardHeader>
                  <CardTitle className="text-gray-900 dark:text-white flex items-center justify-center">
                    <Upload className="w-5 h-5 mr-2 text-purple-400" />
                    Upload Your Resume
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                      isDragOver ? "border-purple-400 bg-purple-400/10" : "border-gray-600 hover:border-gray-500"
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="space-y-6">
                      <div className="w-20 h-20 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto">
                        <FileText className="w-10 h-10 text-purple-400" />
                      </div>
                      <div>
                        <p className="text-xl text-gray-900 dark:text-white font-medium mb-2">
                          Drag and drop your resume here
                        </p>
                        <p className="text-gray-600 dark:text-gray-400">or click to browse files</p>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="resume-upload"
                      />
                      <label htmlFor="resume-upload">
                        <Button className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3" asChild>
                          <span>Choose File</span>
                        </Button>
                      </label>
                      <p className="text-sm text-gray-500">Supports PDF, DOC, DOCX (max 10MB)</p>
                    </div>
                  </div>

                  {parseError && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 text-red-500" />
                        <p className="text-red-700 dark:text-red-400 text-sm">{parseError}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Main Content with Preview and Analysis */
            <div className="grid lg:grid-cols-2 gap-8">
              {/* Left Column - Preview and Info */}
              <div className="space-y-6">
                {/* Animated Pie Chart (show after parsing success) */}
                {parseSuccess && (
                  <AnimatedPieChart
                    data={[
                      { label: "Overall", score: 82, color: "#3b82f6" },
                      { label: "Experience", score: 90, color: "#22c55e" },
                      { label: "Skills", score: 75, color: "#8b5cf6" },
                      { label: "Projects", score: 70, color: "#f59e0b" },
                      { label: "Education", score: 80, color: "#2563eb" },
                      { label: "Impact", score: 65, color: "#ef4444" },
                      { label: "Format", score: 88, color: "#7c3aed" },
                    ]}
                    size={400}
                    innerRadius={100}
                  />
                )}
                {/* File Info */}
                <Card className="card-glow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-purple-400" />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{uploadedFile.name}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB • Uploaded just now
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {isUploading ? (
                          analyzeAnim ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200 shadow-sm dark:bg-transparent dark:ring-0">
                              <Lottie animationData={analyzeAnim} loop autoplay style={{ width: 28, height: 28 }} />
                            </span>
                          ) : (
                            <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                          )
                        ) : isParsing ? (
                          analyzeAnim ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200 shadow-sm dark:bg-transparent dark:ring-0">
                              <Lottie animationData={analyzeAnim} loop autoplay style={{ width: 28, height: 28 }} />
                            </span>
                          ) : (
                            <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                          )
                        ) : parseError ? (
                          <AlertCircle className="w-5 h-5 text-yellow-500" />
                        ) : parseSuccess ? (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={removeFile}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Document Preview */}
                <DocumentPreview
                  file={uploadedFile}
                  onOptimize={handleOptimize}
                  isOptimizing={isAnalyzing}
                  parsedText={parsedInfo.fullText}
                />

                {/* Parsed Information */}
                {(parsedInfo.name || isParsing) && (
                  <Card className="card-glow">
                    <CardHeader>
                      <CardTitle className="text-gray-900 dark:text-white flex items-center">
                      {isUploading ? (
                        <>
                          {analyzeAnim ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200 shadow-sm dark:bg-transparent dark:ring-0">
                              <Lottie animationData={analyzeAnim} loop autoplay style={{ width: 24, height: 24 }} />
                            </span>
                          ) : (
                            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mr-2" />
                          )}
                          <span className="ml-2">Uploading File...</span>
                        </>
                      ) : isParsing ? (
                        <>
                          {analyzeAnim ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200 shadow-sm dark:bg-transparent dark:ring-0">
                              <Lottie animationData={analyzeAnim} loop autoplay style={{ width: 24, height: 24 }} />
                            </span>
                          ) : (
                            <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mr-2" />
                          )}
                          <span className="ml-2">Extracting Information...</span>
                        </>
                      ) : (
                        "Extracted Information"
                      )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {parseError && (
                        <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <AlertCircle className="w-4 h-4 text-red-500" />
                            <p className="text-red-700 dark:text-red-400 text-sm">{parseError}</p>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center text-gray-500 dark:text-gray-400">
                            <User className="w-4 h-4 mr-2" />
                            <span className="text-sm">Name</span>
                          </div>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {isParsing ? "Extracting..." : parsedInfo.name}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center text-gray-500 dark:text-gray-400">
                            <Mail className="w-4 h-4 mr-2" />
                            <span className="text-sm">Email</span>
                          </div>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {isParsing ? "Extracting..." : parsedInfo.email}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center text-gray-500 dark:text-gray-400">
                            <Phone className="w-4 h-4 mr-2" />
                            <span className="text-sm">Phone</span>
                          </div>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {isParsing ? "Extracting..." : parsedInfo.phone}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center text-gray-500 dark:text-gray-400">
                            <MapPin className="w-4 h-4 mr-2" />
                            <span className="text-sm">Location</span>
                          </div>
                          <p className="text-gray-900 dark:text-white font-medium">
                            {isParsing ? "Extracting..." : parsedInfo.location}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center text-gray-500 dark:text-gray-400">
                          <Briefcase className="w-4 h-4 mr-2" />
                          <span className="text-sm">Skills</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isParsing ? (
                            <Badge variant="secondary" className="bg-gray-200 dark:bg-gray-700">
                              Extracting skills...
                            </Badge>
                          ) : parsedInfo.skills && parsedInfo.skills.length > 0 ? (
                            parsedInfo.skills.map((skill) => (
                              <Badge
                                key={skill}
                                variant="secondary"
                                className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                              >
                                {skill}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="secondary" className="bg-gray-200 dark:bg-gray-700">
                              No skills detected
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center text-gray-500 dark:text-gray-400">
                          <GraduationCap className="w-4 h-4 mr-2" />
                          <span className="text-sm">Experience</span>
                        </div>
                        <p className="text-gray-900 dark:text-white">
                          {isParsing ? "Extracting experience..." : parsedInfo.experience}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right Column - Analysis Results */}
              <div>
                {showAnalysis ? (
                  <ResumeAnalysisResults
                    isAnalyzing={isAnalyzing}
                    onExportPDF={handleExportPDF}
                    onReanalyze={handleReanalyze}
                  />
                ) : (
                  <Card className="card-glow h-96 flex items-center justify-center">
                    <div className="text-center text-gray-500 dark:text-gray-400">
                      <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium mb-2">Ready to Analyze</p>
                      <p>Click "Optimize Resume" to get your ATS score and recommendations</p>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* History */}
          <Card className="card-glow max-w-5xl mx-auto">
            <CardHeader>
              <CardTitle className="text-gray-900 dark:text-white">Your Past Resumes</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingHistory ? (
                <div className="flex items-center text-sm text-gray-500"><div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mr-2"/>Loading...</div>
              ) : previousResumes.length === 0 ? (
                <p className="text-gray-500">No uploads yet.</p>
              ) : (
                <div className="space-y-3">
                  {previousResumes.map((r) => (
                    <div key={r.id} className="flex items-center justify-between border rounded p-3">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{r.file_name}</div>
                        <div className="text-xs text-gray-500">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const path = extractPathFromFileUrl(r.file_url)
                            const { data } = await supabase.storage.from('resume').createSignedUrl(path, 60 * 10)
                            if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                          }}
                        >
                          View
                        </Button>
                        <Button size="sm" onClick={() => reparseResume(r)} disabled={reparsingId === r.id}>
                          {reparsingId === r.id ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : null}
                          <span className={reparsingId === r.id ? 'ml-2' : ''}>Re-parse</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
