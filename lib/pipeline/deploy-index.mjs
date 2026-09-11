/**
 * Build the bounded index that gets served, from jobs already in memory.
 *
 * WHY IT IS BUILT HERE RATHER THAN BY RE-READING THE FULL INDEX
 * ============================================================
 * The full index passed Node's ~512MB string ceiling at 530MB. Past that,
 * `JSON.parse(readFileSync(f))` throws ERR_STRING_TOO_LONG, so EVERY consumer
 * broke at once -- including the app loader, which caught the error and fell
 * through to a 14MB v1 snapshot, serving 9,648 jobs while 238,620 sat on disk.
 *
 * Regenerating the slice by re-reading that file would hit the same wall. The
 * ingest and refresh paths already hold the parsed records, so the slice is
 * produced there. That decouples serving from the archive's size: the archive
 * may grow without limit while the served index stays small and loadable.
 *
 * HOW THE SLICE IS CHOSEN
 * -----------------------
 * Not "the first N", and not a pure leaderboard either. Three passes:
 *
 *   0. FLOOR  -- every employer gets its best few postings, unconditionally.
 *   1. RANK   -- quality, freshness, recency, direct-apply, inverse ghost-risk,
 *                capped per employer so one 6,000-role company cannot consume
 *                the budget.
 *   2. FILL   -- spend any budget the cap left over, by rank.
 *
 * The floor is the pass that is easy to leave out and expensive to omit: a cap
 * alone restrains big employers without ever admitting small ones, so a company
 * with a single opening never appears at all. See pass 0 for the measurement.
 */

