# Repository index

Snapshot: 2026-10-02, `master` @ `ab1f387`. Built from the files themselves
(imports, routes, manifests), not from earlier docs. For design rationale see
[ARCHITECTURE.md](ARCHITECTURE.md); for data flows see
[CODEBASE_MAP.md](CODEBASE_MAP.md).

## Stack (verified from manifests)

| Layer | What | Evidence |
|---|---|---|
| Framework | Next.js 14.2.35, App Router, React 18, TypeScript 5 | `package.json`, `node_modules/next/package.json` |
| Data / auth | Supabase (Postgres + Auth + Storage) | `@supabase/supabase-js`, `supabase/migrations/` |
| Payments | Stripe 18 (checkout + verified webhook) | `app/api/stripe/*`, `lib/stripe.ts` |
| AI | Google Gemini (`@google/generative-ai`) | `app/api/analyze-resume`, `lib/linkedin/analyzer.ts`, `lib/ai-interview/interviewer.ts` |
| Validation | Zod | most `app/api/*/route.ts` |
| Hosting | Vercel (`vercel.json`); job index served from committed JSON shards | `lib/job-index.ts` |
| CI | GitHub Actions: `ci.yml` (npm ci, tsc, npm test, next build), `refresh-jobs.yml` (15 min / 3 h / nightly), `daily-publish.yml` (05:00 UTC), `recruiter-directory.yml` | `.github/workflows/` |
| Tests | No framework: 69 standalone `scripts/test-*.mjs` suites, run by `npm test` (`scripts/run-tests.mjs`) | |
| Package manager | npm (`package-lock.json`); a stale `pnpm-lock.yaml` also exists | |

## Directory map

| Path | Responsibility |
|---|---|
| `app/` | Pages (27) and API routes (37). See tables below. |
| `lib/sources/` | One adapter per ATS (`adapters/*`); `types.ts` holds the `SourceId` union, `registry.ts` maps ids to adapters. Both must be updated together. |
| `lib/pipeline/` | Normalisation, dedupe, early-career classification, quality scoring. |
| `lib/companies/` | `registry.ts`: every employer and its board(s), the crawl's ground truth. |
| `lib/search/`, `lib/job-index.ts` | Load the deployed index (`public/data/jobs-deploy*.json`) and search/rank it in-process. |
| `lib/job-matching.ts`, `lib/job-scoring.ts` | Resume-to-job matching and scoring. |
| `lib/resume/` | Parsing, optimisation, resume builder, PDF export. |
| `lib/contacts/` | Contact discovery: email patterns, careers/GitHub scraping, public DNS/RDAP records, recruiter crawler. |
| `lib/linkedin/` | LinkedIn Insight: schema-validated analysis of a profile the user supplies. |
| `lib/ai-interview/` | Voice/text interview sessions (Gemini), scoped per user. |
| `lib/analytics/` | First-party analytics ingest and admin dashboard. |
| `lib/api-auth.ts` | `requireUser()`: bearer/cookie auth for API routes (11 routes use it). |
| `lib/api-guard.ts`, `lib/rate-limit.ts` | Per-process rate limiting for API routes (middleware excludes `/api`). |
| `lib/safe-fetch.ts` | SSRF guard for caller-supplied URLs (resolves DNS, blocks private ranges, no redirects). |
| `lib/contacts/domain.ts` | Hostname validation for caller-supplied company domains (added 2026-10-02). |
| `middleware.ts` | Redirects signed-out visitors away from `/dashboard`, `/profile`, `/settings`; optional `/docs` proxy. |
| `scripts/` | 218 files: ingest (`ingest-v2.mjs`), board discovery (`discover-ats.mjs`), crawls, data quality, test suites. |
| `chrome-extension/` | MV3 extension: LinkedIn content script + messages to the web app. |
| `supabase/migrations/` | 15 SQL migrations (profiles, resumes, locations, OTP resets, subscriptions). |
| `public/data/` | Deployed job index shards and the recruiter directory. |
| `docs/` | Topic docs: ARCHITECTURE, SECURITY, INGESTION, SEARCH, DATA-MODEL, API, ANALYTICS, AI-INTERVIEW, DEVELOPMENT. |

**Not part of this app:** `arc-remote-signer/`, `furlpay-*-work/`,
`furlpay-instagram-mcp/`, `malachite/` (untracked, other projects),
`countries-states-cities-database/` (submodule), `arc-node/`, and the
`*-roles.json/.txt` / `microsoft-*` crawl artefacts at the root.

## Pages (`app/**/page.tsx`)

Public: `/`, `/jobs`, `/jobs/[...id]`, `/explore-jobs`, `/companies`,
`/companies/[slug]`, `/companies/[slug]/intelligence`, `/recruiters`, `/news`,
`/pricing`, `/docs/[[...path]]`, `/login`, `/signup`, `/forgot-password`,
`/reset-password`, `/profile/[username]`, `/resume`, `/resume-builder`,
`/linkedin-insight`, `/ai-interview`.
Signed-in (middleware-gated): `/dashboard`, `/dashboard/contacts`,
`/dashboard/contacts/[id]`, `/profile`, `/settings`. Also `/preferences`,
`/admin/analytics` (admin check server-side in its API), `/toast-demo` (demo page).

## API routes (`app/api/**/route.ts`)

| Route | Methods | Auth | Notes |
|---|---|---|---|
| `jobs`, `search`, `smart-search`, `jobs/delta`, `companies`, `companies/[slug]`, `company-intelligence` | GET | public | `guard()` rate limit; read the deployed index |
| `recruiters` | GET | public | `guard(PUBLIC_READ)` added 2026-10-02 |
| `analytics/events` | POST, GET | public | `guard()`; first-party events |
| `admin/analytics` | GET | admin | `requireAdmin` |
| `resume/build`, `resume/match` | POST | public | rate-limited |
| `analyze-resume`, `parse-resume`, `upload-resume` | POST | user | service role scoped to caller |
| `linkedin-insight` | POST, GET | user | schema-validated |
| `ai-interview/*` | GET, POST | user | `getOwnedInterview(id, user.id)` |
| `contacts/discover` | POST | **public by design** | domain validated + rate-limited (2026-10-02) |
| `contacts/bulk-discover`, `contacts/export`, `contacts/lists*`, `contacts/reveal*` | various | user | |
| `request-otp`, `verify-otp-reset` | POST | public | OTP password reset, rate-limited |
| `generate-magic-link` | POST | public | emails a recovery link (fixed 2026-10-02; used to return it) |
| `stripe/create-checkout-session` | POST | user | |
| `stripe/webhook` | POST | Stripe signature | `constructEvent` + idempotency ledger |
| `stripe/debug/*` | POST, GET | none | 404 in production unless `ENABLE_STRIPE_DEBUG_ROUTES=true` |
| `docs/[...path]` | all | public | 404 unless `DOCS_PROXY_ORIGIN` is set (2026-10-02) |

## Commands

| Command | Does |
|---|---|
| `npm test` | All 69 assertion suites (offline; network suites excluded) |
| `npx tsc --noEmit` | Typecheck. Locally, the untracked sibling folders are inside `**/*.ts` and add ~22,900 errors plus an out-of-memory crash; see AUDIT-2026.md §6. |
| `npx tsx scripts/ingest-v2.mjs --only <slugs>` | Crawl named employers into `public/data/jobs-v2.json` (gitignored, not served) |
| `node scripts/discover-ats.mjs targets.json` | Find and verify an employer's ATS board |
| `npm run build` | Production build (`ignoreBuildErrors: false`) |
