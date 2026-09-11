import type { CanonicalJob, SourceTarget, SourceId, RawJob } from '../sources/types'
import { getAdapter, adapterForUrl } from '../sources/registry'
import { normalizeJob, computeFreshness, detectReposts } from './normalize'
import { deduplicate, type DedupeResult } from './dedupe'
import { resolveAmbiguousLocations } from './resolve-locations'
import { assessJob } from './quality'
import { httpStats } from '../sources/http'

/**
 * Ingestion orchestrator.
 *
 * The pipeline runs as independent stages (§23):
 *
 *   DISCOVERY -> FETCH -> PARSE -> NORMALIZE -> DEDUPE -> ENRICH -> VERIFY -> INDEX
 *
 * The rule that matters: **a failure in an optional stage must not destroy the
 * base job.** The brief calls this out (§36) because the previous ingest had
 * exactly that defect -- running without market-cap enrichment dropped
 * valuation coverage from 28 companies to 17, because enrichment was welded
 * into the same pass as ingestion.
 *
 * Here ingestion is mandatory and enrichment is optional-by-construction:
 * enrichment runs after jobs are already final, receives a copy, and writes
 * back only on success. If it throws, times out, or is skipped entirely, the
 * jobs are unchanged and `companyValuationUsd` stays null -- a known-unknown,
 * not a lost record.
 */

export interface TargetRun {
  target: SourceTarget
  ok: boolean
  jobCount: number
  durationMs: number
  error?: string
  warnings: string[]
}

export interface IngestReport {
  startedAt: string
  finishedAt: string
  durationMs: number

  totalCompanies: number
  totalJobsRaw: number
  totalJobsCanonical: number
  duplicatesRemoved: number
  dedupeTiers: Record<string, number>

  newJobs: number
  updatedJobs: number
  unchangedJobs: number
  closedJobs: number
  reposts: number

  directApplicationUrls: number
  jobsWithCity: number
  jobsWithCountry: number
  jobsWithSalary: number
  jobsWithPostedDate: number

  companiesWithValuation: number
  enrichmentRan: boolean
  enrichmentError: string | null
  descriptionsHydrated: number
  locationsResolved: number
  rejectedByValidation: number
  suspectedGhostJobs: number
  avgQualityScore: number

  sourcesSucceeded: number
  sourcesFailed: number
  bySource: Record<string, { targets: number; jobs: number; failures: number; avgMs: number }>
  topSources: { source: string; jobs: number }[]
  topCompanies: { company: string; jobs: number }[]
  failureReasons: { reason: string; count: number }[]
  avgSourceResponseMs: number
  http: ReturnType<typeof httpStats>
  runs: TargetRun[]
}

export interface PreviousState {
  /** contentHash by job id, for change detection. */
  hashes: Record<string, string>
  /** earliest postedAt by requisitionKey, for repost detection. */
  firstPosted: Record<string, string>
  /** ids present in the last run, for closed-job detection. */
  knownIds: string[]
}

export interface IngestOptions {
  targets: SourceTarget[]
  concurrency?: number
  /** Per-source concurrency override. */
  perSourceConcurrency?: Partial<Record<SourceId, number>>
  previous?: PreviousState
  /**
   * Optional company enrichment. Receives the finished jobs and returns
   * valuations by company slug. Any failure is caught and recorded; jobs are
   * never modified on failure.
   */
  enrich?: (jobs: CanonicalJob[]) => Promise<Record<string, number | null>>
  enrichTimeoutMs?: number
  /**
   * Optionally hydrate missing descriptions via each adapter's fetchJob.
   * Bounded and failure-isolated: a job whose detail fetch fails keeps the
   * record it already had.
   */
  hydrateDescriptions?: { maxJobs: number; concurrency?: number }
  onProgress?: (done: number, total: number, label: string) => void
  signal?: AbortSignal
}

