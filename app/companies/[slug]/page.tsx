import Link from "next/link"
import { notFound } from "next/navigation"
import { getCompany, jobPath } from "@/lib/job-index"
import { formatValuation } from "@/lib/companies/registry"
import { hasBankingIntelligence } from "@/lib/companies/banking-intelligence"
import { getRecruitingContacts } from "@/lib/companies/recruiting-contacts"
import RecruitingIntelligence from "@/components/recruiting-intelligence"
import { CompanyContactFinder } from "@/components/contacts/company-contact-finder"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, MapPin, Clock, ArrowLeft, Shield } from "lucide-react"
import type { Metadata } from "next"
import { absoluteUrl } from "@/lib/site"
import { applyHref, APPLY_LINK_ATTRS } from "@/lib/analytics/links"
import { TrackView } from "@/components/analytics/track-view"

/**
 * Re-rendered hourly rather than on every request.
 *
 * Was `force-dynamic`, which opts the page out of the CDN entirely -- every
 * visitor re-scanned a 113,416-row index to rebuild the same page. The data
 * behind it only changes when the crawler publishes a new index.
 */
export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const result = await getCompany(params.slug)
  if (!result) return { title: "Company not found" }

  const { company, jobs } = result
  const title = `${company.name} jobs — ${jobs.length.toLocaleString("en-US")} open roles`
  const description = [
    `${jobs.length.toLocaleString("en-US")} open roles at ${company.name}`,
    company.industry,
    company.hqLocation,
  ]
    .filter(Boolean)
    .join(" · ") +
    ". Read from the company's own applicant tracking system; every role links to its own application page."

  return {
    title,
    description,
    alternates: { canonical: `/companies/${company.slug}` },
    openGraph: { type: "website", title, description, url: absoluteUrl(`/companies/${company.slug}`) },
    twitter: { card: "summary", title, description },
    // A company with nothing open is a thin page.
    robots: jobs.length > 0 ? undefined : { index: false, follow: true },
  }
}

