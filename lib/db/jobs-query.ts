/**
 * SQL builder for job search.
 *
 * Kept free of any database client on purpose: it turns a JobQuery into
 * `{ text, values }` and nothing else. That makes the part most likely to
 * carry a bug — filter composition, parameter binding, BM25 vs ts_rank
 * ranking — testable without a live Postgres, which matters because the
 * corpus migration lands long before anyone has a Neon instance wired up.
 *
 * Every value is bound as a parameter. No user input is ever concatenated
 * into the statement.
 */

/** Which full-text index the database actually has. See jobs_search_mode(). */
export type SearchMode = 'bm25' | 'tsvector' | 'none'

export interface JobsQueryInput {
  /** Free-text query. Empty means "browse", which changes the ordering. */
  q?: string | null
  companySlug?: string | null
  departments?: string[]
  countries?: string[]
  earlyCareer?: string[]
  remoteOnly?: boolean
  postedWithinDays?: number | null
  limit?: number
  offset?: number
  /** Ordering. `relevance` is only meaningful with a query. */
  sort?: 'relevance' | 'recent' | 'quality'
}

export interface BuiltQuery {
  text: string
  values: unknown[]
}

const MAX_LIMIT = 100

/** Columns the app reads. Listed explicitly so `SELECT *` never leaks a new column into the API. */
const COLUMNS = [
  'id', 'source', 'company', 'company_slug', 'company_domain',
  'title', 'normalized_title', 'description',
  'location_raw', 'location_display', 'city', 'state', 'country', 'remote', 'workplace_type',
  'employment_type', 'department', 'seniority', 'early_career', 'early_career_level', 'skills',
  'salary_min', 'salary_max', 'salary_currency',
  'posted_at', 'first_seen_at', 'application_url', 'is_direct_application',
  'freshness_score', 'quality_score', 'ghost_risk', 'ghost_label', 'visa_status',
].join(', ')

/**
 * Accumulates WHERE clauses and their bound values together, so a clause can
 * never be added without its parameter (the classic way an off-by-one creeps
 * into a hand-built query).
 */
class Binder {
  readonly values: unknown[] = []
  readonly clauses: string[] = []

  /** Bind a value and return its placeholder. */
  bind(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }

  where(sql: string): void {
    this.clauses.push(sql)
  }

  get whereSql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : ''
  }
}

function applyFilters(b: Binder, input: JobsQueryInput): void {
  if (input.companySlug) {
    b.where(`company_slug = ${b.bind(input.companySlug)}`)
  }

  // `= ANY($n)` rather than an IN list: one parameter regardless of how many
  // values, so a 40-department filter cannot blow the parameter limit.
  if (input.departments?.length) {
    b.where(`department = ANY(${b.bind(input.departments)})`)
  }
  if (input.countries?.length) {
    b.where(`country = ANY(${b.bind(input.countries)})`)
  }
  if (input.earlyCareer?.length) {
    b.where(`early_career = ANY(${b.bind(input.earlyCareer)})`)
  }

  // Only ever a positive filter. `remoteOnly: false` means "no preference",
  // not "exclude remote" -- treating it as the latter silently hides remote
  // roles from every default search.
  if (input.remoteOnly) {
    b.where(`remote = TRUE`)
  }

  if (input.postedWithinDays && input.postedWithinDays > 0) {
    b.where(`posted_at >= NOW() - ${b.bind(`${Math.floor(input.postedWithinDays)} days`)}::interval`)
  }
}

/**
 * Build the search statement.
 *
 * With `mode: 'bm25'` the text predicate is pg_search's `@@@` operator and the
 * score is `paradedb.score(id)` — the same BM25 the app's own ranker uses.
 * With `tsvector` it degrades to `ts_rank`, which orders differently; callers
 * are expected to surface that rather than present it as the same thing.
 */
export function buildSearchQuery(input: JobsQueryInput, mode: SearchMode): BuiltQuery {
  const b = new Binder()
  const q = (input.q ?? '').trim()
  const hasQuery = q.length > 0 && mode !== 'none'

  let scoreSql = '0::real AS score'

  if (hasQuery) {
    if (mode === 'bm25') {
      // pg_search matches across the fields named in the BM25 index.
      b.where(`id @@@ ${b.bind(q)}`)
      scoreSql = 'paradedb.score(id) AS score'
    } else {
      const param = b.bind(q)
      b.where(
        `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || ` +
        `coalesce(department,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('english', ${param})`
      )
      scoreSql =
        `ts_rank(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || ` +
        `coalesce(department,'') || ' ' || coalesce(description,'')), plainto_tsquery('english', ${param})) AS score`
    }
  }

  applyFilters(b, input)

  // Relevance is meaningless without a query: a browse request sorted by
  // "relevance" would come back in whatever order the planner chose, which
  // looks random to the user. Fall back to recency.
  const sort = input.sort ?? (hasQuery ? 'relevance' : 'recent')
  const orderBy =
    sort === 'relevance' && hasQuery
      ? 'score DESC, posted_at DESC NULLS LAST, id'
      : sort === 'quality'
        ? 'quality_score DESC NULLS LAST, posted_at DESC NULLS LAST, id'
        : 'posted_at DESC NULLS LAST, id'

  // `id` is the final tiebreaker everywhere. Without it, two rows with equal
  // score and posted_at can swap between pages and a job is shown twice or
  // skipped entirely during pagination.
  const limit = Math.min(Math.max(1, input.limit ?? 20), MAX_LIMIT)
  const offset = Math.max(0, input.offset ?? 0)

  const text =
    `SELECT ${COLUMNS}, ${scoreSql}\n` +
    `FROM jobs\n` +
    (b.whereSql ? `${b.whereSql}\n` : '') +
    `ORDER BY ${orderBy}\n` +
    `LIMIT ${b.bind(limit)} OFFSET ${b.bind(offset)}`

  return { text, values: b.values }
}

