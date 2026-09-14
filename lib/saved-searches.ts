/**
 * Saved searches.
 *
 * The dashboard had a "Save Search" button with no onClick -- it rendered, it
 * hovered, and it did nothing. This gives it a behaviour.
 *
 * SCOPE, STATED PLAINLY
 * ---------------------
 * Storage is per-browser (localStorage). A search saved on a laptop will not
 * appear on a phone, and clearing site data loses it. That is a real
 * limitation, not an oversight: syncing across devices needs a table, RLS
 * policies and a migration that has to be applied before the feature works at
 * all, and a feature that silently does nothing when a migration has not been
 * run is worse than one with an honest boundary. The interface below is the
 * one a server-backed store would implement, so moving it later is a swap
 * rather than a rewrite.
 *
 * The logic is pure and storage is injected, so it can be tested without a DOM.
 */

export interface SearchFilters {
  location?: string
  type?: string
  workType?: string
  salary?: string
  experience?: string
  country?: string
  state?: string
  city?: string
}

export interface SavedSearch {
  id: string
  label: string
  query: string
  filters: SearchFilters
  savedAt: string
}

/** Enough to be useful, few enough that the list stays scannable. */
export const MAX_SAVED_SEARCHES = 20

const STORAGE_KEY = 'jobspark.savedSearches.v1'

/** The minimum of localStorage this module needs, so tests can supply their own. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** In-memory store, used for tests and as the fallback when there is no DOM. */
export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
  }
}

function defaultStore(): KeyValueStore | null {
  // Server render, or a browser with storage disabled. Both are normal; neither
  // should throw on a page that merely renders the button.
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** Drop empty values so two searches that differ only in blanks compare equal. */
export function normalizeFilters(filters: SearchFilters): SearchFilters {
  const out: SearchFilters = {}
  for (const [k, v] of Object.entries(filters)) {
    const trimmed = String(v ?? '').trim()
    if (trimmed) out[k as keyof SearchFilters] = trimmed
  }
  return out
}

/**
 * Stable identity for a search.
 *
 * Keys are sorted so `{location, type}` and `{type, location}` are the same
 * search -- without that, re-saving after touching filters in a different order
 * would silently create duplicates.
 */
export function searchKey(query: string, filters: SearchFilters): string {
  const norm = normalizeFilters(filters)
  const parts = Object.keys(norm)
    .sort()
    .map((k) => `${k}=${norm[k as keyof SearchFilters]}`)
  return [`q=${query.trim().toLowerCase()}`, ...parts].join('&')
}

/** A human label, e.g. `cloud engineer · Remote · Berlin`. */
export function describeSearch(query: string, filters: SearchFilters): string {
  const norm = normalizeFilters(filters)
  const bits = [query.trim() || 'All roles']
  for (const k of ['workType', 'type', 'experience', 'city', 'state', 'country', 'location', 'salary'] as const) {
    if (norm[k]) bits.push(norm[k]!)
  }
  return bits.join(' · ')
}

export function listSavedSearches(store: KeyValueStore | null = defaultStore()): SavedSearch[] {
  if (!store) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Anything could be under this key -- another tab, an older version, a user
    // with devtools open. Treat it as untrusted and keep only well-formed rows.
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is SavedSearch =>
        !!s && typeof s.id === 'string' && typeof s.query === 'string' && typeof s.label === 'string'
    )
  } catch {
    return []
  }
}

export interface SaveResult {
  searches: SavedSearch[]
  /** False when this search was already saved, so the UI can say so. */
  added: boolean
}

export function saveSearch(
  query: string,
  filters: SearchFilters,
  store: KeyValueStore | null = defaultStore(),
  now: () => Date = () => new Date()
): SaveResult {
  const existing = listSavedSearches(store)
  const key = searchKey(query, filters)

  if (existing.some((s) => searchKey(s.query, s.filters) === key)) {
    return { searches: existing, added: false }
  }

  const entry: SavedSearch = {
    id: key,
    label: describeSearch(query, filters),
    query: query.trim(),
    filters: normalizeFilters(filters),
    savedAt: now().toISOString(),
  }

  // Newest first, oldest dropped past the cap.
  const next = [entry, ...existing].slice(0, MAX_SAVED_SEARCHES)
  persist(next, store)
  return { searches: next, added: true }
}

export function deleteSavedSearch(
  id: string,
  store: KeyValueStore | null = defaultStore()
): SavedSearch[] {
  const next = listSavedSearches(store).filter((s) => s.id !== id)
  persist(next, store)
  return next
}

function persist(searches: SavedSearch[], store: KeyValueStore | null): void {
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(searches))
  } catch {
    // Quota exceeded, or storage disabled mid-session. The in-memory list the
    // caller already holds stays correct for this page; losing a saved search
    // is not worth throwing out of a click handler.
  }
}
