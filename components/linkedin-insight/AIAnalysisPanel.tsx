'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileAnalysis } from '@/lib/linkedin/types'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, RefreshCw, CheckCircle2, TrendingUp, Target } from 'lucide-react'

interface AIAnalysisPanelProps {
  analysis: ProfileAnalysis | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function AIAnalysisPanel({ analysis, loading, error, onRetry }: AIAnalysisPanelProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Analyzing profile with AI...</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">This may take a few seconds</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-900">
        <CardContent className="p-8 flex flex-col items-center justify-center space-y-4 text-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-400">Analysis Failed</h3>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
          <Button onClick={onRetry} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry Analysis
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!analysis) return null

  const score = analysis.overallScore || 0

  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
        <CardTitle className="text-xl flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-500" />
          AI Profile Insights
        </CardTitle>
      </CardHeader>
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b border-slate-100 dark:border-slate-800 bg-transparent p-0">
          <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent px-4 py-3 text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="salary" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent px-4 py-3 text-xs sm:text-sm">Salary</TabsTrigger>
          <TabsTrigger value="career" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent px-4 py-3 text-xs sm:text-sm">Career</TabsTrigger>
          <TabsTrigger value="recruiter" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent px-4 py-3 text-xs sm:text-sm">Recruiter</TabsTrigger>
        </TabsList>

        <CardContent className="p-6">
          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-0">
            <div className="flex items-center gap-6">
              <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="6" />
                  <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor"
                    className={score >= 70 ? 'text-emerald-500' : score >= 40 ? 'text-amber-500' : 'text-red-500'}
                    strokeWidth="6" strokeDasharray={`${score * 2.64} 264`} strokeLinecap="round" />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-bold text-slate-900 dark:text-white">{score}</span>
                  <span className="text-[10px] text-slate-500 uppercase">Score</span>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white mb-2">Summary</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">{analysis.jobFitSummary}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Strengths
                </h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.strengths?.map((s, i) => (
                    <Badge key={i} variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
                  <Target className="w-4 h-4 text-amber-500" />
                  Areas to Improve
                </h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.improvements?.map((s, i) => (
                    <Badge key={i} variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Salary Tab */}
          <TabsContent value="salary" className="space-y-6 mt-0">
            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900 dark:text-white">Estimated Salary Range</h4>
              <div className="relative pt-2 pb-2">
                <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
                  <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: '70%' }} />
                  <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
                </div>
                <div className="flex justify-between text-sm font-medium mt-3">
                  <span className="text-slate-500">{analysis.salaryEstimate?.currency || '$'}{analysis.salaryEstimate?.min?.toLocaleString()}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {analysis.salaryEstimate?.currency || '$'}{Math.round(((analysis.salaryEstimate?.min || 0) + (analysis.salaryEstimate?.max || 0)) / 2).toLocaleString()}
                  </span>
                  <span className="text-slate-500">{analysis.salaryEstimate?.currency || '$'}{analysis.salaryEstimate?.max?.toLocaleString()}</span>
                </div>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Confidence: <Badge variant="outline" className="ml-1">{analysis.salaryEstimate?.confidence || 'Medium'}</Badge>
              </p>
            </div>
          </TabsContent>

          {/* Career Path Tab */}
          <TabsContent value="career" className="space-y-6 mt-0">
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900 p-4 rounded-lg">
                <div>
                  <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Current Level</div>
                  <div className="font-medium text-slate-900 dark:text-white">{analysis.careerTrajectory?.currentLevel || 'Professional'}</div>
                </div>
                <TrendingUp className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                <div className="text-right">
                  <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Next Role ({analysis.careerTrajectory?.timeframe || '1-2 yrs'})</div>
                  <div className="font-medium text-indigo-600 dark:text-indigo-400">{analysis.careerTrajectory?.nextRole || 'Senior Role'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3 text-slate-900 dark:text-white">Skills to Develop</h4>
                <ul className="space-y-2">
                  {analysis.careerTrajectory?.skills_to_develop?.map((skill, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                      <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span>{skill}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </TabsContent>

          {/* Recruiter View Tab */}
          <TabsContent value="recruiter" className="space-y-6 mt-0">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">Hiring Likelihood</span>
                    <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{analysis.recruiterInsights?.hiringLikelihood}</span>
                  </div>
                  <Progress value={analysis.recruiterInsights?.hiringLikelihood === 'High' ? 85 : analysis.recruiterInsights?.hiringLikelihood === 'Medium' ? 60 : 35} className="h-2" />
                </div>
              </div>

              {analysis.recruiterInsights?.standoutFactors && analysis.recruiterInsights.standoutFactors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✨ Standout Factors</h4>
                  <ul className="space-y-1">
                    {analysis.recruiterInsights.standoutFactors.map((f, i) => (
                      <li key={i} className="text-sm text-slate-600 dark:text-slate-400">• {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Ideal Roles</h4>
                  <ul className="space-y-1">
                    {analysis.recruiterInsights?.idealRoles?.map((role, i) => (
                      <li key={i} className="text-sm text-slate-600 dark:text-slate-400">• {role}</li>
                    ))}
                  </ul>
                </div>
                {analysis.recruiterInsights?.redFlags && analysis.recruiterInsights.redFlags.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">⚠️ Potential Flags</h4>
                    <ul className="space-y-1">
                      {analysis.recruiterInsights.redFlags.map((flag, i) => (
                        <li key={i} className="text-sm text-red-600/80 dark:text-red-400/80">• {flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {analysis.industryBenchmark && (
                <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                  <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Industry Benchmark</h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{analysis.industryBenchmark}</p>
                </div>
              )}
            </div>
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
