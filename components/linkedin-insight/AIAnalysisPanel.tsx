'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileAnalysis, SalaryEstimate } from '@/lib/linkedin/types'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Loader2, AlertCircle, RefreshCw, CheckCircle2, TrendingUp, Target } from 'lucide-react'

interface AIAnalysisPanelProps {
  analysis: ProfileAnalysis | null
  /**
   * Now a separate analysis, not a field on `analysis`.
   *
   * Salary used to live inside `ProfileAnalysis` as a single min/max/currency
   * object, which meant one model call had to produce both a profile assessment
   * and a compensation band, and a failure in either lost both. They are
   * independent calls now, so the salary tab can be empty while the rest of the
   * panel works — which is the common case when a profile states no location.
   */
  salaryEstimate: SalaryEstimate | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function AIAnalysisPanel({
  analysis,
  salaryEstimate,
  loading,
  error,
  onRetry,
}: AIAnalysisPanelProps) {
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
            {/*
              An absent estimate says so. It used to render `|| '$'` with an
              undefined amount beside it — an empty currency symbol that reads as
              a real answer whose number failed to load. A salary band is the most
              consequential number on this page; it must never be implied.
            */}
            {!salaryEstimate?.ranges?.length ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No compensation estimate for this profile. LinkedIn profiles without a stated
                location or dates do not carry enough signal to estimate a range.
              </p>
            ) : (
              <div className="space-y-6">
                {salaryEstimate.ranges.map((range, i) => {
                  const mid =
                    typeof range.median === 'number'
                      ? range.median
                      : Math.round((range.min + range.max) / 2)
                  const money = (n: number) =>
                    `${range.currency} ${Math.round(n).toLocaleString()}`
                  return (
                    <div key={`${range.currency}-${i}`} className="space-y-3">
                      <h4 className="font-semibold text-slate-900 dark:text-white">
                        Estimated range {i > 0 && <span className="text-slate-400">(secondary)</span>}
                      </h4>
                      <div className="relative pt-2 pb-2">
                        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                          <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
                          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: '70%' }} />
                          <div className="h-full bg-slate-200 dark:bg-slate-700" style={{ width: '15%' }} />
                        </div>
                        <div className="flex justify-between text-sm font-medium mt-3">
                          <span className="text-slate-500">{money(range.min)}</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {money(mid)}
                          </span>
                          <span className="text-slate-500">{money(range.max)}</span>
                        </div>
                      </div>
                      {range.source && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Basis: {range.source}
                        </p>
                      )}
                    </div>
                  )
                })}

                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Confidence:{' '}
                  <Badge variant="outline" className="ml-1">
                    {salaryEstimate.confidence}
                  </Badge>
                  <span className="ml-2">Modelled estimate, not an offer or market survey.</span>
                </p>

                {salaryEstimate.factors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">
                      What drives this estimate
                    </h4>
                    <ul className="space-y-1">
                      {salaryEstimate.factors.map((factor, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400"
                        >
                          <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>{factor}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Career Path Tab */}
          <TabsContent value="career" className="space-y-6 mt-0">
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-900 p-4 rounded-lg">
                <div>
                  <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Current Level</div>
                  <div className="font-medium text-slate-900 dark:text-white">{analysis.careerTrajectory?.currentLevel || 'Not stated'}</div>
                </div>
                <TrendingUp className="w-6 h-6 text-slate-300 dark:text-slate-600" />
                <div className="text-right">
                  <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Next Role ({analysis.careerTrajectory?.timeframe || 'timeframe not stated'})</div>
                  <div className="font-medium text-indigo-600 dark:text-indigo-400">{analysis.careerTrajectory?.nextRole || 'Not stated'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3 text-slate-900 dark:text-white">Skills to Develop</h4>
                <ul className="space-y-2">
                  {analysis.careerTrajectory?.skillsToDevelop?.map((skill: string, i: number) => (
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
