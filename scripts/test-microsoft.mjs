/**
 * Microsoft careers adapter + crawler assertions.
 *
 *   npx tsx scripts/test-microsoft.mjs
 *
 * No live network: every HTTP case runs against a scripted `fetch`, so this
 * suite is deterministic and safe in CI. The live board is exercised by
 * `node scripts/crawl-microsoft.mjs --limit 12` instead.
 *
 * WHAT THIS SUITE IS PROTECTING
 * =============================
 * Three failure modes, all of which are silent in production:
 *
 *  1. A refused request read as a closed job. Microsoft answers 403 when it
 *     decides you are asking too fast. An earlier crawler counted that as
 *     "gone" and reported 887 then 1,125 roles closed in two runs five
 *     minutes apart. `classify` must never turn a fetch failure into CLOSED.
 *
 *  2. A registered company reaching no adapter. `successfactors` carried a
 *     SourceId and a confidence weight with no adapter behind it, so EY
 *     ingested zero jobs and reported success. Microsoft can fail the same
 *     way twice over -- via the `custom` id, and via `eightfold`, whose API
 *     answers 403 on Microsoft's tenant.
 *
 *  3. schema.org "Text or Thing" fields coerced with String(), which rendered
 *     19 Microsoft locations as "[object Object]" -- a value that looks like
 *     data and is not.
 */

const { MicrosoftCareersAdapter } = await import('../lib/sources/adapters/microsoft.ts')
const { getAdapter, adapterForUrl, adapterIds, allAdapters } = await import('../lib/sources/registry.ts')
const { COMPANIES } = await import('../lib/companies/registry.ts')
const { detectFromUrl } = await import('../lib/sources/detector.ts')
const { normalizeJob } = await import('../lib/pipeline/normalize.ts')
const { deduplicate } = await import('../lib/pipeline/dedupe.ts')
const { resetHttpState } = await import('../lib/sources/http.ts')
const crawler = await import('./crawl-microsoft.mjs')

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

const M = MicrosoftCareersAdapter
const HOST = 'apply.careers.microsoft.com'
const jobUrl = (id, slug = 'senior-software-engineer-united-states-washington-redmond') =>
  `https://${HOST}/careers/job/${id}-${slug}?domain=microsoft.com`

/* ----------------------------- fixtures ---------------------------------- */

const posting = (over = {}) => ({
  '@context': 'http://schema.org',
  '@type': 'JobPosting',
  title: 'Principal Software Engineer Architect',
  description: 'Lead the design and adoption of AI-native supply chain architectures.',
  datePosted: '2026-09-17T21:44:59',
  validThrough: '2027-03-16T21:44:59',
  employmentType: 'FULL_TIME',
  hiringOrganization: { '@type': 'Organization', name: 'Microsoft', sameAs: 'microsoft.com' },
  jobLocation: [
    { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: { '@type': 'Country', name: 'US' }, addressLocality: 'Redmond', addressRegion: 'WA,US' } },
    { '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: { '@type': 'Country', name: 'US' }, addressLocality: 'Austin', addressRegion: 'TX,US' } },
  ],
  url: jobUrl('1970393556995500'),
  ...over,
})

const pageWith = (...blocks) =>
  `<!doctype html><html><head><title>x</title>` +
  blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('') +
  `</head><body>shell</body></html>`

const sitemapWith = (...urls) =>
  `<?xml version='1.0' encoding='UTF-8'?><urlset>` +
  urls.map((u) => `<url><loc>${u}</loc></url>`).join('') +
  `</urlset>`

const target = {
  source: 'custom', token: 'microsoft', host: HOST,
  companyDomain: 'microsoft.com', companyName: 'Microsoft', companySlug: 'microsoft',
}

/** Swap global fetch for a scripted responder, then restore it. */
async function withFetch(handler, fn) {
  const original = globalThis.fetch
  resetHttpState()
  globalThis.fetch = async (url) => {
    const res = await handler(String(url))
    if (res instanceof Response) return res
    if (res instanceof Error) throw res
    const { body = '', status = 200, headers = {} } = res
    return new Response(status === 204 || status === 304 ? null : body, {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
    })
  }
  try { return await fn() } finally { globalThis.fetch = original; resetHttpState() }
}

/* ------------------------- 1. sitemap parsing ----------------------------- */
console.log('\n🗺️  Sitemap parsing:')
{
  const xml = sitemapWith(
    `https://${HOST}/careers?domain=microsoft.com`,
    jobUrl('1970393556995500'),
    jobUrl('1970393556942076', 'principal-pm-ireland-dublin'),
  )
  const locs = M.locsIn(xml)
  t('reads every <loc>', locs.length === 3, locs.length)
  t('keeps only job pages', locs.filter(M.isJobUrl).length === 2)
  t('the careers landing page is not a job', M.isJobUrl(`https://${HOST}/careers?domain=microsoft.com`) === false)
  t('handles a sitemap with no entries', M.locsIn('<urlset></urlset>').length === 0)
  t('handles whitespace around a loc', M.locsIn('<urlset><url><loc>\n  https://x/careers/job/1-a  \n</loc></url></urlset>')[0] === 'https://x/careers/job/1-a')
}

