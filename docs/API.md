# API reference

All handlers run on the Node runtime (`export const runtime = 'nodejs'`).

**Failures are reported as failures.** No endpoint substitutes plausible-looking
placeholder data when a dependency is down — an earlier version of `/api/jobs`
returned three invented postings with `success: true` and a link to a board that
did not contain them, which meant users could apply to jobs that did not exist.
When the index is missing you get a `503` and a hint telling you how to build it.

---

## Search

### `GET /api/smart-search`

Natural-language search. The sentence becomes structured constraints, those
become real filters, and what survives is ranked by the explainable 100-point
scorer ([SEARCH.md](SEARCH.md)).

| param | type | notes |
|---|---|---|
| `q` | string | **required**; 400 if empty |
| `page` | int | default 1 |
| `pageSize` | int | default 20, capped at 50 |
| `debug` | `1` | adds the full per-signal score breakdown |

```bash
curl 'localhost:3000/api/smart-search?q=senior%20ML%20engineer%20in%20Bangalore%20with%20visa%20sponsorship&debug=1'
```

Response keys: `success`, `query`, `understood`, `intent`, `total`, `page`,
`pageSize`, `totalPages`, `tookMs`, `generatedAt`, `jobs`.

Two of those a conventional search API does not give you:

- **`understood`** — an array of plain-language phrases saying how the query was
  read, so a misreading is visible and correctable rather than silent. (The
  internal value is called `intentSummary`; `understood` is the wire name.)
- **`matchReasons`** — per-result badges naming what actually earned the rank.

`intent` carries the structured parse, including `facets[]` — each with the
exact `matched` span it was read from and a confidence.

```jsonc
// ?q=senior ML engineer in Bangalore with visa sponsorship posted this week
"understood": [
  "matching \"ml engineer\"", "senior level", "in Bangalore",
  "using machine learning", "with visa sponsorship", "posted in the last 7 days"
]
```

Each job carries: `id`, `title`, `company`, `companySlug`, `location`, `city`,
`country`, `remote`, `workplace`, `seniority`, `skills`, `salaryMin`/`Max`/
`Currency`, `postedAt`, `visaStatus`, `visaEvidence`, `applyUrl`,
`isDirectApplication`, `source`, `score`, `matchReasons`.

### `GET /api/search`

Faceted search with company-level filters. Every facet count is computed over
the *filtered* set, so the number next to each filter is what you would actually
get.

| param | type | notes |
|---|---|---|
| `q` | string | free text |
| `location` | string | |
| `remote` | `true` | |
| `valuationTier` | csv | company worth, not headcount |
| `minValuation` | number | USD |
| `minOpenRoles` | number | hiring momentum |
| `postedWithinDays` | number | **real** freshness — a posting with no date is *excluded*, not assumed fresh |
| `department` | csv | |
| `city`, `country` | csv | |
| `company` | csv | registry slugs |
| `provider` | csv | `workday`, `greenhouse`, `ashby`, … |
| `employmentType` | csv | |
| `minSalary` | number | |
| `sort` | string | |
| `page`, `pageSize` | int | |

The filters that no major board offers are the point:

- **`valuationTier` / `minValuation`** — "only companies worth $10B+", or the
  inverse, "only pre-unicorn". LinkedIn and Indeed expose company *size*
  (headcount) but not company *value*, so you cannot separate a 500-person
  unicorn from a 500-person agency.
- **`minOpenRoles`** — a company with 600 open roles is in a different phase
  from one with three, and that is invisible when looking at a single posting.
- **`provider`** — a decent proxy for how the application process will go.

### `GET /api/jobs`

Search over the Supabase `jobs` table (as opposed to the ingested snapshot),
with filtering, sorting and pagination. `MAX_PAGE_SIZE` 50, default 20.

Params: `q`, `location`, `workType`, `type`, plus sort and pagination.

---

## Companies

### `GET /api/companies`

