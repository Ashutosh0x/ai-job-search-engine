# Analytics

Link tracking, search analytics and the admin dashboard.

This document is the contract. Every number on `/admin/analytics` is defined
here, and every field that is collected is listed here. If the two disagree, the
code is wrong.

---

## 1. What is collected

### Stored on every event

| Field | Example | Where it comes from |
|---|---|---|
| `type` | `apply_click` | The event itself |
| `ts` | `2026-09-15T12:00:00Z` | **Server clock.** A client-supplied time is ignored |
| `session_id` | `a3f1…` (32 hex) | One-way hash, **daily-rotating salt** — see below |
| `job_id` | `greenhouse:acme:1` | The posting |
| `company_slug` / `source` | `acme` / `greenhouse` | Denormalised from the index |
| `query` | `senior software engineer` | What the visitor typed, lower-cased, ≤200 chars |
| `location`, `filters`, `sort`, `page`, `position`, `result_count` | | The search |
| `device` | `mobile` \| `tablet` \| `desktop` \| `bot` \| `unknown` | Derived from UA, **UA not stored** |
| `browser` | `chrome` \| `safari` \| … | Derived from UA, **UA not stored** |
| `os` | `ios` \| `android` \| … | Derived from UA, **UA not stored** |
| `referrer` | `search_engine` \| `social` \| … | **Class only. The referring URL is never stored** |
| `country` | `GB` | The CDN's own header. Never inferred from IP by us |
| `is_bot` | `false` | Derived |

### Never collected

- **No IP address.** Used once, in memory, to derive the country and salt the
  session hash. Never returned from `identity.ts`, never logged, never stored.
- **No user-agent string.** Same: read once, reduced to three buckets, discarded.
- No email, name, account id or any account linkage on an event.
- No referring URL, no page query string (it can carry the search terms — those
  belong in `query`, where they are length-capped).
- No cookies beyond the opt-out flag. No fingerprinting of any kind.

### Why the session id rotates daily

A hash of an IP with a *fixed* salt is a stable identifier for that address
forever. It is pseudonymous, not anonymous, and it is linkable across months.
The salt includes the UTC date, so yesterday's id cannot be matched to today's.

**The cost, stated plainly:** a visitor returning tomorrow counts as a new
visitor. "Unique visitors" therefore means *unique within a day*, and the
dashboard says so. That is the trade — accurate long-range unique counts would
require exactly the durable identifier this avoids.

### Opting out

Honoured, and checked in the browser *and* on the server:

- `Sec-GPC: 1` — Global Privacy Control, legally recognised under CCPA
- `DNT: 1`
- the `js_no_analytics=1` cookie (`optOut()` in `lib/analytics/client.ts`)

When any is present, **nothing at all is recorded** — not a reduced event, not a
counter. The ingestion endpoint returns `202 {stored: 0, reason: "opted_out"}`
before it even parses the body.

### Retention

`ANALYTICS_RETENTION_DAYS`, default **90**. Enforced by
`scripts/prune-analytics.mjs`, which must be scheduled — it is not automatic.

---

## 2. Metric definitions

These are the definitions the dashboard renders and `lib/analytics/metrics.ts`
computes.

| Metric | Definition |
|---|---|
| **Seen** (impression) | A result that scrolled into view, ≥50% visible, for ≥500ms. **Not** every row the API returned |
| **View** | A job detail page opened |
| **Apply click** | The `/go/job` redirect being served. Server-authored |
| **Unique** | Distinct sessions — and sessions rotate daily, so *unique within a day* |
| **View rate** | unique views ÷ unique impressions |
| **Apply rate** | unique apply clicks ÷ unique views |
| **Search → apply** | sessions that searched **and** applied ÷ sessions that searched |
| **Average position** | Mean 1-based rank of the impressions for that job |

### Why impressions are not "what the API returned"

A search returning 50 rows where the visitor reads 8 is **8** impressions.
Counting 50 divides every rate by six and makes well-performing jobs look
ignored — and the distortion is not a constant: it moves with page size and
scroll depth, so it changes whenever the layout does.

### The sample floor

**A rate is not reported at all when its denominator is below 20**
(`MIN_SAMPLE`). It renders as `—`.

A 100% click-through built on one impression is noise presented as insight, and
it is precisely the number that makes someone promote the wrong job. Reporting
`0%` instead would be worse — it asserts something false.

### Trend

```
trend = (recent − older) / max(older, 1)
```

Engagement in the recent half of the window against the older half, weighted:
**apply 5, view 2, impression 1, save/share 3**. The denominator floor of 1 caps
a from-nothing rise, so a single first click cannot top the board.

### Opportunity (zero-result searches)

```
opportunity = zeroResultSearches × log₂(1 + uniqueSearchers) × 0.5^(ageDays/7)
```

- **volume** — how often people ask for something that is not there
- **reach** — `log₂` of *distinct* searchers, so one person refreshing forty
  times cannot outrank forty people asking once
- **recency** — halves weekly, so last quarter's gap does not outrank this week's

This is the crawl backlog, ranked. It is the most actionable panel on the page.

### Bots

Self-identifying bots are **stored and excluded from every metric** — never
silently dropped. Dropping them makes "nobody visited" and "only crawlers
visited" look identical, and those call for very different responses.

### Raw vs unique clicks

Both are kept. Repeats within a per-type window (30 min for applies, 5 min for
views) are marked `metadata.repeat` rather than discarded. De-duplication is
per-process, so on a serverless host it *under*-detects across instances — the
safe direction, since a missed de-duplication is a slightly high raw count, while
a false positive would discard a real click.

---

## 3. Architecture