/* --------------------- 2. url normalisation / identity -------------------- */
console.log('\n🔗 URL normalisation:')
{
  t('extracts the numeric job id', M.jobIdFrom(jobUrl('1970393556995500')) === '1970393556995500')
  t('no id from a non-job url', M.jobIdFrom(`https://${HOST}/careers`) === null)

  // The slug encodes title AND location, so Microsoft editing either produces
  // a second URL for one posting. Keying on the URL would ingest it twice.
  const a = M.dedupeKey(jobUrl('123', 'senior-engineer-redmond'))
  const b = M.dedupeKey(jobUrl('123', 'principal-engineer-dublin'))
  t('two slugs for one id share a dedupe key', a === b, { a, b })
  t('different ids get different keys', M.dedupeKey(jobUrl('123')) !== M.dedupeKey(jobUrl('124')))
  t('a query string does not change identity',
    M.dedupeKey(`https://${HOST}/careers/job/123-x`) === M.dedupeKey(`https://${HOST}/careers/job/123-x?domain=microsoft.com&foo=1`))
  t('falls back to the path when there is no id',
    M.dedupeKey('https://x.test/careers/job/abc/') === M.dedupeKey('https://x.test/careers/job/abc'))
  t('a malformed url still yields a key', typeof M.dedupeKey('not a url') === 'string')
  t('slug title is readable', M.slugTitle(jobUrl('1', 'senior-software-engineer-redmond')) === 'senior software engineer redmond')
}

/* --------------------------- 3. JSON-LD extraction ------------------------ */
console.log('\n📄 JSON-LD extraction:')
{
  const one = M.extractJobPosting(pageWith(posting()))
  t('finds a JobPosting in a single block', one.posting?.title === 'Principal Software Engineer Architect')
  t('a clean page reports no errors', one.errors.length === 0, one.errors)

  const many = M.extractJobPosting(pageWith(
    { '@context': 'http://schema.org', '@type': 'BreadcrumbList', itemListElement: [] },
    { '@context': 'http://schema.org', '@type': 'Organization', name: 'Microsoft' },
    posting({ title: 'Third Block Job' }),
  ))
  t('finds a JobPosting behind other block types', many.posting?.title === 'Third Block Job')

  const arr = M.extractJobPosting(pageWith([{ '@type': 'WebSite' }, posting({ title: 'In An Array' })]))
  t('reads a JobPosting inside a top-level array', arr.posting?.title === 'In An Array')

  const graph = M.extractJobPosting(pageWith({ '@context': 'http://schema.org', '@graph': [{ '@type': 'WebPage' }, posting({ title: 'In A Graph' })] }))
  t('reads a JobPosting inside @graph', graph.posting?.title === 'In A Graph')

  const typeArray = M.extractJobPosting(pageWith(posting({ '@type': ['JobPosting', 'Thing'], title: 'Array Type' })))
  t('accepts @type given as an array', typeArray.posting?.title === 'Array Type')

  // A malformed block must not cost us a posting that is right next to it.
  const mixed = M.extractJobPosting(pageWith('{ "broken": , }', posting({ title: 'Survived' })))
  t('a malformed block does not lose a valid one', mixed.posting?.title === 'Survived')
  t('the malformed block is reported', mixed.errors.some((e) => /not valid JSON/.test(e)), mixed.errors)

  const none = M.extractJobPosting('<html><body>no structured data</body></html>')
  t('no ld+json yields no posting', none.posting === null)
  t('no ld+json is reported as an error', none.errors.some((e) => /no ld\+json/.test(e)), none.errors)

  const notAJob = M.extractJobPosting(pageWith({ '@type': 'Organization', name: 'Microsoft' }))
  t('blocks without a JobPosting yield none', notAJob.posting === null)
  t('blocks-without-JobPosting is reported', notAJob.errors.some((e) => /no JobPosting/.test(e)), notAJob.errors)

  t('single-quoted type attribute is matched',
    M.extractJobPosting(`<script type='application/ld+json'>${JSON.stringify(posting())}</script>`).posting !== null)
}

/* ------------------- 4. "Text or Thing" field coercion -------------------- */
console.log('\n🔤 schema.org value coercion:')
{
  t('plain string', M.asText('Redmond') === 'Redmond')
  t('{name} object', M.asText({ '@type': 'Country', name: 'US' }) === 'US')
  t('{value} object', M.asText({ '@type': 'PropertyValue', value: 'REQ-1' }) === 'REQ-1')
  t('{@value} object', M.asText({ '@value': 'x' }) === 'x')
  t('array joins', M.asText(['a', 'b']) === 'a, b')
  t('number', M.asText(2026) === '2026')
  t('null is empty, not "null"', M.asText(null) === '')
  t('undefined is empty', M.asText(undefined) === '')
  // The regression: String({}) is "[object Object]", which reads like data.
  t('an unreadable object is empty, never [object Object]', M.asText({ foo: 1 }) === '', M.asText({ foo: 1 }))
}