/** Bounded parallel map that never lets one slow target stall the pool. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (queue.length) {
        const item = queue.shift()!
        results.push(await worker(item))
      }
    })
  )
  return results
}

export async function runIngest(options: IngestOptions): Promise<{
  jobs: CanonicalJob[]
  report: IngestReport
  state: PreviousState
}> {
  const {
    targets,
    concurrency = 8,
    previous = { hashes: {}, firstPosted: {}, knownIds: [] },
    enrich,
    enrichTimeoutMs = 120_000,
    onProgress,
    signal,
  } = options

  const startedAt = new Date()
  const runs: TargetRun[] = []
  const rawJobs: RawJob[] = []

  /* ---------------------------- FETCH + PARSE ----------------------------- */

  let done = 0
  await pooled(targets, concurrency, async (target) => {
    const t0 = Date.now()
    const adapter = getAdapter(target.source, target.token, target.host)

    if (!adapter) {
      runs.push({
        target, ok: false, jobCount: 0, durationMs: 0,
        error: `no adapter for ${target.source}`, warnings: [],
      })
      return
    }

    try {
      const result = await adapter.fetchJobs(target, { signal })
      rawJobs.push(...result.jobs)
      runs.push({
        target, ok: true, jobCount: result.jobs.length,
        durationMs: Date.now() - t0, warnings: result.warnings,
      })
    } catch (err) {
      // One dead board must never abort the run.
      runs.push({
        target, ok: false, jobCount: 0, durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err), warnings: [],
      })
    } finally {
      done++
      onProgress?.(done, targets.length, `${target.source}/${target.token}`)
    }
  })

  /* ------------------------------ NORMALIZE ------------------------------- */

  const normalized: CanonicalJob[] = []
  for (const raw of rawJobs) {
    try {
      normalized.push(normalizeJob(raw))
    } catch {
      // Normalisation is pure, but a pathological posting should still not
      // take the batch down.
    }
  }

  /* -------------------- AMBIGUOUS LOCATION RESOLUTION --------------------- */
  //
  // Runs before dedupe so duplicate detection compares corrected locations.
  // A code like "IN" cannot be settled from one row; the corpus can settle it.
  const locationResolution = resolveAmbiguousLocations(normalized)
  const locationsResolved = locationResolution.report.resolvedRows
  const resolvedJobs = locationResolution.jobs

  /* -------------------------------- DEDUPE -------------------------------- */

  const dedupeResult: DedupeResult = deduplicate(resolvedJobs)
  let jobs = dedupeResult.jobs

  /* ------------------------- FRESHNESS + REPOSTS -------------------------- */

  const repostResult = detectReposts(jobs, previous.firstPosted)
  jobs = repostResult.jobs.map((job) => ({
    ...job,
    freshnessScore: computeFreshness(job).score,
  }))

  /* --------------------- QUALITY + GHOST ASSESSMENT ----------------------- */
  //
  // Ghost risk is an inference and is treated as one: a suspected posting is
  // ranked lower and labelled with its evidence, never removed. Only a
  // CRITICAL validation failure keeps a job out of the index.
  let rejected = 0
  const assessed = jobs.map((job) => {
    const a = assessJob(job, { firstSeenAt: job.firstSeenAt })
    if (!a.shouldIndex) rejected++
    return {
      ...job,
      qualityScore: a.qualityScore,
      qualityIssues: a.issues,
      ghostRisk: a.ghostRisk,
      ghostLabel: a.ghostLabel,
      ghostSignals: a.ghostSignals.map((s) => ({ signal: s.signal, evidence: s.evidence })),
      shouldIndex: a.shouldIndex,
    }
  })
  jobs = assessed.filter((j) => (j as any).shouldIndex).map(({ shouldIndex, ...rest }: any) => rest)
  const rejectedByValidation = rejected

  /* --------------------------- CHANGE DETECTION --------------------------- */

  let newJobs = 0
  let updatedJobs = 0
  let unchangedJobs = 0
  for (const job of jobs) {
    const prevHash = previous.hashes[job.id]
    if (!prevHash) newJobs++
    else if (prevHash !== job.contentHash) updatedJobs++
    else unchangedJobs++
  }

  // Anything we saw last time and did not see now is a closed-job candidate.
  // Recorded, never deleted (§15).
  const currentIds = new Set(jobs.map((j) => j.id))
  const closedJobs = previous.knownIds.filter((id) => !currentIds.has(id)).length

  /* ----------------------- DESCRIPTION HYDRATION -------------------------- */
  //
  // Optional. Listing endpoints for SmartRecruiters and Workday carry no
  // description, which caps visa classification at "not mentioned" for those
  // sources. Re-classifying after hydration is what makes the visa feature work
  // on more than a third of the corpus.

  let hydrated = 0
  if (options.hydrateDescriptions) {
    const { maxJobs, concurrency: hc = 6 } = options.hydrateDescriptions
    const needsText = jobs
      .map((job, index) => ({ job, index }))
      .filter(({ job }) => (job.description ?? '').length < 200)
      .slice(0, maxJobs)

    await pooled(needsText, hc, async ({ job, index }) => {
      const url = job.canonicalUrl || job.applicationUrl
      // Resolve the target from the posting's OWN URL rather than rebuilding it
      // from the id. The id carries only `token`, so the old reconstruction
      // silently dropped `host` and `site` -- and for every sharded platform
      // (Workday above all) the detail endpoint cannot be addressed without
      // them. That is why hydration produced nothing for ~48% of the corpus
      // even once an adapter implemented `fetchJob`.
      const routed = url ? adapterForUrl(url) : null
      const token = job.id.split(':')[1]
      const adapter = routed?.adapter ?? getAdapter(job.source, token)
      if (!adapter?.fetchJob) return
      try {
        const target: SourceTarget = routed?.target ?? { source: job.source, token }
        const detail = await adapter.fetchJob(target, job.sourceId, { url })
        if (!detail) return
        // Re-normalise so visa/workplace/skills all see the new text.
        const renormalized = normalizeJob({ ...detail, target })
        jobs[index] = {
          ...jobs[index],
          description: renormalized.description,
          visaStatus: renormalized.visaStatus,
          visaConfidence: renormalized.visaConfidence,
          visaEvidence: renormalized.visaEvidence,
          visaTypes: renormalized.visaTypes,
          visaCountries: renormalized.visaCountries,
          workAuthorizationRequired: renormalized.workAuthorizationRequired,
          workplaceType: renormalized.workplaceType,
          workplaceDisplay: renormalized.workplaceDisplay,
          workplaceEvidence: renormalized.workplaceEvidence,
          remoteScope: renormalized.remoteScope,
          remoteCountries: renormalized.remoteCountries,
          officeDaysPerWeek: renormalized.officeDaysPerWeek,
          remote: renormalized.remote,
          skills: renormalized.skills,
          technologies: renormalized.technologies,
          seniority: renormalized.seniority ?? jobs[index].seniority,

          // FILL, never overwrite. The detail payload is richer for the fields
          // the list endpoint omits, but it is not automatically better for the
          // ones the list endpoint already had -- and clobbering a real value
          // with a null from a partial detail response would be a regression
          // dressed up as an enrichment.
          postedAt: jobs[index].postedAt ?? renormalized.postedAt,
          department: jobs[index].department ?? renormalized.department,
          employmentType: jobs[index].employmentType ?? renormalized.employmentType,
          city: jobs[index].city ?? renormalized.city,
          state: jobs[index].state ?? renormalized.state,
          country: jobs[index].country ?? renormalized.country,
          locationDisplay: jobs[index].locationDisplay ?? renormalized.locationDisplay,
        }
        // Freshness is derived from postedAt, so it has to be recomputed for
        // the jobs that just acquired one -- otherwise a posting hydrated to
        // "posted 2 days ago" keeps the freshness of a job with no date.
        if (!job.postedAt && renormalized.postedAt) {
          jobs[index].freshnessScore = computeFreshness(jobs[index]).score
        }
        hydrated++
      } catch {
        // Keep the un-hydrated record; a detail fetch failure is not fatal.
      }
    })
  }

  /* ------------------------------- ENRICH --------------------------------- */
  //
  // Optional and isolated. Jobs are already final at this point; enrichment can
  // only add a valuation, never remove or invalidate a record.

  let enrichmentRan = false
  let enrichmentError: string | null = null

  if (enrich) {
    try {
      const valuations = await Promise.race([
        enrich(jobs),
        new Promise<Record<string, number | null>>((_, reject) =>
          setTimeout(() => reject(new Error('enrichment timed out')), enrichTimeoutMs)
        ),
      ])
      // Apply only what actually resolved. A company missing from the map keeps
      // companyValuationUsd === null, which the UI renders as "Not disclosed".
      jobs = jobs.map((job) => {
        const v = valuations[job.companySlug]
        return typeof v === 'number' ? { ...job, companyValuationUsd: v } : job
      })
      enrichmentRan = true
    } catch (err) {
      enrichmentError = err instanceof Error ? err.message : String(err)
      // Deliberately no rethrow and no mutation: the ingest still succeeds.
    }
  }

  /* -------------------------------- REPORT -------------------------------- */

  const bySource: IngestReport['bySource'] = {}
  for (const run of runs) {
    const key = run.target.source
    const entry = bySource[key] ?? { targets: 0, jobs: 0, failures: 0, avgMs: 0 }
    entry.targets++
    entry.jobs += run.jobCount
    if (!run.ok) entry.failures++
    entry.avgMs += run.durationMs
    bySource[key] = entry
  }
  for (const entry of Object.values(bySource)) {
    entry.avgMs = entry.targets ? Math.round(entry.avgMs / entry.targets) : 0
  }

  const companyCounts = new Map<string, number>()
  for (const job of jobs) companyCounts.set(job.company, (companyCounts.get(job.company) ?? 0) + 1)

  const failureCounts = new Map<string, number>()
  for (const run of runs) {
    if (run.ok) continue
    const reason = (run.error ?? 'unknown').replace(/\d+/g, 'N').slice(0, 80)
    failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1)
  }

  const finishedAt = new Date()
  const durations = runs.map((r) => r.durationMs).filter((d) => d > 0)

  const report: IngestReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),

    totalCompanies: new Set(jobs.map((j) => j.companySlug)).size,
    totalJobsRaw: rawJobs.length,
    totalJobsCanonical: jobs.length,
    duplicatesRemoved: dedupeResult.duplicatesRemoved,
    dedupeTiers: dedupeResult.tierCounts,

    newJobs,
    updatedJobs,
    unchangedJobs,
    closedJobs,
    reposts: repostResult.repostCount,

    directApplicationUrls: jobs.filter((j) => j.isDirectApplication).length,
    jobsWithCity: jobs.filter((j) => j.city).length,
    jobsWithCountry: jobs.filter((j) => j.country).length,
    jobsWithSalary: jobs.filter((j) => j.salaryMin || j.salaryMax).length,
    jobsWithPostedDate: jobs.filter((j) => j.postedAt).length,

    companiesWithValuation: new Set(
      jobs.filter((j) => j.companyValuationUsd).map((j) => j.companySlug)
    ).size,
    enrichmentRan,
    enrichmentError,
    descriptionsHydrated: hydrated,
    locationsResolved,
    rejectedByValidation,
    suspectedGhostJobs: jobs.filter((j: any) => (j.ghostRisk ?? 0) >= 0.5).length,
    avgQualityScore:
      jobs.length === 0 ? 0
      : Math.round((jobs.reduce((s, j: any) => s + (j.qualityScore ?? 0), 0) / jobs.length) * 1000) / 1000,

    sourcesSucceeded: runs.filter((r) => r.ok).length,
    sourcesFailed: runs.filter((r) => !r.ok).length,
    bySource,
    topSources: Object.entries(bySource)
      .map(([source, v]) => ({ source, jobs: v.jobs }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 20),
    topCompanies: [...companyCounts.entries()]
      .map(([company, jobs]) => ({ company, jobs }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 20),
    failureReasons: [...failureCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    avgSourceResponseMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    http: httpStats(),
    runs,
  }

  /* -------------------------------- STATE --------------------------------- */

  const state: PreviousState = {
    hashes: Object.fromEntries(jobs.map((j) => [j.id, j.contentHash])),
    firstPosted: {
      ...previous.firstPosted,
      ...Object.fromEntries(
        jobs
          .filter((j) => j.requisitionKey && j.postedAt)
          .map((j) => [j.requisitionKey!, previous.firstPosted[j.requisitionKey!] ?? j.postedAt!])
      ),
    },
    knownIds: jobs.map((j) => j.id),
  }

  return { jobs, report, state }
}
