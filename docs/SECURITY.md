# Security

A full security audit was carried out on 10 September 2026 against the whole
app-specific codebase (163 files / ~25k lines). Every finding was reproduced
against the code rather than inferred, and the fixes are committed on top of a
`Baseline` commit so each is reversible and diffable.

The complete write-up — with the offending code, the mechanism, and the fix for
each — is in **[AUDIT-2026.md](../AUDIT-2026.md)**. This page is the standing
threat model and the current posture.

## What was fixed

### Authentication and identity

| | |
|---|---|
| **Password reset changed the wrong user's password** | `supabase.auth.admin.listUsers({ email })` accepts only `{ page, perPage }`. The unknown `email` key was ignored, so the call returned the first page of *every user in the project* and reset `users[0]` — in practice the oldest account. An attacker requested an OTP for their own address, received it legitimately, submitted it, and a different account's password changed. Addresses are now resolved properly, paginating and matching case-insensitively. |
| **OTP verification had no rate limit** | `request-otp` was throttled; verification was not. A 6-digit code is 10⁶ wide. Added per-email and per-IP limits, an `attempts` counter that burns the code after 5 failures, and a timing-safe compare. |
| **OTPs came from `Math.random()`** | Predictable, and this is an account-recovery secret. Now `crypto.randomInt`. |
| **Four endpoints trusted a client-supplied `userId` while holding the service-role key** | The service-role key bypasses RLS, so this allowed uploading a resume into anyone's account, reading or overwriting anyone's analysis, and opening a checkout session against any account (leaking that user's email). Identity now comes from a verified Supabase JWT via `lib/api-auth.ts`, plus an explicit ownership check on the resume row. |
| **Password policy capped at 20 characters** | Rejected ordinary passphrases and anything a password manager generates. NIST SP 800-63B asks for ≥64 accepted; now 128. |

### Request forgery and redirects

| | |
|---|---|
| **SSRF in resume parsing** | `/api/parse-resume` fetched a caller-supplied `fileUrl` directly, making the server a proxy for anything it could reach — cloud instance metadata at `169.254.169.254` (which hands out credentials), internal services, `localhost`. `lib/safe-fetch.ts` now resolves the host and rejects private, link-local, CGNAT and multicast targets, **refuses redirects** (a 302 would otherwise sidestep the check), and caps size and time. 22 regression tests. |
| **Open redirect in checkout** | `success_url` was built from the request's `origin` header. Now validated against an allow-list. |
| **Unauthenticated Stripe debug routes** | `debug/validate` leaked Stripe configuration; `debug/create-session` drove the Stripe API with an arbitrary `price_id` and an attacker-controlled `origin`. Both 404 outside development. |

### Uploads

Previously no size limit, no content sniffing, and a path-traversal vector —
`file.name` went straight into the storage path. Now 10 MB, magic-byte
validation, sanitised names, and orphan cleanup if the DB insert fails.

### Integrity

| | |
|---|---|
| **`analyze-resume` fabricated results** | When Gemini failed it substituted a hard-coded "score 70" analysis and saved it as though the model had produced it. A user acts on advice nobody generated and the failure is invisible. Now returns 503 and marks the row failed. |
| **`/api/jobs` returned invented postings** | On upstream failure it returned three fabricated jobs with `success: true` and a link to a board that did not contain them — users could apply to jobs that do not exist. Failures are now reported as failures. |
| **Stripe webhooks had no idempotency** | Stripe retries and can redeliver. Added `stripe_webhook_events`. |

## Standing threat model

**Trust boundaries**

1. **Browser → API.** Every authenticated route resolves identity from a
   verified Supabase JWT. Never from the request body.
2. **API → Supabase.** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and is
   server-only. Any handler holding it must do its own ownership check —
   RLS will not save you there.
3. **API → the open internet.** Ingestion and resume parsing both fetch
   attacker-influenceable URLs. Everything goes through `lib/safe-fetch.ts` or
   the hardened `lib/sources/http.ts`.
4. **Stripe → API.** Webhook signatures verified; events deduplicated.

**Data sensitivity.** Resumes are the crown jewels — they carry name, address,
employment history and contact details. They live in Supabase storage behind RLS
policies, and the ownership check on `upload-resume`/`analyze-resume` is what
enforces it, because those routes hold the service-role key.

## Open issues

Ordered by what I would fix first.

1. **`ignoreBuildErrors` and `ignoreDuringBuilds` are still on** in
   `next.config.mjs`. They hid two critical bugs — the build failure and the
   Stripe webhook crash — both of which TypeScript had already flagged. This is
   the single highest-value change available. 51 errors remain, 29 in a vendored
   sub-project the app does not use.
2. **Next.js 14.2.16 (Oct 2024).** The 2026 releases fixed middleware/proxy
   **auth bypass**, SSRF, cache poisoning, and an unauthenticated RCE on Windows
   (CVE-2026-75604). This app has no middleware-based auth today, which limits
   exposure, but the version gap is large.
3. **No server-side route protection.** `middleware.ts` only proxies `/docs`.
   `/dashboard`, `/profile` and `/settings` rely on client-side checks alone —
   which protect the UI, not the data.
4. **Rate limiting is per-process.** `lib/rate-limit.ts` uses an in-memory map,
   so on serverless each instance has its own. It is a speed bump, not a
   guarantee — and it is the control protecting password reset. Upstash Redis is
   the fix.
5. **No CI.** Nothing runs the tests, the typecheck or a dependency audit on
   push.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.

## References

- [Supabase `listUsers` reference](https://supabase.com/docs/reference/javascript/auth-admin-listusers)
- [Stripe: deprecate subscription `current_period_start/end`](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end)
- [Next.js August 2026 security release](https://nextjs.org/blog/august-2026-security-release) · [July 2026](https://nextjs.org/blog/july-2026-security-release)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)