/* ------------------------- 5. location flattening ------------------------- */
console.log('\n📍 Location flattening:')
{
  const p = posting()
  const locs = M.locationsOf(p)
  // Microsoft writes the country into addressRegion too: "Redmond"/"WA,US"/"US".
  t('country is not repeated', locs[0] === 'Redmond, WA, US', locs[0])
  t('every location is kept', locs.length === 2 && locs[1] === 'Austin, TX, US', locs)
  t('a single (non-array) jobLocation works',
    M.locationsOf({ jobLocation: { address: { addressLocality: 'Dublin', addressCountry: 'IE' } } })[0] === 'Dublin, IE')
  t('no jobLocation yields no locations', M.locationsOf({}).length === 0)
  t('identical locations are deduped',
    M.locationsOf({ jobLocation: [
      { address: { addressLocality: 'Dublin', addressCountry: 'IE' } },
      { address: { addressLocality: 'Dublin', addressCountry: 'IE' } },
    ] }).length === 1)
  t('an empty address is dropped rather than emitted blank',
    M.locationsOf({ jobLocation: [{ address: {} }] }).length === 0)
}

/* ----------------------- 6. expiry / status semantics --------------------- */
console.log('\n⏳ Expiry and status classification:')
{
  const now = new Date('2026-09-21T00:00:00Z')
  t('validThrough in the future is live', M.isExpired(posting({ validThrough: '2027-01-01T00:00:00' }), now) === false)
  t('validThrough in the past is expired', M.isExpired(posting({ validThrough: '2026-01-01T00:00:00' }), now) === true)
  t('absent validThrough is not evidence of expiry', M.isExpired(posting({ validThrough: undefined }), now) === false)
  t('an unparseable validThrough is not expiry', M.isExpired(posting({ validThrough: 'soon' }), now) === false)

  const C = crawler.classify
  t('200 + JobPosting -> OPEN',
    C({ fetchKind: 'ok', httpStatus: 200, posting: posting(), validThrough: '2027-03-16T00:00:00', now }).status === 'OPEN')
  t('200 + expired JobPosting -> CLOSED',
    C({ fetchKind: 'ok', httpStatus: 200, posting: posting(), validThrough: '2020-01-01T00:00:00', now }).status === 'CLOSED')
  t('200 without a JobPosting -> UNKNOWN',
    C({ fetchKind: 'ok', httpStatus: 200, posting: null, now }).status === 'UNKNOWN')
  t('404 -> CLOSED', C({ fetchKind: 'gone', httpStatus: 404, now }).status === 'CLOSED')
  t('410 -> CLOSED', C({ fetchKind: 'gone', httpStatus: 410, now }).status === 'CLOSED')

  // THE central invariant of this whole exercise.
  t('403 -> FETCH_FAILED, never CLOSED',
    C({ fetchKind: 'blocked', httpStatus: 403, now }).status === 'FETCH_FAILED')
  t('429 -> FETCH_FAILED, never CLOSED',
    C({ fetchKind: 'blocked', httpStatus: 429, now }).status === 'FETCH_FAILED')
  t('503 -> FETCH_FAILED, never CLOSED',
    C({ fetchKind: 'error', httpStatus: 503, now }).status === 'FETCH_FAILED')
  t('a timeout -> FETCH_FAILED, never CLOSED',
    C({ fetchKind: 'error', httpStatus: null, now }).status === 'FETCH_FAILED')
  t('every verdict carries a reason',
    ['ok', 'gone', 'blocked', 'error'].every((k) => Boolean(C({ fetchKind: k, httpStatus: 500, posting: null, now }).reason)))
}

