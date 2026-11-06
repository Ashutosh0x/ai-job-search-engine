/**
 * Pin the pipeline-job -> jobs-row mapping used by load-jobs-postgres.mjs.
 *
 *   npx tsx scripts/test-job-row.mjs
 *
 * No database. The failures guarded here are silent ones: a job filed under
 * the wrong board (so a prune deletes a healthy employer's rows), a missing
 * field defaulted into something that looks real, or first_seen_at reset.
 */
import { boardKeyOf, toJobRow } from '../lib/db/job-row.ts'
import { buildUpsertQuery } from '../lib/db/jobs-query.ts'

let pass = 0, fail = 0
function t(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const throws = (fn) => { try { fn(); return false } catch { return true } }

const SEEN = '2026-10-16T05:00:00.000Z'
const job = {
  id: 'custom:CX_1001:210800363',
  source: 'custom',
  company: 'JPMorgan Chase',
  companySlug: 'jpmorgan-chase',
  companyDomain: 'jpmorganchase.com',
  title: 'Lead Security Engineer - Unix/Linux/Observability',
  description: 'Design, implement, and secure cryptographic infrastructure.',
  locationDisplay: 'Ohio, United States',
  state: 'Ohio',
  country: 'United States',
  remote: false,
  department: 'Security Engineering',
  skills: ['linux'],
  postedAt: '2026-10-14T00:00:00.000Z',
  firstSeenAt: '2026-10-16T04:22:01.114Z',
  applicationUrl: 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210800363',
  isDirectApplication: true,
  qualityScore: 0.629,
}

console.log('boardKeyOf')
t('provider:token from a three-part id', boardKeyOf(job.id) === 'custom:CX_1001')
t('requisition ids may contain colons', boardKeyOf('workday:ghr:Lateral-US:R123') === 'workday:ghr')
t('refuses an id with no requisition', throws(() => boardKeyOf('custom:CX_1001')))
t('refuses an empty token', throws(() => boardKeyOf('custom::123')))

console.log('toJobRow')
const row = toJobRow(job, SEEN)
t('maps camelCase to the table columns', row.company_slug === 'jpmorgan-chase' && row.location_display === 'Ohio, United States')
t('board_key derived from the id', row.board_key === 'custom:CX_1001')
t('keeps the pipeline first sighting', row.first_seen_at === '2026-10-16T04:22:01.114Z')
t('last_seen_at is this load', row.last_seen_at === SEEN)
t('unknown salary stays NULL, not 0', row.salary_min === null && row.salary_max === null)
t('unknown employment type stays NULL', row.employment_type === null)
t('missing first sighting falls back to this load', toJobRow({ ...job, firstSeenAt: undefined }, SEEN).first_seen_at === SEEN)
t('an unparseable date becomes NULL, not "Invalid Date"', toJobRow({ ...job, postedAt: 'soon' }, SEEN).posted_at === null)
t('NaN scores become NULL', toJobRow({ ...job, qualityScore: NaN }, SEEN).quality_score === null)
t('refuses a job with no title', throws(() => toJobRow({ ...job, title: '' }, SEEN)))

console.log('fits buildUpsertQuery')
const q = buildUpsertQuery([row, toJobRow({ ...job, id: 'custom:CX_1001:210800364' }, SEEN)])
const placeholders = new Set(Array.from(q.text.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])))
t('every column the builder writes is present on the row', q.values.length === placeholders.size && !q.values.includes(undefined))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
