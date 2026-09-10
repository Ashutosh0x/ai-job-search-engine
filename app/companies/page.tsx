import Link from "next/link"
import { listCompanies } from "@/lib/job-index"
import { formatValuation } from "@/lib/companies/registry"
import Navigation from "@/components/navigation"
import { CompanyLogo } from "@/components/company-logo"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertCircle } from "lucide-react"

export const dynamic = "force-dynamic"

/**
 * Company directory, ordered by valuation.
 *
 * Every company here was admitted by reaching its own ATS board and finding
 * live postings (scripts/verify-ats-boards.mjs). Nothing is listed on the
 * strength of a name alone.
 */
export default async function CompaniesPage() {
  const companies = await listCompanies()

  if (!companies) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <Navigation />
        <div className="mx-auto max-w-4xl px-4 py-10">
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex gap-3 p-5">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Company index is not available
                </p>
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  Run <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">npx tsx scripts/ingest-jobs.mjs</code>{" "}
                  to build it from the ATS APIs.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const totalRoles = companies.reduce((s, c) => s + (c.openRoles ?? 0), 0)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Companies</h1>
          <p className="mt-1 text-sm text-slate-500">
            {companies.length} verified employers · {totalRoles.toLocaleString()} open roles.
            Each one confirmed by reading its own applicant tracking system.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => {
            const valuation = formatValuation(c.valuationUsd)
            return (
              <Link key={c.slug} href={`/companies/${c.slug}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <CompanyLogo name={c.name} logoUrl={c.logoUrl} size={44} />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {c.name}
                        </h2>
                        <p className="truncate text-xs text-slate-500">{c.industry ?? c.domain}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">
                          {c.valuationKind === "public" ? "Market cap" : "Valuation"}
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {valuation ?? "Not disclosed"}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {c.openRoles ?? 0} roles
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
