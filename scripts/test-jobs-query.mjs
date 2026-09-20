/**
 * Pin the job-search SQL builder.
 *
 *   npx tsx scripts/test-jobs-query.mjs
 *
 * No database required, which is the point: the builder is the part of the
 * Postgres migration most likely to carry a bug -- filter composition,
 * parameter binding, BM25 vs ts_rank ranking, pagination stability -- and all
 * of it is decidable from the generated statement alone.
 *
 * The properties asserted here are the ones whose failure is INVISIBLE in
 * production: a query that runs fine and returns subtly wrong rows.
 */

import {
  buildSearchQuery, buildCountQuery, buildFacetQuery,
  buildUpsertQuery, buildPruneQuery,
} from '../lib/db/jobs-query.ts'

let pass = 0, fail = 0

function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** Every $n in the statement must have a value, and vice versa. */
function bindingsAgree(built) {
  const used = new Set(Array.from(built.text.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])))
  if (used.size !== built.values.length) return false
  for (let i = 1; i <= built.values.length; i++) if (!used.has(i)) return false
  return true
}

/* ---- Parameter binding ---- */
console.log('\n🔗 Parameter binding:')

for (const [name, built] of [
  ['plain browse', buildSearchQuery({}, 'bm25')],
  ['text query', buildSearchQuery({ q: 'rust engineer' }, 'bm25')],
  ['tsvector query', buildSearchQuery({ q: 'rust engineer' }, 'tsvector')],
  ['every filter', buildSearchQuery({
    q: 'engineer', companySlug: 'stripe', departments: ['Engineering', 'Design'],
    countries: ['United Kingdom'], earlyCareer: ['graduate'], remoteOnly: true,
    postedWithinDays: 30, limit: 50, offset: 100,
  }, 'bm25')],
  ['count', buildCountQuery({ q: 'engineer', remoteOnly: true }, 'bm25')],
  ['facet', buildFacetQuery('department', { q: 'engineer' }, 'bm25')],
]) {
  t(`${name}: every placeholder is bound`, bindingsAgree(built),
    `${built.text.match(/\$\d+/g)?.length ?? 0} placeholders vs ${built.values.length} values`)
}

/* ---- Injection safety ---- */
console.log('\n🛡️  Injection safety:')
{
  const nasty = `'; DROP TABLE jobs; --`
  const built = buildSearchQuery({ q: nasty, companySlug: nasty }, 'bm25')
  t('user text never reaches the statement', !built.text.includes('DROP TABLE'))
  t('user text is bound as a value', built.values.includes(nasty))

  let threw = false
  try { buildFacetQuery('department; DROP TABLE jobs', {}, 'bm25') } catch { threw = true }
  t('a non-allowlisted facet column is rejected', threw)

  for (const col of ['department', 'country', 'company_slug', 'early_career', 'seniority']) {
    let ok = true
    try { buildFacetQuery(col, {}, 'bm25') } catch { ok = false }
    t(`"${col}" is facetable`, ok)
  }
}

/* ---- Ranking mode ---- */
console.log('\n🎯 Ranking:')
{
  const bm25 = buildSearchQuery({ q: 'engineer' }, 'bm25')
  t('bm25 uses the @@@ operator', bm25.text.includes('@@@'))
  t('bm25 scores with paradedb.score', bm25.text.includes('paradedb.score'))
  t('bm25 does not fall back to ts_rank', !bm25.text.includes('ts_rank'))

  const ts = buildSearchQuery({ q: 'engineer' }, 'tsvector')
  t('tsvector uses plainto_tsquery', ts.text.includes('plainto_tsquery'))
  t('tsvector scores with ts_rank', ts.text.includes('ts_rank'))
  t('tsvector never emits @@@', !ts.text.includes('@@@'))

  // With no FTS index there is no text predicate to apply; the query must
  // still run as a browse rather than silently matching nothing.
  const none = buildSearchQuery({ q: 'engineer' }, 'none')
  t('mode "none" drops the text predicate', !none.text.includes('@@@') && !none.text.includes('tsquery'))
  t('mode "none" still returns rows', none.text.includes('FROM jobs'))
}