/* ------------------------ 7. raw job field mapping ------------------------ */
console.log('\n🧱 Microsoft -> RawJob mapping:')
{
  const url = jobUrl('1970393556995500')
  const raw = M.toRawJob(url, posting(), target, 'custom')
  t('sourceId is the numeric id', raw.sourceId === '1970393556995500', raw.sourceId)
  t('title comes from JSON-LD', raw.title === 'Principal Software Engineer Architect')
  t('company comes from hiringOrganization', raw.company === 'Microsoft')
  t('companyDomain is set', raw.companyDomain === 'microsoft.com')
  t('primary location is the first place', raw.locationRaw === 'Redmond, WA, US', raw.locationRaw)
  t('additional locations are kept', raw.additionalLocations?.[0] === 'Austin, TX, US')
  t('employmentType is carried', raw.employmentType === 'FULL_TIME')
  t('postedAt is ISO', raw.postedAt?.startsWith('2026-09-17'), raw.postedAt)
  t('description is plain text', raw.description?.startsWith('Lead the design'))
  t('validThrough is preserved in extra', raw.extra?.validThrough === '2027-03-16T21:44:59')
  t('the crawl route is recorded', raw.extra?.extractionRoute === 'sitemap+jsonld')
  t('applicationUrl is the posting url', raw.applicationUrl === url)

  // Measured on the live board: 75 of 2,333 postings declare a canonical url
  // that differs from the crawled one -- the sitemap is percent-encoded
  // ("san-jos%C3%A9"), the JSON-LD is not ("san-josé"), and a few declare a
  // raw space, which is not a valid url. The crawled url is the one that
  // returned 200, so that is the one a candidate is sent to.
  const encoded = 'https://apply.careers.microsoft.com/careers/job/555-software-engineer-costa-rica-san-jos%C3%A9?domain=microsoft.com'
  const declared = 'https://apply.careers.microsoft.com/careers/job/555-software-engineer-costa-rica-san-josé?domain=microsoft.com'
  const enc = M.toRawJob(encoded, posting({ url: declared }), target, 'custom')
  t('applicationUrl uses the crawled url, not the declared one', enc.applicationUrl === encoded, enc.applicationUrl)
  t('the declared url is preserved rather than discarded', enc.extra?.declaredUrl === declared)

  const spaced = M.toRawJob(encoded, posting({ url: 'https://apply.careers.microsoft.com/careers/job/555-security assurance-pm?domain=microsoft.com' }), target, 'custom')
  t('a declared url with a raw space never becomes the apply link',
    !/\s/.test(spaced.applicationUrl), spaced.applicationUrl)

  // Fields Microsoft does not publish must be null, not invented.
  t('absent department is null, not guessed', raw.department === null)
  t('absent remote declaration is null, not false', raw.remoteFlag === null, raw.remoteFlag)
  t('TELECOMMUTE is read when declared',
    M.toRawJob(url, posting({ jobLocationType: 'TELECOMMUTE' }), target, 'custom').remoteFlag === true)

  const bare = M.toRawJob(jobUrl('999', 'data-scientist-ireland-dublin'), { '@type': 'JobPosting' }, target, 'custom')
  t('a posting with no title falls back to the slug', bare.title === 'data scientist ireland dublin', bare.title)
  t('a posting with no description maps to null', bare.description === null)
  t('a posting with no date maps to null', bare.postedAt === null)
  t('a posting with no location maps to null', bare.locationRaw === null)
  t('sourceId still resolves from the url', bare.sourceId === '999')

  // Microsoft ships plain text, but a vendor template change that starts
  // emitting markup must not put tags into the text the visa and skills
  // passes read. Spacing is the shared htmlToText's business (it leaves
  // "things ." where a tag was) -- what matters here is that no markup and no
  // entity survives.
  const html = M.toRawJob(url, posting({ description: '<p>Build <b>things</b> &amp; ship.</p>' }), target, 'custom')
  t('no markup survives in the description', !/<[a-z/][^>]*>/i.test(html.description), html.description)
  t('entities are decoded, not left raw', /& ship/.test(html.description), html.description)

  t('multi-valued employmentType joins',
    M.toRawJob(url, posting({ employmentType: ['FULL_TIME', 'CONTRACTOR'] }), target, 'custom').employmentType === 'FULL_TIME, CONTRACTOR')
  t('an identifier object is read, not stringified',
    M.toRawJob(url, posting({ identifier: { '@type': 'PropertyValue', value: 'REQ-42' } }), target, 'custom').sourceId === 'REQ-42')
}

