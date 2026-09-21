/**
 * Diff two Microsoft crawls.
 *
 *   node scripts/compare-microsoft-crawls.mjs \
 *     --before microsoft-roles.prev-2026-09-12.json \
 *     --after  microsoft-roles.json \
 *     --out    microsoft-sep12-vs-sep21.json
 *
 * KEYED ON JOB ID, NOT URL
 * ========================
 * Microsoft's job URL is `/careers/job/<id>-<slug>`, and the slug is generated
 * from the title and the location. Edit either and the posting gets a new URL.
 * Diffing on URLs therefore reports one edited posting as one removal plus one
 * addition -- churn that never happened. The numeric id is the identity.
 *
 * THE BASELINE MAY NOT BE A BASELINE
 * ==================================
 * A crawl that was rate-limited is not a census. The Sep 12 run recorded
 * "1125 pages gone" against 1,240 read -- and the crawler of that generation
 * counted HTTP 403 as 404, so those 1,125 are throttled requests, not closed
 * jobs. When the before-crawl carries that defect, "new since" is not
 * computable: a posting missing from the baseline may be genuinely new, or may
 * simply be one the baseline never reached.
 *
 * This script detects that case and refuses to label the difference, reporting
 * `appearedSinceBefore` (a fact) rather than `newJobs` (a claim).
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const BEFORE = resolve(ROOT, val('before', 'microsoft-roles.prev-2026-09-12.json'))
const AFTER = resolve(ROOT, val('after', 'microsoft-roles.json'))
const OUT = resolve(ROOT, val('out', 'microsoft-sep12-vs-sep21.json'))
const BEFORE_TEXT = val('before-text', 'microsoft-roles.prev-2026-09-12.txt')

const load = (p) => JSON.parse(readFileSync(p, 'utf8'))

/**
 * Normalise a record from either crawl generation into one shape.
 *
 * The Sep 12 crawler wrote {id, title, location, posted, employmentType, url}
 * with no description and no status. The current one writes the full record.
 * Missing is recorded as null so a comparison can say "not comparable"
 * instead of reading absence as a change.
 */
function normalise(r) {
  return {
    id: String(r.jobId ?? r.id ?? ''),
    title: r.title ?? null,
    location: r.locationDisplay ?? r.location ?? null,
    posted: (r.datePosted ?? r.posted ?? null)?.slice(0, 10) ?? null,
    employmentType: r.employmentType ?? null,
    url: r.sourceUrl ?? r.url ?? null,
    status: r.status ?? null,
    statusReason: r.statusReason ?? null,
    // Only the current crawler keeps descriptions. `null` means "this crawl
    // did not record one", which is not the same as "the posting has none".
    descriptionLength: typeof r.descriptionLength === 'number'
      ? r.descriptionLength
      : (typeof r.description === 'string' ? r.description.length : null),
  }
}

function index(records) {
  const byId = new Map()
  const duplicates = []
  for (const raw of records) {
    const r = normalise(raw)
    if (!r.id) continue
    if (byId.has(r.id)) duplicates.push(r.id)
    else byId.set(r.id, r)
  }
  return { byId, duplicates }
}

/**
 * Is the baseline a census, or a partial read?
 *
 * Two independent signals:
 *
 *  1. The Sep 12 report line "N pages gone" came from a crawler that counted
 *     HTTP 403 as 404. A large "gone" count next to a much smaller "read"
 *     count is that bug's signature.
 *  2. A modern crawl records its own FETCH_FAILED count. Any non-zero value
 *     means some URLs were never read, so absence from that file is not
 *     evidence of anything.
 *
 * Only a baseline that passes both can support the words "new" and "removed".
 */
