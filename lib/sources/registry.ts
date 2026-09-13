import type { JobSource, SourceId, SourceTarget } from './types'
import {
  GreenhouseAdapter, LeverAdapter, AshbyAdapter, SmartRecruitersAdapter,
  RecruiteeAdapter, WorkdayAdapter, TeamtailorAdapter, PersonioAdapter,
  WorkableAdapter, MokaHrAdapter, KekaAdapter,
} from './adapters/ats'
import { CustomSiteAdapter } from './adapters/custom'
import { EightfoldAdapter, AmazonAdapter, OracleRecruitingAdapter } from './adapters/enterprise'
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
  new MokaHrAdapter(),
  new KekaAdapter(),
  new KekaAdapter(),
  new EightfoldAdapter(),
  new CustomSiteAdapter(),
]

const BY_ID = new Map<SourceId, JobSource>(ADAPTERS.map((a) => [a.id, a]))

const AMAZON = new AmazonAdapter()
const ORACLE_RECRUITING = new OracleRecruitingAdapter()

/**
 * Amazon's portal is bespoke, so it shares the `custom` SourceId rather than
 * claiming a platform of its own. Route by target token when one is supplied.
 */
export function getAdapter(id: SourceId, token?: string, host?: string): JobSource | null {
  if (id === 'custom' && token === 'amazon') return AMAZON
  // Oracle Recruiting Cloud rides the `custom` id. Route on EITHER the vendor
  // host or the site-number token shape.
  //
  // Host alone is not enough: large tenants front ORC on their own domain --
  // Dell serves it from enterpriseplatform.dell.com and Honeywell from
  // careers.honeywell.com, neither of which matches *.oraclecloud.com. Dell
  // silently returned 0 jobs because of exactly that, falling through to the
  // generic custom adapter which cannot read an ORC API.
  //
  // `CX_<n>` is the ORC site-number convention and is distinctive enough to
  // route on: nothing else in this registry uses a token of that shape.
  if (id === 'custom' && host && /oraclecloud\.com$/i.test(host)) return ORACLE_RECRUITING
  if (id === 'custom' && token && /^CX_\d+$/i.test(token)) return ORACLE_RECRUITING
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
