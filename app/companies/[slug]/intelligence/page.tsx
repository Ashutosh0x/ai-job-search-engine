import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getCompany } from "@/lib/job-index"
import { getBankingIntelligence } from "@/lib/companies/banking-intelligence"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ExternalLink,
  MapPin,
  ArrowLeft,
  Building2,
  Users,
  Globe,
  Mail,
  Code,
  TrendingUp,
  Shield,
  Landmark,
  Briefcase,
  Server,
  ChevronRight,
} from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Company Intelligence page.
 *
 * This is the key differentiator of the AI Job Search Engine. While other
 * boards show a posting, this page turns the company behind the posting
 * into an intelligence dossier: leadership, ATS platform and endpoint,
 * developer APIs, email patterns, office locations, tech focus, and
 * partnerships — all from publicly accessible sources.
 *
 * Only companies with banking intelligence data get this page; others
 * redirect to the standard company profile.
 */
export default async function CompanyIntelligencePage({
  params,
}: {
  params: { slug: string }
}) {
  const intel = getBankingIntelligence(params.slug)
  if (!intel) redirect(`/companies/${params.slug}`)

  const companyResult = await getCompany(params.slug)
  const company = companyResult?.company
  const jobs = companyResult?.jobs ?? []

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />

      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-1.5 text-sm text-slate-500">
          <Link href="/companies" className="hover:text-slate-900 dark:hover:text-slate-100">
            Companies
          </Link>
          <ChevronRight className="h-3 w-3" />
          <Link
            href={`/companies/${params.slug}`}
            className="hover:text-slate-900 dark:hover:text-slate-100"
          >
            {intel.legalName}
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-slate-900 dark:text-slate-100">Intelligence</span>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* HEADER CARD                                                        */}
        {/* ----------------------------------------------------------------- */}
        <Card className="mb-6 border-blue-200 dark:border-blue-900">
          <CardContent className="p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {company && (
                <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={72} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                      {intel.legalName}
                    </h1>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {intel.globalHq}
                      {intel.ticker && ` · ${intel.ticker}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="default" className="bg-blue-600">
                        <Shield className="mr-1 h-3 w-3" /> Company Intelligence
                      </Badge>
                      {intel.ticker && <Badge variant="secondary">{intel.ticker}</Badge>}
                      <Badge variant="outline">{intel.atsPlatform}</Badge>
                      {intel.globalReach && (
                        <Badge variant="outline">
                          <Globe className="mr-1 h-3 w-3" /> {intel.globalReach}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/companies/${params.slug}`}>
                        <ArrowLeft className="mr-1.5 h-3 w-3" /> Jobs ({jobs.length})
                      </Link>
                    </Button>
                    {company && (
                      <Button asChild variant="outline" size="sm">
                        <a
                          href={`https://${company.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Website <ExternalLink className="ml-1.5 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 dark:border-slate-800 sm:grid-cols-3 md:grid-cols-5">
              <Metric label="Employees" value={intel.employees} />
              <Metric label="Assets" value={intel.assets ?? null} />
              <Metric label="Market Cap" value={intel.marketCap ?? null} />
              <Metric label="Revenue" value={intel.revenue ?? null} />
              <Metric label="Tech Budget" value={intel.techBudget ?? null} />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* ---- Main column ---- */}
          <div className="space-y-6">
            {/* LEADERSHIP */}
            {intel.leadership.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <SectionHeader icon={Users} label="Leadership" />
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {intel.leadership.map((l) => (
                      <div
                        key={l.name}
                        className="flex items-center gap-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {l.name
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {l.name}
                          </p>
                          <p className="truncate text-xs text-slate-500">{l.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ATS & HIRING INTELLIGENCE */}
            <Card>
              <CardContent className="p-5">
                <SectionHeader icon={Briefcase} label="Careers & ATS Intelligence" />
                <div className="mt-3 space-y-3">
                  <InfoRow label="ATS Platform" value={intel.atsPlatform} />
                  {intel.atsEndpoint && (
                    <InfoRow label="Direct ATS Endpoint">
                      <a
                        href={intel.atsEndpoint}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {intel.atsEndpoint} <ExternalLink className="ml-1 inline h-3 w-3" />
                      </a>
                    </InfoRow>
                  )}
                  {intel.workdayConfig && (
                    <InfoRow label="Workday Config">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                        tenant: {intel.workdayConfig.tenant} · shard: {intel.workdayConfig.shard} ·
                        site: {intel.workdayConfig.site}
                      </code>
                    </InfoRow>
                  )}
                  {intel.hiringVolume && (
                    <InfoRow label="Hiring Volume" value={intel.hiringVolume} />
                  )}
                  {intel.hotRoles && intel.hotRoles.length > 0 && (
                    <InfoRow label="In-Demand Roles">
                      <div className="flex flex-wrap gap-1.5">
                        {intel.hotRoles.map((r) => (
                          <Badge key={r} variant="secondary" className="text-xs">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </InfoRow>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* DEVELOPER APIs */}
            {(intel.developerPortals.length > 0 || (intel.keyApis && intel.keyApis.length > 0)) && (
              <Card>
                <CardContent className="p-5">
                  <SectionHeader icon={Code} label="Developer APIs & Portals" />
                  {intel.developerPortals.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {intel.developerPortals.map((p) => (
                        <a
                          key={p.url}
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group rounded-lg border border-slate-100 p-3 transition-colors hover:border-blue-200 hover:bg-blue-50/50 dark:border-slate-800 dark:hover:border-blue-900 dark:hover:bg-blue-950/20"
                        >
                          <p className="text-sm font-medium text-slate-900 group-hover:text-blue-600 dark:text-slate-100">
                            {p.name} <ExternalLink className="ml-1 inline h-3 w-3" />
                          </p>
                          {p.description && (
                            <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>
                          )}
                        </a>
                      ))}
                    </div>
                  )}

                  {intel.keyApis && intel.keyApis.length > 0 && (
                    <>
                      <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Key API Suites
                      </h4>
                      <div className="space-y-1.5">
                        {intel.keyApis.map((api) => (
                          <div key={api.name} className="flex gap-2 text-sm">
                            <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <div>
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {api.name}
                              </span>
                              <span className="text-slate-500"> — {api.description}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* EMAIL PATTERNS */}
            {intel.emailPatterns.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <SectionHeader icon={Mail} label="Email Patterns" />
                  <p className="mt-1 text-xs text-slate-400">
                    Domain: <strong>@{intel.emailDomain}</strong> · Patterns from public sources
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800">
                          <th className="pb-2 pr-4">Pattern</th>
                          <th className="pb-2 pr-4 text-right">Share</th>
                          <th className="pb-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intel.emailPatterns.map((ep) => (
                          <tr
                            key={ep.pattern}
                            className="border-b border-slate-50 dark:border-slate-900"
                          >
                            <td className="py-2 pr-4">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                                {ep.pattern}
                              </code>
                            </td>
                            <td className="py-2 pr-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    className="h-full rounded-full bg-blue-500"
                                    style={{ width: `${ep.share}%` }}
                                  />
                                </div>
                                <span className="tabular-nums text-slate-600 dark:text-slate-400">
                                  {ep.share}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2 text-xs text-slate-500">{ep.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* OFFICE LOCATIONS */}
            <Card>
              <CardContent className="p-5">
                <SectionHeader icon={MapPin} label="Office Locations" />
                <div className="mt-3 space-y-4">
                  <OfficeSection title="India" offices={intel.officesIndia} />
                  <OfficeSection title="United Kingdom" offices={intel.officesUk} />
                  <OfficeSection title="Germany" offices={intel.officesGermany} />
                  {intel.officesOther && intel.officesOther.length > 0 && (
                    <OfficeSection title="Other" offices={intel.officesOther} />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ---- Sidebar ---- */}
          <aside className="space-y-4">
            {/* Tech Focus */}
            {intel.techFocus.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <SectionHeader icon={TrendingUp} label="2026 Tech Focus" />
                  <ul className="mt-3 space-y-1.5">
                    {intel.techFocus.map((t) => (
                      <li
                        key={t}
                        className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Partnerships */}
            {(intel.cloudPartners || intel.fintechPartners || intel.keyPartnerships) && (
              <Card>
                <CardContent className="p-4">
                  <SectionHeader icon={Landmark} label="Partnerships" />
                  {intel.cloudPartners && intel.cloudPartners.length > 0 && (
                    <PartnerSection title="Cloud" partners={intel.cloudPartners} />
                  )}
                  {intel.fintechPartners && intel.fintechPartners.length > 0 && (
                    <PartnerSection title="Fintech" partners={intel.fintechPartners} />
                  )}
                  {intel.keyPartnerships && intel.keyPartnerships.length > 0 && (
                    <PartnerSection title="Key" partners={intel.keyPartnerships} />
                  )}
                </CardContent>
              </Card>
            )}

            {/* Quick stats from live data */}
            {jobs.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <SectionHeader icon={Building2} label="Live Job Stats" />
                  <div className="mt-3 space-y-2">
                    <StatRow label="Open roles" value={jobs.length.toString()} />
                    <StatRow
                      label="Remote roles"
                      value={jobs.filter((j) => j.isRemote).length.toString()}
                    />
                    <StatRow
                      label="Departments"
                      value={new Set(jobs.map((j) => j.department).filter(Boolean)).size.toString()}
                    />
                    <StatRow
                      label="Locations"
                      value={new Set(jobs.map((j) => j.location).filter(Boolean)).size.toString()}
                    />
                  </div>
                  <Button asChild variant="default" size="sm" className="mt-4 w-full">
                    <Link href={`/companies/${params.slug}`}>
                      View all {jobs.length} open roles
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Data provenance */}
            <Card className="border-amber-200 dark:border-amber-900">
              <CardContent className="p-4">
                <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  <strong>Data sources:</strong> Corporate websites, SEC/RBI/FCA regulatory
                  filings, developer documentation portals, careers pages, and press releases.
                  Leadership and office data are from public profiles. Email patterns are
                  derived from publicly observable formats.
                </p>
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Headcounts, addresses, and leadership positions may have changed since
                  compilation. Always verify critical information before use.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------- Helpers -------------------------------- */

function SectionHeader({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-4 w-4" /> {label}
    </h3>
  )
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
        {value ?? "—"}
      </p>
    </div>
  )
}

function InfoRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-slate-50 pb-2 dark:border-slate-900 sm:flex-row sm:items-start sm:gap-3">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:w-36">
        {label}
      </span>
      {children ?? <span className="text-sm text-slate-900 dark:text-slate-100">{value}</span>}
    </div>
  )
}

function OfficeSection({
  title,
  offices,
}: {
  title: string
  offices: { city: string; country: string; address?: string; notes?: string; estimatedHeadcount?: string }[]
}) {
  if (!offices.length) return null
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {offices.map((o) => (
          <div
            key={`${o.city}-${o.country}`}
            className="rounded-lg border border-slate-100 p-2.5 dark:border-slate-800"
          >
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              <MapPin className="mr-1 inline h-3 w-3 text-slate-400" /> {o.city}
            </p>
            {o.address && <p className="mt-0.5 text-xs text-slate-500">{o.address}</p>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {o.estimatedHeadcount && (
                <Badge variant="secondary" className="text-[10px]">
                  {o.estimatedHeadcount}
                </Badge>
              )}
              {o.notes && (
                <span className="text-[10px] text-slate-400">{o.notes}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PartnerSection({ title, partners }: { title: string; partners: string[] }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <div className="flex flex-wrap gap-1">
        {partners.map((p) => (
          <Badge key={p} variant="outline" className="text-xs">
            {p}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  )
}