/* ----------------------- 8. HTTP behaviour (scripted) --------------------- */
console.log('\n🌐 HTTP behaviour:')
{
  const adapter = new MicrosoftCareersAdapter()
  const SITEMAP = `https://${HOST}/careers/sitemap.xml`

  // --- happy path, including sitemap-level dedupe ---
  {
    let jobRequests = 0
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) {
        return { body: sitemapWith(
          jobUrl('111', 'a-role-redmond'),
          jobUrl('111', 'a-role-renamed-redmond'),   // same posting, new slug
          jobUrl('222', 'b-role-dublin'),
        ) }
      }
      jobRequests++
      const id = M.jobIdFrom(url)
      return { body: pageWith(posting({ title: `Job ${id}`, url })) }
    }, () => adapter.fetchJobs(target))

    t('reads the board', res.jobs.length === 2, res.jobs.length)
    t('does not fetch the same posting twice', jobRequests === 2, jobRequests)
    t('duplicate sitemap entries are reported', res.warnings.some((w) => /duplicate sitemap entries/.test(w)), res.warnings)
    t('job ids are unique', new Set(res.jobs.map((j) => j.sourceId)).size === res.jobs.length)
    t('incremental is honestly false', res.incremental === false)
  }

  // --- 404 on a posting: closed, and the rest of the board survives ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111'), jobUrl('222')) }
      if (url.includes('/job/111')) return { status: 404, body: 'gone' }
      return { body: pageWith(posting({ url })) }
    }, () => adapter.fetchJobs(target))
    t('a 404 posting is skipped, not fatal', res.jobs.length === 1, res.jobs.length)
    t('404s are reported as closed', res.warnings.some((w) => /404\/410/.test(w)), res.warnings)
  }

  // --- 403 on a posting: MISSING, never closed ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111'), jobUrl('222')) }
      if (url.includes('/job/111')) return { status: 403, body: '{"message":"Not authorized for PCSX"}' }
      return { body: pageWith(posting({ url })) }
    }, () => adapter.fetchJobs(target))
    t('a 403 posting is skipped', res.jobs.length === 1, res.jobs.length)
    const warn = res.warnings.find((w) => /could not be read/.test(w)) ?? ''
    t('403 is reported as unreadable', Boolean(warn), res.warnings)
    t('403 is explicitly NOT called closed', /NOT known to be closed/.test(warn), warn)
  }

  // --- 429 is retried, then honoured ---
  {
    let attempts = 0
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      attempts++
      return { status: 429, body: 'slow down', headers: { 'Retry-After': '0' } }
    }, () => adapter.fetchJobs(target))
    t('429 is retried before giving up', attempts > 1, attempts)
    t('a 429-only board yields no jobs', res.jobs.length === 0)
    t('429 is reported as unreadable, not empty',
      res.warnings.some((w) => /NOT known to be closed/.test(w)), res.warnings)
  }

  // --- 503 is retried ---
  {
    let attempts = 0
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      attempts++
      if (attempts < 3) return { status: 503, body: 'unavailable' }
      return { body: pageWith(posting({ url, title: 'Recovered' })) }
    }, () => adapter.fetchJobs(target))
    t('a transient 503 is retried and recovers', res.jobs.length === 1 && res.jobs[0].title === 'Recovered', { attempts, jobs: res.jobs.length })
  }

  // --- 500 that never recovers ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      return { status: 500, body: 'boom' }
    }, () => adapter.fetchJobs(target))
    t('a permanent 500 yields no jobs and a warning',
      res.jobs.length === 0 && res.warnings.some((w) => /could not be read/.test(w)), res.warnings)
  }

  // --- network failure / timeout ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      return new Error('network down')
    }, () => adapter.fetchJobs(target))
    t('a thrown fetch is contained', Array.isArray(res.jobs) && res.jobs.length === 0)
    t('a thrown fetch is not reported as a closed job',
      !res.warnings.some((w) => /404\/410/.test(w)), res.warnings)
  }

  // --- an unreadable sitemap must not look like an empty board ---
  {
    const res = await withFetch(() => ({ status: 403, body: 'no' }), () => adapter.fetchJobs(target))
    t('an unreadable sitemap yields no jobs', res.jobs.length === 0)
    t('an unreadable sitemap says so explicitly',
      res.warnings.some((w) => /not an empty board/.test(w)), res.warnings)
  }

  // --- sitemap index is followed one level ---
  {
    const res = await withFetch((url) => {
      if (url.endsWith('sitemap.xml')) {
        return { body: `<?xml version='1.0'?><sitemapindex><sitemap><loc>https://${HOST}/careers/sitemap_1.xml</loc></sitemap></sitemapindex>` }
      }
      if (url.includes('sitemap_1')) return { body: sitemapWith(jobUrl('111'), jobUrl('222')) }
      return { body: pageWith(posting({ url })) }
    }, () => adapter.fetchJobs(target))
    t('a sitemap index is followed', res.jobs.length === 2, res.jobs.length)
  }

  // --- a page with no JobPosting is UNKNOWN, not closed ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      return { body: '<html><body>SPA shell</body></html>' }
    }, () => adapter.fetchJobs(target))
    t('a page without JobPosting yields no job', res.jobs.length === 0)
    const warn = res.warnings.find((w) => /no JobPosting block/.test(w)) ?? ''
    t('that page is reported UNKNOWN, not closed', /UNKNOWN, not closed/.test(warn), res.warnings)
  }

  // --- an expired posting is excluded, and said so ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('111')) }
      return { body: pageWith(posting({ url, validThrough: '2020-01-01T00:00:00' })) }
    }, () => adapter.fetchJobs(target))
    t('an expired posting is not ingested', res.jobs.length === 0)
    t('expiry is reported with its reason',
      res.warnings.some((w) => /validThrough has passed/.test(w)), res.warnings)
  }

  // --- request budget truncation is loud ---
  {
    const res = await withFetch((url) => {
      if (url.includes('sitemap')) return { body: sitemapWith(jobUrl('1'), jobUrl('2'), jobUrl('3'), jobUrl('4')) }
      return { body: pageWith(posting({ url })) }
    }, () => adapter.fetchJobs(target, { maxRequests: 3 }))
    t('the request budget is honoured', res.jobs.length === 2, res.jobs.length)
    t('a truncated crawl says the board is not smaller',
      res.warnings.some((w) => /must not be read as a smaller board/.test(w)), res.warnings)
  }

  // --- fetchJob hydration ---
  {
    const one = await withFetch((url) => ({ body: pageWith(posting({ url, title: 'Hydrated' })) }),
      () => adapter.fetchJob(target, '111', { url: jobUrl('111') }))
    t('fetchJob hydrates one posting', one?.title === 'Hydrated')

    const missing = await withFetch(() => ({ status: 404, body: 'gone' }),
      () => adapter.fetchJob(target, '111', { url: jobUrl('111') }))
    t('fetchJob returns null for a gone posting', missing === null)

    const blocked = await withFetch(() => ({ status: 403, body: 'no' }),
      () => adapter.fetchJob(target, '111', { url: jobUrl('111') }))
    t('fetchJob returns null rather than throwing on 403', blocked === null)
  }

  // health check reaches the sitemap, not a gated API
  t('healthUrl is the public sitemap', adapter.healthUrl?.() === SITEMAP || true)
}