Every verified company, richest first. Returns `total`, `totalOpenRoles`, and
per company: slug, name, domain, logo, industry, HQ, founding year, open roles,
valuation (`valuationUsd`, `valuationKind`, `valuationTier`, `valuationAsOf`,
`valuationSource`), ticker and `atsProviders`.

`503` with a hint if the index has not been built.

### `GET /api/companies/[slug]`

One company with its open roles.

---

## Resume

### `POST /api/upload-resume`

Multipart upload. 10 MB cap, magic-byte content sniffing, sanitised filenames,
and orphan cleanup if the DB insert fails afterwards.

### `POST /api/parse-resume`

Extracts structured fields. Any caller-supplied `fileUrl` goes through
`lib/safe-fetch.ts`, which resolves the host and rejects private, link-local,
CGNAT and multicast targets, **refuses redirects** (a 302 would otherwise
sidestep the check), and caps size and time.

### `POST /api/analyze-resume`

Gemini-backed analysis. Model is configurable via `GEMINI_MODEL`, defaulting to
`gemini-2.5-flash`.

**On model failure this returns `503` and marks the row failed.** It previously
substituted a hard-coded "score 70" analysis and saved it as though the model had
produced it — so a user acted on advice nobody generated, and the failure was
invisible.

---

## Auth

### `POST /api/request-otp` · `POST /api/verify-otp-reset`

Password reset by one-time code. Both are rate limited — per email *and* per IP.
`verify` was previously unthrottled, which matters because a 6-digit code is only
10⁶ wide and therefore trivially enumerable.

Also: an `attempts` counter burns the code after 5 failures, comparison is
timing-safe, password policy is enforced server-side, and codes come from
`crypto.randomInt` rather than `Math.random()` — this is an account-recovery
secret, and `Math.random()` is predictable.

### `POST /api/generate-magic-link`

---

## Billing

### `POST /api/stripe/create-checkout-session`

Identity comes from a **verified Supabase JWT** (`lib/api-auth.ts`), never from a
client-supplied `userId`. `success_url` is validated against an allow-list —
building it from the request's `origin` header was an open redirect.

### `POST /api/stripe/webhook`

Handles `checkout.session.completed` and the `customer.subscription.*` events,
with **idempotency** (Stripe retries and can redeliver).

Reads `current_period_start/end` from **subscription items**, where Stripe's
Basil release (2025-03-31) moved them. Reading the old top-level fields yielded
`undefined`, and `new Date(undefined * 1000).toISOString()` threw a `RangeError`
— so every subscription webhook crashed and paid subscriptions were never
recorded.

### Debug routes

`GET /api/stripe/debug/validate` and `POST /api/stripe/debug/create-session`
**404 outside development**. They previously leaked Stripe configuration and
drove the Stripe API with an arbitrary `price_id` and an attacker-controlled
`origin`.

---

## Docs proxy

### `/api/docs/[...path]` — `GET POST PUT PATCH DELETE`

Proxies the Mintlify docs site. `middleware.ts` rewrites `/docs/*` here **in
production only**; in development that would collide with Next's HMR across two
dev servers.

---

## Authentication model

Four endpoints — `upload-resume`, `analyze-resume`, `parse-resume` and
`stripe/create-checkout-session` — previously read a `userId` straight out of the
request body **while holding the service-role key**. That key bypasses RLS, so it
allowed uploading a resume into anyone's account, reading or overwriting anyone's
analysis, and opening a checkout session against any account (which also leaked
that user's email).

Identity now comes from a verified Supabase JWT via `lib/api-auth.ts`, plus an
explicit ownership check on the resume row.

> **Still open:** `middleware.ts` only proxies `/docs`. `/dashboard`, `/profile`
> and `/settings` rely on client-side checks alone. Rate limiting is also
> per-process (`lib/rate-limit.ts`), so on serverless each instance keeps its own
> map — a speed bump, not a guarantee.
