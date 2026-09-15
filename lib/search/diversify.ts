/**
 * Spread results so one employer cannot own the whole first page.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Mass-hiring employers post one requisition per seat. Accenture carries 1,945
 * separate requisition IDs for "Custom Software Engineer" in Bangalore alone,
 * each with its own id and its own application URL. They are NOT duplicates --
 * every one is a real, separately-applicable opening, and removing them would
 * destroy recall for exactly the people searching those roles.
 *
 * But relevance sorting puts near-identical postings next to each other, so the
 * first page becomes one job repeated. MEASURED over the served index, page 1
 * of 20 results:
 *
 *   q=engineer, location=Chennai        16 of 20 from Accenture, 6 distinct titles
 *   q=software engineer, Bangalore       9 of 20 from Accenture, 8 distinct titles
 *
 * A page that shows six distinct jobs out of twenty is not a ranking problem,
 * it is a presentation problem: the ranking is right and the page is useless.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not deduplication. Nothing is dropped, nothing is merged, `total` does not
 * change. This is a pure reordering: every posting that was in the list is
 * still in the list, exactly once.
 *
 * STABILITY
 * ---------
 * Pagination reads slices of one array, so the reordering must be deterministic
 * and computed over the whole list rather than per page -- otherwise a posting
 * could appear on two pages or on none. This reorders a bounded prefix once,
 * from the sorted input alone, with no randomness and no dependence on which
 * page was asked for.
 */

/** How many results one employer may hold within a single page-sized block. */
export const PER_COMPANY_PER_BLOCK = 3

/**
 * How far into the result list to reorder.
 *
 * Clustering only matters where people actually look. Reordering 40,000 rows to
 * fix the first few pages is work nobody reads, so the prefix is bounded and
 * everything past it keeps its sorted order. 2,000 rows is 100 pages of 20.
 */
export const DIVERSIFY_WINDOW = 2000

/**
 * Reorder `rows` so that no `blockSize`-sized block holds more than
 * `perCompany` entries from the same employer, where that is possible.
 *
 * The quota is a preference, not a guarantee: when a block cannot be filled any
 * other way -- a search that legitimately only matches one employer -- the
 * quota is relaxed rather than leaving a gap. Dropping a result to satisfy a
 * display rule would be the wrong trade every time.
 */
export function diversify<T>(
  rows: T[],
  keyOf: (row: T) => string,
  opts: { perCompany?: number; blockSize?: number; window?: number } = {},
): T[] {
  const perCompany = opts.perCompany ?? PER_COMPANY_PER_BLOCK
  const blockSize = opts.blockSize ?? 20
  const window = opts.window ?? DIVERSIFY_WINDOW

  if (rows.length <= perCompany || blockSize <= 0) return rows

  const head = rows.slice(0, window)
  const tail = rows.slice(window)

  const out: T[] = []
  /** Rows passed over because their employer was already at quota. */
  const deferred: T[] = []
  let i = 0
  let blockCount = new Map<string, number>()
  let inBlock = 0

  const take = (row: T) => {
    const k = keyOf(row)
    blockCount.set(k, (blockCount.get(k) ?? 0) + 1)
    out.push(row)
    inBlock++
    if (inBlock === blockSize) {
      // New block: quotas reset, so a big employer gets another slot rather
      // than being pushed out of the results entirely.
      blockCount = new Map()
      inBlock = 0
    }
  }

  const eligible = (row: T) => (blockCount.get(keyOf(row)) ?? 0) < perCompany

  while (i < head.length || deferred.length) {
    // Deferred rows first: they were ranked higher than whatever is at `i`, so
    // holding them back any longer than the quota requires would be a real
    // relevance loss rather than a cosmetic one.
    const di = deferred.findIndex(eligible)
    if (di >= 0) {
      take(deferred.splice(di, 1)[0])
      continue
    }

    if (i < head.length) {
      const row = head[i++]
      if (eligible(row)) take(row)
      else deferred.push(row)
      continue
    }

    // Only over-quota rows are left. Relax rather than drop: emit the oldest
    // deferred row and let the quota rebuild on the next block.
    take(deferred.shift()!)
  }

  return out.concat(tail)
}
