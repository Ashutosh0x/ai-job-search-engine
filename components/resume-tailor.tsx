"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Upload, FileText, Download, ExternalLink, AlertTriangle, Check, FileDown } from "lucide-react"
import type { ResumePlan } from "@/lib/resume/plan"

/**
 * Paste a job description, get a LaTeX resume targeted at it.
 *
 * The panel is built around one honesty constraint: it must never suggest the
 * tool wrote anything. It selects and reorders the user's OWN bullets by how
 * well each evidences a requirement the posting actually states, and shows the
 * matched terms next to every kept bullet plus the reason for every dropped
 * one. A user should be able to defend this document in an interview because
 * every sentence in it is a sentence they already stood behind.
 *
 * The live pane is a real PDF, rendered in the browser from the same plan the
 * LaTeX is rendered from -- not an HTML mock-up of one. What the .tex adds is
 * TeX's line breaking and kerning, which is worth saying rather than implying
 * the two are identical.
 */

interface Decision {
  role: string
  keptBullets: { text: string; matched: string[]; score: number }[]
  droppedBullets: { text: string; reason: string }[]
}

interface BuildResponse {
  latex: string
  plan: ResumePlan
  filename: string
  parsed: {
    contact: { name: string | null; email: string | null; location: string | null }
    skills: string[]
    totalExperienceMonths: number | null
    experience: { title: string | null; organization: string | null; dates: string | null; bulletCount: number }[]
    warnings: string[]
  }
  decisions: Decision[]
  unevidencedRequirements: string[]
  coverage: { covered: number; total: number; weightedCoverage: number } | null
  requirements: { term: string; importance: number; basis: string; mandatory: boolean | null }[]
  unknowns: string[]
  warnings: string[]
  output: { format: string; compiled: boolean; note: string }
}

