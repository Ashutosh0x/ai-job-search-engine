"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Search, Mail, Users, Building2, ShieldCheck, ExternalLink, Copy, Check,
  AlertTriangle, Loader2, X, Linkedin, Lightbulb,
} from "lucide-react"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Reachability = "direct" | "named" | "pattern" | "ats-only"

interface Recruiter {
  fullName: string
  title: string | null
  department: string | null
  identityStatus: string
  linkedinUrl: string | null
  sourceUrls: string[]
}

interface Entry {
  slug: string
  name: string
  domain: string
  logoUrl: string
  recruiters: Recruiter[]
  recruiterCount: number
  publishedContacts: { address: string; kind: string; evidence: string; onCompanyDomain?: boolean }[]
  publicRecords?: { address: string; kind: string; evidence: string }[]
  emailPattern: { domain: string; patterns: { pattern: string; share: number; sampleSize: number }[] } | null
  mailPosture: { hasMx: boolean; hasSpf: boolean; dmarcPolicy: string | null } | null
  reachability: Reachability
  crawledAt: string | null
}

const REACH_LABEL: Record<Reachability, string> = {
  direct: "Published inbox",
  named: "Named recruiters",
  pattern: "Address pattern",
  "ats-only": "Apply via ATS",
}

const REACH_STYLE: Record<Reachability, string> = {
  direct: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  named: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  pattern: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "ats-only": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
}

export default function RecruitersPage() {
  const router = useRouter()
  const params = useSearchParams()

  // The URL is the search state, same as /explore-jobs: a filtered view has to
  // be linkable, bookmarkable and reachable with the back button.
  const query = params.get("q") ?? ""
  const reach = params.get("reachability") ?? "all"

  const [draft, setDraft] = useState(query)
  const [entries, setEntries] = useState<Entry[]>([])
  const [meta, setMeta] = useState<{ generatedAt: string; total: number; facets: Record<string, number> } | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setDraft(query) }, [query])

  const commit = useCallback(
    (next: Partial<{ q: string; reachability: string }>, push = false) => {
      const sp = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (!v || v === "all") sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      const url = qs ? `/recruiters?${qs}` : "/recruiters"
      if (push) router.push(url, { scroll: false })
      else router.replace(url, { scroll: false })
    },
    [params, router],
  )

  const fetchPage = useCallback(async (p: number, append: boolean) => {
    append ? setLoadingMore(true) : setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (query) sp.set("q", query)
      if (reach !== "all") sp.set("reachability", reach)
      sp.set("page", String(p))

      const res = await fetch(`/api/recruiters?${sp}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const body = await res.json()
      setEntries((prev) => (append ? [...prev, ...body.companies] : body.companies))
      setMeta({ generatedAt: body.generatedAt, total: body.total, facets: body.facets })
      setHasMore(body.hasMore)
      setPage(p)
    } catch (err) {
      // No stand-in directory: if the artefact is missing the page says so.
      setError(err instanceof Error ? err.message : "Could not load the directory")
      if (!append) setEntries([])
    } finally {
      append ? setLoadingMore(false) : setLoading(false)
    }
  }, [query, reach])

  useEffect(() => { fetchPage(1, false) }, [fetchPage])

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/20 to-gray-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-900">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-16">

          <header className="mb-10 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
              <Users className="h-8 w-8 text-purple-600 dark:text-purple-400" />
            </div>
            <h1 className="mb-3 text-4xl font-bold text-gray-900 dark:text-white">Recruiter Directory</h1>
            <p className="mx-auto max-w-2xl text-lg text-gray-600 dark:text-gray-400">
              Who to contact at every employer in the index — published recruiting inboxes,
              publicly identified recruiters, and how each company forms its addresses.
            </p>
            {meta && (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-500">
                {meta.total.toLocaleString("en-US")} companies · refreshed{" "}
                {new Date(meta.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            )}
          </header>

          {/* Search + facets */}
          <div className="mb-8 space-y-4">
            <form
              onSubmit={(e) => { e.preventDefault(); commit({ q: draft }, true) }}
              className="relative mx-auto max-w-2xl"
            >
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search a company, a recruiter, or a job title…"
                className="h-12 pl-12 pr-24"
                aria-label="Search the recruiter directory"
              />
              <Button type="submit" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2">
                Search
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {(["all", "direct", "named", "pattern", "ats-only"] as const).map((key) => {
                const active = reach === key
                const count = key === "all" ? meta?.total : meta?.facets?.[key]
                return (
                  <button
                    key={key}
                    onClick={() => commit({ reachability: key }, true)}
                    className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-purple-600 text-white"
                        : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-gray-700"
                    }`}
                  >
                    {key === "all" ? "All" : REACH_LABEL[key]}
                    {typeof count === "number" && (
                      <span className={active ? "ml-1.5 opacity-80" : "ml-1.5 text-gray-400"}>{count}</span>
                    )}
                  </button>
                )
              })}
              {query && (
                <button
                  onClick={() => { setDraft(""); commit({ q: "" }, true) }}
                  className="inline-flex items-center gap-1 rounded-full bg-purple-100 py-1.5 pl-3 pr-2 text-sm text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                >
                  “{query}” <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {error && (
            <Card className="mx-auto mb-8 max-w-2xl border-destructive/40">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-medium text-destructive">Directory unavailable</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
              ))}
            </div>
          ) : entries.length === 0 && !error ? (
            <div className="rounded-xl border bg-white/60 py-20 text-center dark:bg-gray-800/40">
              <Building2 className="mx-auto mb-4 h-10 w-10 text-gray-400" aria-hidden="true" />
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">No companies match</h2>
              <p className="mx-auto mt-2 max-w-sm text-gray-500 dark:text-gray-400">
                Try a different company name, or clear the filters.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((entry) => <CompanyCard key={entry.slug} entry={entry} />)}
              </div>

              {hasMore && (
                <div className="mt-10 text-center">
                  <Button variant="outline" onClick={() => fetchPage(page + 1, true)} disabled={loadingMore}>
                    {loadingMore ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</> : "Load more companies"}
                  </Button>
                </div>
              )}
            </>
          )}

          <FooterNote />
        </div>
      </div>
    </>
  )
}

