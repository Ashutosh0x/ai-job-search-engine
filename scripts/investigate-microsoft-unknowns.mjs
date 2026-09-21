/**
 * Evidence gathering for every posting classified UNKNOWN.
 *
 *   node scripts/investigate-microsoft-unknowns.mjs
 *
 * WHAT THIS IS FOR
 * ================
 * UNKNOWN is a real verdict, not a holding pen -- but it has to be earned. A
 * page that answers 200 and carries no JobPosting could be a closed posting
 * the sitemap has not caught up with, a rendering quirk, or a transient
 * server state. This fetches each one again, from several angles, records
 * what came back, and says whether the evidence is now sufficient to move it.
 *
 * WHAT IT DOES NOT DO
 * ===================
 * It does not reclassify anything. If the evidence supports a deterministic
 * rule, that rule goes into the adapter with tests and the next crawl applies
 * it. Guessing here would produce a verdict no crawl could reproduce.
 *
 * A REFERENCE PAGE IS FETCHED FIRST
 * =================================
 * "Looks like a generic SPA shell" is only meaningful against something. A
 * known-good job page and the careers landing page are fetched as references,
 * so shell-detection is a measured comparison rather than an impression.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const args = process.argv.slice(2)
const val = (n, d) => { const i = args.indexOf(`--${n}`); return i !== -1 && args[i + 1] ? args[i + 1] : d }

const DATASET = resolve(ROOT, val('dataset', 'microsoft-roles.json'))
const OUT = resolve(ROOT, val('out', 'microsoft-unknown-audit.json'))
const OUT_TEXT = resolve(ROOT, val('out-text', 'microsoft-unknown-audit.txt'))
const DELAY_MS = Number(val('delay', 700))
/** Seconds to wait before the second attempt, to separate transient from stable. */
const RETRY_AFTER_MS = Number(val('retry-after', 5_000))

