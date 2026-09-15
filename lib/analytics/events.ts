import { z } from 'zod'

/**
 * The analytics event model.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Answering which jobs, companies, searches and sources actually drive
 * engagement -- and, just as importantly, which searches return nothing, which
 * is the signal for what to crawl next.
 *
 * WHAT IS DELIBERATELY NOT COLLECTED
 * ----------------------------------
 * No IP address is stored. No user agent string is stored. No email, name or
 * account identifier is stored on an event. No free-text beyond the search
 * query the user typed into a public search box.
 *
 * What IS stored is derived and coarse: a rotating session id, a device
 * CATEGORY, a browser FAMILY, an OS FAMILY, and a country. Each of those is a
 * bucket with thousands of members, which is what makes them useful for product
 * decisions and useless for identifying a person.
 *
 * The raw IP is used once, in memory, to derive the country and to salt the
 * session hash, and is never written anywhere. See lib/analytics/identity.ts.
 *
 * WHY ZOD AND NOT A FREE-FORM JSONB BLOB
 * --------------------------------------
 * An events table with an untyped `metadata` column becomes unqueryable within
 * a month: every producer invents its own key names and no aggregation can rely
 * on anything. Every field below is declared, validated at the boundary, and
 * rejected if it does not fit. `metadata` exists but is bounded and typed.
 */

/* ------------------------------ event types ------------------------------- */

/**
 * The funnel, in order:
 *
 *   search -> search_result_impression -> job_detail_view -> apply_click
 *          -> external_redirect
 *
 * `search_result_impression` is emitted for results the user ACTUALLY SAW, not
 * for everything the API returned -- see the note on `position` below.
 */
