# Codebase map

How the parts call each other. Paths are real; follow them rather than these
summaries when they disagree. Snapshot 2026-10-02.

## 1. Job data: crawl -> index -> search

```
.github/workflows/refresh-jobs.yml (15 min / 3 h / nightly)   daily-publish.yml (05:00 UTC)
        |                                                           |
scripts/ingest-v2.mjs                                       builds + verifies shards
        |  for each lib/companies/registry.ts board               scripts/verify-deploy-index.mjs
        v                                                   (refuses an index that shrank)
lib/sources/registry.ts --(SourceId)--> lib/sources/adapters/<provider>.ts
        |   (greenhouse, lever, ashby, workday, successfactors, smartrecruiters, recruitee, oracle, ...)
        v
lib/pipeline/*  normalise -> dedupe -> early-career classify -> quality score
        v
public/data/jobs-deploy*.json  (committed shards; what production serves)
        v
lib/job-index.ts  loadIndex() -> searchJobs()
        v
app/api/{jobs,search,smart-search,jobs/delta,companies*,company-intelligence}/route.ts
        (each behind lib/api-guard.ts guard())
        v
app/jobs, app/explore-jobs, app/companies pages
```

Rules that fail silently when broken (from `docs/INGESTION.md`): a provider
needs both a `SourceId` and an adapter registration; board tokens come from
`scripts/discover-ats.mjs`, never guesses; `--only` writes `jobs-v2.json`, which
is not served.

## 2. Accounts and sessions

```
components/auth-form.tsx --> supabase.auth (password / Google / LinkedIn OAuth)
                         \-> /api/generate-magic-link --> auth.resetPasswordForEmail (email only)
app/forgot-password --> /api/request-otp --> otp_resets table --> /api/verify-otp-reset
                                                                     --> auth.admin.updateUserById(owner of OTP)
middleware.ts  gates /dashboard, /profile, /settings (redirect to /login)
lib/api-auth.ts requireUser()  gates API routes (bearer or cookie)
```

## 3. Resume and matching

```
app/resume, app/resume-builder
  -> /api/upload-resume, /api/parse-resume   (requireUser; remote URLs via lib/safe-fetch.ts)
  -> /api/analyze-resume                     (requireUser; Gemini)
  -> /api/resume/match, /api/resume/build    (public, rate-limited) -> lib/job-matching.ts, lib/job-scoring.ts
```

## 4. Contacts and recruiters

```
lib/contacts/client.ts, chrome-extension/background.js
  -> /api/contacts/discover (anonymous) -> lib/contacts/enricher.ts discoverContact()
        domain := normalizePublicHostname(...)   <- lib/contacts/domain.ts (single choke point)
        -> pattern-source (directory / GitHub), email-patterns, scraper (careers pages),
           sources/public-records (DNS TXT/SOA, RDAP), verify
  -> /api/contacts/bulk-discover (signed in) -> same, then lib/contacts/persist.ts
  -> /api/contacts/{reveal,lists,export}     (signed in, per-user)
scripts/build-recruiter-directory.mjs (recruiter-directory.yml)
  -> public/data/recruiter-directory.json -> /api/recruiters (public, guard)
```

## 5. AI features

| Feature | Entry | Model call | Trust boundary |
|---|---|---|---|
| Resume analysis | `/api/analyze-resume` | Gemini | resume text is untrusted input |
| LinkedIn Insight | `/api/linkedin-insight` -> `lib/linkedin/analyzer.ts` | Gemini, output parsed against a schema | client-supplied profile is not trusted (`ab1f387`) |
| AI interview | `/api/ai-interview/*` -> `lib/ai-interview/interviewer.ts` | Gemini, with deterministic fallbacks | sessions scoped by `user_id` |

## 6. Payments

`/api/stripe/create-checkout-session` (requireUser) -> Stripe Checkout ->
`/api/stripe/webhook` (`constructEvent` with `STRIPE_WEBHOOK_SECRET`, idempotency
table) -> `user_subscriptions`.

## 7. Browser extension

`chrome-extension/manifest.json` (MV3, `storage` only, host `*.linkedin.com`).
Content script on LinkedIn stores the latest profile in `chrome.storage.session`;
`onMessage` accepts only same-extension tab senders; `onMessageExternal` answers
`ping` and `get-linkedin-profile` to the web app origins listed in
`externally_connectable` (includes `http://localhost/*`; see AUDIT-2026.md §6).
