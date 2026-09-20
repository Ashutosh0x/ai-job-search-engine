import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getJobById,
  jobIdFromSegments,
  jobPath,
  similarJobs,
  type IndexedJob,
} from "@/lib/job-index"
import { absoluteUrl, SITE_NAME } from "@/lib/site"
import { applyHref, APPLY_LINK_ATTRS } from "@/lib/analytics/links"
import { TrackView } from "@/components/analytics/track-view"
import { jobPostingSchema } from "@/lib/seo/job-posting"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { ShareJobButton } from "@/components/share-job-button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  Building2,
  Clock,
  ExternalLink,
  Globe,
  Laptop,
  MapPin,
  MessagesSquare,
  Wallet,
  BriefcaseBusiness,
} from "lucide-react"

/**
 * Job detail page.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now a posting had no page of its own. Every surface -- Explore, search,
 * the company page -- linked straight out to the employer's ATS, so the site
 * held 113,416 jobs and offered Google exactly zero indexable job URLs. For a
 * job search engine that is the whole SEO surface missing: Google for Jobs
 * reads JobPosting structured data from a page per posting, and there were no
 * pages to read it from.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not pretend to hold the full posting. The served index stores at most
 * 200 characters of description (a deployment budget, see
 * scripts/build-deploy-index.mjs) and only 35.2% of rows carry even 50. So the
 * description is presented as the excerpt it is, and the employer's own page is
 * the prominent action rather than a footnote -- the honest shape for a page
 * whose value is discovery, not republication.
 */

/**
 * Rendered on demand and then cached for an hour.
 *
 * There are 113,416 postings, so there is deliberately no generateStaticParams:
 * pre-rendering the corpus would make every build proportional to the index.
 * A page is built the first time it is requested and served from the cache
 * after that, which is the right trade for a long tail where most URLs are
 * never visited and the ones that are, are visited repeatedly.
 *
 * `force-static` would be wrong here -- it is for routes whose params are
 * fully enumerated at build time, and on an unenumerated dynamic segment it
 * turns a normal miss into a build-time error.
 */
export const revalidate = 3600

type Params = { params: { id: string[] } }

async function load(params: Params["params"]) {
  const id = jobIdFromSegments(params.id)
  if (!id) return null
  return getJobById(id)
}

/* --------------------------------- display -------------------------------- */