import { openSync, writeSync, closeSync, renameSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const SNIPPET = 200
const MAX_COMPANY_SHARE = 0.04

export function projectForDeploy(x) {
  return {
    id: x.id,
    source: x.source,
    company: x.company,
    companySlug: x.companySlug,
    companyDomain: x.companyDomain,
    title: x.title,
    normalizedTitle: x.normalizedTitle,
    description: (x.description || '').slice(0, SNIPPET),
    locationRaw: x.locationRaw,
    locationDisplay: x.locationDisplay,
    city: x.city,
    state: x.state,
    country: x.country,
    remote: x.remote,
    workplaceType: x.workplaceType,
    workplaceDisplay: x.workplaceDisplay,
    employmentType: x.employmentType,
    seniority: x.seniority,
    department: x.department,
    skills: (x.skills || []).slice(0, 12),
    salaryMin: x.salaryMin,
    salaryMax: x.salaryMax,
    salaryCurrency: x.salaryCurrency,
    postedAt: x.postedAt,
    firstSeenAt: x.firstSeenAt,
    freshnessScore: x.freshnessScore,
    applicationUrl: x.applicationUrl,
    isDirectApplication: x.isDirectApplication,
    visaStatus: x.visaStatus,
    visaEvidence: (x.visaEvidence || []).slice(0, 1),
    sponsorCountries: x.sponsorCountries,
    qualityScore: x.qualityScore,
    ghostRisk: x.ghostRisk,
    ghostLabel: x.ghostLabel,
    companyValuationUsd: x.companyValuationUsd,
    sourceCount: x.sourceCount,
  }
}

function scoreJob(j, now) {
  const quality = j.qualityScore ?? 0
  const fresh = j.freshnessScore ?? 0
  // A posting we can date beats one we cannot, and recent beats old -- but a
  // missing date is not evidence of staleness, so it scores neutral not zero.
  const ageDays = j.postedAt ? (now - new Date(j.postedAt).getTime()) / 86400000 : null
  const recency = ageDays === null ? 0.4 : Math.max(0, 1 - ageDays / 90)
  const direct = j.isDirectApplication ? 1 : 0
  const hasText = (j.description || '').length > 200 ? 1 : 0
  const ghost = 1 - (j.ghostRisk ?? 0)
  return 0.30 * quality + 0.20 * fresh + 0.20 * recency + 0.10 * direct + 0.10 * hasText + 0.10 * ghost
}

/**
 * Postings every known employer is guaranteed in the slice, regardless of how
 * its scores compare to the global field. The complement of MAX_COMPANY_SHARE:
 * that caps the loud, this floors the quiet.
 */
const MIN_PER_COMPANY = 3

export function selectForDeploy(jobs, budgetMb = 30) {
  const now = Date.now()
  const ranked = jobs
    .map((j) => ({ j, s: scoreJob(j, now) }))
    .sort((a, b) => b.s - a.s)

  // Sample the real serialised size rather than guessing.
  const sampleN = Math.min(2000, ranked.length)
  const sampleBytes = sampleN
    ? ranked.slice(0, sampleN).reduce(
        (n, { j }) => n + Buffer.byteLength(JSON.stringify(projectForDeploy(j))) + 1, 0) / sampleN
    : 1200

  const targetCount = Math.max(1, Math.floor((budgetMb * 1024 * 1024) / sampleBytes))
  const perCompanyCap = Math.max(20, Math.floor(targetCount * MAX_COMPANY_SHARE))

  const perCompany = new Map()
  const chosen = []
  const taken = new Set()

  // Pass 0 -- floor: every employer gets its best few postings, unconditionally.
  //
  // WHY THIS PASS EXISTS
  // Ranking globally and capping per company sounds fair, and is not. The cap
  // only restrains employers that are ALREADY winning; it does nothing for one
  // that never places a posting in the top `targetCount` at all. So whether an
  // employer appears in production was decided by whether its individual
  // postings out-scored a 241,859-job field -- which a company with one opening
  // will lose on volume alone, no matter how good that opening is.
  //
  // Measured, before this pass: 14 of the 114 recently funded employers had
  // just been added to the registry, crawled successfully, and were absent from
  // the deployed index entirely. Every one of them was small -- Socket 1
  // posting, Zed 1, Shield AI 1, Method 2, Halliday 2, Unit 3, Turnkey 13. The
  // slice was not showing the market; it was showing employers big enough to
  // brute-force their way into it, which inverts the point of tracking startups.
  //
  // A floor of 3 across 1,444 employers costs ~17% of the budget and makes
  // presence a property of being a known employer rather than of headcount.
  // The remaining 83% is still allocated purely by rank.
  for (const { j } of ranked) {
    if (chosen.length >= targetCount) break
    const n = perCompany.get(j.companySlug) ?? 0
    if (n >= MIN_PER_COMPANY) continue
    perCompany.set(j.companySlug, n + 1)
    chosen.push(j)
    taken.add(j.id)
  }

  // Pass 1 -- rank, up to the per-employer ceiling.
  for (const { j } of ranked) {
    if (chosen.length >= targetCount) break
    if (taken.has(j.id)) continue
    const n = perCompany.get(j.companySlug) ?? 0
    if (n >= perCompanyCap) continue
    perCompany.set(j.companySlug, n + 1)
    chosen.push(j)
    taken.add(j.id)
  }
  // Pass 2 -- backfill by rank if the ceiling left budget unspent.
  if (chosen.length < targetCount) {
    for (const { j } of ranked) {
      if (chosen.length >= targetCount) break
      if (taken.has(j.id)) continue
      chosen.push(j)
      taken.add(j.id)
    }
  }
  return {
    chosen,
    targetCount,
    perCompanyCap,
    minPerCompany: MIN_PER_COMPANY,
    companies: perCompany.size,
    bytesPerJob: Math.round(sampleBytes),
  }
}

export function writeDeployIndex(jobs, outPath, sourceMeta = {}, budgetMb = 30) {
  const { chosen, perCompanyCap, companies } = selectForDeploy(jobs, budgetMb)

  const head = {
    generatedAt: sourceMeta.generatedAt ?? new Date().toISOString(),
    builtAt: new Date().toISOString(),
    jobCount: chosen.length,
    deployment: {
      bounded: true,
      corpusTotal: jobs.length,
      budgetMb,
      descriptionChars: SNIPPET,
      perCompanyCap,
      minPerCompany: MIN_PER_COMPANY,
      companies,
      selection:
        `Every employer is guaranteed its best ${MIN_PER_COMPANY} postings, so presence in ` +
        'this slice reflects being a known employer rather than posting volume. The rest is ' +
        'ranked by posting quality, freshness, recency, direct-apply and ghost-risk, then ' +
        'capped per employer so no single company dominates.',
      note:
        'This deployment serves a bounded subset of the crawled corpus. Serving all of it ' +
        'needs Postgres or a search service; a JSON file cannot exceed Node\u2019s ~512MB ' +
        'string limit, which the full index has already passed.',
    },
    report: sourceMeta.report ?? null,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  // Temp + rename: a truncated destination reads as "index not available".
  const tmp = `${outPath}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try {
    const parts = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    writeSync(fd, `{${parts.join(',')},"jobs":[`)
    let buf = ''
    for (let i = 0; i < chosen.length; i++) {
      buf += (i ? ',' : '') + JSON.stringify(projectForDeploy(chosen[i]))
      if (buf.length > 4000000) { writeSync(fd, buf); buf = '' }
    }
    if (buf) writeSync(fd, buf)
    writeSync(fd, ']}')
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, outPath)
  return { count: chosen.length }
}
