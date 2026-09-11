# Architecture

## The shape of the thing

```
                      ┌─────────────────────────────────────────────┐
   employers' own     │  DISCOVERY   Common Crawl URL index         │
   ATS boards  ──────▶│  FETCH       13 source adapters             │
   (public JSON)      │  PARSE       provider JSON → RawJob         │
                      │  NORMALIZE   RawJob → CanonicalJob          │
                      │  DEDUPE      4-tier cascade                 │
                      │  ENRICH      market cap, sponsor registers  │  ← optional
                      │  VERIFY      quality + ghost-risk signals   │
                      │  INDEX       jobs-v2.json / Postgres        │
                      └────────────────────┬────────────────────────┘
                                           │
                    ┌──────────────────────▼──────────────────────┐
                    │  SEARCH                                     │
                    │    intent.ts   sentence → hard filters      │
                    │    rank.ts     13 signals → 100 points      │
                    └──────────────────────┬──────────────────────┘
                                           │
                            app/api/*  →  Next.js UI
```

## The one rule

**A failure in an optional stage must not destroy the base job.**

This is written into `lib/pipeline/orchestrator.ts` because an earlier ingest
had exactly that defect: enrichment was welded into the ingestion pass, so
running without market-cap enrichment dropped valuation coverage from 28
companies to 17 — the failure of an optional step destroyed data from a
mandatory one.

Now ingestion is mandatory and enrichment is optional *by construction*:

- enrichment runs **after** jobs are final,
- it receives a **copy**,
- it writes back **only on success**.

If it throws, times out, or is skipped entirely, the jobs are unchanged and
`companyValuationUsd` stays `null` — a known-unknown, not a lost record.

## Layering

### `lib/sources/` — the adapter seam

`types.ts` defines `JobSource`, `RawJob` and `CanonicalJob`. Everything
downstream of FETCH consumes `RawJob`/`CanonicalJob` only, so **an adapter is
the single file you write to add a platform**. Discovery, dedupe, ranking and
the UI never name a vendor.

```ts
interface JobSource {
  readonly id: SourceId
  readonly displayName: string
  fetchJobs(target: SourceTarget, opts?: FetchOptions): Promise<FetchResult>
  fetchJob?(target: SourceTarget, id: string): Promise<RawJob | null>  // optional
  healthCheck(): Promise<SourceHealth>
}
```

Registered in `lib/sources/registry.ts`. Two adapters deliberately share the
`custom` id rather than claiming a platform of their own — Amazon's bespoke
portal (routed by token) and Oracle Recruiting Cloud (routed by
`*.oraclecloud.com` host, because its token is a site number like `CX_1001`,
which is not distinctive).

`http.ts` is the hardened fetch layer: timeouts, retries, a response cache, and
an explicit `Accept-Encoding` pin — Node's fetch decodes only the first zstd
frame, which silently truncates large bodies to ~1 KB behind a 200 status.

### `lib/pipeline/` — stages

| module | responsibility |
|---|---|
| `normalize.ts` | `RawJob` → `CanonicalJob`; freshness; repost detection |
| `dedupe.ts` | four-tier cascade, certain → probabilistic |
| `quality.ts` | validation rules + ghost-risk **signals with evidence** |
| `visa.ts` | sponsorship classification from posting prose (inference) |
| `workplace.ts` | remote / hybrid / onsite, with the evidence span |
| `skills.ts` | canonical skill extraction and alias resolution |
| `resolve-locations.ts` | corpus-wide pass resolving ambiguous country/state codes |
| `orchestrator.ts` | runs the stages, isolates the optional ones, emits the report |

### `lib/search/` — retrieval and ranking

`intent.ts` turns a sentence into structured constraints; `rank.ts` scores what
survives. Both are pure and independently testable. See
[SEARCH.md](SEARCH.md).

### `lib/companies/` and `lib/visa/` — ground truth

The company registry is 104 hand-verified employers carrying the metadata a
machine cannot derive (industry, HQ, founding year, ticker). Valuation always
carries provenance — `public` (derived from SEC EDGAR shares × last close),
`private` (curated, with a source and an as-of date), or `unknown` (shown as
"Not disclosed", never guessed).

`lib/visa/sponsor-registers.ts` is different in kind from `lib/pipeline/visa.ts`
and the two are never collapsed:

| | source | epistemic status |
|---|---|---|
| `pipeline/visa.ts` | the posting's own prose | **inference** — as good as what the employer chose to write |
| `visa/sponsor-registers.ts` | UK Home Office CSV, Dutch IND register | **fact** — a named government source with a date |

An employer holding a Skilled Worker licence *can* sponsor. That is not the same
as *this role being sponsored*, so the two are stored separately.

Register matching is the dangerous part: 143,147 organisations means loose
matching finds a "hit" for almost any string — "Circle" matches "Circle Health
Group Limited", "Apple" matches "Apple Tree Day Nursery". The matcher accepts
only two shapes and records the matched legal name as evidence, so a wrong match
is visible rather than silent.

### `lib/discovery/` — finding boards

The hard part of aggregation is not reading an ATS API; it is knowing *which
boards exist*. There is no master list of Greenhouse tokens or Workday tenants.

Common Crawl's URL index is used rather than search-engine dorking, because
Google's ToS prohibits automated querying, the supported Custom Search API caps
at ~1,000 URLs/day before dedupe, and a search engine returns a *ranked sample*
where enumeration needs *the set*.

Discovery is only half of it: every candidate is verified against the provider's
live API before entering the registry. A URL in a year-old crawl proves a board
once existed, not that it exists now.

## Why not LinkedIn or Indeed

Deliberate, and documented in `lib/ats/types.ts`:

- **They are not the source.** The postings they show mostly originate from the
  same Greenhouse/Lever/Ashby/Workday boards. Reading the ATS gets the same jobs
  earlier, with structured fields the aggregators strip.
- **Their terms prohibit scraping**, and LinkedIn enforces it. A product built
  on scraped data breaks the first time markup changes or an IP range is
  blocked, and cannot be operated openly.
- **Duplicate and ghost postings are the main quality problem** on aggregator
  listings pages. Going to the ATS avoids inheriting it.

If first-party data from either is ever needed, both run official partner
programmes (LinkedIn Talent Solutions, Indeed Publisher/Employer APIs). Those
are the supported routes and they require an agreement.

## Serving

`lib/job-index.ts` serves from the ingested snapshot. The snapshot is a cache of
real responses from employers' own ATS APIs — serving from it is serving real
listings, not fixtures. Every response carries its source and generation time,
so a stale index is *visible* rather than passed off as live.

The query shape is deliberately one Postgres can execute directly, so moving to
Supabase is mechanical rather than a rewrite.
