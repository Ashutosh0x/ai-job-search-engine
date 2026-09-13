"use client"

/**
 * Recruiting Intelligence panel for a company page.
 *
 * Shows how to apply, the publicly-identified recruiting/talent professionals
 * (with source evidence and a confidence badge), the OBSERVED company email
 * pattern (labelled as a pattern, never resolved to a person), and the
 * DOMAIN-level mail posture. Filtering and search run entirely on the already
 * loaded dataset -- no request per keystroke.
 *
 * What this panel refuses to show, by construction: a guessed personal email,
 * or "verified" next to anything that is not a confirmed public identity. MX
 * is presented as domain infrastructure, never as proof a mailbox exists.
 */

import { useMemo, useState } from "react"
import type { RecruitingContact } from "@/lib/companies/recruiter-intel-types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ExternalLink,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Users,
  Server,
  Info,
  Linkedin,
  FileText,
} from "lucide-react"

type Channel = { provider: string; label: string; url: string | null }
type Posture = { domain: string; hasMx: boolean; mx?: string[]; hasSpf: boolean; dmarcPolicy: string | null } | null

export interface RecruitingIntelligenceProps {
  companyName: string
  applicationChannels: Channel[]
  recruiters: RecruitingContact[]
  publishedContacts: { address: string; domainHasMx: boolean | null }[]
  emailPatterns: { pattern: string; share: number }[]
  emailDomain?: string | null
  talentOrg: { role: string; name: string }[]
  mailPosture: Posture
  lastVerifiedAt?: string | null
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
}

const IDENTITY_LABEL: Record<string, string> = {
  confirmed: "Verified public identity",
  corroborated: "Corroborated",
  uncertain: "Uncertain",
}

const ROLE_FILTERS = [
  { key: "all", label: "All" },
  { key: "recruiter", label: "Recruiters" },
  { key: "talent_acquisition", label: "Talent Acquisition" },
  { key: "talent_partner", label: "Talent Partners" },
  { key: "leadership", label: "Leadership" },
  { key: "technology", label: "Technology Recruiting" },
  { key: "campus", label: "Campus Recruiting" },
  { key: "executive", label: "Executive Recruiting" },
]

