import type { CanonicalJob } from '../sources/types'

/**
 * Merge a partial refresh into an existing index.
 *
 * WHY THIS IS ITS OWN MODULE
 * ==========================
 * This is the one operation in the pipeline that can destroy data. A full
 * ingest builds an index from nothing, so the worst it can do is produce a bad
 * index; a refresh REPLACES part of a good one, and getting the boundary wrong
 * silently deletes jobs that are still open. It is extracted here so the rules
 * below can be tested directly rather than by running a crawl and hoping.
 *
 * THE TWO RULES
 * -------------
 * 1. ONLY CRAWLED BOARDS MAY BE REPLACED. A hot-tier refresh touches
 *    Greenhouse and Ashby; if the merge treated "not in the fresh set" as
 *    "closed", every Workday job in the index would vanish on the first run.
 *    Boards absent from this pass are copied through untouched.
 *
 * 2. `firstSeenAt` SURVIVES. It records when THIS pipeline first observed a
 *    posting, which is the cursor /api/jobs/delta pages on and the basis for
 *    ghost-job staleness (Workday publishes no posted date, so first-seen is
 *    all there is). Resetting it on every refresh would make every job look
 *    newly discovered forever, and the delta feed would re-deliver the corpus
 *    on every poll.
 */

export interface MergeInput {
  existing: CanonicalJob[]
  fresh: CanonicalJob[]
  /**
   * Board keys successfully crawled in this pass, as `source|token|site`.
   * A board missing from this set is one we did not ask about, which is not
   * the same as one that returned nothing.
   */
  crawledBoards: Set<string>
  now?: string
}

export interface MergeResult {
  jobs: CanonicalJob[]
  added: number
  /** Seen again on a crawled board; keeps its original firstSeenAt. */
  updated: number
  /** Was on a crawled board and did not come back. */
  removed: number
  /** From boards this pass did not touch, passed through unchanged. */
  carriedThrough: number
}

/**
 * Board identity for a job: `source|token`.
 *
 * NOT source|token|site, though that was the first attempt. Job ids are
 * `${source}:${token}:${sourceId}` -- three segments, no site -- so the site a
 * posting came from is NOT recoverable from its id. Keying on a site parsed out
 * of position 2 actually reads the job id, so no job would ever match its own
 * board and every crawled board would look empty.
 *
 * Consequence worth stating: a tenant with several sites (Lloyds runs both
 * `lbg_Careers` and `Graduate_careers`) is ONE unit here. That is safe because
 * a tier refresh selects boards by provider, so every site on a tenant is
 * crawled in the same pass -- the union is complete before anything is
 * replaced. If that ever stops being true, this key must gain a site segment
 * AND the job id must start carrying one.
 */
export function boardKeyOf(job: Pick<CanonicalJob, 'id' | 'source'>): string {
  const parts = String(job.id ?? '').split(':')
  return `${job.source}|${parts[1] ?? ''}`
}

export function boardKeyOfTarget(t: { source: string; token: string; site?: string }): string {
  return `${t.source}|${t.token}`
}

export function mergeRefresh(input: MergeInput): MergeResult {
  const { existing, fresh, crawledBoards } = input
  const now = input.now ?? new Date().toISOString()

  const firstSeenById = new Map<string, string>()
  for (const j of existing) {
    if (j.firstSeenAt) firstSeenById.set(j.id, j.firstSeenAt)
  }

  const jobs: CanonicalJob[] = []
  let carriedThrough = 0

  // Rule 1: untouched boards pass through.
  for (const j of existing) {
    if (!crawledBoards.has(boardKeyOf(j))) {
      jobs.push(j)
      carriedThrough++
    }
  }

  // Crawled boards are represented by this pass's results only.
  let added = 0
  let updated = 0
  for (const j of fresh) {
    const prior = firstSeenById.get(j.id)
    if (prior) {
      // Rule 2: keep the original observation time.
      jobs.push({ ...j, firstSeenAt: prior })
      updated++
    } else {
      jobs.push({ ...j, firstSeenAt: j.firstSeenAt ?? now })
      added++
    }
  }

  const freshIds = new Set(fresh.map((j) => j.id))
  let removed = 0
  for (const j of existing) {
    if (crawledBoards.has(boardKeyOf(j)) && !freshIds.has(j.id)) removed++
  }

  return { jobs, added, updated, removed, carriedThrough }
}

/**
 * Would this merge lose an implausible share of the index?
 *
 * A refresh that halves the corpus is a bug in the merge, not a collapse in the
 * job market. Writing it would be unrecoverable without a full re-crawl, so the
 * caller refuses instead. Returns the reason, or null when the write is safe.
 */
export function unsafeMergeReason(
  existingCount: number,
  mergedCount: number,
  threshold = 0.5
): string | null {
  if (existingCount === 0) return null
  if (mergedCount >= existingCount * threshold) return null
  return (
    `merge produced ${mergedCount} jobs from ${existingCount} ` +
    `(below ${Math.round(threshold * 100)}%), which indicates a merge fault rather than market change`
  )
}
