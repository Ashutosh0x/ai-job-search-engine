# JobSpark AI — audit and remediation, 10 Sep 2026

Full read of the app-specific code (163 files / ~25k lines; `components/ui/*`
shadcn boilerplate skimmed). Everything below was reproduced against the code,
not inferred. Fixes are committed on top of a `Baseline` commit so every change
is reversible and diffable.

**Verification of the whole change set**

| check | before | after |
|---|---|---|
| `npx tsc --noEmit` | 66 errors | **51** (0 introduced, 15 fixed) |
| `npx next build` | **fails — ENOENT** | **succeeds** |
| `scripts/test-job-matching.mjs` | — | **20/20 pass** |

---

## 1. Critical — security

### 1.1 Password reset changed the *wrong user's* password
`app/api/verify-otp-reset/route.ts`

```ts
const { data: userData } = await supabase.auth.admin.listUsers({ email });
const userId = userData.users[0].id;          // ← arbitrary user
```

`listUsers()` accepts only `{ page, perPage }`. Unknown keys are ignored, so
this returned **the first page of every user in the project** and reset
`users[0]` — in practice the oldest account. An attacker requests an OTP for
their own address, receives it legitimately, submits it, and the password of a
different account is changed.

Fixed by resolving the address properly (`lib/supabase-admin.ts`, paginating and
matching case-insensitively).

### 1.2 The OTP endpoint had no rate limit
Same file. `request-otp` was throttled; **verification was not**. A 6-digit code
is 10⁶ wide — trivially enumerable. Added per-email and per-IP limits, an
`attempts` counter that burns the code after 5 failures, a timing-safe compare,
and server-side password-policy enforcement. OTPs now come from
`crypto.randomInt`, not `Math.random()` (predictable, and this is an
account-recovery secret).

### 1.3 Four endpoints trusted a client-supplied `userId` while holding the service-role key
`upload-resume`, `analyze-resume`, `parse-resume`, `stripe/create-checkout-session`

```ts
const userId = formData.get('userId') as string   // ← from the request body
```

