# Development

## Requirements

- Node.js 20+ (developed against 26)
- A Supabase project
- Optional: Google AI (Gemini), Stripe, Resend keys — the app degrades to
  explicit errors without them rather than faking success

## Setup

```bash
git clone --recurse-submodules https://github.com/Ashutosh0x/ai-job-search-engine.git
cd ai-job-search-engine
npm install
cp env.example .env.local
npm run dev
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

The submodule is [`dr5hn/countries-states-cities-database`](https://github.com/dr5hn/countries-states-cities-database),
used by the location seed scripts. It is a large repo; skip it if you are not
seeding location tables.

## Environment

```ini
# Supabase — the only hard requirement
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-only; bypasses RLS

# Google AI — resume analysis
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash    # optional override

# Email
RESEND_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_BASIC_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_PREMIUM_PRICE_ID=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`.env*` is gitignored. Never commit real keys — `SUPABASE_SERVICE_ROLE_KEY`
bypasses row-level security entirely.

## Building the index

The app needs a job index before search returns anything.

```bash
npx tsx scripts/ingest-v2.mjs --limit 40      # quick first run
npx tsx scripts/ingest-v2.mjs                 # full corpus, ~20 min
```

Writes `public/data/jobs-v2.json` and `.ingest-state.json`, both gitignored.
Details in [INGESTION.md](INGESTION.md).

## Tests

14 suites, 262 assertions. `npm test` runs them all; each is also a standalone script.

```bash
# these import .ts modules, so they need tsx
npx tsx scripts/test-location.mjs      # 44   location parsing
npx tsx scripts/test-backfill.mjs      # 23
npx tsx scripts/test-sponsors.mjs      # 25   sponsor-register matching
npx tsx scripts/test-ssrf-guard.mjs    # 22   safe-fetch
npx tsx scripts/test-intent.mjs        # 21   query understanding
npx tsx scripts/test-visa.mjs          # 18
npx tsx scripts/test-quality.mjs       # 17   ghost-job signals
npx tsx scripts/test-dedupe.mjs        # 16
npx tsx scripts/test-rank.mjs          # 16
npx tsx scripts/test-workplace.mjs     # 16
npx tsx scripts/test-skills.mjs        # 14
npx tsx scripts/test-pagination.mjs    # 6
npx tsx scripts/test-html.mjs          # 4

# plain node is fine for this one
node scripts/test-job-matching.mjs     # 20
```

> `test-dedupe`, `test-intent` and `test-rank` **fail under plain `node`** with
> `ERR_MODULE_NOT_FOUND`. They import extensionless `.ts` paths, which Node's
> resolver will not follow. Use `tsx`.

Diagnostics (not assertion suites — they print, they do not pass/fail):
`smoke-normalize.mjs`, `test-enterprise.mjs`, `show-examples.mjs`,
`benchmark.mjs`, `health-check.mjs`.

## Typecheck

```bash
npx tsc --noEmit     # 51 errors, all pre-existing
```

| location | errors |
|---|--:|
| `countries-states-cities-database/prisma/seed.ts` | 29 — vendored sub-project, unused by the app |
| `components/dashboard.tsx` | 6 |
| `lib/auth-service.ts` | 5 |
| `components/animated-pie-chart.tsx` | 3 |
| `app/reset-password/page.tsx` | 3 |
| `app/profile/[username]/page.tsx` | 3 |
| others | 2 |

Keep this at 51 or lower. `next.config.mjs` sets
`typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`, so
the compiler will not stop you — **turning those off is the single
highest-value change available**; they hid two critical bugs (see
[AUDIT-2026.md](../AUDIT-2026.md)).

## Layout

```
app/            20 pages, 16 API route handlers
components/     87 components (52 are shadcn/ui primitives)
lib/
  sources/      13 adapters + the JobSource contract + hardened HTTP
  pipeline/     normalize · dedupe · quality · visa · workplace · skills · orchestrator
  search/       intent · rank
  companies/    registry (104) · market-cap · discovered
  visa/         sponsor-registers
  discovery/    common-crawl
scripts/        ingest, probes, discovery, 14 test suites
supabase/       23 migrations
docs/           this documentation
```

## Docs site

The `.mdx` files at the repo root plus `mint.json` are a Mintlify site, served
at `/docs` through `middleware.ts` → `app/api/docs/[...path]` **in production
only**. In development, run it separately:

```bash
npm i -g mintlify && mintlify dev
```

See [DOCS-SITE.md](DOCS-SITE.md).

## Known gaps

- **No CI.** The suites above are real and pass; nothing runs them on push.
  Adding a workflow that runs `tsc --noEmit` and the 14 scripts is the obvious
  first move.
- **Next.js 14.2.16** dates from Oct 2024. The 2026 releases fixed
  middleware/proxy auth bypass, SSRF, cache poisoning and an unauthenticated RCE
  on Windows (CVE-2026-75604). This app has no middleware-based auth today,
  which limits exposure, but the gap is large.
- **No server-side route protection** — `/dashboard`, `/profile` and `/settings`
  are guarded client-side only.
- **Rate limiting is per-process** and therefore per-instance on serverless.
- **Workday postings carry no posted date** — see
  [INGESTION.md](INGESTION.md#known-ingestion-gaps).

## Conventions

- **Never fabricate data.** If a source fails, return the failure. Placeholder
  jobs, invented scores and assumed dates are all worse than an error, because
  they are invisible.
- **Record uncertainty, don't resolve it early.** Ambiguous location codes and
  unknown valuations stay explicitly unknown.
- **Evidence with every inference.** Visa status, workplace type and ghost-risk
  all carry the span or fact that produced them.
- **Comments explain *why*.** The codebase documents the reasoning behind
  non-obvious decisions, especially where a plausible alternative was rejected.