function postedAgo(iso?: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days < 0) return null
  if (days === 0) return "Posted today"
  if (days === 1) return "Posted yesterday"
  if (days < 30) return `Posted ${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? "Posted last month" : `Posted ${months} months ago`
}

/**
 * Salary, only when it can be stated without inventing anything.
 *
 * 3.6% of the corpus carries a figure. A range renders as a range, a single
 * bound says which bound it is -- "From £70,000" is true, rendering it as
 * "£70,000" is not.
 */
function salaryLabel(job: IndexedJob): string | null {
  const { salaryMin, salaryMax, salaryCurrency } = job
  if (!salaryMin && !salaryMax) return null

  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: salaryCurrency ? "currency" : "decimal",
        currency: salaryCurrency ?? undefined,
        maximumFractionDigits: 0,
      }).format(n)
    } catch {
      // An ATS can emit a currency code Intl does not know. Showing the number
      // with the raw code beats throwing, and beats dropping the salary.
      return `${n.toLocaleString("en-US")}${salaryCurrency ? ` ${salaryCurrency}` : ""}`
    }
  }

  if (salaryMin && salaryMax) {
    return salaryMin === salaryMax ? fmt(salaryMin) : `${fmt(salaryMin)} – ${fmt(salaryMax)}`
  }
  return salaryMin ? `From ${fmt(salaryMin)}` : `Up to ${fmt(salaryMax!)}`
}

/** Board name as a person would say it, not as the pipeline keys it. */
const PROVIDER_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  smartrecruiters: "SmartRecruiters",
  recruitee: "Recruitee",
  personio: "Personio",
  teamtailor: "Teamtailor",
  successfactors: "SAP SuccessFactors",
  icims: "iCIMS",
  eightfold: "Eightfold",
  oracle: "Oracle Recruiting",
  radancy: "Radancy",
  keka: "Keka",
  workable: "Workable",
  jobvite: "Jobvite",
  bamboohr: "BambooHR",
}
const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p

/* -------------------------------- metadata -------------------------------- */

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await load(params)
  if (!found) return { title: "Job not found" }

  const { job } = found
  const where = job.locationDisplay ?? job.location ?? (job.isRemote ? "Remote" : null)
  const title = `${job.title} at ${job.companyName}${where ? ` — ${where}` : ""}`

  // Prefer the posting's own words; fall back to a factual sentence rather than
  // marketing copy, because a description is a claim about the job.
  const excerpt = (job.descriptionText || "").replace(/\s+/g, " ").trim()
  const description =
    excerpt.length >= 80
      ? excerpt.slice(0, 200)
      : [
          `${job.title} at ${job.companyName}`,
          where,
          job.employmentType,
          "Apply on the employer's own site.",
        ]
          .filter(Boolean)
          .join(". ")

  const canonical = jobPath(job)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(canonical),
      siteName: SITE_NAME,
    },
    twitter: { card: "summary", title, description },
    // A posting we cannot date, or that carries no description, is thin: it
    // should be reachable and followable, but it is not worth an index slot and
    // asking for one invites a thin-content penalty across the whole section.
    robots:
      job.postedAt && excerpt.length >= 50
        ? undefined
        : { index: false, follow: true },
  }
}

/* ---------------------------------- page ---------------------------------- */

export default async function JobDetailPage({ params }: Params) {
  const found = await load(params)
  if (!found) notFound()

  const { job, company } = found
  const similar = await similarJobs(job, 6)

  const where = job.locationDisplay ?? job.location
  const salary = salaryLabel(job)
  const posted = postedAgo(job.postedAt)
  const excerpt = (job.descriptionText || "").replace(/\s+/g, " ").trim()
  const schema = jobPostingSchema(job, company)

  const facts: { icon: React.ReactNode; label: string; value: string }[] = []
  if (where) facts.push({ icon: <MapPin className="h-4 w-4" />, label: "Location", value: where })
  if (job.isRemote) facts.push({ icon: <Laptop className="h-4 w-4" />, label: "Workplace", value: "Remote" })
  if (salary) facts.push({ icon: <Wallet className="h-4 w-4" />, label: "Salary", value: salary })
  if (job.employmentType)
    facts.push({ icon: <BriefcaseBusiness className="h-4 w-4" />, label: "Type", value: job.employmentType })
  if (job.seniority)
    facts.push({ icon: <Building2 className="h-4 w-4" />, label: "Level", value: job.seniority })
  if (posted) facts.push({ icon: <Clock className="h-4 w-4" />, label: "Posted", value: posted })

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Structured data, emitted only when the posting carries the fields
          Google requires. See lib/seo/job-posting.ts for what is checked and
          why a partial record gets no schema at all. */}
      {schema && (
        <script
          type="application/ld+json"
          // The payload is built from typed fields by jobPostingSchema and
          // serialised with JSON.stringify, so it cannot carry markup. The
          // `<` escape closes the one remaining hole: a description containing
          // "</script>" would otherwise end the block early.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
          }}
        />
      )}

      {/* Records the view. Renders nothing, so this page stays a server
          component -- turning it into a client component to measure it would
          trade away the SEO surface being measured. */}
      <TrackView
        event={{ type: "job_detail_view", jobId: job.externalId, companySlug: job.companySlug }}
      />

      <Navigation />

      <div className="mx-auto max-w-5xl px-4 py-6 pb-28 sm:pb-6">
        <Link
          href="/explore-jobs"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to jobs
        </Link>

        {/* ----------------------------- header ----------------------------- */}
        <Card className="mb-6">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
              <CompanyLogo name={job.companyName} logoUrl={company?.logoUrl ?? null} size={64} />

              <div className="min-w-0 flex-1">
                <h1 className="break-anywhere text-xl font-semibold leading-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
                  {job.title}
                </h1>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                  <Link
                    href={`/companies/${job.companySlug}`}
                    className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {job.companyName}
                  </Link>
                  {where && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      {where}
                    </span>
                  )}
                  {posted && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {posted}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {job.isRemote && <Badge variant="secondary">Remote</Badge>}
                  {job.earlyCareer && (
                    <Badge variant="secondary" className="capitalize">
                      {job.earlyCareer.replace("-", " ")}
                    </Badge>
                  )}
                  {job.employmentType && <Badge variant="outline">{job.employmentType}</Badge>}
                  {job.department && <Badge variant="outline">{job.department}</Badge>}
                  {salary && <Badge variant="outline">{salary}</Badge>}
                </div>
              </div>

              {/* Desktop actions. The mobile equivalent is the sticky bar. */}
              <div className="hidden shrink-0 flex-col gap-2 sm:flex">
                <Button asChild variant="outline" size="lg">
                  <Link href={`/ai-interview?jobId=${encodeURIComponent(job.externalId)}`}>
                    AI Interview
                    <MessagesSquare className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg">
                  <a href={applyHref(job.externalId)} {...APPLY_LINK_ATTRS}>
                    Apply
                    <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
                <ShareJobButton
                  title={job.title}
                  company={job.companyName}
                  path={jobPath(job)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            {/* ---------------------------- summary --------------------------- */}
            {facts.length > 0 && (
              <Card>
                <CardContent className="p-5 sm:p-6">
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    At a glance
                  </h2>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                    {facts.map((f) => (
                      <div key={f.label} className="min-w-0">
                        <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                          <span aria-hidden="true">{f.icon}</span>
                          {f.label}
                        </dt>
                        <dd className="mt-0.5 break-anywhere text-sm font-medium text-slate-900 dark:text-slate-100">
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )}

            {/* -------------------------- description ------------------------- */}
            <Card>
              <CardContent className="p-5 sm:p-6">
                <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-50">
                  About this role
                </h2>
                {excerpt ? (
                  <>
                    <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {excerpt}
                      {excerpt.length >= 195 && "…"}
                    </p>
                    {/* Say that this is an excerpt. A truncated description
                        presented as the whole posting is a small lie that costs
                        the reader an application. */}
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                      This is an excerpt from the employer's posting. Requirements, benefits and
                      the full description are on{" "}
                      <a
                        href={applyHref(job.externalId)}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-medium text-slate-900 underline underline-offset-2 dark:text-slate-100"
                      >
                        {job.companyName}'s own listing
                      </a>
                      .
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This board publishes the description only on the posting itself, so there is
                    nothing to show here.{" "}
                    <a
                      href={applyHref(job.externalId)}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-medium text-slate-900 underline underline-offset-2 dark:text-slate-100"
                    >
                      Read it on {job.companyName}'s site
                    </a>
                    .
                  </p>
                )}

                {job.skills && job.skills.length > 0 && (
                  <div className="mt-6">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                      Skills mentioned
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {job.skills.slice(0, 20).map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Extracted from the posting text, not stated by the employer.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* --------------------------- provenance ------------------------- */}
            <Card>
              <CardContent className="p-5 sm:p-6">
                <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-slate-50">
                  Where this came from
                </h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Source</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {job.companyName}'s {providerLabel(job.provider)} board
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Application</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {job.isDirectApplication === false
                        ? "Via the board"
                        : "Direct to the employer"}
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-slate-500 dark:text-slate-400">Employer posted</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {job.postedAt
                        ? new Date(job.postedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })
                        : "Not published by this board"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Listings are read from employers' own applicant tracking systems. A role can be
                  filled or withdrawn before that board updates, so check the employer's page
                  before applying.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------ sidebar ---------------------------- */}
          <aside className="space-y-6">
            {company && (
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <CompanyLogo name={company.name} logoUrl={company.logoUrl} size={40} />
                    <div className="min-w-0">
                      <Link
                        href={`/companies/${company.slug}`}
                        className="block truncate font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {company.name}
                      </Link>
                      {company.industry && (
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {company.industry}
                        </p>
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500 dark:text-slate-400">Open roles</dt>
                      <dd className="text-slate-900 dark:text-slate-100">
                        {company.openRoles.toLocaleString("en-US")}
                      </dd>
                    </div>
                    {company.hqLocation && (
                      <div className="flex justify-between gap-2">
                        <dt className="shrink-0 text-slate-500 dark:text-slate-400">HQ</dt>
                        <dd className="truncate text-slate-900 dark:text-slate-100">
                          {company.hqLocation}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <Button asChild variant="outline" className="mt-4 w-full">
                    <Link href={`/companies/${company.slug}`}>
                      View all {company.name} roles
                    </Link>
                  </Button>
                  {/* The recruiting contact lives on the company page, next to
                      the evidence behind it, rather than being restated here. */}
                  <Button asChild variant="ghost" className="mt-2 w-full">
                    <Link href={`/companies/${company.slug}#find-contacts`}>
                      Find recruiter contact
                    </Link>
                  </Button>
                  {company.domain && (
                    <a
                      href={`https://${company.domain}`}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      <Globe className="h-3 w-3" aria-hidden="true" />
                      {company.domain}
                    </a>
                  )}
                </CardContent>
              </Card>
            )}

            {similar.length > 0 && (
              <Card>
                <CardContent className="p-5">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Similar roles
                  </h2>
                  <ul className="space-y-3">
                    {similar.map((s) => (
                      <li key={s.externalId}>
                        <Link
                          href={jobPath(s)}
                          className="group block rounded-md p-2 -mx-2 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        >
                          <span className="block break-anywhere text-sm font-medium leading-snug text-slate-900 group-hover:underline dark:text-slate-100">
                            {s.title}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                            {s.companyName}
                            {(s.locationDisplay ?? s.location) &&
                              ` · ${s.locationDisplay ?? s.location}`}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>

      {/* Sticky apply bar, phones only. The desktop button is always on screen
          in the header; on a phone it scrolls away, and the apply action is the
          entire point of the page. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-800 dark:bg-slate-950/95 sm:hidden">
        <div className="flex items-center gap-2">
          <ShareJobButton title={job.title} company={job.companyName} path={jobPath(job)} compact />
          <Button asChild variant="outline" size="lg" className="shrink-0 px-3">
            <Link
              href={`/ai-interview?jobId=${encodeURIComponent(job.externalId)}`}
              aria-label={`Practice for ${job.title} with AI Interview`}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" className="flex-1">
            <a href={applyHref(job.externalId)} {...APPLY_LINK_ATTRS}>
              Apply on {job.companyName}
              <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