```
job card / detail page
   │  track()  ──► batched, sendBeacon on visibilitychange
   ▼
POST /api/analytics/events   ── zod-validated, size-capped, rate-limited
   │
   ├─ Apply button ──► GET /go/job/:provider/:token/:id
   │                     ├ resolve destination FROM THE INDEX (never the URL)
   │                     ├ validate + clean it
   │                     ├ record apply_click + external_redirect (fire-and-forget)
   │                     └ 307 → employer ATS
   ▼
lib/analytics/store.ts  ── driver: supabase │ memory │ none
   ▼
GET /api/admin/analytics ── admin-only, one read, aggregated in-process
   ▼
/admin/analytics
```

### Why the store is an interface

Not speculative generality — forced by three verified facts:

1. The job corpus is a **static JSON file**, not a database. Job search does not
   need Postgres, so analytics cannot assume Postgres exists.
2. **The configured Supabase project does not resolve** (`ENOTFOUND`, verified
   2026-09-15 while `github.com` and `supabase.com` both answered 200). Writing
   directly against that client would ship a feature that cannot run.
3. Vercel functions are ephemeral and horizontally scaled, so an in-process
   counter is per-instance and lost on cold start.

The store therefore **reports its own health**, and the dashboard renders that
banner rather than showing zeros that look like "nobody visited".

### Drivers

| Driver | Durable | When |
|---|---|---|
| `supabase` | yes | Default when `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set. Needs `supabase/migrations/20260915000000_create_analytics_events.sql` |
| `memory` | no | Bounded 50k ring buffer. Development and single-instance. Real storage — the whole funnel works — but per-instance and cleared on restart |
| `none` | no | `ANALYTICS_DISABLED=1`, or a driver that could not be constructed. Accepts and discards, and says so |

### Aggregation

In-process, one pass, one read per dashboard load. SQL aggregation would have to
be written per driver and would drift between them. When volume demands it, the
place to change is **behind `store.read()`** — add a materialised view without
touching the dashboard.

---

## 4. Security

| Risk | Control |
|---|---|
| **Open redirect** | The destination is **never** taken from the request. `/go/job` carries a job id and resolves the URL from the index. There is no parameter that influences where a visitor lands |
| Malicious stored URL | `isSafeApplyUrl()` — http(s) only, no credentials in the authority, no loopback/private/link-local/metadata hosts, no control characters |
| Header injection | Control characters rejected before parsing, so a newline cannot terminate the `Location` header |
| Referrer leakage | `Referrer-Policy: no-referrer` on the redirect, and `rel="noopener noreferrer nofollow"` on every Apply link — the ATS never learns the job id or the search |
| Campaign-parameter leakage | `utm_*`, `gclid`, `fbclid` etc. stripped before redirecting |
| Event spoofing | `apply_click` and `external_redirect` are **refused** from clients. Session, country, device, time are all server-derived |
| Payload abuse | 64KB body cap (checked before *and* after read), 50 events per batch, every field length-capped |
| Admin access | `ADMIN_EMAILS` allowlist over the existing Supabase session. **Fails closed** — unset means nobody. Requires a *verified* address |
| Enumeration | The admin API answers **404**, not 403, so it does not confirm the route exists |
| Cache leakage | `no-store, private` on the admin API; `no-store` on the redirect |
| Crawler inflation | `/go/` and `/admin` disallowed in `robots.txt`; the dashboard is `noindex` |

### On admin authorisation

There was **no admin authorisation in this project to reuse**. The only artefact
was one RLS policy testing `auth.users.role = 'admin'` — in Supabase that column
is `authenticated` for every signed-in user, so **it matches nobody**.

`ADMIN_EMAILS` is *authorisation*, not a second authentication system: identity
still comes from the verified Supabase session. An allowlist rather than a
database role because the database is the thing being reported on, and an
authorisation check that fails open when the database is down is not a check.

---

## 5. Configuration

```bash
# Analytics
ANALYTICS_DRIVER=supabase          # supabase | memory | none  (default: supabase if configured, else memory)
ANALYTICS_DISABLED=0               # 1 turns the whole system off
ANALYTICS_SALT=<32+ random bytes>  # session-hash salt. Unset = random per process,
                                   # which inflates unique counts across instances
ANALYTICS_RETENTION_DAYS=90

# Admin dashboard. Unset = nobody has access.
ADMIN_EMAILS=you@example.com,colleague@example.com
```

`ANALYTICS_SALT` should be set in production. Without it each instance salts
differently, so the same visitor counts once per instance.

---

## 6. Performance

- Apply redirect: the analytics write is **fire-and-forget with a 2s timeout**
  and is not awaited. **If the store is down the user still reaches the
  employer.** An outage that stopped people applying would be far worse than
  losing a day of metrics.
- `record()` never rejects. `recordAndForget()` never blocks.
- The client queue batches on a 3s timer and flushes via `sendBeacon` on
  `visibilitychange` — chosen over `unload`, which does not fire reliably on
  mobile, where most of this traffic is.
- No third-party script, no added dependency. The tracker is ~2KB of first-party
  code.

---

## 7. Known limits

- **Query → click attribution is generous.** Without per-event referrer
  chaining there is no way to know *which* of a session's searches produced a
  click, so a session that searched twice and applied once adds one apply to
  both. Over-counts when people search several things; attributing to none would
  make the column useless.
- **Unique counts are per day** (see salt rotation).
- **De-duplication is per-process** and under-detects across instances.
- **The `memory` driver is per-instance** and clears on deploy.
- **No IntersectionObserver ⇒ no impressions** rather than a fallback, so those
  visitors are a known gap instead of a second definition of the same metric.
