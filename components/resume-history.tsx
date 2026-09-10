"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  History, 
  FileText, 
  TrendingUp, 
  Download, 
  Eye,
  GitBranch,
  Calendar,
  BarChart3
} from "lucide-react"
import { useToast } from "@/components/toast-provider"

interface ResumeVersion {
  id: string
  version: number
  fileName: string
  createdAt: string
  atsScore: number
  changes: string[]
  status: 'draft' | 'published' | 'archived'
}

export default function ResumeHistory() {
  const [versions, setVersions] = useState<ResumeVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<ResumeVersion | null>(null)
  const [loading, setLoading] = useState(true)
  const { addToast } = useToast()

  useEffect(() => {
    fetchResumeHistory()
  }, [])

  const fetchResumeHistory = async () => {
    try {
      const response = await fetch("/api/resume-history")
      if (!response.ok) throw new Error("Failed to fetch resume history")
      
      const data = await response.json()
      setVersions(data.versions)
      if (data.versions.length > 0) {
        setSelectedVersion(data.versions[0])
      }
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to load resume history",
        type: "error"
      })
    } finally {
      setLoading(false)
    }
  }

  const restoreVersion = async (versionId: string) => {
    try {
      const response = await fetch(`/api/resume-history/${versionId}/restore`, {
        method: "POST"
      })
      
      if (!response.ok) throw new Error("Failed to restore version")
      
      addToast({
        title: "Version Restored",
        description: "Resume version has been restored successfully",
        type: "success"
      })
      
      fetchResumeHistory()
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to restore version",
        type: "error"
      })
    }
  }

  const downloadVersion = async (versionId: string) => {
    try {
      const response = await fetch(`/api/resume-history/${versionId}/download`)
      if (!response.ok) throw new Error("Failed to download version")
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `resume-v${versions.find(v => v.id === versionId)?.version}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      addToast({
        title: "Error",
        description: "Failed to download version",
        type: "error"
      })
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600 bg-green-100 dark:bg-green-900/30"
    if (score >= 60) return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30"
    return "text-red-600 bg-red-100 dark:bg-red-900/30"
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return "text-green-600 bg-green-100 dark:bg-green-900/30"
      case 'draft': return "text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30"
      case 'archived': return "text-gray-600 bg-gray-100 dark:bg-gray-900/30"
      default: return "text-gray-600 bg-gray-100 dark:bg-gray-900/30"
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-purple-600" />
            Resume History & Versions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="timeline" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="comparison">Comparison</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="space-y-4">
              <div className="space-y-4">
                {versions.map((version, index) => (
                  <div
                    key={version.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-all ${
                      selectedVersion?.id === version.id
                        ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                        : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                    }`}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                          <FileText className="w-4 h-4 text-purple-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{version.fileName}</h3>
                          <p className="text-sm text-gray-500">
                            Version {version.version} • {new Date(version.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getScoreColor(version.atsScore)}>
                          {version.atsScore}% ATS Score
                        </Badge>
                        <Badge className={getStatusColor(version.status)}>
                          {version.status}
                        </Badge>
                      </div>
                    </div>
                    
                    {selectedVersion?.id === version.id && (
                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex gap-2 mb-3">
                          <Button
                            size="sm"
                            onClick={() => restoreVersion(version.id)}
                            variant="outline"
                          >
                            <GitBranch className="w-4 h-4 mr-2" />
                            Restore Version
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => downloadVersion(version.id)}
                            variant="outline"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                        </div>
                        
                        {version.changes.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-2">Changes in this version:</h4>
                            <ul className="space-y-1">
                              {version.changes.map((change, idx) => (
                                <li key={idx} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                                  <div className="w-1 h-1 bg-purple-400 rounded-full"></div>
                                  {change}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="comparison" className="space-y-4">
              <div className="text-center py-8 text-gray-500">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>Compare different resume versions to see improvements over time.</p>
              </div>
            </TabsContent>

            <TabsContent value="analytics" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Total Versions</p>
                        <p className="text-2xl font-bold">{versions.length}</p>
                      </div>
                      <History className="w-8 h-8 text-purple-600" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Best Score</p>
                        <p className="text-2xl font-bold">
                          {Math.max(...versions.map(v => v.atsScore))}%
                        </p>
                      </div>
                      <TrendingUp className="w-8 h-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Average Score</p>
                        <p className="text-2xl font-bold">
                          {Math.round(versions.reduce((acc, v) => acc + v.atsScore, 0) / versions.length)}%
                        </p>
                      </div>
                      <BarChart3 className="w-8 h-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
