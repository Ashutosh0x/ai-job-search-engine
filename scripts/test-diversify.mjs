/**
 * Result diversification.
 *
 * WHY IT EXISTS
 * -------------
 * Mass-hiring employers post one requisition per seat. Accenture carries 1,945
 * separate requisition IDs for "Custom Software Engineer" in Bangalore, each
 * with its own id and application URL. They are NOT duplicates, and removing
 * them would destroy recall for the people searching those roles.
 *
 * But relevance sorting puts near-identical postings next to each other.
 * MEASURED over the served index before this existed, page 1 of 20:
 *
 *   q=engineer, location=Chennai     16 of 20 from Accenture, 6 distinct titles
 *
 * TWO REGIMES
 * -----------
 * These tests pin both, because only one of them is a guarantee:
 *
 *   SUPPLY ALLOWS IT   the quota holds exactly.
 *   SUPPLY DOES NOT    an employer holding 80% of the matches cannot be held to
 *                      15% of a page without DROPPING results, which is never
 *                      the right trade. The quota degrades; it does not drop.
 *
 * And in both regimes the reordering must be lossless and deterministic,
 * because pagination slices the array it produces.
 */
import { diversify } from '../lib/search/diversify.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

const rowsFrom = (spec) => {
  const out = []
  for (const [company, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) out.push({ company, i, id: `${company}-${i}` })
  }
  return out
}
const blockCounts = (rows, blockSize) => {
  const blocks = []
  for (let b = 0; b * blockSize < rows.length; b++) {
    const m = new Map()
    for (const r of rows.slice(b * blockSize, (b + 1) * blockSize)) {
      m.set(r.company, (m.get(r.company) ?? 0) + 1)
    }
    blocks.push(m)
  }
  return blocks
}

/* ===================== losslessness, always ============================== */
{
  const input = rowsFrom({ acme: 160, globex: 10, initech: 10, umbrella: 10, hooli: 10 })
  const out = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })

  t('length is unchanged', out.length === input.length, { in: input.length, out: out.length })
  t('every row survives exactly once',
    new Set(out.map((r) => r.id)).size === input.length, new Set(out.map((r) => r.id)).size)
  t('no row is invented',
    out.every((r) => input.some((s) => s.id === r.id)))
  t('per-company totals are unchanged', (() => {
    const before = new Map(), after = new Map()
    for (const r of input) before.set(r.company, (before.get(r.company) ?? 0) + 1)
    for (const r of out) after.set(r.company, (after.get(r.company) ?? 0) + 1)
    return [...before].every(([k, v]) => after.get(k) === v)
  })())
}

/* ===================== determinism ======================================= */
{
  const input = rowsFrom({ acme: 50, globex: 30, initech: 20 })
  const a = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })
  const b = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })
  t('the same input yields the same output',
    JSON.stringify(a.map((r) => r.id)) === JSON.stringify(b.map((r) => r.id)))
  // Pagination slices this array, so a second call must not reshuffle it.
  const c = diversify([...input], (r) => r.company, { perCompany: 3, blockSize: 20 })
  t('a copied input yields the same output',
    JSON.stringify(a.map((r) => r.id)) === JSON.stringify(c.map((r) => r.id)))
}

/* ============ regime 1: the quota HOLDS when supply allows =============== */
// Five employers, none dominant: every block can be filled inside the quota.
{
  const input = rowsFrom({ acme: 40, globex: 40, initech: 40, umbrella: 40, hooli: 40 })
  const out = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 15 })
  const blocks = blockCounts(out, 15)
  const worst = Math.max(...blocks.flatMap((m) => [...m.values()]))
  t('no employer exceeds the quota in any block', worst <= 3, worst)
  t('and every block is shared between employers',
    blocks.every((m) => m.size >= 3), blocks.map((m) => m.size).slice(0, 5))
}

/* ====== regime 2: a dominant employer degrades, it does not vanish ======= */
// acme is 80% of the matches. Holding it to 3-in-20 would mean dropping rows.
{
  const input = rowsFrom({ acme: 160, globex: 10, initech: 10, umbrella: 10, hooli: 10 })
  const out = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })
  const blocks = blockCounts(out, 20)

  t('the dominant employer keeps all of its rows',
    out.filter((r) => r.company === 'acme').length === 160)

  const first = blocks[0]
  t('page 1 is still shared between several employers', first.size >= 4, [...first])
  t('page 1 is not owned by one employer', first.get('acme') <= 10, first.get('acme'))
  t('the minority employers reach page 1',
    ['globex', 'initech', 'umbrella', 'hooli'].every((c) => (first.get(c) ?? 0) >= 3), [...first])

  // Once the minority is exhausted the remainder is necessarily the dominant
  // employer -- that is the corpus, not a bug.
  const last = blocks[blocks.length - 1]
  t('the tail is allowed to be one employer', last.get('acme') > 0)
}

/* ============ a single-employer result set still fills pages ============= */
// Capping a search that legitimately matches one employer would show 3 results
// and hide the rest, which is the worst possible reading of "diversify".
{
  const input = rowsFrom({ acme: 57 })
  const out = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })
  t('every row is kept', out.length === 57)
  t('the first page is full', out.slice(0, 20).length === 20)
  t('order is preserved when there is nothing to interleave',
    out.every((r, i) => r.id === input[i].id))
}

/* ============================ edge cases ================================= */
{
  t('an empty list is returned as-is', diversify([], (r) => r.company).length === 0)
  t('a single row is returned as-is', diversify([{ company: 'a', id: '1' }], (r) => r.company).length === 1)
  t('a list shorter than the quota is untouched', (() => {
    const input = rowsFrom({ acme: 2 })
    const out = diversify(input, (r) => r.company, { perCompany: 3, blockSize: 20 })
    return out.length === 2 && out[0].id === input[0].id
  })())
  t('a zero blockSize is a no-op rather than a hang',
    diversify(rowsFrom({ acme: 10 }), (r) => r.company, { blockSize: 0 }).length === 10)

  /**
   * Everything past the window keeps its incoming order, so the cost stays
   * bounded on very large result sets.
   *
   * The window is a prefix of the INPUT, so interleaving can only draw on
   * employers that appear within it. That is the intended trade: clustering
   * only matters where people actually look, and 2,000 rows is 100 pages.
   */
  {
    const input = rowsFrom({ acme: 10, globex: 10, initech: 10 })
    const out = diversify(input, (r) => r.company, { perCompany: 2, blockSize: 10, window: 20 })

    t('rows past the window keep their incoming order',
      out.slice(20).every((r, i) => r.id === input[20 + i].id),
      out.slice(20).map((r) => r.id))
    t('and the employers inside the window are interleaved',
      new Set(out.slice(0, 10).map((r) => r.company)).size === 2,
      out.slice(0, 10).map((r) => r.company))
    t('nothing is lost across the window boundary',
      new Set(out.map((r) => r.id)).size === 30)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