const UA = process.env.CRAWLER_USER_AGENT ||
  'JobSparkAI/1.0 (+https://jobspark.ai; job discovery; contact: support@jobspark.ai)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, { redirect = 'follow' } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 40_000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect })
    const body = res.status === 204 ? '' : await res.text()
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      finalUrl: res.url,
      redirected: res.redirected || res.url !== url,
      bytes: body.length,
      body,
    }
  } catch (err) {
    return { ok: false, status: null, error: err?.name === 'AbortError' ? 'timeout' : String(err?.cause?.code || err?.name || err), bytes: 0, body: '' }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------ page analysis ----------------------------- */
//
// These live in their own module so they can be unit-tested without live
// fetches. The i18n guard inside `closureEvidence` decides whether a posting
// gets called CLOSED, so it is pinned by tests in scripts/test-microsoft.mjs
// rather than trusted.
import { ldBlocks, titleOf, closureEvidence } from './lib/microsoft-page-evidence.mjs'

/* --------------------------------- main ----------------------------------- */

const data = JSON.parse(readFileSync(DATASET, 'utf8'))
const unknowns = (data.roles ?? []).filter((r) => r.status === 'UNKNOWN')

console.log(`UNKNOWN audit: ${unknowns.length} postings from ${DATASET.split(/[\\/]/).pop()}\n`)

if (unknowns.length === 0) {
  writeFileSync(OUT, JSON.stringify({ investigatedAt: new Date().toISOString(), unknownCount: 0, findings: [], verdict: 'no UNKNOWN postings in this crawl' }, null, 2))
  writeFileSync(OUT_TEXT, 'MICROSOFT UNKNOWN AUDIT\nNo postings were classified UNKNOWN in this crawl.\n')
  console.log('nothing to investigate')
  process.exit(0)
}

/* ---- is the posting still published in the sitemap? ---- */
//
// This is the only genuinely positive, reproducible evidence available for a
// page that answers 200 and publishes nothing: Microsoft's own sitemap is the
// list of postings it is advertising. A posting that has left it is no longer
// being published, which is a fact about the publisher rather than an
// inference about the page.
console.log('fetching the live sitemap...')
const sitemapRes = await get(data.sitemap ?? 'https://apply.careers.microsoft.com/careers/sitemap.xml')
const liveSitemapIds = new Set(
  [...String(sitemapRes.body).matchAll(/\/careers\/job\/(\d+)/g)].map((m) => m[1])
)
console.log(`  sitemap lists ${liveSitemapIds.size} postings right now`)
console.log('')

/* ---- references, so "shell" is a measurement not an impression ---- */
console.log('fetching reference pages...')
const knownGood = (data.roles ?? []).find((r) => r.status === 'OPEN')
const refJob = knownGood ? await get(knownGood.sourceUrl) : null
await sleep(DELAY_MS)
const refLanding = await get(`https://apply.careers.microsoft.com/careers?domain=microsoft.com`)

const refJobLd = refJob ? ldBlocks(refJob.body).length : null
const refJobTitle = refJob ? titleOf(refJob.body) : null
const refLandingTitle = refLanding ? titleOf(refLanding.body) : null
const refLandingBytes = refLanding?.bytes ?? null

console.log(`  reference job page   : HTTP ${refJob?.status}  ${refJob?.bytes} bytes  ${refJobLd} ld+json  title ${JSON.stringify(refJobTitle)}`)
console.log(`  careers landing page : HTTP ${refLanding?.status}  ${refLanding?.bytes} bytes  title ${JSON.stringify(refLandingTitle)}`)
console.log('')

/* ---- per-posting evidence ---- */
const findings = []

for (const [i, rec] of unknowns.entries()) {
  const url = rec.sourceUrl
  await sleep(DELAY_MS)
  const first = await get(url)

  await sleep(RETRY_AFTER_MS)
  const second = await get(url)

  // The id-only URL: Microsoft normally redirects it to the slugged one, so a
  // different answer here separates "bad slug" from "no such posting".
  const idOnly = rec.jobId
    ? await (async () => { await sleep(DELAY_MS); return get(`https://apply.careers.microsoft.com/careers/job/${rec.jobId}?domain=microsoft.com`) })()
    : null

  const ld1 = ldBlocks(first.body)
  const ld2 = ldBlocks(second.body)
  const ldIdOnly = idOnly ? ldBlocks(idOnly.body) : []

  const title1 = titleOf(first.body)
  const { hits: evidence, rejectedAsSerialisedData } = closureEvidence(first.body)
  const stillInSitemap = liveSitemapIds.size > 0 ? liveSitemapIds.has(String(rec.jobId)) : null

  // The measured shell test: no ld+json, and a <title> with nothing before
  // the site name -- exactly what the landing page produces.
  const emptyTitlePrefix = /^\s*\|/.test(title1)
  const looksLikeShell = ld1.length === 0 && emptyTitlePrefix

  const finding = {
    jobId: rec.jobId,
    title: rec.title,
    url,
    priorStatus: rec.status,
    priorReason: rec.statusReason,
    attempt1: {
      httpStatus: first.status, contentType: first.contentType, bytes: first.bytes,
      ldJsonBlocks: ld1.length, pageTitle: title1,
      redirected: first.redirected, finalUrl: first.finalUrl, error: first.error ?? null,
    },
    attempt2: {
      httpStatus: second.status, bytes: second.bytes, ldJsonBlocks: ld2.length,
      pageTitle: titleOf(second.body), redirected: second.redirected, error: second.error ?? null,
    },
    idOnlyUrl: idOnly ? {
      url: `https://apply.careers.microsoft.com/careers/job/${rec.jobId}?domain=microsoft.com`,
      httpStatus: idOnly.status, bytes: idOnly.bytes, ldJsonBlocks: ldIdOnly.length,
      redirected: idOnly.redirected, finalUrl: idOnly.finalUrl,
    } : null,
    retryChangedResult: ld1.length !== ld2.length || first.status !== second.status,
    looksLikeGenericShell: looksLikeShell,
    emptyTitlePrefix,
    bytesVsLandingPage: refLandingBytes ? first.bytes - refLandingBytes : null,
    renderedClosureEvidence: evidence,
    /** Matches thrown out for sitting inside serialised data, kept as proof. */
    closureMatchesRejectedAsSerialisedData: rejectedAsSerialisedData,
    stillInSitemap,
    /**
     * The verdict this posting's evidence supports, on its own.
     * Recorded per posting so the aggregate conclusion is traceable.
     */
    supportedVerdict: (() => {
      if (first.status === 404 || first.status === 410) return 'CLOSED (http-gone)'
      if (first.status === 403 || first.status === 429) return 'FETCH_FAILED (throttled)'
      if (first.status === null) return 'FETCH_FAILED (network)'
      if (ld1.length > 0) return 'reclassifiable -- JobPosting present on re-fetch'
      if (evidence.length > 0) return 'CLOSED (rendered closure message)'
      if (ldIdOnly.length > 0) return 'reclassifiable -- JobPosting present at the id-only url'
      // Positive, reproducible, and about the publisher rather than the page:
      // Microsoft has stopped advertising this posting.
      if (stillInSitemap === false) return 'DELISTED (no longer published in Microsoft\'s sitemap)'
      return 'UNKNOWN (server answers 200 but publishes no posting data)'
    })(),
  }

  findings.push(finding)
  process.stdout.write(
    `  ${String(i + 1).padStart(3)}/${unknowns.length}  ${rec.jobId}  ` +
    `HTTP ${first.status}  ld+json ${ld1.length}/${ld2.length}  ` +
    `${finding.supportedVerdict}\n`
  )
}

/* ------------------------------- conclusion ------------------------------- */

const tally = {}
for (const f of findings) tally[f.supportedVerdict] = (tally[f.supportedVerdict] || 0) + 1

const reclassifiable = findings.filter((f) => /reclassifiable|CLOSED \(|DELISTED/.test(f.supportedVerdict))
const stillUnknown = findings.filter((f) => f.supportedVerdict.startsWith('UNKNOWN'))
const delisted = findings.filter((f) => f.supportedVerdict.startsWith('DELISTED'))
const rejectedMatches = findings.filter((f) => f.closureMatchesRejectedAsSerialisedData.length > 0)

const summary = {
  investigatedAt: new Date().toISOString(),
  dataset: DATASET.split(/[\\/]/).pop(),
  unknownCount: unknowns.length,
  references: {
    knownGoodJobPage: knownGood ? {
      url: knownGood.sourceUrl, httpStatus: refJob?.status, bytes: refJob?.bytes,
      ldJsonBlocks: refJobLd, pageTitle: refJobTitle,
    } : null,
    careersLandingPage: { httpStatus: refLanding?.status, bytes: refLandingBytes, pageTitle: refLandingTitle },
  },
  verdictTally: tally,
  allRetriesAgreed: findings.every((f) => !f.retryChangedResult),
  allLookLikeShell: findings.every((f) => f.looksLikeGenericShell),
  anyRenderedClosureEvidence: findings.some((f) => f.renderedClosureEvidence.length > 0),
  closureMatchesRejectedAsSerialisedData: rejectedMatches.length,
  reclassifiableCount: reclassifiable.length,
  stillUnknownCount: stillUnknown.length,
  delistedCount: delisted.length,
  stillInSitemapCount: findings.filter((f) => f.stillInSitemap === true).length,
  conclusion: (() => {
    if (delisted.length === unknowns.length) {
      return `All ${unknowns.length} postings have since left Microsoft's sitemap. At crawl time ` +
        `UNKNOWN was the correct verdict -- the page answered 200 and published nothing either ` +
        `way -- and the publisher has since stopped advertising them. That is positive evidence ` +
        `of delisting, observed rather than inferred, and it is a fact about a LATER crawl, not ` +
        `a rule the original crawl could have applied.`
    }
    if (stillUnknown.length === unknowns.length) {
      return 'UNKNOWN remains justified for every posting: each answers HTTP 200, publishes no ' +
        'JobPosting, carries no rendered closure message, and answers identically on retry. ' +
        'There is no public evidence either way, so no deterministic rule can be added.'
    }
    return `${reclassifiable.length} of ${unknowns.length} postings now carry evidence supporting a ` +
      `different verdict -- see findings[].supportedVerdict.`
  })(),
  findings,
}

writeFileSync(OUT, JSON.stringify(summary, null, 2))

const L = []
const n = (v) => String(v).padStart(6)
L.push('MICROSOFT UNKNOWN-POSTING AUDIT')
L.push('='.repeat(72))
L.push(`investigated   ${summary.investigatedAt}`)
L.push(`dataset        ${summary.dataset}`)
L.push(`unknown count  ${summary.unknownCount}`)
L.push('')
L.push('REFERENCE PAGES  (so "generic shell" is measured, not asserted)')
if (summary.references.knownGoodJobPage) {
  const r = summary.references.knownGoodJobPage
  L.push(`  known-good job page  HTTP ${r.httpStatus}  ${r.bytes} bytes  ${r.ldJsonBlocks} ld+json`)
  L.push(`    title  ${JSON.stringify(r.pageTitle)}`)
}
L.push(`  careers landing      HTTP ${summary.references.careersLandingPage.httpStatus}  ${summary.references.careersLandingPage.bytes} bytes`)
L.push(`    title  ${JSON.stringify(summary.references.careersLandingPage.pageTitle)}`)
L.push('')
L.push('EVIDENCE TALLY')
for (const [k, v] of Object.entries(tally)) L.push(`${n(v)}  ${k}`)
L.push('')
L.push('AGGREGATE SIGNALS')
L.push(`  retry changed the result for any posting : ${summary.allRetriesAgreed ? 'no' : 'YES'}`)
L.push(`  every page looks like the generic shell  : ${summary.allLookLikeShell ? 'yes' : 'no'}`)
L.push(`  any rendered closure message found       : ${summary.anyRenderedClosureEvidence ? 'YES' : 'no'}`)
L.push(`  still advertised in the live sitemap     : ${summary.stillInSitemapCount}/${summary.unknownCount}`)
L.push(`  no longer in the sitemap (delisted)      : ${summary.delistedCount}/${summary.unknownCount}`)
L.push(`  phrase matches rejected as i18n/config   : ${summary.closureMatchesRejectedAsSerialisedData}`)
L.push('')
L.push('CONCLUSION')
L.push(`  ${summary.conclusion}`)
L.push('')
L.push('PER-POSTING EVIDENCE')
L.push('-'.repeat(72))
for (const f of findings) {
  L.push(`  ${f.jobId}  ${f.title?.slice(0, 60) ?? ''}`)
  L.push(`    url          ${f.url}`)
  L.push(`    attempt 1    HTTP ${f.attempt1.httpStatus}  ${f.attempt1.bytes}b  ld+json ${f.attempt1.ldJsonBlocks}  ${f.attempt1.contentType ?? ''}`)
  L.push(`    attempt 2    HTTP ${f.attempt2.httpStatus}  ${f.attempt2.bytes}b  ld+json ${f.attempt2.ldJsonBlocks}`)
  if (f.idOnlyUrl) L.push(`    id-only url  HTTP ${f.idOnlyUrl.httpStatus}  ld+json ${f.idOnlyUrl.ldJsonBlocks}  redirected ${f.idOnlyUrl.redirected}`)
  L.push(`    page title   ${JSON.stringify(f.attempt1.pageTitle)}`)
  L.push(`    redirected   ${f.attempt1.redirected}`)
  L.push(`    closure text ${f.renderedClosureEvidence.length ? JSON.stringify(f.renderedClosureEvidence) : 'none in rendered markup'}`)
  L.push(`    verdict      ${f.supportedVerdict}`)
  L.push('')
}
writeFileSync(OUT_TEXT, L.join('\n'))

console.log('')
console.log(L.slice(0, 40).join('\n'))
console.log(`\nwrote ${OUT}`)
console.log(`wrote ${OUT_TEXT}`)