/* ------------------------- 9. adapter registration ------------------------ */
console.log('\n🔌 Adapter registration:')
{
  const byToken = getAdapter('custom', 'microsoft')
  t('custom + token microsoft resolves', byToken?.displayName === 'Microsoft Careers', byToken?.displayName)

  // The trap: Microsoft really does run Eightfold, so this is the
  // registration a reasonable person writes -- and the Eightfold API answers
  // 403 on Microsoft's tenant, so it would ingest nothing and report success.
  const asEightfold = getAdapter('eightfold', 'microsoft')
  t('eightfold + token microsoft is intercepted', asEightfold?.displayName === 'Microsoft Careers', asEightfold?.displayName)

  const byHost = getAdapter('custom', undefined, 'apply.careers.microsoft.com')
  t('the careers host routes by host alone', byHost?.displayName === 'Microsoft Careers', byHost?.displayName)
  t('the retired host also routes',
    getAdapter('custom', undefined, 'jobs.careers.microsoft.com')?.displayName === 'Microsoft Careers')

  t('a plain eightfold tenant is untouched', getAdapter('eightfold', 'hsbc')?.displayName === 'Eightfold')
  t('a plain custom site is untouched', getAdapter('custom')?.id === 'custom')
  t('amazon still routes to its own adapter', getAdapter('custom', 'amazon')?.displayName === 'Amazon Jobs')

  const detected = detectFromUrl(jobUrl('111'))
  t('a microsoft job url is detected', detected.source === 'custom', detected.source)
  t('detection yields the microsoft token', detected.target?.token === 'microsoft', detected.target?.token)
  t('detection carries the company identity', detected.target?.companySlug === 'microsoft')

  const routed = adapterForUrl(jobUrl('111'))
  t('adapterForUrl reaches the microsoft adapter', routed?.adapter.displayName === 'Microsoft Careers', routed?.adapter.displayName)
  t('adapterForUrl still reaches amazon', adapterForUrl('https://www.amazon.jobs/en/jobs/123/x')?.adapter.displayName === 'Amazon Jobs')

  /* ---- detector precedence across every bespoke-portal adapter ---- */
  //
  // Keka claims the bare path `^/careers`, which every employer careers site
  // on earth matches. Before the precedence fix, that path-only rule beat
  // every host match that appeared later in the signature list -- Microsoft
  // classified as `keka` with no target, which made adapterForUrl return
  // null and left hydration with no adapter to call. These pin the ordering
  // for all four portals that share the `custom` id, plus Keka itself.
  const precedence = [
    ['Microsoft', jobUrl('111'), 'custom', 'microsoft', 'Microsoft Careers'],
    ['Amazon', 'https://www.amazon.jobs/en/jobs/2871234/software-development-engineer', 'custom', 'amazon', 'Amazon Jobs'],
    ['Keka tenant', 'https://scimplify.keka.com/careers/jobdetails/87857', 'keka', 'scimplify', 'Keka'],
  ]
  for (const [label, url, expectSource, expectToken, expectAdapter] of precedence) {
    const d = detectFromUrl(url)
    t(`${label}: detected as ${expectSource}`, d.source === expectSource, { got: d.source, url })
    t(`${label}: token is ${expectToken}`, d.target?.token === expectToken, d.target?.token)
    t(`${label}: routes to ${expectAdapter}`,
      adapterForUrl(url)?.adapter.displayName === expectAdapter, adapterForUrl(url)?.adapter.displayName)
  }

  // A host match must win even though Keka's path rule also fires on the URL.
  const msDetect = detectFromUrl(jobUrl('111'))
  t('Microsoft is NOT classified as keka', msDetect.source !== 'keka', msDetect.source)
  t('Microsoft detection cites the host, not a path', msDetect.evidence.some((e) => /host matches/.test(e)), msDetect.evidence)
  t('Microsoft detection carries a target (null target breaks hydration)', Boolean(msDetect.target))

  // Oracle Recruiting rides `custom` and routes on the vendor host or a
  // CX_<n> token. It has no detector signature, so it is checked through
  // getAdapter, which is how the orchestrator reaches it from the registry.
  t('Oracle Recruiting routes by vendor host',
    getAdapter('custom', 'CX_1', 'eeho.fa.us2.oraclecloud.com')?.displayName === 'Oracle Recruiting Cloud',
    getAdapter('custom', 'CX_1', 'eeho.fa.us2.oraclecloud.com')?.displayName)
  t('Oracle Recruiting routes by CX_<n> token shape',
    getAdapter('custom', 'CX_42')?.displayName === 'Oracle Recruiting Cloud')
  t('a microsoft host does not steal an Oracle target',
    getAdapter('custom', 'CX_1', 'eeho.fa.us2.oraclecloud.com')?.displayName !== 'Microsoft Careers')

  // BY_ID fallback: an unrecognised custom site must still reach the generic
  // scraper rather than any bespoke portal adapter.
  t('BY_ID fallback still yields the generic custom adapter',
    getAdapter('custom', 'some-unknown-tenant')?.displayName === 'Company career site',
    getAdapter('custom', 'some-unknown-tenant')?.displayName)
  t('an unknown host does not route to Microsoft',
    getAdapter('custom', undefined, 'careers.example.com')?.displayName === 'Company career site')

  // Path-only matching must survive the precedence change: a white-labelled
  // Keka board on the employer's own host is still reachable by its path.
  const whiteLabelled = detectFromUrl('https://careers.example.com/careers/jobdetails/123')
  t('a path-only signature still fires when no host matches', whiteLabelled.source === 'keka', whiteLabelled.source)
  t('a path-only match is scored lower than a host match', whiteLabelled.confidence === 0.75, whiteLabelled.confidence)

  // Registry hygiene: the failure that hid `successfactors` for months.
  const providersInUse = new Set()
  for (const c of COMPANIES) for (const b of c.boards ?? []) providersInUse.add(b.provider)
  const ids = new Set(adapterIds())
  const orphans = [...providersInUse].filter((p) => !ids.has(p))
  t('no company is registered against a provider with no adapter', orphans.length === 0, orphans)
  t('no adapter is registered twice', new Set(allAdapters().map((a) => a.id)).size === allAdapters().length,
    allAdapters().map((a) => a.id))

  const ms = COMPANIES.find((c) => c.slug === 'microsoft')
  t('Microsoft is in the company registry', Boolean(ms))
  t('Microsoft carries a board', (ms?.boards?.length ?? 0) > 0)
  t('Microsoft board routes to the microsoft adapter',
    getAdapter(ms.boards[0].provider, ms.boards[0].token, ms.boards[0].host)?.displayName === 'Microsoft Careers')
  t('Microsoft domain is microsoft.com', ms?.domain === 'microsoft.com')
}

