"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, ZoomIn, ZoomOut, Eye } from "lucide-react"

interface DocumentPreviewProps {
  file: File | null
  onOptimize?: () => void
  isOptimizing?: boolean
  parsedText?: string
}

export default function DocumentPreview({ file, onOptimize, isOptimizing = false, parsedText }: DocumentPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)

      return () => URL.revokeObjectURL(url)
    }
  }, [file])

  if (!file) {
    return (
      <Card className="card-glow h-96 flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p>Upload a resume to see preview</p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="card-glow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-gray-900 dark:text-white flex items-center">
            <Eye className="w-5 h-5 mr-2 text-purple-400" />
            Document Preview
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="sm" onClick={() => setZoom(Math.max(50, zoom - 25))} disabled={zoom <= 50}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[60px] text-center">{zoom}%</span>
            <Button variant="ghost" size="sm" onClick={() => setZoom(Math.min(200, zoom + 25))} disabled={zoom >= 200}>
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {file.name} • {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
          <Button onClick={onOptimize} disabled={isOptimizing} className="bg-purple-600 hover:bg-purple-700 text-white">
            {isOptimizing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Analyzing...
              </>
            ) : (
              "Optimize Resume"
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="relative">
            <div
              className="bg-white dark:bg-gray-900 p-8 overflow-auto max-h-96"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left" }}
            >
              <div className="bg-white shadow-lg max-w-2xl mx-auto text-black text-sm leading-relaxed h-full">
                {file && file.type === "application/pdf" && previewUrl ? (
                  <iframe src={previewUrl} className="w-full h-[500px]" title="Resume Preview"></iframe>
                ) : parsedText ? (
                  <pre className="whitespace-pre-wrap font-sans text-xs p-8">{parsedText}</pre>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-500">
                    <div className="text-center">
                      <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>Document content will appear here after parsing</p>
                      {file && (file.type === "application/msword" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") && (
                        <p className="text-sm mt-2">Word documents are displayed as extracted text.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
