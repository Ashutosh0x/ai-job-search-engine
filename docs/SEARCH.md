# Search and ranking

## The premise

A job search query is mostly **constraints wearing the costume of free text**.

> `senior ML engineer in Bangalore with visa sponsorship posted this week`

That is five filters and one topic. A keyword engine treats all six as
bag-of-words, and so it happily returns a junior role in Boston that merely
*mentions* Bangalore.

Lifting the constraints out first makes them hard filters and leaves the residue
as the topical query. That single move is the biggest quality difference between
"search over job text" and "job search".

## Stage 1 — intent parsing

`lib/search/intent.ts` → `ParsedIntent`

```ts
{
  raw:              "senior ML engineer in Bangalore with visa sponsorship posted this week",
  topic:            "ml engineer",
  titleTerms:       ["engineer"],
  skills:           ["machine-learning"],
  locations:        ["Bangalore"],
  impliedCountries: ["India"],        // Bangalore → India
  seniority:        "senior",
  visa:             "required",
  postedWithinDays: 7,
  facets:           [ /* every extraction, with the span it consumed */ ]
}
```

Every extraction records `matched` — the exact text it was read from — and a
confidence. That is what lets `/api/smart-search` return an `intentSummary`: the
user can see how their sentence was understood and correct a misreading, rather
than being silently handed the wrong results.

Fields extracted: title terms, skills (via the canonical skill table),
locations, countries, seniority, workplace type, remote-only, visa requirement,
employment type, posted-within window, salary floor + currency, and named
companies.

## Stage 2 — ranking

`lib/search/rank.ts`. Two commitments:

**1. Every point is attributable.** The score is a sum of named signals and each
result carries the breakdown, so "why is this ranked here?" has an answer you can
read — which is what makes the ranking improvable rather than mystical.

**2. Relevance dominates.** Company valuation and size contribute **at most 3 of
100 points**, deliberately. A ranker that lets prestige outweigh fit turns into a
popularity list, and the whole point of a job search is that the right small
company beats the wrong famous one.

| signal | weight | reads |
|---|--:|---|
| `titleMatch` | 15 | query title terms vs the posting title |
| `skillMatch` | 15 | canonical skills, alias-resolved |
| `locationMatch` | 10 | city / region / country, after normalisation |
| `freshness` | 10 | posted date; **no date is not treated as fresh** |
| `descriptionMatch` | 9 | topic terms in the body |
| `workplaceMatch` | 8 | remote / hybrid / onsite vs what was asked |
| `visaMatch` | 8 | sponsorship status vs requirement |
| `seniorityMatch` | 7 | senior / staff / junior alignment |
| `sourceQuality` | 5 | per-source confidence (employer site 1.0 → unknown 0.4) |
| `completeness` | 5 | how much of the posting is actually filled in |
| `directApply` | 5 | link goes to the employer/ATS, not an aggregator |
| `companyQuality` | 3 | valuation tier and open-role count — capped on purpose |
| `duplicatePenalty` | −5 | applied when a record was merged from several sources |

Weights are **data, not code** (`DEFAULT_WEIGHTS`), so they can be tuned per
surface or A/B tested without touching the scorer.

```bash
curl 'localhost:3000/api/smart-search?q=senior+platform+engineer+in+india&debug=1'
```

`debug=1` returns the full per-signal breakdown; without it each result still
carries `matchReasons` — short badges naming what earned the rank.

## Skill matching

Naive substring matching is why job matchers embarrass themselves. Fixed cases,
each with a regression test:

- `"Java"` no longer satisfies a `"JavaScript"` requirement — the old
  bidirectional `includes()` meant `"R"` matched almost everything.
- `"JS"` *does* satisfy `"JavaScript"`, via an explicit alias table rather than
  substring luck.
- `"York"` no longer matches `"New York"`.

## Scoring correctness

`lib/job-scoring.ts` is pure — deliberately separated from the DB client so it is
testable — and five real defects were fixed there, each now covered:

| defect | effect before |
|---|---|
| weights never renormalised | a job with no salary listed could not score above 85; missing salary *and* location capped at 65, so sparse postings ranked below rich ones regardless of fit |
| skill ratio could exceed 100% | matches counted from the *user's* skills but divided by the *job's* requirement count — listing "React" and "React Native" scored 200% on one required "React" |
| division by zero → `NaN` | an empty requirements array poisoned the final score |
| salary parsed 1000× wrong | `"$50,000"` became **50,000,000** — the `k` was stripped before being tested for, then multiplied unconditionally |
| location distance fabricated | any non-substring match returned a constant `50`, which fell into the `< 100` branch and awarded every unrelated location a flat 75/100 "within reasonable distance" |

## Retrieval

`getRecommendedJobs` previously did `select('*')` over the entire `jobs` table
with no limit and scored every row in memory on every request. It is now the
standard two-stage recommender shape: a bounded, filtered, ordered candidate
pull, then ranking over that shortlist.

## Where this should go next

`lib/job-scoring.ts` is pure specifically so it can become the **reranker** over
a proper retrieval stage. Current practice for job relevance is BM25 lexical +
vector semantic, fused with Reciprocal Rank Fusion — in Postgres that is
`pg_textsearch`/ParadeDB `pg_search` alongside `pgvector`. LinkedIn's published
approach is two-tower embedding retrieval feeding a contextual reranker, which is
the same shape.

The blocker is the data model, not the ranker: `jobs.salary` and
`jobs.experience` are free **text**, which is why parsing them is guesswork.
`salary_min_cents`, `salary_max_cents`, `currency` and `experience_min_years`
would make matching exact and push filtering into Postgres.

## Tests

```bash
npx tsx scripts/test-intent.mjs      # 21
npx tsx scripts/test-rank.mjs        # 16
npx tsx scripts/test-skills.mjs      # 14
node    scripts/test-job-matching.mjs # 20
```
