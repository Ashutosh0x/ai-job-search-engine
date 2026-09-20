-- Job corpus in Postgres, with BM25 search.
--
-- WHY THIS EXISTS
-- ===============
-- The corpus is served from public/data/jobs-deploy.json today. That file is
-- 60 MB, costs 309ms (113ms read + 196ms parse) and 78 MB of heap on every
-- cold serverless invocation, and it can only carry 130,863 of the 498,025
-- crawled jobs -- a JSON string cannot exceed Node's ~512 MB cap, which the
-- full index passed long ago. The bounded slice, the sharding, the size floor
-- and the per-company budget all exist to work around that one limitation.
--
-- lib/search/inverted-index.ts already says where this ends up:
--   "This is what a database's GIN index does, implemented locally because
--    there is no database in the serving path today."
--
-- SEARCH: pg_search (ParadeDB), NOT tsvector
-- ==========================================
-- The app ranks with BM25 (lib/search/rank.ts). Postgres' built-in
-- `ts_rank` is not BM25 -- moving to it would silently change every result
-- ordering. pg_search embeds a Tantivy BM25 index directly in Postgres, so
-- the ranking function stays the one the app was tuned against, and faceted
-- filtering stays a single query rather than the exponential join problem
-- native FTS has with five facets.
--
-- If pg_search is unavailable, the DO block below falls back to a GIN
-- tsvector index. Search still works; ranking is ts_rank, not BM25, and the
-- application must be told so rather than silently serving different results.

CREATE TABLE IF NOT EXISTS jobs (
  -- The pipeline's own id: "provider:token:requisition", e.g. "custom:ebay:R0075646".
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  company         TEXT NOT NULL,
  company_slug    TEXT NOT NULL,
  company_domain  TEXT,
  title           TEXT NOT NULL,
  normalized_title TEXT,
  description     TEXT,

  -- Location, already normalised by lib/location.ts at ingest.
  location_raw     TEXT,
  location_display TEXT,
  city            TEXT,
  state           TEXT,
  country         TEXT,
  remote          BOOLEAN NOT NULL DEFAULT FALSE,
  workplace_type  TEXT,

  employment_type TEXT,
  department      TEXT,
  seniority       TEXT,
  early_career    TEXT,
  early_career_level SMALLINT,
  skills          TEXT[] DEFAULT '{}',

  salary_min      NUMERIC,
  salary_max      NUMERIC,
  salary_currency TEXT,

  posted_at       TIMESTAMPTZ,
  -- The cursor /api/jobs/delta pages on and the basis of ghost-job staleness.
  -- Preserved across refreshes; resetting it makes every job look new forever.
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  application_url TEXT,
  is_direct_application BOOLEAN DEFAULT FALSE,
  freshness_score REAL,
  quality_score   REAL,
  ghost_risk      REAL,
  ghost_label     TEXT,
  visa_status     TEXT,

  -- Which board produced this row. A refresh may only delete rows whose board
  -- it actually crawled; without that, a hot-tier pass would wipe every
  -- Workday job. Same rule as mergeRefresh() in lib/pipeline/merge.ts.
  board_key       TEXT NOT NULL
);

-- Filters the search page actually uses.
CREATE INDEX IF NOT EXISTS idx_jobs_company_slug ON jobs (company_slug);
CREATE INDEX IF NOT EXISTS idx_jobs_country      ON jobs (country) WHERE country IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_department   ON jobs (department) WHERE department IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_early_career ON jobs (early_career) WHERE early_career IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_remote       ON jobs (remote) WHERE remote = TRUE;
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at    ON jobs (posted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_jobs_board_key    ON jobs (board_key);
-- /api/jobs/delta pages on first_seen_at; without this it is a full scan.
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen   ON jobs (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_skills       ON jobs USING GIN (skills);

-- Ranking reads these on every row it returns, so keep them in one covering
-- index for the common "recent, high quality, direct apply" ordering.
CREATE INDEX IF NOT EXISTS idx_jobs_rank
  ON jobs (quality_score DESC NULLS LAST, posted_at DESC NULLS LAST);

/* ------------------------------------------------------------------ */
/* Full-text: pg_search BM25 where available, GIN tsvector otherwise.  */
/* ------------------------------------------------------------------ */

DO $$
DECLARE
  has_pg_search BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_search')
    INTO has_pg_search;

  IF has_pg_search THEN
    CREATE EXTENSION IF NOT EXISTS pg_search;

    -- Tantivy BM25 over the fields the app searches. Benchmarks put this
    -- 20-1000x ahead of native FTS on query latency at comparable relevance
    -- to Elasticsearch, without a second system to keep in sync.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jobs_bm25') THEN
      EXECUTE $ix$
        CREATE INDEX idx_jobs_bm25 ON jobs
        USING bm25 (id, title, normalized_title, description, company, department, skills)
        WITH (key_field = 'id')
      $ix$;
    END IF;

    RAISE NOTICE 'jobs: BM25 search enabled (pg_search)';
  ELSE
    -- Fallback. Ranking is ts_rank, which is NOT BM25: results will order
    -- differently from lib/search/rank.ts. jobsSearchMode() reports which
    -- index is live so the app can say so rather than quietly differ.
    CREATE INDEX IF NOT EXISTS idx_jobs_fts ON jobs
      USING GIN (
        to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(company, '') || ' ' ||
          coalesce(department, '') || ' ' ||
          coalesce(description, ''))
      );

    RAISE NOTICE 'jobs: pg_search unavailable — using GIN tsvector (ts_rank, not BM25)';
  END IF;
END
$$;

/**
 * Which search index is actually live.
 *
 * The app must not claim BM25 relevance when it is running on ts_rank.
 */
CREATE OR REPLACE FUNCTION jobs_search_mode() RETURNS TEXT AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jobs_bm25') THEN 'bm25'
    WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jobs_fts')  THEN 'tsvector'
    ELSE 'none'
  END
$$ LANGUAGE sql STABLE;

/* ------------------------------------------------------------------ */
/* Row level security                                                  */
/* ------------------------------------------------------------------ */

-- Job postings are public data: every visitor reads them, nobody writes from
-- the browser. Writes go through the ingest using the service role, which
-- bypasses RLS.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Jobs are publicly readable" ON jobs;
CREATE POLICY "Jobs are publicly readable" ON jobs FOR SELECT USING (TRUE);

/* ------------------------------------------------------------------ */
/* Ingest bookkeeping                                                  */
/* ------------------------------------------------------------------ */

-- One row per board per crawl, so a refresh can prove which boards it
-- actually reached before deleting anything attributed to them.
CREATE TABLE IF NOT EXISTS job_crawls (
  board_key    TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  crawled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  jobs_found   INTEGER NOT NULL DEFAULT 0,
  ok           BOOLEAN NOT NULL DEFAULT TRUE,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_crawls_crawled_at ON job_crawls (crawled_at DESC);

ALTER TABLE job_crawls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Crawl status is publicly readable" ON job_crawls;
CREATE POLICY "Crawl status is publicly readable" ON job_crawls FOR SELECT USING (TRUE);
