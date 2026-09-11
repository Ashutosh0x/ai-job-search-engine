<p align="center">
  <img src="docs/assets/banner.svg" alt="AI Job Search Engine" width="100%">
</p>

<p align="center">
  <b>A job search engine that reads employers' own applicant tracking systems — not aggregators, not scrapers.</b><br>
  Natural-language queries become hard filters. Every result explains why it ranked where it did.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white">
  <img alt="Radix UI" src="https://img.shields.io/badge/Radix_UI-shadcn-161618?style=flat-square&logo=radixui&logoColor=white">
</p>
<p align="center">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres_+_RLS-3FCF8E?style=flat-square&logo=supabase&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-23_migrations-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="Stripe" src="https://img.shields.io/badge/Stripe-Billing-635BFF?style=flat-square&logo=stripe&logoColor=white">
  <img alt="Gemini" src="https://img.shields.io/badge/Gemini-2.5_Flash-8E75B2?style=flat-square&logo=googlegemini&logoColor=white">
  <img alt="Resend" src="https://img.shields.io/badge/Resend-Email-000000?style=flat-square&logo=resend&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20+-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white">
</p>

<p align="center">
  <img alt="tests" src="https://img.shields.io/badge/tests-432_passing-2ea043?style=flat-square">
  <img alt="sources" src="https://img.shields.io/badge/source_adapters-13-7cf2d0?style=flat-square">
  <img alt="companies" src="https://img.shields.io/badge/curated_employers-173-a9b6ff?style=flat-square">
  <img alt="jobs" src="https://img.shields.io/badge/roles_indexed-241%2C586-5b7cff?style=flat-square">
</p>

---
<img width="1448" height="717" alt="image" src="https://github.com/user-attachments/assets/e8c64dad-503c-4567-9dc0-d7cf30c11a43" />

## What this is

Most "job search" products are a search box over an aggregator's copy of a job
posting. This one goes to the source: it reads the public, documented, no-auth
JSON feeds that power employers' own careers pages — Workday, Greenhouse, Ashby,
SmartRecruiters, Oracle Recruiting Cloud and eight more — normalises them into
one schema, deduplicates across boards, and ranks with a transparent scorer.

Three things follow from reading the source rather than an aggregator:

- **The jobs are real.** A company with a live ATS board answering on its own
  domain is a real employer really hiring. That is a stronger genuineness signal
  than anything scraped off a listings page.
- **It is permitted.** LinkedIn's and Indeed's terms prohibit scraping. Every
  endpoint used here is the employer's own public feed. Nothing here needs to be
  operated in the dark.
- **The fields survive.** Aggregators strip department, compensation, workplace
  type and requisition ids. Reading the ATS keeps them, which is what makes
  real filtering possible.

## What it does that a job board doesn't