/** Total matching rows, for pagination. Same predicate, no ordering or window. */
export function buildCountQuery(input: JobsQueryInput, mode: SearchMode): BuiltQuery {
  const b = new Binder()
  const q = (input.q ?? '').trim()

  if (q.length > 0 && mode !== 'none') {
    if (mode === 'bm25') {
      b.where(`id @@@ ${b.bind(q)}`)
    } else {
      b.where(
        `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || ` +
        `coalesce(department,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('english', ${b.bind(q)})`
      )
    }
  }

  applyFilters(b, input)

  return {
    text: `SELECT COUNT(*)::int AS total FROM jobs\n${b.whereSql}`,
    values: b.values,
  }
}

/**
 * Facet counts for one column, under the same filters.
 *
 * The column is NOT a parameter — Postgres cannot bind an identifier — so it
 * is checked against an allowlist. Anything else would be SQL injection via
 * a query string.
 */
const FACETABLE = new Set(['department', 'country', 'company_slug', 'early_career', 'seniority'])

export function buildFacetQuery(
  column: string,
  input: JobsQueryInput,
  mode: SearchMode,
  topN = 50
): BuiltQuery {
  if (!FACETABLE.has(column)) {
    throw new Error(`"${column}" is not a facetable column`)
  }

  const b = new Binder()
  const q = (input.q ?? '').trim()

  if (q.length > 0 && mode !== 'none') {
    if (mode === 'bm25') {
      b.where(`id @@@ ${b.bind(q)}`)
    } else {
      b.where(
        `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(company,'') || ' ' || ` +
        `coalesce(department,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('english', ${b.bind(q)})`
      )
    }
  }

  applyFilters(b, input)
  b.where(`${column} IS NOT NULL`)

  return {
    text:
      `SELECT ${column} AS value, COUNT(*)::int AS count\n` +
      `FROM jobs\n${b.whereSql}\n` +
      `GROUP BY ${column}\nORDER BY count DESC, value ASC\nLIMIT ${b.bind(topN)}`,
    values: b.values,
  }
}

/**
 * Upsert one crawled batch.
 *
 * `first_seen_at` is preserved with LEAST() rather than overwritten: it is the
 * cursor /api/jobs/delta pages on, so resetting it on every refresh would make
 * every job look new forever.
 */
export function buildUpsertQuery(rows: Record<string, unknown>[]): BuiltQuery {
  if (rows.length === 0) throw new Error('buildUpsertQuery called with no rows')

  const cols = [
    'id', 'source', 'company', 'company_slug', 'company_domain', 'title', 'normalized_title',
    'description', 'location_raw', 'location_display', 'city', 'state', 'country', 'remote',
    'workplace_type', 'employment_type', 'department', 'seniority', 'early_career',
    'early_career_level', 'skills', 'salary_min', 'salary_max', 'salary_currency',
    'posted_at', 'first_seen_at', 'last_seen_at', 'application_url', 'is_direct_application',
    'freshness_score', 'quality_score', 'ghost_risk', 'ghost_label', 'visa_status', 'board_key',
  ]

  const values: unknown[] = []
  const tuples = rows.map((row) => {
    const placeholders = cols.map((c) => {
      values.push(row[c] ?? null)
      return `$${values.length}`
    })
    return `(${placeholders.join(', ')})`
  })

  const updates = cols
    .filter((c) => c !== 'id' && c !== 'first_seen_at')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ')

  return {
    text:
      `INSERT INTO jobs (${cols.join(', ')})\nVALUES ${tuples.join(', ')}\n` +
      `ON CONFLICT (id) DO UPDATE SET ${updates}, ` +
      `first_seen_at = LEAST(jobs.first_seen_at, EXCLUDED.first_seen_at)`,
    values,
  }
}

/**
 * Delete postings that vanished from a board this crawl.
 *
 * Scoped to the boards actually crawled, and never runs for a board that
 * returned nothing — an ATS answering with an empty list (rate limit, tenant
 * rename, outage) is indistinguishable from "all roles closed", and acting on
 * it would erase a healthy employer's entire listing.
 */
export function buildPruneQuery(boardKey: string, keepIds: string[]): BuiltQuery {
  if (keepIds.length === 0) {
    throw new Error(
      `refusing to prune ${boardKey}: the crawl returned no jobs, which cannot be ` +
      `distinguished from a failed fetch`
    )
  }
  const b = new Binder()
  const board = b.bind(boardKey)
  const keep = b.bind(keepIds)
  return {
    text: `DELETE FROM jobs WHERE board_key = ${board} AND NOT (id = ANY(${keep}))`,
    values: b.values,
  }
}