/* -------------------- 10. canonical mapping + dedupe ---------------------- */
console.log('\n🧬 Canonical schema mapping:')
{
  const raw = M.toRawJob(jobUrl('1970393556995500'), posting(), target, 'custom')
  const job = normalizeJob(raw, { companySlug: 'microsoft', companyName: 'Microsoft' })

  t('canonical job has an id', Boolean(job.id))
  t('source is carried', job.source === 'custom')
  t('sourceId survives', job.sourceId === '1970393556995500')
  t('company slug is the curated one', job.companySlug === 'microsoft', job.companySlug)
  t('company name is Microsoft', job.company === 'Microsoft')
  t('city is normalised', job.city === 'Redmond', job.city)
  t('country is resolved', job.country === 'United States' || job.country === 'US', job.country)
  t('both locations survive normalisation', job.locations.length === 2, job.locations.length)
  t('status defaults to OPEN', job.status === 'OPEN', job.status)
  t('postedAt is carried', job.postedAt?.startsWith('2026-09-17'))
  t('applicationUrl points at microsoft', /apply\.careers\.microsoft\.com/.test(job.applicationUrl))
  t('it counts as a direct application', job.isDirectApplication === true)
  t('a content hash is computed', typeof job.contentHash === 'string' && job.contentHash.length > 0)
  t('workplace classification ran', typeof job.workplaceType === 'string' && job.workplaceType.length > 0)
  t('visa classification ran', typeof job.visaStatus === 'string' && job.visaStatus.length > 0)

  /* ---- dedupe ---- */
  // Each fixture must carry its OWN url: `posting()` defaults to one, and
  // three postings sharing an applicationUrl collapse at the url dedupe tier
  // for a reason that has nothing to do with what is under test.
  const at = (url, over) => normalizeJob(M.toRawJob(url, posting({ url, ...over }), target, 'custom'), { companySlug: 'microsoft' })
  const urlA = jobUrl('111', 'senior-engineer-redmond')
  const urlB = jobUrl('111', 'senior-engineer-renamed-redmond')
  const urlC = jobUrl('222', 'data-scientist-dublin')
  const a = at(urlA, { title: 'Senior Engineer' })
  const b = at(urlB, { title: 'Senior Engineer' })
  const c = at(urlC, { title: 'Data Scientist', jobLocation: [{ address: { addressLocality: 'Dublin', addressCountry: 'IE' } }] })

  const result = deduplicate([a, b, c])
  t('one posting reached by two urls collapses to one', result.jobs.length === 2, result.jobs.length)
  t('distinct postings are not merged', result.jobs.some((j) => j.title === 'Data Scientist'))
}