/* ---- Ordering ---- */
console.log('\n📑 Ordering and pagination:')
{
  // Relevance without a query orders by whatever the planner picks, which
  // reads as random. A browse must fall back to recency.
  const browse = buildSearchQuery({ sort: 'relevance' }, 'bm25')
  t('relevance sort without a query falls back to recency',
    browse.text.includes('ORDER BY posted_at DESC'), browse.text.split('ORDER BY')[1]?.trim())

  const relevant = buildSearchQuery({ q: 'engineer', sort: 'relevance' }, 'bm25')
  t('relevance sort with a query orders by score', /ORDER BY\s+score DESC/.test(relevant.text))

  // Without a unique tiebreaker, equal-scoring rows can swap between pages —
  // the same job shown twice and another never shown at all.
  for (const [name, built] of [
    ['relevance', buildSearchQuery({ q: 'a', sort: 'relevance' }, 'bm25')],
    ['recent', buildSearchQuery({ sort: 'recent' }, 'bm25')],
    ['quality', buildSearchQuery({ sort: 'quality' }, 'bm25')],
  ]) {
    const order = built.text.split('ORDER BY')[1] ?? ''
    t(`${name} ordering ends with the id tiebreaker`, /\bid\b/.test(order.split('LIMIT')[0]))
  }

  const capped = buildSearchQuery({ limit: 100000 }, 'bm25')
  t('limit is capped', capped.values.includes(100))
  const negative = buildSearchQuery({ limit: -5, offset: -20 }, 'bm25')
  t('negative limit becomes a sane minimum', negative.values.includes(1))
  t('negative offset becomes 0', negative.values.includes(0))
}

/* ---- Filters ---- */
console.log('\n🔎 Filters:')
{
  // remoteOnly:false means "no preference". Emitting `remote = FALSE` would
  // hide every remote job from the default search.
  const noPref = buildSearchQuery({ remoteOnly: false }, 'bm25')
  t('remoteOnly:false adds no remote predicate', !noPref.text.includes('remote ='))
  const remote = buildSearchQuery({ remoteOnly: true }, 'bm25')
  t('remoteOnly:true filters to remote', remote.text.includes('remote = TRUE'))

  // ANY($n) keeps a long multi-select to ONE parameter.
  const many = buildSearchQuery({ departments: Array.from({ length: 40 }, (_, i) => `d${i}`) }, 'bm25')
  t('a 40-value filter binds one parameter, not 40', many.values.length === 3,
    `${many.values.length} values`)
  t('multi-value filters use = ANY', many.text.includes('= ANY('))

  const empty = buildSearchQuery({ departments: [], countries: [] }, 'bm25')
  t('empty filter arrays add no clause', !empty.text.includes('ANY('))

  const count = buildCountQuery({ q: 'x', remoteOnly: true, departments: ['Eng'] }, 'bm25')
  t('count applies the same filters', count.text.includes('remote = TRUE') && count.text.includes('ANY('))
  t('count has no ORDER BY or LIMIT', !count.text.includes('ORDER BY') && !count.text.includes('LIMIT'))
}

/* ---- Upsert ---- */
console.log('\n💾 Upsert:')
{
  const rows = [
    { id: 'custom:ebay:R1', company: 'eBay', title: 'SWE', board_key: 'custom:ebay', first_seen_at: '2026-01-01' },
    { id: 'custom:ebay:R2', company: 'eBay', title: 'PM', board_key: 'custom:ebay', first_seen_at: '2026-02-01' },
  ]
  const up = buildUpsertQuery(rows)
  t('upsert binds every placeholder', bindingsAgree(up))
  t('upsert is a single multi-row statement', (up.text.match(/INSERT INTO/g) ?? []).length === 1)
  t('upsert resolves conflicts on id', up.text.includes('ON CONFLICT (id) DO UPDATE'))

  // first_seen_at is the delta cursor and the ghost-staleness basis. If a
  // refresh overwrote it, every job would look newly discovered forever.
  t('first_seen_at is preserved with LEAST', up.text.includes('first_seen_at = LEAST('))
  t('first_seen_at is not in the plain SET list', !/SET[^]*?first_seen_at = EXCLUDED/.test(up.text))
  t('last_seen_at IS refreshed', up.text.includes('last_seen_at = EXCLUDED.last_seen_at'))

  let threw = false
  try { buildUpsertQuery([]) } catch { threw = true }
  t('an empty upsert is rejected rather than emitting invalid SQL', threw)
}

/* ---- Prune ---- */
console.log('\n🧹 Prune:')
{
  const prune = buildPruneQuery('greenhouse:cloudflare', ['a', 'b'])
  t('prune binds every placeholder', bindingsAgree(prune))
  t('prune is scoped to one board', prune.text.includes('board_key ='))
  t('prune keeps the ids it was given', prune.text.includes('NOT (id = ANY('))

  // An ATS answering with an empty list (rate limit, tenant rename, outage)
  // is indistinguishable from "every role closed". Pruning on it would erase
  // a healthy employer's entire listing.
  let threw = false, msg = ''
  try { buildPruneQuery('greenhouse:cloudflare', []) } catch (e) { threw = true; msg = e.message }
  t('pruning on an empty crawl is refused', threw)
  t('the refusal explains why', /cannot be distinguished|failed fetch/.test(msg), msg)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