| | |
|---|---|
| **Natural-language search** | `"senior ML engineer in Bangalore with visa sponsorship posted this week"` is parsed into five hard filters and one topic — not bag-of-words. The API returns `intentSummary` so the user can see how their sentence was read, and correct it. |
| **Explainable ranking** | Score is a sum of 13 named signals out of 100. Every result carries the breakdown; `?debug=1` returns it in full. Company prestige is capped at 3 points on purpose — the right small company should beat the wrong famous one. |
| **Visa sponsorship, as fact and as inference** | Inferred status is read from the posting's prose and kept *separate* from three **official government sources**: the UK Home Office register (143,147 orgs), the Dutch IND register (12,974), and the USCIS H-1B Employer Data Hub (28,060). Those are different kinds of fact and are not merged — UK/NL publish *licences* (permission, current), USCIS publishes *outcomes* (petitions actually approved, for a closed fiscal year). A licence means an employer *can* sponsor; it never silently becomes "this role is sponsored". |
| **Ghost-job signals** | Stale and repost patterns are surfaced as *signals with evidence*, never as a verdict. Staleness is measured primarily from **`firstSeenAt`** — when this crawler first observed the posting, tracked in `.ingest-state.json` — not from the employer's `postedAt`. That matters because Workday publishes no date at list time; `postedAt` is only the fallback branch (`lib/pipeline/quality.ts:185`). Repost counts and talent-pipeline phrasing are also date-independent. A suspected ghost job is ranked lower and labelled, never hidden. |
| **Company-level filters** | Valuation tier, hiring momentum (open-role count), and which ATS the employer runs. Aggregators expose headcount, not company value — so they cannot separate a 500-person unicorn from a 500-person agency. |
| **Resume ↔ job matching, evidence-first** | A resume is scored against a *target job*, never in the abstract. Each requirement maps to the resume span that supports it, graded DIRECT / STRONG / WEAK / INSUFFICIENT / CONTRADICTED / ABSENT. Assertion detection means `"No hands-on experience with Kubernetes"`, `"Interested in learning Rust"` and `"Managed a team of Python developers"` never count as skills. |
| **Cross-board dedupe** | The same requisition legitimately appears on several boards. A four-tier cascade (requisition id → apply URL → title+location → fuzzy) collapses them, keeps the most direct apply link, and records how certain the match was. |

## Provenance

This started as an audit and overhaul of an existing Next.js application called
**JobSpark AI** (commit `fcaa23c`, "Baseline: JobSpark AI as found (pre-audit)").
That app supplied the auth, profile, resume-upload and billing surfaces. It also
arrived with a build that did not compile, a password reset that changed the
wrong user's password, and a job search that returned three invented postings on
failure -- all documented in [AUDIT-2026.md](AUDIT-2026.md).

Everything the search engine consists of was added on top. Measured against
that baseline:

```
git diff --shortstat fcaa23c HEAD -- lib/ scripts/ app/api/
  102 files changed, 25,480 insertions(+), 1,109 deletions(-)
```

So: ~25k lines of net-new pipeline, adapter, search, visa and resume code over
an inherited product shell. An earlier version of this README described the
whole thing as "first-party", which was wrong, and this section replaces it.

```
Ingestion pipeline    ██████████████████░░   done, running
Search + ranking      ██████████████████░░   done, running
Visa / sponsor data   ██████████████████░░   done, running
Web app + auth        ████████████████░░░░   done; server-side route guards pending
Billing (Stripe)      ███████████████░░░░░   done; webhook idempotency in place
Resume AI             ██████████████░░░░░░   analysis + parsing done
CI                    ░░░░░░░░░░░░░░░░░░░░   not started
```

**Measured, from the last full corpus run (10 Sep 2026):**

| | |
|---|---|
| Roles indexed | **241,586** canonical, from 301,128 raw |
| Boards crawled | **1,282** companies / 1,295 sources — 0 failures |
| HTTP requests | **9,178 — 100% 2xx.** 0 blocked, 0 not-found, 0 network errors |
| Duplicates collapsed | 59,476 (requisition 21,215 · title+location 32,026 · fuzzy 6,607) |
| Direct apply links | 241,461 — **100%** |
| Sponsor register orgs | 184,181 (UK 143,147 · US 28,060 · NL 12,974) |
| Run time | 19m 38s |
| Search latency | p50 **43ms**, p90 59ms (BM25 inverted index over the full corpus) |
| Tests | **377 assertions, 17 suites, all passing** |