export default function ResumeTailor() {
  const [resumeText, setResumeText] = useState("")
  const [jobDescription, setJobDescription] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [busy, setBusy] = useState<null | "parsing" | "building">(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BuildResponse | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfPages, setPdfPages] = useState(0)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [maxBullets, setMaxBullets] = useState(4)
  // Only auto-rebuild after the user has built once. Rebuilding before that
  // would fire a request on every keystroke of a resume being pasted in.
  const [live, setLive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * Re-render the preview whenever the plan changes.
   *
   * The PDF is drawn in the browser from `result.plan` -- the same model the
   * LaTeX was rendered from -- so the pane and the download can never show
   * different documents. jspdf is imported lazily so its weight lands only on
   * users who actually build something.
   *
   * The object URL is revoked on replacement; leaking one per keystroke pins
   * a whole PDF in memory each time.
   */
  useEffect(() => {
    if (!result?.plan) return
    let cancelled = false
    let created: string | null = null

    ;(async () => {
      try {
        setPdfError(null)
        const { renderPdf } = await import("@/lib/resume/pdf")
        const out = await renderPdf(result.plan)
        if (cancelled) return
        created = URL.createObjectURL(out.blob)
        setPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return created
        })
        setPdfPages(out.pageCount)
      } catch (e) {
        if (!cancelled) {
          setPdfError(e instanceof Error ? e.message : "The preview could not be rendered.")
        }
      }
    })()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [result])

  // Release the last preview when the component goes away.
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  function downloadPdf() {
    if (!pdfUrl || !result) return
    const a = document.createElement("a")
    a.href = pdfUrl
    a.download = result.filename.replace(/\.tex$/, ".pdf")
    a.click()
  }

  /**
   * Rebuild as the inputs change, once the user has built at least once.
   *
   * Debounced at 600ms: the request re-runs requirement extraction over the
   * whole posting, and firing that per keystroke is both wasteful and enough
   * traffic to trip the endpoint's own rate limit.
   */
  useEffect(() => {
    if (!live || busy !== null) return
    const id = setTimeout(() => { void build() }, 600)
    return () => clearTimeout(id)
    // `build` is intentionally excluded: it is recreated each render, and
    // depending on it would restart the timer continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeText, jobDescription, jobTitle, maxBullets, live])

  async function handleFile(file: File) {
    setError(null)
    setBusy("parsing")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/parse-resume", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Upload failed (${res.status})`)
      const text = json?.data?.fullText ?? ""
      if (!text.trim()) throw new Error("No text could be extracted from that file.")
      setResumeText(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.")
    } finally {
      setBusy(null)
    }
  }

  async function build() {
    setError(null)
    setResult(null)
    setBusy("building")
    try {
      const res = await fetch("/api/resume/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resumeText,
          jobDescription: jobDescription || undefined,
          jobTitle: jobTitle || undefined,
          options: { maxBulletsPerRole: maxBullets },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Build failed (${res.status})`)
      setResult(json as BuildResponse)
      setLive(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  function download() {
    if (!result) return
    const blob = new Blob([result.latex], { type: "application/x-tex" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = result.filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const canBuild = resumeText.trim().length > 40 && busy === null

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
        Tailor your resume to a job description
      </h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Paste a posting and this reorders your own bullets to lead with the ones that
        evidence what it asks for. It never writes new bullets, so everything in the
        output is text you already wrote.
      </p>

      {/* Editor on the left, live PDF on the right. The preview sticks so it
          stays in view while the analysis below is scrolled. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div>

      {/* ---- inputs ---- */}
      <div className="grid gap-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Your resume
          </label>
          <div className="mb-2 flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
            >
              {busy === "parsing"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Upload className="mr-2 h-4 w-4" />}
              Upload PDF or DOCX
            </Button>
          </div>
          <Textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="...or paste your resume text here."
            className="min-h-[140px] sm:min-h-[220px] font-mono text-xs"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Job description
          </label>
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Job title (optional, improves requirement weighting)"
            className="mb-2 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
          <Textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the full job posting here."
            className="min-h-[140px] sm:min-h-[220px] font-mono text-xs"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          Bullets per role
          <select
            value={maxBullets}
            onChange={(e) => setMaxBullets(Number(e.target.value))}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <Button onClick={build} disabled={!canBuild} size="lg" className="w-full sm:w-auto">
          {busy === "building"
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <FileText className="mr-2 h-4 w-4" />}
          Build your resume
        </Button>
        {resumeText.trim().length > 0 && resumeText.trim().length <= 40 && (
          <span className="text-xs text-gray-500">Add more resume text to continue.</span>
        )}
        {!jobDescription.trim() && resumeText.trim().length > 40 && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Without a job description nothing can be prioritised.
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ---- result ---- */}
      {result && (
        <div className="mt-8 space-y-6">
          {/* coverage */}
          {result.coverage && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">
                      {Math.round(result.coverage.weightedCoverage * 100)}%
                    </div>
                    <div className="text-xs text-gray-500">
                      importance-weighted requirement coverage
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {result.coverage.covered} of {result.coverage.total} requirements
                    have supporting evidence in your resume.
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* what the posting wants that the resume cannot show */}
          {result.unevidencedRequirements.length > 0 && (
            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
                  Asked for, but not evidenced anywhere in your resume
                </h3>
                <p className="mb-3 text-xs text-gray-500">
                  These were left out rather than asserted. If you do have the
                  experience, add it to your resume and rebuild.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.unevidencedRequirements.map((r) => (
                    <Badge key={r} variant="outline" className="text-amber-700 dark:text-amber-400">
                      {r}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* per-role decisions */}
          {result.decisions.length > 0 && (
            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                  What was kept, and why
                </h3>
                <div className="space-y-4">
                  {result.decisions.map((d) => (
                    <div key={d.role} className="border-l-2 border-gray-200 pl-3 dark:border-gray-700">
                      <div className="mb-1.5 text-sm font-medium text-gray-900 dark:text-white">
                        {d.role}
                      </div>
                      {d.keptBullets.map((b) => (
                        <div key={b.text} className="mb-1.5 text-xs">
                          <div className="flex items-start gap-1.5">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                            <span className="break-anywhere text-gray-700 dark:text-gray-300">{b.text}</span>
                          </div>
                          {b.matched.length > 0 && (
                            <div className="ml-5 mt-0.5 pl-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                              evidences: {b.matched.join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                      {d.droppedBullets.map((b) => (
                        <div key={b.text} className="mb-1 pl-5 text-[11px] text-gray-400">
                          <span className="break-anywhere line-through">{b.text}</span>
                          <span className="ml-1.5 not-italic">— {b.reason}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* parse warnings and unknowns, never hidden */}
          {(result.parsed.warnings.length > 0 || result.unknowns.length > 0 || result.warnings.length > 0) && (
            <Card>
              <CardContent className="pt-5">
                <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
                  What this could not determine
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">
                  {[...new Set([...result.parsed.warnings, ...result.warnings, ...result.unknowns])].map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* output */}
          <Card>
            <CardContent className="pt-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Button onClick={download} size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Download {result.filename}
                </Button>
                <form
                  action="https://www.overleaf.com/docs"
                  method="post"
                  target="_blank"
                  className="inline"
                >
                  <input type="hidden" name="snip" value={result.latex} />
                  <input type="hidden" name="engine" value="pdflatex" />
                  <Button type="submit" variant="outline" size="sm">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Overleaf
                  </Button>
                </form>
              </div>
              <p className="mb-3 text-xs text-gray-500">{result.output.note}</p>
              <details>
                <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-400">
                  View LaTeX source
                </summary>
                <pre className="mt-2 max-h-64 sm:max-h-80 overflow-auto whitespace-pre rounded bg-gray-50 p-3 text-[10px] sm:text-[11px] leading-relaxed dark:bg-gray-900 dark:text-gray-300">
                  {result.latex}
                </pre>
              </details>
            </CardContent>
          </Card>
        </div>
      )}

        </div>

        {/* ---- live PDF preview ---- */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Live preview
              {pdfPages > 0 && (
                <span className="ml-2 font-normal text-gray-400">
                  {pdfPages} page{pdfPages > 1 ? "s" : ""}
                </span>
              )}
            </span>
            {pdfUrl && (
              <Button type="button" variant="outline" size="sm" onClick={downloadPdf}>
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-900">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                title="Resume preview"
                className="h-[60vh] min-h-[360px] w-full border-0 bg-white lg:h-[760px]"
              />
            ) : (
              <div className="flex h-[40vh] min-h-[220px] flex-col items-center justify-center gap-2 px-6 text-center lg:h-[760px]">
                {busy === "building" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    <span className="text-sm text-gray-500">Building...</span>
                  </>
                ) : (
                  <>
                    <FileText className="h-8 w-8 text-gray-300 dark:text-gray-700" />
                    <span className="text-sm text-gray-500">
                      Your resume will appear here once you build it.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {pdfError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{pdfError}</p>
          )}

          {pdfPages > 1 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              This runs to {pdfPages} pages. Lower the bullets-per-role setting to fit one.
            </p>
          )}

          {pdfUrl && (
            <p className="mt-2 text-xs text-gray-500">
              Rendered in your browser from the same plan as the LaTeX, so both describe
              the same document. Download the .tex for TeX line breaking and kerning.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