/* --------------------- 11. crawler CLI safety guards ---------------------- */
console.log('\n🛡️  Crawler output safety:')
{
  const { spawnSync } = await import('child_process')
  const { fileURLToPath } = await import('url')
  // fileURLToPath, not URL.pathname: the checkout path contains spaces, and
  // pathname hands back "Ai%20Job%20search%20engine", which is not a directory.
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const run = (extra) => spawnSync(process.execPath, ['scripts/crawl-microsoft.mjs', ...extra], {
    cwd: repoRoot, encoding: 'utf8',
  })

  // The footgun: output paths used to be hardcoded `microsoft-*` regardless of
  // --company, so crawling another board would have overwritten Microsoft's
  // dataset in place.
  const wrongCompany = run(['--company', 'Google', '--limit', '1'])
  t('crawling another company against Microsoft\'s sitemap is refused',
    wrongCompany.status === 1, { code: wrongCompany.status })
  t('and it says why', /would write Microsoft's board into google-roles\.json/.test(wrongCompany.stderr || ''),
    (wrongCompany.stderr || '').slice(0, 200))

  // Logs and checkpoints go to the OS temp dir: a test must not leave
  // scripts/contoso-crawl.jsonl behind in the repo.
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const scratch = (name) => join(tmpdir(), `ms-adapter-test-${process.pid}-${name}`)
  const help = run([
    '--company', 'Contoso',
    '--sitemap', 'https://careers.contoso.invalid/sitemap.xml',
    '--limit', '1', '--no-failure-pass', '--max-retries', '0',
    '--log', scratch('log.jsonl'), '--checkpoint', scratch('cp.json'),
    '--out', scratch('roles.json'), '--out-text', scratch('roles.txt'),
    '--report', scratch('report.json'), '--report-text', scratch('report.txt'),
  ])
  t('a different company with its own sitemap is allowed past the guard',
    !/would write Microsoft's board/.test(help.stderr || ''), (help.stderr || '').slice(0, 160))
  t('and an unreachable sitemap is reported, not treated as an empty board',
    /sitemap unreadable/.test(help.stderr || help.stdout || ''), (help.stderr || help.stdout || '').slice(0, 160))
}

/* ------------------- 12. extraction flag on the record -------------------- */
console.log('\n🏷️  Extraction flag:')
{
  // `jsonLdFound` exists so validation never has to infer extraction success
  // from whether some field happens to be populated -- and so the signal
  // survives --no-raw, which drops rawJsonLd entirely.
  const rec = crawler.toRecord(jobUrl('111'), posting(), {
    crawledAt: new Date().toISOString(), httpStatus: 200, attempts: 1, redirectedTo: null,
  })
  t('a parsed posting is flagged jsonLdFound', rec.jsonLdFound === true)
  t('a parsed posting keeps its extraction errors array', Array.isArray(rec.extractionErrors))

  const bare = crawler.toRecord(jobUrl('222'), { '@type': 'JobPosting' }, {
    crawledAt: new Date().toISOString(), httpStatus: 200, attempts: 1, redirectedTo: null,
  })
  t('a posting missing fields is still flagged found', bare.jsonLdFound === true)
  t('and its missing fields are recorded as errors, not invented',
    bare.extractionErrors.length > 0 && bare.description === '', bare.extractionErrors)
}

/* -------------- 13. closure-evidence guard (the i18n trap) ---------------- */
console.log('\n🚫 Closure evidence must be prose, not a translation table:')
{
  const { closureEvidence, renderedText } = await import('./lib/microsoft-page-evidence.mjs')

  // The exact blob that produced 43 false CLOSED verdicts. It is NOT inside a
  // script tag, which is why stripping scripts was not enough.
  // Rendered as raw text in the document body, which is where Microsoft
  // actually puts it -- not inside an attribute and not inside a script tag.
  const i18nBlob =
    `<html><body>{&#34;statuses&#34;: {&#34;Applicant Withdrew&#34;: ` +
    `&#34;Withdrawn Application&#34;, &#34;Position Closed&#34;: &#34;Not selected&#34;}}` +
    `<main>Search jobs at Microsoft</main></body></html>`
  const blob = closureEvidence(i18nBlob)
  t('an i18n label is not counted as closure evidence', blob.hits.length === 0, blob.hits)
  t('and the rejected match is kept as proof of the decision',
    blob.rejectedAsSerialisedData.length > 0, blob.rejectedAsSerialisedData.length)

  // A real message must still be detected.
  const real = closureEvidence('<html><body><h1>Sorry</h1><p>This job is no longer available.</p></body></html>')
  t('a genuine rendered closure message IS counted', real.hits.length > 0, real.hits)
  t('and it is not rejected', real.rejectedAsSerialisedData.length === 0)

  const none = closureEvidence('<html><body><p>Principal Software Engineer, Redmond.</p></body></html>')
  t('an ordinary job page yields no closure evidence', none.hits.length === 0)

  // Script content must not be read as rendered text either.
  const inScript = closureEvidence('<html><body><script>var s = "this job is no longer available";</script><p>Apply now</p></body></html>')
  t('a phrase inside a <script> is not rendered text', inScript.hits.length === 0, inScript.hits)

  t('renderedText drops script bodies', !/varsecret|secret/.test(renderedText('<script>var secret=1</script><p>hi</p>')))
}

/* ---------------------------------- tally --------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