function timeAgo(iso?: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return null
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return "Just now"
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

export default async function CompanyPage({ params }: { params: { slug: string } }) {
  const result = await getCompany(params.slug)
  if (!result) notFound()

  const { company, jobs } = result
  const remote = jobs.filter((j) => j.isRemote).length
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const recent = jobs.filter(
    (j) => j.postedAt && new Date(j.postedAt).getTime() >= thirtyDaysAgo
  ).length

  const byDept = new Map<string, number>()
  const byLoc = new Map<string, number>()
  for (const j of jobs) {
    if (j.department) byDept.set(j.department, (byDept.get(j.department) ?? 0) + 1)
    if (j.location) byLoc.set(j.location, (byLoc.get(j.location) ?? 0) + 1)
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

  const valuation = formatValuation(company.valuationUsd)
  const recruiting = await getRecruitingContacts(company.slug, company.boards)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TrackView event={{ type: "company_view", companySlug: company.slug }} />

      <Navigation />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <Link
          href="/jobs"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to jobs
        </Link>

        {/* Header */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={72} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {company.name}
                    </h1>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {[company.industry, company.hqLocation].filter(Boolean).join(" · ")}
                      {company.foundedYear ? ` · Founded ${company.foundedYear}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {hasBankingIntelligence(params.slug) && (
                      <Button asChild variant="default" size="sm" className="bg-blue-600 hover:bg-blue-700">
                        <Link href={`/companies/${params.slug}/intelligence`}>
                          <Shield className="mr-1.5 h-3 w-3" /> Intelligence
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer">
                        Website <ExternalLink className="ml-1.5 h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {company.ticker && <Badge variant="secondary">{company.ticker}</Badge>}
                  <Badge variant="outline" className="capitalize">
                    {company.valuationKind === "public" ? "Publicly traded" : company.valuationKind}
                  </Badge>
                  {company.boards.map((b) => (
                    <Badge key={b.provider} variant="outline" className="capitalize text-slate-400">
                      via {b.provider}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 dark:border-slate-800 md:grid-cols-4">
              <Metric label="Open roles" value={jobs.length.toLocaleString("en-US")} />
              <Metric label="Remote roles" value={remote.toLocaleString("en-US")} />
              <Metric label="Posted last 30 days" value={recent.toLocaleString("en-US")} />
              <Metric
                label={company.valuationKind === "public" ? "Market cap" : "Valuation"}
                value={valuation}
              />
            </div>

            {/*
              Provenance is shown, always. A private company's last round can be
              years old, and a market cap is only as fresh as its quote --
              presenting either as a bare current number would be the kind of
              confident inaccuracy this page exists to avoid.
            */}
            {(company.valuationSource || company.valuationAsOf) && (
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                {company.valuationSource}
                {company.valuationAsOf && (
                  <> · as of {new Date(company.valuationAsOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</>
                )}
              </p>
            )}
            {!company.valuationUsd && (
              <p className="mt-3 text-xs text-slate-400">
                No public valuation figure available for this company.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recruiting Intelligence */}
        <div className="mb-6">
          <RecruitingIntelligence
            companyName={company.name}
            applicationChannels={recruiting.applicationChannels}
            recruiters={recruiting.recruiters}
            publishedContacts={recruiting.publishedContacts}
            emailPatterns={recruiting.emailPatterns}
            emailDomain={recruiting.emailPattern?.domain ?? null}
            talentOrg={recruiting.talentOrg}
            mailPosture={recruiting.mailPosture}
            lastVerifiedAt={recruiting.metadata?.generatedAt ?? recruiting.checkedAt ?? null}
          />
        </div>

        {/* Find Contacts — pattern-based discovery, kept separate from the
            evidence-backed panel above so the two are never confused. */}
        <div className="mb-6" id="find-contacts">
          <CompanyContactFinder
            companyName={company.name}
            domain={recruiting.emailPattern?.domain ?? company.domain ?? null}
            emailPatterns={recruiting.emailPatterns}
            publishedContacts={recruiting.publishedContacts}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* Roles */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Open roles <span className="text-slate-400">({jobs.length})</span>
            </h2>

            {jobs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-slate-500">
                  No open roles on this company's board right now.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {jobs.slice(0, 100).map((job) => (
                  <Card key={job.externalId} className="transition-shadow hover:shadow-sm">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <h3 className="font-medium text-slate-900 dark:text-slate-100">
                          {/* Links to the posting's own page. The only link on
                              this row used to leave the site entirely. */}
                          <Link href={jobPath(job)} className="line-clamp-2 hover:underline">
                            {job.title}
                          </Link>
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          {job.location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {job.location}
                            </span>
                          )}
                          {timeAgo(job.postedAt) && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {timeAgo(job.postedAt)}
                            </span>
                          )}
                          {job.department && <span>{job.department}</span>}
                          {job.isRemote && <Badge variant="secondary" className="text-xs">Remote</Badge>}
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <a href={applyHref(job.externalId)} {...APPLY_LINK_ATTRS}>
                          Apply <ExternalLink className="ml-1.5 h-3 w-3" />
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {jobs.length > 100 && (
                  <p className="pt-2 text-center text-xs text-slate-400">
                    Showing the first 100 of {jobs.length} roles.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Breakdown */}
          <aside className="space-y-4">
            {top(byDept, 10).length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Hiring by team
                  </h3>
                  <ul className="space-y-1.5">
                    {top(byDept, 10).map(([name, count]) => (
                      <li key={name} className="flex justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-600 dark:text-slate-400">{name}</span>
                        <span className="tabular-nums text-slate-400">{count}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {top(byLoc, 10).length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Hiring by location
                  </h3>
                  <ul className="space-y-1.5">
                    {top(byLoc, 10).map(([name, count]) => (
                      <li key={name} className="flex justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-600 dark:text-slate-400">{name}</span>
                        <span className="tabular-nums text-slate-400">{count}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
        {value ?? "Not disclosed"}
      </p>
    </div>
  )
}