export const EVENT_TYPES = [
  'page_view',
  'search',
  'search_result_impression',
  'job_detail_view',
  'company_view',
  'apply_click',
  'external_redirect',
  'filter_change',
  'sort_change',
  'pagination',
  'save_job',
  'share_job',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Events the browser may report. The rest are server-authored only. */
export const CLIENT_EVENT_TYPES: readonly EventType[] = [
  'page_view',
  'search',
  'search_result_impression',
  'job_detail_view',
  'company_view',
  'filter_change',
  'sort_change',
  'pagination',
  'save_job',
  'share_job',
]

/**
 * `apply_click` and `external_redirect` are NOT in that list on purpose.
 *
 * They are the two events that matter most commercially, so they are the two
 * most worth forging. Both are written by the server inside the /go/job
 * redirect, where the job id has been resolved against the real index and the
 * redirect actually happened. A browser cannot assert either of them.
 */
export const SERVER_ONLY_EVENT_TYPES: readonly EventType[] = ['apply_click', 'external_redirect']

/* -------------------------------- limits ---------------------------------- */

/**
 * Field caps. Every one of these is a rejection boundary, not a truncation
 * point, for anything a caller controls -- silently truncating an oversized
 * field hides an abusive or broken client instead of surfacing it.
 */
export const LIMITS = {
  /** Long enough for a real search, short enough to not be a payload vector. */
  query: 200,
  jobId: 200,
  companySlug: 128,
  path: 256,
  /** Number of filter entries on one event. */
  filters: 24,
  filterKey: 48,
  filterValue: 96,
  /** Events accepted in one POST. */
  batch: 50,
  /** Bytes of JSON accepted in one POST. */
  body: 64 * 1024,
  metadataKeys: 8,
  metadataValue: 200,
} as const

/* ------------------------------- primitives -------------------------------- */

const deviceCategory = z.enum(['mobile', 'tablet', 'desktop', 'bot', 'unknown'])
const browserFamily = z.enum(['chrome', 'safari', 'firefox', 'edge', 'opera', 'samsung', 'other', 'bot'])
const osFamily = z.enum(['windows', 'macos', 'ios', 'android', 'linux', 'other'])
/** Where the visit came from, as a class -- never the full referring URL. */
const referrerCategory = z.enum(['direct', 'search_engine', 'social', 'internal', 'external', 'unknown'])

/**
 * Filters, as a bounded key/value map.
 *
 * Values are stringified by the caller so the shape is uniform and groupable.
 * A filter combination is one of the most useful things this system can report
 * ("Remote + United States + Engineering"), and that only works if the
 * representation is stable.
 */
const filterMap = z
  .record(z.string().max(LIMITS.filterKey), z.string().max(LIMITS.filterValue))
  .refine((m) => Object.keys(m).length <= LIMITS.filters, {
    message: `at most ${LIMITS.filters} filters per event`,
  })

/** Small, typed extras. Not a dumping ground: string values only, and few. */
const metadata = z
  .record(z.string().max(48), z.union([z.string().max(LIMITS.metadataValue), z.number(), z.boolean()]))
  .refine((m) => Object.keys(m).length <= LIMITS.metadataKeys, {
    message: `at most ${LIMITS.metadataKeys} metadata keys`,
  })

/* ---------------------------- the client event ---------------------------- */

/**
 * What a browser is allowed to send.
 *
 * Note what is absent: no session id, no country, no device, no timestamp.
 * The client does not get to assert any of those -- the server derives them, so
 * they cannot be spoofed to poison aggregates. A client that sends them has
 * those fields ignored rather than the event rejected, because being strict
 * there breaks nothing and helps nobody.
 */
export const ClientEventSchema = z.object({
  type: z.enum(CLIENT_EVENT_TYPES as [EventType, ...EventType[]]),

  /** Stable posting id (`provider:token:sourceId`). Validated against the index. */
  jobId: z.string().max(LIMITS.jobId).optional(),
  companySlug: z.string().max(LIMITS.companySlug).optional(),

  /** The user's own words, as typed. Trimmed and length-capped, never parsed. */
  query: z.string().max(LIMITS.query).optional(),
  /** The location box, kept separate from the query so both can be reported. */
  location: z.string().max(LIMITS.filterValue).optional(),

  filters: filterMap.optional(),
  sort: z.string().max(32).optional(),

  /** How many results the search returned. 0 is the interesting value. */
  resultCount: z.number().int().min(0).max(10_000_000).optional(),
  /** 1-based page number. */
  page: z.number().int().min(1).max(100_000).optional(),

  /**
   * Rank of this result in the list the user was looking at, 1-based.
   *
   * Only meaningful on `search_result_impression`, and only reported for rows
   * that actually became visible -- see components/analytics/impressions.
   */
  position: z.number().int().min(1).max(10_000).optional(),

  /** Site-relative path. Query strings are stripped before storage. */
  path: z.string().max(LIMITS.path).optional(),

  metadata: metadata.optional(),
})

export type ClientEvent = z.infer<typeof ClientEventSchema>

export const ClientEventBatchSchema = z.object({
  events: z.array(ClientEventSchema).min(1).max(LIMITS.batch),
})

/* ---------------------------- the stored event ---------------------------- */

/**
 * What is actually written. The client's fields plus the server's derivations.
 *
 * This is the row shape for every driver, so a driver swap does not change what
 * the dashboard can ask for.
 */
export const StoredEventSchema = ClientEventSchema.omit({ type: true }).extend({
  id: z.string().min(1).max(64),
  type: z.enum(EVENT_TYPES),
  /** ISO-8601, server clock. A client-supplied time is never trusted. */
  ts: z.string(),

  /**
   * Rotating pseudonymous id. Derived from a daily-rotating salt, so it cannot
   * be linked across days and cannot be reversed to an IP.
   */
  sessionId: z.string().max(64),

  /** Coarse, derived, never the raw header. */
  device: deviceCategory,
  browser: browserFamily,
  os: osFamily,
  referrer: referrerCategory,
  /** ISO-3166 alpha-2, or null when the host does not provide one. */
  country: z.string().length(2).nullable(),

  /** True when the request looked automated. Kept, but excluded from metrics. */
  isBot: z.boolean(),

  /** Which ATS the posting came from, denormalised so source reports are cheap. */
  source: z.string().max(64).optional(),
})

export type StoredEvent = z.infer<typeof StoredEventSchema>

/* ------------------------------- normalising ------------------------------ */

/**
 * Canonical form of a search query, for grouping.
 *
 * "Senior  Software Engineer" and "senior software engineer" are the same
 * search and must aggregate together, or the top-queries report fragments into
 * near-duplicates and tells you nothing.
 *
 * Deliberately NOT the search tokeniser: this preserves the user's words so the
 * report reads like what people typed. It only folds case, collapses
 * whitespace and strips surrounding punctuation.
 */
export function normalizeQuery(raw: string | null | undefined): string | null {
  if (!raw) return null
  const q = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#.]+$/gu, '')
    .trim()
  return q.length ? q.slice(0, LIMITS.query) : null
}

/**
 * Stable string for a filter combination, so "which filters are used together"
 * is a group-by rather than a scan.
 *
 * Keys are sorted, so the same combination always produces the same string
 * regardless of the order the UI happened to set them in.
 */
export function filterSignature(filters: Record<string, string> | undefined): string | null {
  if (!filters) return null
  const entries = Object.entries(filters).filter(([, v]) => v !== '' && v != null)
  if (!entries.length) return null
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.map(([k, v]) => `${k}=${v}`).join('&').slice(0, 512)
}

/** Strip the query string from a path: it can carry the user's search terms. */
export function normalizePath(path: string | null | undefined): string | null {
  if (!path) return null
  const clean = path.split('?')[0].split('#')[0]
  return clean.slice(0, LIMITS.path) || null
}
