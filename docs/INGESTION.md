# Ingestion

## Running a crawl

```bash
npx tsx scripts/ingest-v2.mjs                          # every registered board (~20 min)
npx tsx scripts/ingest-v2.mjs --limit 60               # bounded
npx tsx scripts/ingest-v2.mjs --only stripe,figma      # named companies
npx tsx scripts/ingest-v2.mjs --sources workday,ashby  # by platform
npx tsx scripts/ingest-v2.mjs --no-enrich              # jobs must be unaffected
npx tsx scripts/ingest-v2.mjs --hydrate 500            # fetch descriptions for N jobs
npx tsx scripts/ingest-v2.mjs --out path/to/index.json
```

Writes:

- `public/data/jobs-v2.json` — the search index
- `.ingest-state.json` — hashes, cursors and first-seen dates for the next
  incremental run

Both are gitignored. Regenerate rather than commit them.

> `--only` takes **registry slugs**, not company names. `national-australia-bank`,
> not `NAB`.

## Reading the report

Every run prints a report; the fields worth watching:

| field | what a bad value means |
|---|---|
| `sourcesFailed` | a board stopped answering — check whether the token changed |
| `duplicatesRemoved` | a sudden jump means two boards started syndicating each other |
| `jobsWithPostedDate` | freshness ranking degrades below this coverage |
| `jobsWithCountry` | country filters silently miss these postings |
| `rejectedByValidation` | postings failing a CRITICAL rule; should stay near zero |
| `suspectedGhostJobs` | inference, not fact — see `quality.ts` |
| `avgQualityScore` | drops when a large low-detail board is added |

## Adding an employer

**Never guess a token.** Probe it, and add it only when the board answers with
live postings:

```bash
node scripts/probe-tokens.mjs greenhouse doordashusa stripe
node scripts/probe-tokens.mjs workday "crowdstrike.wd5.myworkdayjobs.com|crowdstrikecareers"
node scripts/probe-tokens.mjs eightfold "hsbc.eightfold.ai|hsbc.com"
```

Workday and Eightfold take a compound token because they need two parts:
`host|site` and `host|domain` respectively.

Guessing is wrong often enough to matter. Real examples from this registry:

| employer | the obvious guess | what it actually is |
|---|---|---|
| DoorDash | `doordash` | `doordashusa` |
| CrowdStrike | `External` / `Careers` | `crowdstrikecareers` (lowercase) |
| Bank of America | `bankofamerica` | `ghr` |
| NatWest | `natwest` | `rbs` |
| Standard Chartered | `standardchartered` | `peopleplus` |
| JPMorgan | a Workday tenant | Oracle Recruiting Cloud, site `CX_1001` |

Then add the entry to `lib/companies/registry.ts`:

```ts
{ slug: 'doordash', name: 'DoorDash', domain: 'doordash.com',
  ticker: 'DASH', valuationKind: 'public',
  industry: 'Food Delivery', hqLocation: 'San Francisco, CA', foundedYear: 2013,
  boards: [{ provider: 'greenhouse', token: 'doordashusa' }] },
```

`valuationKind` is the honest part:

- `public` — set `ticker`; market cap is derived at ingest from SEC EDGAR
  shares-outstanding × last close. Both inputs are free and authoritative.
- `private` — set `reportedValuationUsd`, `valuationAsOf` and
  `valuationSource`. There is no free API that reports private valuations
  reliably, so these are curated, and the UI must show the as-of date.
- `unknown` — for ASX/LSE-listed companies and private firms with no reported
  figure. Rendered "Not disclosed". **Never interpolate.**

> Assets under management is *not* a valuation. It is money managed on behalf of
> clients. Presenting AUM as a hedge fund's own worth would be wrong by orders
> of magnitude, which is why the trading firms in the registry are `unknown`.

Verify the whole registry still resolves:

```bash
node scripts/verify-ats-boards.mjs
npx tsx scripts/ingest-v2.mjs --only your-new-slug --no-enrich
```

## Writing an adapter

One file, one class, one registration. Extend `BaseAdapter` (which gives you
`json()`, `postJson()`, `mapRows()` and caching) and implement `fetchJobs`.

```ts
export class ExampleAdapter extends BaseAdapter {
  readonly id: SourceId = 'example'
  readonly displayName = 'Example ATS'
  readonly hostPatterns = [/(^|\.)example\.com$/i]
  protected discoveryPattern = '*.example.com/*'
  protected healthUrl() { return 'https://api.example.com/boards/demo/jobs' }

  async fetchJobs(target: SourceTarget, opts: FetchOptions = {}): Promise<FetchResult> {
    const warnings: string[] = []
    const data = await this.json<any>(`https://api.example.com/boards/${target.token}/jobs`,
      { cacheTtlMs: this.ttl.jobListing, signal: opts.signal })

    return {
      jobs: this.mapRows(data?.jobs ?? [], target, (j) => ({
        source: this.id, target,
        sourceId: String(j.id),
        requisitionId: j.req_id ? String(j.req_id) : String(j.id),
        title: String(j.title ?? '').trim(),
        locationRaw: j.location ?? null,
        descriptionHtml: j.description ?? null,
        postedAt: toIso(j.published_at),
        applicationUrl: String(j.apply_url ?? ''),
      }), warnings),
      incremental: false,
      warnings,
    }
  }
}
```

Register it in `lib/sources/registry.ts` and you are done — nothing downstream
needs to change.

### Pagination traps, all of which have bitten this codebase

- **Workday** hard-caps page size at 20. Asking for more returns an empty array
  rather than an error, which silently yields nothing. Its `total` is reported
  only on the first response; later pages come back `total: 0` while still
  returning postings — so it is a hint, never a stop condition.
- **Eightfold** caps a page at 10 and silently ignores a larger `num`. Stopping
  because "fewer than 100 came back" ended every crawl after one page: HSBC
  reported 1,611 jobs and yielded 10.
- **Amazon** reports `hits: 10000` as a ceiling, not a true total. Stop on a
  short page, not on the count.
- **Never stop on a short page** where the server may have trimmed the batch;
  stop on an *empty* one.

## Board discovery

```bash
node scripts/discover-boards.mjs      # Common Crawl → candidates → live verification
```

Candidates from the crawl index are verified against the provider's live API
before entering `scripts/discovered-boards.json`. Auto-discovered boards are
crawled with `confidence: 0.9` and carry no curated metadata — they show a
humanised token as the company name until someone promotes them into
`registry.ts`.

## Health

```bash
node scripts/health-check.mjs         # every registered platform
```

Also exposed programmatically via `healthCheckAll()` for an observability
dashboard.

## Known ingestion gaps

- **Workday postings have no posted date at list time.** `startDate` lives on
  the detail endpoint, and `WorkdayAdapter` implements no `fetchJob`, so the
  hydration stage is a no-op for it. Measured across a 10-board sample:
  Oracle Recruiting boards returned 100% posted dates, every Workday board
  returned 0%. Workday is ~55% of the corpus. Fixing this means implementing
  `fetchJob` **and** fixing the orchestrator's target reconstruction, which
  currently drops `host`/`site` — so the detail URL cannot be rebuilt for
  sharded sources.
- **Bare street addresses do not resolve to a country.** `"15 Tran Bach Dang
  An Khanh Ward"` is Vietnam, but nothing in the string says so. These stay
  `country: null` rather than being guessed.
- **Bot-protected platforms.** Eightfold tenants (Qualcomm, American Express,
  NAB's global portal) return 403 to every non-browser client. AMD is on iCIMS,
  for which no adapter exists yet. Goldman Sachs runs a bespoke portal with no
  public feed. All documented rather than faked.