> **On "0 failures".** That figure counts boards whose adapter threw. It is not
> a claim that every request succeeded, and it should never have been presented
> as one: `httpJson` returns null on any non-OK response, so a board answering
> 403 yielded an empty list and was recorded as succeeding with 0 jobs. A WAF
> could block two dozen employers without moving the number.
>
> The HTTP layer now records real outcomes — 2xx, blocked (401/403/429/**202**,
> the code Akamai uses for a bot challenge), 404/410, 5xx, network errors — and
> every run prints them alongside the named hosts that refused us. The metric is
> falsifiable now. Known blocks: Eightfold tenants (Qualcomm, Amex, NAB global),
> IBM, dol.gov.

Source mix from that run: Workday 118,984 · SmartRecruiters 94,346 ·
Greenhouse 28,785 · Ashby 17,509 · bespoke portals 6,193 · Recruitee 2,210 ·
Eightfold 1,675 · Lever 383 · Workable 6.

That is **9 sources from 13 implemented adapters** — not a discrepancy. The
other four (Teamtailor, Personio, and the Amazon and Oracle Recruiting adapters,
which both ride the `custom` id) had no employer in that particular seed list,
so they contributed nothing to that run rather than being absent from the code.
All 13 are registered in `lib/sources/registry.ts`; Oracle Recruiting has since
picked up Dell and JPMorgan.

## Architecture

```
DISCOVERY → FETCH → PARSE → NORMALIZE → DEDUPE → ENRICH → VERIFY → INDEX
```

Stages are independent, and the rule that matters is that **a failure in an
optional stage must not destroy the base job**. Enrichment runs after jobs are
already final, on a copy, and writes back only on success — so a market-cap
lookup timing out leaves `companyValuationUsd` null (a known-unknown) instead of
losing the posting.

Adding a new ATS means writing **one adapter** and registering it. Discovery,
ingestion, dedupe, ranking and the UI all work through the `JobSource` interface
and never name a platform.

```
lib/
  sources/       adapters (13) + the JobSource contract + hardened HTTP
  pipeline/      normalize · dedupe · quality · visa · workplace · skills · orchestrator
  search/        intent parsing · explainable ranking
  companies/     curated registry (173 employers) + market cap from SEC EDGAR
  visa/          UK Home Office + Dutch IND sponsor registers
  discovery/     Common Crawl board discovery
app/api/         16 route handlers
```

Full detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Quick start

```bash
git clone --recurse-submodules https://github.com/Ashutosh0x/ai-job-search-engine.git
cd ai-job-search-engine
npm install
cp env.example .env.local     # fill in Supabase at minimum
npm run dev
```

Build the job index (writes `public/data/jobs-v2.json`, gitignored):

```bash
npx tsx scripts/ingest-v2.mjs --limit 40        # a bounded first run
npx tsx scripts/ingest-v2.mjs                   # the full corpus, ~20 min
npx tsx scripts/ingest-v2.mjs --only stripe,figma,doordash
```

Then search it:

```bash
curl 'localhost:3000/api/smart-search?q=senior platform engineer in india&debug=1'
```

### Keeping it current

A full ingest is a 20-minute crawl of every board, so it is the wrong tool for
staying fresh. `refresh` crawls a **tier** and merges into the existing index,
leaving every other board untouched:

```bash
npx tsx scripts/refresh.mjs --tier hot     # Greenhouse/Ashby/Lever, ~60s
npx tsx scripts/refresh.mjs --tier warm    # SmartRecruiters/Recruitee
npx tsx scripts/refresh.mjs --tier cold    # Workday/Eightfold/Oracle
```

Tiers come from measured per-board cost: Greenhouse ~0.4s, Ashby ~0.7s,
SmartRecruiters ~1-6s, Workday ~23-101s. Polling all of them on the fast
cadence would cost far more and deliver less. `.github/workflows/refresh-jobs.yml`
runs the three on their own crons.

**There are no webhooks** — every ATS here is poll-only, so freshness is bounded
by poll interval. Hot-tier boards are minutes fresh; Workday tenants (~47% of
the corpus) are nightly. Calling the whole thing "real-time" would be a claim
about latency we cannot meet for most of it.

Clients poll the delta feed rather than re-reading a 275 MB index:

```bash
curl 'localhost:3000/api/jobs/delta?since=2026-09-11T04:54:00Z'
```

It cursors on `firstSeenAt` (when *we* first saw a posting), not `postedAt` —
which is absent on ~47% of the corpus and is not monotonic with discovery.

Setup in full: **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

## Documentation

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Stages, the adapter contract, why the layering is what it is |
| [Ingestion](docs/INGESTION.md) | Running crawls, adding an employer, writing an adapter, board discovery |
| [Search & ranking](docs/SEARCH.md) | Intent parsing, the 13 ranking signals, tuning weights |
| [API reference](docs/API.md) | All 16 endpoints, parameters, response shapes |
| [Data model](docs/DATA-MODEL.md) | `CanonicalJob`, the company registry, the 23 migrations |
| [Development](docs/DEVELOPMENT.md) | Env vars, scripts, tests, known gaps |
| [Security](docs/SECURITY.md) | Threat model and the September 2026 audit |
| [Resume intelligence](docs/resume-intelligence-audit.md) | Audit of the resume feature, the hardcode inventory, and the evidence-first design |
| [Zero-cost architecture](docs/zero-cost-architecture.md) | Client-side/extension blueprint, with six verified corrections |
| [Audit report](AUDIT-2026.md) | The full remediation write-up |

## Known gaps

Stated plainly, because a README that only lists wins is not much use:

- **Descriptions are missing for ~80% of the corpus, and that caps everything
  downstream.** Workday and SmartRecruiters list endpoints return no body text,
  so skills sit at 11%, workplace type is mostly UNKNOWN and visa signal is
  thin — every classifier is reading titles for most rows. Hydration is now
  implemented (`WorkdayAdapter.fetchJob`, `--hydrate N`) and measured on 1,023
  Workday postings it takes descriptions 0% → 100%, skills 6% → 76% and posted
  dates 0% → 100%. It costs ~5.7x ingestion time, so it is opt-in and has not
  been run corpus-wide. **This is the single highest-value thing left.**
- **Search is lexical only.** BM25 with IDF and length normalisation, no dense
  retrieval — there is no embedding model or vector index here. It cannot match
  "AI infrastructure" to "ML platform", and searching `mistral` surfaces a
  French H&M store called "Avignon Mistral" above the AI lab. Reciprocal Rank
  Fusion is implemented and tested so a second retrieval stream can plug in
  without rewriting the caller; calling this "hybrid search" today would
  describe software that has not been written.
- **No scoring model is calibrated.** The resume engine's score registry has
  `calibration: null` on every model, which forces `confidence: 'uncalibrated'`
  and integer precision. That is enforced by the types rather than by
  convention, but it means no score here predicts an outcome.
- **`ignoreBuildErrors` is still on** in `next.config.mjs`. It hid two critical
  bugs (see the audit). 51 type errors remain, 29 of them in the vendored
  location sub-project. CI ratchets the count so it can fall but never rise.
- **Next.js 14.2.16 is old** (Oct 2024). The 2026 releases fixed middleware auth
  bypass, SSRF and cache poisoning.
- **Rate limiting is per-process**, so on serverless it is a speed bump rather
  than a guarantee — and it is the control protecting password reset.
- **Supabase-backed features need a project.** Auth, profiles and resumes are
  down whenever `NEXT_PUBLIC_SUPABASE_URL` points at a project that no longer
  exists. The search engine itself needs none of it — it reads the snapshot.
- **Some employers are not reachable, and are left out rather than faked.**
  Eightfold tenants (Qualcomm, American Express) answer 403 to any non-browser
  client. IBM, Tesla, Uber and dol.gov sit behind bot managers that answer a
  challenge instead of the document — IBM's `robots.txt` even *allows* `/careers`
  and publishes a sitemap whose child files then return 202. AMD is on iCIMS and
  Goldman Sachs runs a bespoke portal; neither has an adapter. Where a public
  feed genuinely does not exist, the employer is absent, not invented.

## Licence

No licence file yet, which means **all rights reserved** by default. Add one
before inviting outside contributions.