function fmtDate(iso?: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

export default function RecruitingIntelligence({
  companyName,
  applicationChannels,
  recruiters,
  publishedContacts,
  emailPatterns,
  emailDomain,
  talentOrg,
  mailPosture,
  lastVerifiedAt,
}: RecruitingIntelligenceProps) {
  const [query, setQuery] = useState("")
  const [role, setRole] = useState("all")
  const [confidence, setConfidence] = useState<"all" | "high" | "medium">("all")
  const [emailOnly, setEmailOnly] = useState<"all" | "has" | "none">("all")
  const [showReview, setShowReview] = useState(false)

  // Only high/medium-confidence records belong in the main list; low-confidence
  // records are held separately for manual review (TASK 4).
  const qualified = useMemo(() => recruiters.filter((r) => r.confidence !== "low"), [recruiters])
  const review = useMemo(() => recruiters.filter((r) => r.confidence === "low"), [recruiters])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return qualified.filter((r) => {
      if (role !== "all" && r.department !== role) return false
      if (confidence !== "all" && r.confidence !== confidence) return false
      if (emailOnly === "has" && r.emailStatus !== "published") return false
      if (emailOnly === "none" && r.emailStatus === "published") return false
      if (!q) return true
      return [r.fullName, r.currentTitle, r.department, r.location]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    })
  }, [qualified, query, role, confidence, emailOnly])

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, published: 0 }
    for (const r of recruiters) {
      c[r.confidence]++
      if (r.emailStatus === "published") c.published++
    }
    return c
  }, [recruiters])

  const lastVerified = fmtDate(lastVerifiedAt)

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <Send className="h-4 w-4 text-blue-600" /> Recruiting Intelligence
          </h2>
          {lastVerified && (
            <span className="text-xs text-slate-400">Last verified: {lastVerified}</span>
          )}
        </div>

        {/* Application channels */}
        <section className="mb-6">
          <SectionLabel>Application channels</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {applicationChannels.length === 0 && (
              <span className="text-sm text-slate-500">No known application channel.</span>
            )}
            {applicationChannels.map((ch) => (
              <a
                key={ch.provider + ch.label}
                href={ch.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                  ch.url
                    ? "border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950"
                    : "cursor-default border-slate-200 text-slate-500 dark:border-slate-800"
                }`}
              >
                {ch.label}
                {ch.url && <ExternalLink className="h-3 w-3" />}
              </a>
            ))}
          </div>
          {publishedContacts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {publishedContacts.map((c) => (
                <a key={c.address} href={`mailto:${c.address}`} className="inline-flex items-center gap-1 text-slate-700 hover:underline dark:text-slate-300">
                  <Mail className="h-3 w-3 text-slate-400" /> {c.address}
                  {c.domainHasMx && <ShieldCheck className="h-3 w-3 text-emerald-500" />}
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Recruiters */}
        <section className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>
              Recruiting / talent professionals{" "}
              <span className="font-normal text-slate-400">({recruiters.length})</span>
            </SectionLabel>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1"><Dot className="bg-emerald-500" />{counts.high} high</span>
              <span className="inline-flex items-center gap-1"><Dot className="bg-amber-500" />{counts.medium} med</span>
              <span className="inline-flex items-center gap-1"><Dot className="bg-slate-400" />{counts.low} review</span>
            </div>
          </div>

          {qualified.length === 0 ? (
            <p className="mt-3 rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:bg-slate-900">
              No high/medium-confidence recruiters on record for {companyName} yet. Use the
              application channel above to apply.
            </p>
          ) : (
            <>
              {/* Search + filters */}
              <div className="mt-3 space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search recruiters by name, title, department, location..."
                    className="pl-8"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_FILTERS.map((f) => (
                    <FilterChip key={f.key} active={role === f.key} onClick={() => setRole(f.key)}>
                      {f.label}
                    </FilterChip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "high", "medium"] as const).map((c) => (
                    <FilterChip key={c} active={confidence === c} onClick={() => setConfidence(c)}>
                      {c === "all" ? "Any confidence" : `${c[0].toUpperCase()}${c.slice(1)} confidence`}
                    </FilterChip>
                  ))}
                  <span className="mx-1 w-px bg-slate-200 dark:bg-slate-700" />
                  {([["all", "Any email"], ["has", "Has public email"], ["none", "No public email"]] as const).map(
                    ([k, label]) => (
                      <FilterChip key={k} active={emailOnly === k} onClick={() => setEmailOnly(k)}>
                        {label}
                      </FilterChip>
                    )
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Title</th>
                      <th className="pb-2 pr-3">Department</th>
                      <th className="pb-2 pr-3">Contact</th>
                      <th className="pb-2 pr-3">Email</th>
                      <th className="pb-2 pr-3">Confidence</th>
                      <th className="pb-2">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 align-top dark:border-slate-900">
                        <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                          {r.fullName}
                          {r.location && <div className="text-xs font-normal text-slate-400">{r.location}</div>}
                        </td>
                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{r.currentTitle ?? "—"}</td>
                        <td className="py-2 pr-3">
                          {r.department ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {r.department.replace(/_/g, " ")}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {r.linkedinUrl ? (
                            <a
                              href={r.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
                            >
                              <Linkedin className="h-3.5 w-3.5" /> Contact on LinkedIn
                            </a>
                          ) : r.officialCompanyProfileUrl ? (
                            <a href={r.officialCompanyProfileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400">
                              <ExternalLink className="h-3.5 w-3.5" /> Profile
                            </a>
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {r.emailStatus === "published" && r.email ? (
                            <a href={`mailto:${r.email}`} className="text-slate-700 hover:underline dark:text-slate-300">{r.email}</a>
                          ) : (
                            <span className="text-xs text-slate-400">No public email</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium uppercase ${CONFIDENCE_STYLE[r.confidence]}`}
                            title={IDENTITY_LABEL[r.identityStatus]}
                          >
                            {r.confidence}
                          </span>
                        </td>
                        <td className="py-2">
                          <Popover>
                            <PopoverTrigger className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400">
                              <FileText className="h-3.5 w-3.5" /> View evidence
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-80 text-xs">
                              <p className="mb-1 font-medium text-slate-700 dark:text-slate-200">
                                {IDENTITY_LABEL[r.identityStatus]} · {r.sourceType.replace(/_/g, " ")}
                              </p>
                              <ul className="mb-2 list-disc space-y-1 pl-4 text-slate-600 dark:text-slate-400">
                                {r.evidence.map((e, i) => (<li key={i}>{e}</li>))}
                              </ul>
                              <p className="font-medium text-slate-500">Sources</p>
                              <ul className="space-y-0.5">
                                {r.sourceUrls.map((u) => (
                                  <li key={u}>
                                    <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 hover:underline dark:text-blue-400">{u}</a>
                                  </li>
                                ))}
                              </ul>
                              {r.lastVerifiedAt && (
                                <p className="mt-2 text-slate-400">Last verified: {fmtDate(r.lastVerifiedAt)}</p>
                              )}
                            </PopoverContent>
                          </Popover>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-500">No recruiters match these filters.</p>
                )}
              </div>
            </>
          )}

          {/* Low-confidence records are held out of the main list for review. */}
          {review.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowReview((s) => !s)}
                className="text-xs text-slate-500 underline-offset-2 hover:underline"
              >
                {showReview ? "Hide" : "Show"} {review.length} low-confidence record
                {review.length === 1 ? "" : "s"} held for manual review
              </button>
              {showReview && (
                <ul className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-900">
                  {review.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-600 dark:text-slate-400">{r.fullName}</span>
                      <span>{r.currentTitle ?? "—"}</span>
                      {r.linkedinUrl && (
                        <a href={r.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                          LinkedIn
                        </a>
                      )}
                      <span className="text-slate-400">· uncertain identity (e.g. truncated name / single source)</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Company email intelligence */}
        {emailPatterns.length > 0 && (
          <section className="mb-6">
            <SectionLabel>Observed company email pattern</SectionLabel>
            <div className="mt-2 space-y-1">
              {emailPatterns.map((p) => (
                <div key={p.pattern} className="flex items-center justify-between gap-2 text-sm">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{p.pattern}</code>
                  <span className="tabular-nums text-slate-400">{p.share}%</span>
                </div>
              ))}
            </div>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-slate-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Pattern only. This is not a verified email address for any individual, and we never
              resolve it to a named person.
            </p>
          </section>
        )}

        {talentOrg.length > 0 && (
          <section className="mb-6">
            <SectionLabel><Users className="mr-1 inline h-3.5 w-3.5" />Talent &amp; HR leadership</SectionLabel>
            <ul className="mt-2 space-y-0.5 text-sm text-slate-600 dark:text-slate-400">
              {talentOrg.map((l) => (
                <li key={l.name}><span className="text-slate-400">{l.role}:</span> {l.name}</li>
              ))}
            </ul>
          </section>
        )}

        {/* Domain posture */}
        {mailPosture && (
          <section>
            <SectionLabel><Server className="mr-1 inline h-3.5 w-3.5" />Domain mail posture</SectionLabel>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">@{mailPosture.domain}</code>
              <PostureBadge ok={mailPosture.hasMx} label={`MX: ${mailPosture.hasMx ? "Present" : "None"}`} />
              <PostureBadge ok={mailPosture.hasSpf} label={`SPF: ${mailPosture.hasSpf ? "Present" : "None"}`} />
              <PostureBadge
                ok={Boolean(mailPosture.dmarcPolicy)}
                label={`DMARC: ${mailPosture.dmarcPolicy ? mailPosture.dmarcPolicy : "None"}`}
              />
            </div>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-slate-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Domain-level checks only. These do not verify individual mailboxes, and no mailbox is
              ever probed.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${className}`} />
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? "border-blue-500 bg-blue-500 text-white"
          : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400"
      }`}
    >
      {children}
    </button>
  )
}

function PostureBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${
        ok
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-slate-100 text-slate-500 dark:bg-slate-800"
      }`}
    >
      {label}
    </span>
  )
}
