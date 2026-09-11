# Data model

## `CanonicalJob`

Defined in `lib/sources/types.ts`. Every adapter's output converges here, and
everything downstream reads only this shape.

```ts
interface CanonicalJob {
  id: string                      // `${source}:${token}:${sourceId}`
  sourceId: string
  source: SourceId

  company: string
  companyDomain: string | null
  companySlug: string

  title: string
  normalizedTitle: string         // noise words stripped, for dedupe
  description: string

  // location — normalised, plus every location the posting names
  locationRaw: string | null
  locationDisplay: string | null
  city: string | null
  state: string | null
  country: string | null
  locationType: LocationType
  locationAmbiguous?: string | null   // "IN", "CA", "DE" … awaiting corpus resolution
  locations: { display, city, state, country }[]

  remote: boolean
  hybrid: boolean
  onsite: boolean

  employmentType: string | null
  seniority: string | null
  department: string | null
  team: string | null

  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null

  postedAt: string | null
  updatedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  lastVerifiedAt: string | null

  applicationUrl: string
  canonicalUrl: string
  sourceUrls: string[]            // every board this was found on
  sourceTypes: string[]
  isDirectApplication: boolean

  skills: string[]
  technologies: string[]
  companyValuationUsd: number | null

  // visa — inference from the posting's prose
  visaStatus: string
  visaConfidence: number
  visaEvidence: { quote, polarity, rule }[]
  visaTypes: string[]
  visaCountries: string[]
  workAuthorizationRequired: boolean

  // workplace — with the evidence span that decided it
  workplaceType: string
  workplaceConfidence: number
  workplaceEvidence: string[]
  workplaceDisplay: string
  remoteScope: string | null
  remoteCountries / remoteRegions / remoteTimezones: string[]
  officeDaysPerWeek: number | null

  // quality — signals with evidence, never a bare verdict
  qualityScore: number
  qualityIssues: { rule, severity, message }[]
  ghostRisk: number
  ghostLabel: string | null
  ghostSignals: { signal, evidence }[]

  status: JobStatus
  freshnessScore: number
  sourceConfidence: number
}
```

### Design notes

**Evidence travels with every inference.** `visaEvidence` carries the verbatim
quote and the rule that fired; `workplaceEvidence` carries the span;
`ghostSignals` carry factual evidence, never a paraphrase of intent. This is what
lets the UI show *why* rather than asserting.

**Nothing is discarded on dedupe.** The survivor becomes canonical and absorbs
the others' `sourceUrls`, so a user can still see every place the job was found,
and the best (most direct) apply link is the one kept.

**Ambiguity is recorded, not guessed.** `"IN"` is both Indiana and India; so are
CA, DE, ID, LA, MO, MT, NE, PA, SC. Resolving them blindly as US states put 210
Bangalore jobs in Indiana. `locationAmbiguous` defers the decision to
`resolveAmbiguousLocations`, a later pass that settles it from unambiguous
sightings of the same city across the whole corpus. Guessing at parse time would
be a fabrication; deferring is not.

## Source confidence

`DEFAULT_SOURCE_CONFIDENCE` — how much a source's data is trusted before any
learned adjustment:

| tier | value | sources |
|---|--:|---|
| employer's own site | 1.00 | `company` |
| major ATS | 0.98 | Workday, Greenhouse, Lever, Ashby, SmartRecruiters |
| mid ATS | 0.96–0.97 | Recruitee, Teamtailor, Personio, Jobvite, BambooHR, Workable, … |
| enterprise ATS | 0.95 | iCIMS, Taleo, SuccessFactors, Eightfold, Avature, Phenom, UKG |
| bespoke portal | 0.92 | `custom` |
| search-index discovered | 0.85 | not yet resolved to a board |
| aggregator | 0.70 | |
| unknown | 0.40 | |

This feeds the `sourceQuality` ranking signal.

## Company registry

`lib/companies/registry.ts` — 104 hand-verified employers. Each entry is an
employer reached on its own ATS board with live postings (`scripts/verify-ats-boards.mjs`).
That verification is what "genuine company" means here.

```ts
interface CompanyRecord {
  slug: string
  name: string
  domain: string                  // drives the logo, joins enrichment
  boards: CompanyBoard[]          // one employer can have several
  valuationKind: 'public' | 'private' | 'unknown'
  ticker?: string                 // SEC ticker, for `public`
  reportedValuationUsd?: number   // for `private` only
  valuationAsOf?: string
  valuationSource?: string
  industry?: string
  hqLocation?: string
  foundedYear?: number
}
```

Valuation provenance rules are in [INGESTION.md](INGESTION.md#adding-an-employer).
The short version: `public` is *derived* from SEC EDGAR, `private` is *curated*
with a source and a date, `unknown` renders as "Not disclosed" and is never
interpolated.

One employer can carry several boards — Lloyds Banking Group lists both
`lbg_Careers` and `Graduate_careers`, or the graduate roles are missed entirely.

## Sponsor registers

`public/data/sponsors.json`, built by `scripts/build-sponsors.mjs`.

| | source | orgs |
|---|---|--:|
| UK | Home Office, *Register of licensed sponsors: workers* (CSV, monthly) | 143,147 |
| NL | IND, *Public Register of Recognised Sponsors — Labour* (HTML table) | 12,974 |

The UK CSV URL carries a date and changes every release, so it is discovered
through the GOV.UK content API rather than hardcoded. The Netherlands publishes
no CSV, so the table is parsed from the page.

Stored **separately** from inferred visa status and never collapsed into it.

## Postgres schema

23 migrations in `supabase/migrations/`.

| area | tables |
|---|---|
| identity | `profiles`, `experiences`, `educations`, `audit_logs` |
| jobs | `jobs` (+ RLS: admin-only writes, public select) |
| location | `countries`, `states`, `cities` — seeded from the vendored dataset |
| resumes | `resumes` + storage policies |
| billing | `user_subscriptions`, `stripe_webhook_events` (idempotency) |
| auth | `otp_resets` (hardened Sep 2026) |
| content | `blogs` |

Seed the location tables:

```bash
npm run populate-locations
```

### The schema change worth making

`jobs.salary` and `jobs.experience` are free **text**, which is why parsing them
is guesswork and why the 1000× salary bug was possible at all.
`salary_min_cents`, `salary_max_cents`, `currency` and `experience_min_years`
would make matching exact and let filtering move into Postgres instead of
happening in memory.
