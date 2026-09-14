/**
 * Saved searches.
 *
 *   npx tsx scripts/test-saved-searches.mjs
 *
 * Storage is injected, so none of this needs a DOM. The cases that matter are
 * the ones that would silently corrupt the list: duplicates that differ only in
 * filter order or whitespace, and whatever else happens to be sitting under the
 * storage key.
 */
import {
  saveSearch,
  listSavedSearches,
  deleteSavedSearch,
  describeSearch,
  searchKey,
  normalizeFilters,
  createMemoryStore,
  MAX_SAVED_SEARCHES,
} from '../lib/saved-searches.ts'

let pass = 0, fail = 0
const t = (n, c, g) => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (g !== undefined ? '  got: ' + JSON.stringify(g) : '')) } }

const at = (iso) => () => new Date(iso)

console.log('\nnormalisation')
t('blank filters are dropped', JSON.stringify(normalizeFilters({ location: '', type: 'Full time' })) === '{"type":"Full time"}')
t('values are trimmed', normalizeFilters({ city: '  Berlin ' }).city === 'Berlin')
t('undefined is dropped', JSON.stringify(normalizeFilters({ city: undefined })) === '{}')

console.log('\nidentity')
t('filter ORDER does not change identity',
  searchKey('dev', { location: 'EU', type: 'FT' }) === searchKey('dev', { type: 'FT', location: 'EU' }))
t('query case and padding do not change identity',
  searchKey('  Cloud Engineer ', {}) === searchKey('cloud engineer', {}))
t('a different filter value IS a different search',
  searchKey('dev', { city: 'Berlin' }) !== searchKey('dev', { city: 'Paris' }))
t('an empty filter equals no filter',
  searchKey('dev', { city: '' }) === searchKey('dev', {}))

console.log('\nlabels')
t('describes query and filters', describeSearch('cloud engineer', { workType: 'Remote', city: 'Berlin' }) === 'cloud engineer · Remote · Berlin')
t('empty query reads as All roles', describeSearch('', {}) === 'All roles')

console.log('\nsaving')
{
  const store = createMemoryStore()
  const first = saveSearch('cloud engineer', { city: 'Berlin' }, store, at('2026-09-14T00:00:00Z'))
  t('first save is added', first.added === true)
  t('list has one entry', listSavedSearches(store).length === 1)
  t('savedAt recorded', listSavedSearches(store)[0].savedAt === '2026-09-14T00:00:00.000Z')

  const dup = saveSearch('cloud engineer', { city: 'Berlin' }, store, at('2026-09-14T01:00:00Z'))
  t('saving the same search again is NOT added', dup.added === false)
  t('and does not duplicate the row', listSavedSearches(store).length === 1)

  // The duplicate that a naive implementation misses.
  const reordered = saveSearch('  CLOUD ENGINEER  ', { city: ' Berlin ' }, store, at('2026-09-14T02:00:00Z'))
  t('same search with different case/padding is still a duplicate', reordered.added === false, listSavedSearches(store).length)

  saveSearch('data engineer', {}, store, at('2026-09-14T03:00:00Z'))
  t('a genuinely different search is added', listSavedSearches(store).length === 2)
  t('newest is first', listSavedSearches(store)[0].query === 'data engineer')
}

console.log('\ncap')
{
  const store = createMemoryStore()
  for (let i = 0; i < MAX_SAVED_SEARCHES + 7; i++) {
    saveSearch(`role ${i}`, {}, store, at('2026-09-14T00:00:00Z'))
  }
  const all = listSavedSearches(store)
  t(`caps at ${MAX_SAVED_SEARCHES}`, all.length === MAX_SAVED_SEARCHES, all.length)
  t('the newest survives', all[0].query === `role ${MAX_SAVED_SEARCHES + 6}`, all[0].query)
  t('the oldest is dropped', !all.some((s) => s.query === 'role 0'))
}

console.log('\ndeleting')
{
  const store = createMemoryStore()
  saveSearch('a', {}, store)
  saveSearch('b', {}, store)
  const id = listSavedSearches(store)[0].id
  const after = deleteSavedSearch(id, store)
  t('removes the entry', after.length === 1)
  t('removes the right one', after[0].query === 'a', after[0].query)
  t('deleting a missing id is a no-op', deleteSavedSearch('nope', store).length === 1)
}

console.log('\nhostile / absent storage')
{
  t('no store reads as empty', listSavedSearches(null).length === 0)
  t('no store does not throw on save', saveSearch('x', {}, null).added === true)

  t('garbage under the key reads as empty',
    listSavedSearches(createMemoryStore({ 'jobspark.savedSearches.v1': 'not json' })).length === 0)
  t('a non-array reads as empty',
    listSavedSearches(createMemoryStore({ 'jobspark.savedSearches.v1': '{"a":1}' })).length === 0)
  t('malformed rows are filtered out, well-formed ones kept',
    listSavedSearches(createMemoryStore({
      'jobspark.savedSearches.v1': JSON.stringify([
        { id: 'x', query: 'ok', label: 'ok', filters: {}, savedAt: '2026-01-01' },
        { id: 42 },
        null,
        'nope',
      ]),
    })).length === 1)

  const throwing = {
    getItem: () => { throw new Error('storage disabled') },
    setItem: () => { throw new Error('quota exceeded') },
  }
  t('a throwing store does not propagate on read', listSavedSearches(throwing).length === 0)
  t('a throwing store does not propagate on write', saveSearch('y', {}, throwing).added === true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