function CompanyCard({ entry }: { entry: Entry }) {
  const [copied, setCopied] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard blocked; the address is on screen anyway */ }
  }

  const topPattern = entry.emailPattern?.patterns?.[0] ?? null
  const shownRecruiters = showAll ? entry.recruiters : entry.recruiters.slice(0, 3)

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <CompanyLogo name={entry.name} logoUrl={entry.logoUrl} size={44} />
          <div className="min-w-0 flex-1">
            <Link
              href={`/companies/${entry.slug}`}
              className="block truncate font-semibold text-gray-900 hover:underline dark:text-white"
            >
              {entry.name}
            </Link>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{entry.domain}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="secondary" className={`text-xs ${REACH_STYLE[entry.reachability]}`}>
            {REACH_LABEL[entry.reachability]}
          </Badge>
          {entry.mailPosture?.dmarcPolicy && (
            <Badge variant="outline" className="text-xs" title="Domain-level DMARC policy">
              DMARC {entry.mailPosture.dmarcPolicy}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 pt-0 text-sm">
        {/* Published inboxes — the employer printed these itself. */}
        {entry.publishedContacts.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Published inbox
            </h3>
            <ul className="space-y-1.5">
              {entry.publishedContacts.map((c) => (
                <li key={c.address} className="flex items-center justify-between gap-2">
                  <a href={`mailto:${c.address}`} className="min-w-0 truncate font-medium text-purple-700 hover:underline dark:text-purple-300">
                    {c.address}
                  </a>
                  <div className="flex shrink-0 items-center gap-1">
                    {c.onCompanyDomain === false && (
                      <span className="text-[10px] text-gray-400" title={`Published on ${entry.domain}, hosted on a corporate alternate domain`}>
                        alt
                      </span>
                    )}
                    <button onClick={() => copy(c.address)} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label={`Copy ${c.address}`}>
                      {copied === c.address ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-gray-400" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Named recruiters — no address is ever attached to a person. */}
        {entry.recruiterCount > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> {entry.recruiterCount} public recruiter{entry.recruiterCount === 1 ? "" : "s"}
            </h3>
            <ul className="space-y-2">
              {shownRecruiters.map((r) => (
                <li key={r.fullName} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">{r.fullName}</p>
                    {r.title && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{r.title}</p>}
                  </div>
                  {r.linkedinUrl && (
                    <a
                      href={r.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${r.fullName} on LinkedIn`}
                      className="shrink-0 rounded p-1 text-[#0a66c2] hover:bg-[#0a66c2]/10"
                    >
                      <Linkedin className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {entry.recruiterCount > 3 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="mt-2 text-xs font-medium text-purple-600 hover:underline dark:text-purple-400"
              >
                {showAll ? "Show fewer" : `Show all ${entry.recruiterCount}`}
              </button>
            )}
          </div>
        )}

        {/* Observed pattern — a shape, not a mailbox. */}
        {topPattern && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Address pattern
            </h3>
            <code className="text-xs text-gray-700 dark:text-gray-300">
              {topPattern.pattern}@{entry.emailPattern!.domain}
            </code>
            <p className="mt-1 text-[11px] text-gray-500">
              Seen in {topPattern.sampleSize} public address{topPattern.sampleSize === 1 ? "" : "es"}
              {" · "}{Math.round(topPattern.share * 100)}% of them. A pattern is not a mailbox.
            </p>
          </div>
        )}

        {entry.reachability === "ats-only" && (
          <p className="text-gray-500 dark:text-gray-400">
            No public recruiting address. Applications go through this employer's own board.
          </p>
        )}

        {/* Security and DNS mailboxes the company publishes in RFC-defined
            records. Deliberately last, visually quieter, and labelled as not
            recruiting — writing to security@ about a job helps nobody. */}
        {(entry.publicRecords?.length ?? 0) > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {entry.publicRecords!.length} other published address{entry.publicRecords!.length === 1 ? "" : "es"}
              </span>
            </summary>
            <ul className="mt-2 space-y-1.5">
              {entry.publicRecords!.map((r) => (
                <li key={r.address} className="text-xs">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{r.address}</span>
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {r.kind}
                  </span>
                  <p className="mt-0.5 text-[11px] text-gray-400">{r.evidence}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-gray-400">
              Security and DNS mailboxes, not recruiting contacts. Listed because they prove the
              domain receives mail and are sometimes the only published route to a company.
            </p>
          </details>
        )}

        <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-gray-400">
          <Link href={`/companies/${entry.slug}`} className="inline-flex items-center gap-1 hover:text-purple-600">
            Open roles <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
          {entry.crawledAt && (
            <span title={new Date(entry.crawledAt).toLocaleString("en-GB")}>
              checked {new Date(entry.crawledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FooterNote() {
  return (
    <div className="mx-auto mt-14 max-w-3xl rounded-xl border bg-white/70 p-5 text-sm text-gray-600 dark:bg-gray-800/40 dark:text-gray-400">
      <h2 className="mb-2 flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Where this comes from
      </h2>
      <p>
        Inboxes here were published by the employers themselves on their own careers and contact
        pages. Recruiters are people who are publicly identified in that role, each carrying the
        source that names them — and no address is attached to any individual. Address patterns are
        inferred from commit authors in a company's verified GitHub organisation: they describe how
        a company forms addresses, and never assert that a particular mailbox exists.
      </p>
      <p className="mt-2">
        Nothing on this page was generated. The crawl refreshes daily and respects each site's
        robots.txt.
      </p>
    </div>
  )
}