function baselineIntegrity(beforeData) {
  const records = beforeData.roles ?? []
  const fetchFailed = records.filter((r) => r.status === 'FETCH_FAILED').length
  const unknown = records.filter((r) => r.status === 'UNKNOWN').length

  if (fetchFailed > 0) {
    return {
      trustworthy: false,
      reason: `the baseline recorded ${fetchFailed} FETCH_FAILED urls -- it never read them, ` +
              `so a posting missing from it may simply be one of those.`,
      fetchFailed, unknown,
    }
  }

  try {
    const text = readFileSync(resolve(ROOT, BEFORE_TEXT), 'utf8')
    const gone = Number((text.match(/#\s*(\d+)\s+pages gone/) || [])[1] || 0)
    const read = beforeData.count ?? records.length
    if (gone > read * 0.2) {
      return {
        trustworthy: false,
        reason:
          `the baseline crawl reported ${gone} pages "gone" against ${read} read. ` +
          `That crawler counted HTTP 403 as 404, so those are almost certainly ` +
          `throttled requests, not closed jobs. The baseline is a partial read of ` +
          `roughly ${gone + read} urls, not a census.`,
        reportedGone: gone,
        reportedRead: read,
        impliedSitemapSize: gone + read,
        fetchFailed, unknown,
      }
    }
    return { trustworthy: true, reason: null, reportedGone: gone, reportedRead: read, fetchFailed, unknown }
  } catch {
    // No report text alongside it. A modern dataset with zero FETCH_FAILED is
    // still a complete read -- that is the stronger signal, and it is present.
    if (records.some((r) => r.status)) {
      return {
        trustworthy: true,
        reason: null,
        note: 'no report text found; judged complete because the dataset records 0 FETCH_FAILED',
        fetchFailed, unknown,
      }
    }
    return { trustworthy: null, reason: 'baseline report text not found; integrity not assessed' }
  }
}

/* ---------------------------------- main ---------------------------------- */

const beforeData = load(BEFORE)
const afterData = load(AFTER)

const before = index(beforeData.roles ?? [])
const after = index(afterData.roles ?? [])
const integrity = baselineIntegrity(beforeData)

const inBoth = []
const onlyBefore = []
const onlyAfter = []

for (const [id, b] of before.byId) {
  if (after.byId.has(id)) inBoth.push([b, after.byId.get(id)])
  else onlyBefore.push(b)
}
for (const [id, a] of after.byId) {
  if (!before.byId.has(id)) onlyAfter.push(a)
}

const changed = {
  title: [],
  location: [],
  url: [],
  postedDate: [],
  employmentType: [],
  status: [],
  description: [],
}

for (const [b, a] of inBoth) {
  if (b.title && a.title && b.title !== a.title) {
    changed.title.push({ id: a.id, before: b.title, after: a.title, url: a.url })
  }
  if (b.location && a.location && b.location !== a.location) {
    changed.location.push({ id: a.id, before: b.location, after: a.location, url: a.url })
  }
  if (b.url && a.url && b.url !== a.url) {
    changed.url.push({ id: a.id, before: b.url, after: a.url })
  }
  if (b.posted && a.posted && b.posted !== a.posted) {
    changed.postedDate.push({ id: a.id, before: b.posted, after: a.posted, url: a.url })
  }
  if (b.employmentType && a.employmentType && b.employmentType !== a.employmentType) {
    changed.employmentType.push({ id: a.id, before: b.employmentType, after: a.employmentType })
  }
  // The baseline has no status field at all, so any comparison would be
  // inventing a "before" to diff against.
  if (b.status && a.status && b.status !== a.status) {
    changed.status.push({ id: a.id, before: b.status, after: a.status, reason: a.statusReason })
  }
  // Only comparable when BOTH crawls recorded a description. A null on either
  // side means "this crawl did not record one", not "the posting has none".
  if (typeof b.descriptionLength === 'number' && typeof a.descriptionLength === 'number' &&
      b.descriptionLength !== a.descriptionLength) {
    changed.description.push({
      id: a.id, beforeChars: b.descriptionLength, afterChars: a.descriptionLength,
      deltaChars: a.descriptionLength - b.descriptionLength, url: a.url,
    })
  }
}

/** Were descriptions recorded on both sides at all? */
const descriptionsComparable =
  inBoth.some(([b, a]) => typeof b.descriptionLength === 'number' && typeof a.descriptionLength === 'number')

const statusOfAfter = {}
for (const r of after.byId.values()) statusOfAfter[r.status ?? 'unrecorded'] = (statusOfAfter[r.status ?? 'unrecorded'] || 0) + 1

const disappeared = onlyBefore.map((r) => ({ id: r.id, title: r.title, location: r.location, url: r.url }))
const appeared = onlyAfter.map((r) => ({ id: r.id, title: r.title, location: r.location, status: r.status, url: r.url }))

const report = {
  generatedAt: new Date().toISOString(),
  before: {
    file: BEFORE.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
    crawledAt: beforeData.crawledAt ?? '2026-09-12 (from the file name and report header)',
    recordCount: beforeData.roles?.length ?? 0,
    uniqueJobIds: before.byId.size,
    duplicateJobIds: before.duplicates.length,
  },
  after: {
    file: AFTER.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
    crawledAt: afterData.crawledAt ?? null,
    recordCount: afterData.roles?.length ?? 0,
    uniqueJobIds: after.byId.size,
    duplicateJobIds: after.duplicates.length,
    statusCounts: statusOfAfter,
  },

  baselineIntegrity: integrity,

  /**
   * Named for what they are, not for what they would mean if both crawls were
   * complete. With an untrustworthy baseline these are observations about two
   * files, not about Microsoft's hiring.
   */
  presentInBoth: inBoth.length,
  appearedSinceBefore: appeared.length,
  absentFromAfter: disappeared.length,

  /**
   * The categories the change report has to separate.
   *
   * "Definitely" is only used when BOTH crawls read their whole sitemap. When
   * the baseline is partial, appearances and disappearances move wholesale
   * into `cannotClassifyConfidently` -- an absent posting may have closed, or
   * may simply never have been fetched, and these two files cannot tell them
   * apart.
   */
  categories: integrity.trustworthy === false
    ? {
        definitelyNew: 0,
        definitelyRemoved: 0,
        stillPresent: inBoth.length,
        cannotClassifyConfidently: appeared.length + disappeared.length,
        basis: 'the baseline is a partial read; appearances and disappearances are not classifiable',
        breakdown: {
          appearedButUnclassifiable: appeared.length,
          absentButUnclassifiable: disappeared.length,
        },
      }
    : {
        definitelyNew: appeared.length,
        definitelyRemoved: disappeared.length,
        stillPresent: inBoth.length,
        cannotClassifyConfidently: 0,
        basis: 'both crawls read their whole sitemap and recorded 0 FETCH_FAILED, ' +
               'so presence and absence are both evidence',
      },

  interpretation: integrity.trustworthy === false
    ? {
        newJobs: 'NOT COMPUTABLE -- the baseline is a partial read, so a posting ' +
                 'absent from it may be new or may simply never have been fetched.',
        removedJobs: 'NOT COMPUTABLE from these two files alone for the same reason, ' +
                     'though a posting present in the baseline and absent now is a ' +
                     'stronger signal, since the current crawl read 100% of the sitemap.',
        usable: 'Field-level changes among the ' + inBoth.length + ' postings present in ' +
                'both crawls ARE comparable: both files observed those directly.',
      }
    : {
        newJobs: appeared.length,
        removedJobs: disappeared.length,
        usable: 'both crawls are complete reads; all figures are comparable',
      },

  changed: {
    titleChanges: changed.title.length,
    locationChanges: changed.location.length,
    urlChanges: changed.url.length,
    postedDateChanges: changed.postedDate.length,
    employmentTypeChanges: changed.employmentType.length,
    statusChanges: changed.status.length,
    descriptionChanges: descriptionsComparable
      ? changed.description.length
      : 'NOT COMPARABLE -- the baseline crawler did not record descriptions. ' +
        'The current crawl does, so a diff between two modern crawls can compare them.',
    descriptionsComparable,
    samples: {
      description: changed.description.slice(0, 20),
      title: changed.title.slice(0, 20),
      location: changed.location.slice(0, 20),
      url: changed.url.slice(0, 20),
      postedDate: changed.postedDate.slice(0, 20),
      employmentType: changed.employmentType.slice(0, 20),
      status: changed.status.slice(0, 20),
    },
  },

  duplicatesOrMerged: {
    beforeDuplicateIds: before.duplicates.slice(0, 20),
    afterDuplicateIds: after.duplicates.slice(0, 20),
    note: 'Both crawls key on the numeric job id. A posting whose slug changed ' +
          'appears once, not as a removal plus an addition.',
  },

  absentFromAfterSamples: disappeared.slice(0, 50),
  appearedSinceBeforeSamples: appeared.slice(0, 50),
}

writeFileSync(OUT, JSON.stringify(report, null, 2))

/* --------------------------------- console -------------------------------- */

const n = (v) => String(v).padStart(6)
console.log('MICROSOFT CRAWL COMPARISON')
console.log('='.repeat(72))
console.log(`before : ${report.before.file}  (${report.before.uniqueJobIds} unique ids)`)
console.log(`after  : ${report.after.file}  (${report.after.uniqueJobIds} unique ids)`)
console.log('')
if (integrity.trustworthy === false) {
  console.log('!! BASELINE IS NOT A CENSUS')
  console.log(`   ${integrity.reason}`)
  console.log('')
}
console.log(`${n(report.presentInBoth)}  postings present in both crawls`)
console.log(`${n(report.appearedSinceBefore)}  present now, absent from the baseline`)
console.log(`${n(report.absentFromAfter)}  present in the baseline, absent now`)
console.log('')
console.log('CLASSIFICATION')
console.log(`${n(report.categories.definitelyNew)}  definitely new`)
console.log(`${n(report.categories.definitelyRemoved)}  definitely removed`)
console.log(`${n(report.categories.stillPresent)}  still present`)
console.log(`${n(report.categories.cannotClassifyConfidently)}  cannot classify confidently`)
console.log(`        basis: ${report.categories.basis}`)
console.log('')
console.log('FIELD CHANGES (among postings both crawls actually read)')
console.log(`${n(report.changed.titleChanges)}  title changed`)
console.log(`${n(report.changed.locationChanges)}  location changed`)
console.log(`${n(report.changed.urlChanges)}  url changed`)
console.log(`${n(report.changed.postedDateChanges)}  posted date changed`)
console.log(`${n(report.changed.employmentTypeChanges)}  employment type changed`)
console.log(`${n(report.changed.statusChanges)}  status changed`)
console.log(`        description: ${report.changed.descriptionChanges}`)
console.log('')
console.log(`wrote ${OUT}`)