The service-role key bypasses RLS, so this allowed uploading a resume into
anyone's account, reading/overwriting anyone's analysis, and opening a checkout
session against any account (which also leaked that user's email). Identity now
comes from a verified Supabase JWT — `lib/api-auth.ts` — plus an explicit
ownership check on the resume row.

### 1.4 SSRF in resume parsing
`app/api/parse-resume/route.ts` fetched a caller-supplied `fileUrl` directly.
That makes the server a proxy for anything it can reach — cloud instance
metadata at `169.254.169.254` (which hands out credentials), internal services,
`localhost`. `lib/safe-fetch.ts` now resolves the host and rejects
private/link-local/CGNAT/multicast targets, refuses redirects (a 302 would
otherwise sidestep the check), and caps size and time.

### 1.5 Unauthenticated Stripe debug routes
`stripe/debug/validate` (GET) leaked Stripe configuration; `stripe/debug/create-session`
(POST) drove the Stripe API with an arbitrary `price_id` and an
attacker-controlled `origin`. Both now 404 outside development.

### 1.6 Open redirect in checkout
`success_url` was built from the request's `origin` header. Now validated
against an allow-list.

---

## 2. Critical — the app could not build, and billing was broken

### 2.1 `next build` failed outright
`pdf-parse@1.1.1`'s `index.js` runs a debug branch guarded by `!module.parent`,
which webpack always makes true. It reads `./test/data/05-versions-space.pdf`,
a fixture the package doesn't ship, so the build died with `ENOENT` collecting
page data for `/api/parse-resume`. Importing `pdf-parse/lib/pdf-parse.js`
bypasses the wrapper. **The build now succeeds.**

### 2.2 Every Stripe subscription webhook crashed
Stripe's Basil release (2025-03-31) removed `current_period_start/end` from the
subscription object and moved them onto subscription items. The handler read the
old fields, got `undefined`, and called
`new Date(undefined * 1000).toISOString()` — a `RangeError`. So
`customer.subscription.created/updated` failed every time and **paid
subscriptions were never recorded**.

Also added: webhook idempotency (Stripe retries and can redeliver; there was no
dedup), the missing `checkout.session.completed` handler, and `invoice.subscription`
read from its new location.

> Both of these were already visible to TypeScript. `next.config.mjs` sets
> `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`,
> which is why they shipped. **That is the root cause worth fixing first** —
> turning those off is how you stop the next one.

---

## 3. The job search and recommendation engine

### 3.1 The "engine" was dead code
`JobMatchingEngine` was never imported anywhere. The product's headline feature
did not run.

### 3.2 `/api/jobs` was not a job search
It was hard-coded to a single Greenhouse board (`boards/cloudflare`) and ignored
the `jobs` table the rest of the app reads and writes. On failure it returned
**three invented postings** — "Software Engineer, San Francisco" et al. — with
`success: true` and a link to a board that doesn't contain them. Users could
apply to jobs that don't exist.

Rewritten to search the `jobs` table with filters (`q`, `location`, `workType`,
`type`), sorting and pagination, and to report failure as failure.

### 3.3 Five scoring defects, each with a regression test
`lib/job-scoring.ts` (pure, extracted from the DB client so it is testable):

| defect | effect |
|---|---|
| **Weights never renormalised** | Weights were added only when a field existed, but the total was never rescaled. A job with no salary listed could not score above 85; missing salary *and* location capped at 65. Sparse postings were ranked below rich ones regardless of fit. |
| **Skill ratio could exceed 100%** | Matches were counted from the *user's* skills but divided by the *job's* requirement count. A user listing "React" and "React Native" scored 200% on one required "React". |
| **Division by zero → NaN** | An empty requirements array produced `NaN`, which propagated into the final score. |
| **Salary parsed wrong by 1000×** | `parseInt(x.replace(/[$,k]/gi,'')) * 1000` stripped the "k" *before* testing for it and multiplied unconditionally: `"$50,000"` became **50,000,000**. |
| **Location distance was fabricated** | `calculateLocationDistance` returned a constant `50` for any non-substring match, which fell into the `< 100` branch and awarded every unrelated location a flat 75/100 "within reasonable distance". |

Also fixed: `"Java"` no longer satisfies a `"JavaScript"` requirement (the old
bidirectional `includes()` meant `"R"` matched almost everything), while `"JS"`
now does via a small explicit alias table. `"York"` no longer matches
`"New York"`.

### 3.4 No retrieval stage
`getRecommendedJobs` did `select('*')` over the entire `jobs` table with no
limit and scored every row in memory on every request. Now a bounded, filtered,
ordered candidate pull (stage 1) followed by ranking over that shortlist
(stage 2) — the standard two-stage recommender shape.

---

## 4. Other correctness fixes

- **`analyze-resume` fabricated results.** When Gemini failed it substituted a
  hard-coded "score 70" analysis and saved it as though the model produced it.
  A user acts on advice nobody generated and the failure is invisible. It now
  returns 503 and marks the row failed.
- **`analyze-resume` could never mark a failure.** Its `catch` block called
  `await request.json()` a second time to recover `resumeId`. A request body is
  a single-use stream, so that always threw.
- **The model was retired.** `gemini-1.5-pro` was hard-coded; the 1.5 series is
  long gone (even 2.5 Pro retires 16 Oct 2026). Every analysis was silently
  falling through to the fabricated fallback above. Now `GEMINI_MODEL`,
  defaulting to `gemini-2.5-flash`.
- **Invalid regex anchor.** Resume section parsing ended with `(?:\n\n|\Z)`.
  JavaScript has **no `\Z` anchor** — it's parsed as a literal `Z`, so a section
  running to end-of-document only terminated if it happened to contain a capital
  Z. Also relaxed the name regex, which required the document to begin at
  character zero with no leading whitespace (most PDF extractions don't).
- **Password policy capped at 20 characters**, rejecting ordinary passphrases
  and anything a password manager generates. NIST SP 800-63B asks for ≥64
  accepted; now 128. The strength meter also never showed 0% (an empty password
  rendered a 20%-filled bar).
- **Uploads had no size limit, no content sniffing, and a path-traversal vector**
  (`file.name` went straight into the storage path). Now 10 MB, magic-byte
  validation, sanitised names, and orphan cleanup if the DB insert fails.

---

## 5. Recommended next — not done, and why

These are design changes rather than bug fixes, so I've left them for a
decision rather than making it unilaterally.

1. **Turn off `ignoreBuildErrors`.** The single highest-value change. It hid two
   critical bugs. 51 errors remain; they're pre-existing and concentrated in
   `countries-states-cities-database/prisma/seed.ts` (29, an unused vendored
   sub-project), `dashboard.tsx`, and `lib/auth-service.ts`.
2. **Upgrade Next.js.** `14.2.16` is from Oct 2024. Current is 15.5.24 / 16.3.3.
   The 2026 releases fixed middleware/proxy **auth bypass**, SSRF, cache
   poisoning and an unauthenticated RCE on Windows (CVE-2026-75604). This app
   has no `middleware`-based auth today, which limits exposure, but the gap is
   large.
3. **Structured salary/experience columns.** `jobs.salary` and `jobs.experience`
   are free **text**, which is why parsing is guesswork. `salary_min_cents`,
   `salary_max_cents`, `currency`, `experience_min_years` would make matching
   exact and let filtering move into Postgres.
4. **Hybrid retrieval.** Current practice for job relevance is BM25 lexical +
   vector semantic, fused with Reciprocal Rank Fusion. In Postgres that's
   `pg_textsearch`/ParadeDB `pg_search` alongside `pgvector`. `lib/job-scoring.ts`
   is deliberately pure so it can become the reranker over such a retrieval
   stage. LinkedIn's own published approach is a two-tower embedding retrieval
   feeding a contextual reranker — same shape.
5. **Move rate limiting to Upstash Redis.** `lib/rate-limit.ts` is per-process;
   on serverless each instance has its own map. It's a speed bump, not a
   guarantee, and it's the control protecting password reset.
6. **No server-side route protection.** `middleware.ts` only proxies `/docs`.
   `/dashboard`, `/profile`, `/settings` rely on client-side checks alone.
7. **Add CI.** No test runner, no lint gate, no typecheck in the repo. The
   matching tests are a start (`node --experimental-strip-types scripts/test-job-matching.mjs`).

## 6. Follow-up audit, 2 Oct 2026

Scope: the 112 commits since this audit (`f3412f7..ab1f387`, ~39k lines), plus
a fresh access-control pass over all 37 API routes (auth call, service-role
use, rate limit, input schema). Index of the codebase:
[docs/REPOSITORY_INDEX.md](docs/REPOSITORY_INDEX.md),
[docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md). Backlog:
[docs/IMPROVEMENT_BACKLOG.md](docs/IMPROVEMENT_BACKLOG.md).

### 6.1 Critical: `/api/generate-magic-link` handed out account-takeover links (FIXED)

`app/api/generate-magic-link/route.ts` called
`supabase.auth.admin.generateLink({ type: 'recovery', email })` with the
service-role key for **any email in the request body** and returned
`{ link: action_link }`; `components/auth-form.tsx` rendered it as a clickable
"reset your password" link. A recovery link signs its holder in as that user.
The only gates were Cloudflare Turnstile (any human passes) and per-email/IP
in-memory limits, so typing a victim's address was enough to take over the
account. Present since the pre-audit baseline (`fcaa23c`).

Fix: the route now calls `auth.resetPasswordForEmail(email, { redirectTo })`,
which mails the same link to the address, validates the email, and always
answers with the same generic message, so it no longer reveals which accounts
exist. The form shows that message instead of a link.

Verified: `scripts/test-auth-link-exposure.mjs` (registered in `npm test`)
fails if any API route calls `admin.generateLink` or references `action_link`,
or if the form renders a returned link. It passes on the fix and **fails 4/5
checks when run against the original two files**.

Not verified: real mail delivery. It needs Supabase SMTP configured; the
default Supabase mailer is rate-limited. Behaviour changes for users: the link
now arrives by email instead of on screen, which is the point.

Production exposure (checked 2026-10-02): the Vercel project
`ai-job-search-engine` has **no environment variables**
(`vercel env ls`: none). Without `SUPABASE_SERVICE_ROLE_KEY` the route answered
503 before reaching `generateLink`, and without `TURNSTILE_SECRET_KEY` the CAPTCHA
check fails closed, so this was not exploitable on the deployed site. It would
have become exploitable the moment Supabase was configured. The SSRF in §6.2
needs no configuration and **was** reachable in production.

### 6.2 High: SSRF through `/api/contacts/discover` (FIXED)

The route is anonymous by design (`lib/contacts/client.ts`: "Anonymous callers
are allowed here"; the extension calls it without a session). Its `domain` was
interpolated into `https://www.${domain}${path}` (`lib/contacts/scraper.ts`),
`https://${domain}` and DNS queries (`lib/contacts/sources/public-records.ts`).
`domain = "evil.com@10.0.0.5"` makes `www.evil.com` the URL's userinfo and
10.0.0.5 the host, so an unauthenticated caller chose the server's fetch
target; ports, paths and IP literals worked too. Impact on Vercel is limited (no
instance-metadata credentials), but it was an open outbound-request proxy with
5+ fetches per call and no rate limit.

Fix: `lib/contacts/domain.ts` `normalizePublicHostname()` accepts only a plain
public DNS name (LDH labels, at least two labels, alphabetic or punycode TLD,
no IPs, ports, paths, userinfo or internal suffixes). It is enforced at the
single entry point `discoverContact()` (`lib/contacts/enricher.ts`), covering
every downstream sink, and in both route schemas (`discover`,
`bulk-discover`) so callers get a 400. `/api/contacts/discover` now has
`guard(10/min)`. Verified by `scripts/test-contact-domain.mjs` (34 cases, in
`npm test`).

DNS rebinding and redirects (closed in the release pass the same day): the two
domain-driven fetches (careers scraper, security.txt) now use
`fetchPublicFollowingRedirects` (`lib/safe-fetch.ts`). It follows up to 5
redirects and re-runs `assertPublicHttpUrl` (DNS-resolved addresses checked
against private, loopback, link-local and metadata ranges) before every hop.
Verified by `scripts/test-safe-fetch-redirects.mjs` (13 cases). Residual: a
rebinding DNS server with a near-zero TTL can still race between the check and
fetch's own resolution; closing that needs a connection pinned to the checked
address (backlog B-4).

### 6.3 Low: `/api/docs/*` proxied to localhost when unconfigured (FIXED)

The proxy's own comment says an unset `DOCS_PROXY_ORIGIN` means "off", and the
middleware only rewrites when it is set, but the route was reachable directly
and forwarded any method and body to the default `http://localhost:3001`. It
now answers 404 unless `DOCS_PROXY_ORIGIN` is set.

### 6.4 Low: `/api/recruiters` was the only unthrottled public read (FIXED)

It serves the recruiter directory (people's work contact details). It now has
`guard(PUBLIC_READ)` like the other public reads. Per-process limiter caveat in
`lib/api-guard.ts` applies.

### 6.5 Checked and found sound

- `ai-interview/*`: every read and write goes through
  `getOwnedInterview(id, user.id)` or `.eq('user_id', auth.user.id)`.
- `stripe/webhook`: `constructEvent` signature check plus an `event.id`
  idempotency table. Note: if the idempotency insert fails it processes anyway
  (logged), a deliberate availability-over-dedupe choice.
- `stripe/debug/*`: 404 in production unless `ENABLE_STRIPE_DEBUG_ROUTES=true`.
- `admin/analytics`: `requireAdmin`.
- Extension `onMessage`: only same-extension tab senders; `onMessageExternal`:
  two read-only message types, http(s) origins only.

### 6.6 Open (not fixed; decisions or larger work)

| Severity | Issue | Evidence |
|---|---|---|
| Medium | Rate limiting is per-process, so it does not bound distributed abuse of password reset, OTP or contact discovery | `lib/api-guard.ts` header (measured 46/46 allowed in prod) |
| Medium | Lint never runs: no ESLint config (`next lint` stops at its setup prompt) and `ignoreDuringBuilds: true` | baseline run, `next.config.mjs:4` |
| Low | Extension `externally_connectable` includes `http://localhost/*` in the shipped manifest, so any local page on any port can read the last captured LinkedIn profile | `chrome-extension/manifest.json` |
| Low | Extension calls `bulk-discover` without a session, so it always gets 401 | `chrome-extension/background.js:154`, route requires `getUser()` |
| Info | Local typecheck is unusable: `tsconfig.json` includes `**/*.ts`, which sweeps in the untracked sibling projects (22,898 of 22,920 errors) and runs out of memory. CI is unaffected (they are not committed). | baseline |

### 6.7 Verification for this follow-up

| Check | Before | After |
|---|---|---|
| `npm test` | 63/63 suites, 2,382 assertions, 0 failed | **65/65 suites, 2,421 assertions, 0 failed** |
| `tsc --noEmit` (repo config) | out-of-memory crash (exit 134); with 8 GB heap, 22,920 errors, all but 2 from untracked folders | unchanged locally (environmental) |
| `tsc --noEmit` excluding the untracked folders (temporary config) | not run | **0 errors** |
| `next lint` | not configured (exit 1) | unchanged |
| `next build` | not run locally (disk nearly full) | not run; CI runs it |

## Sources

- [Stripe: deprecate subscription current_period_start/end](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
- [Next.js August 2026 security release](https://nextjs.org/blog/august-2026-security-release) ·
  [July 2026](https://nextjs.org/blog/july-2026-security-release) ·
  [CVE-2026-23869](https://vercel.com/changelog/summary-of-cve-2026-23869)
- [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations) ·
  [Models](https://ai.google.dev/gemini-api/docs/models)
- [Supabase listUsers reference](https://supabase.com/docs/reference/javascript/auth-admin-listusers)
- [Hybrid search in PostgreSQL (ParadeDB)](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) ·
  [pg_textsearch / BM25](https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres)
- [LinkedIn: Learning to Retrieve for Job Matching](https://arxiv.org/pdf/2402.13435) ·
  [Two-tower retrieval (Google Cloud)](https://docs.cloud.google.com/architecture/implement-two-tower-retrieval-large-scale-candidate-generation)
