import type { JobSource, SourceId, SourceTarget } from './types'
import {
  GreenhouseAdapter, LeverAdapter, AshbyAdapter, SmartRecruitersAdapter,
  RecruiteeAdapter, WorkdayAdapter, TeamtailorAdapter, PersonioAdapter,
  WorkableAdapter,
} from './adapters/ats'
import { CustomSiteAdapter } from './adapters/custom'
import { detectFromUrl } from './detector'

/**
 * Adapter registry.
 *
 * This is the seam the brief asks for: adding an ATS means writing one adapter
 * and registering it here. Discovery, ingestion, dedupe, ranking and the UI all
 * work through the `JobSource` interface and never name a platform.
 */

const ADAPTERS: JobSource[] = [
  new GreenhouseAdapter(),
  new LeverAdapter(),
  new AshbyAdapter(),
  new SmartRecruitersAdapter(),
  new RecruiteeAdapter(),
  new WorkdayAdapter(),
  new TeamtailorAdapter(),
  new PersonioAdapter(),
  new WorkableAdapter(),
  new CustomSiteAdapter(),
]

const BY_ID = new Map<SourceId, JobSource>(ADAPTERS.map((a) => [a.id, a]))

export function getAdapter(id: SourceId): JobSource | null {
  return BY_ID.get(id) ?? null
}

export function allAdapters(): JobSource[] {
  return [...ADAPTERS]
}

export function adapterIds(): SourceId[] {
  return ADAPTERS.map((a) => a.id)
}

/** Route a public URL to the adapter that can read it. */
export function adapterForUrl(url: string): { adapter: JobSource; target: SourceTarget } | null {
  const detected = detectFromUrl(url)
  if (detected.source === 'unknown' || !detected.target) return null
  const adapter = BY_ID.get(detected.source)
  if (!adapter) return null
  return { adapter, target: detected.target }
}

/** Health of every registered platform, for the observability dashboard. */
export async function healthCheckAll() {
  return Promise.all(ADAPTERS.map((a) => a.healthCheck()))
}
