/**
 * Analytics: identity, privacy, validation, de-duplication and metrics.
 *
 * The properties that matter here are not "does it count" but "does it count
 * the right things and store the right amount":
 *
 *   - no IP or user agent ever leaves identity.ts
 *   - session ids do not survive the day
 *   - a client cannot assert its own country, device or session
 *   - bots are labelled and excluded, not silently dropped
 *   - a rate built on three impressions is not reported at all
 */
import { ClientEventBatchSchema, ClientEventSchema, normalizeQuery, filterSignature, normalizePath, LIMITS, SERVER_ONLY_EVENT_TYPES } from '../lib/analytics/events.ts'
import { deriveIdentity, classifyDevice, classifyBrowser, classifyOs, classifyReferrer, readCountry, hasOptedOut } from '../lib/analytics/identity.ts'
import { computeTotals, computeJobs, computeQueries, computeFunnel, computeDimension, opportunityScore, MIN_SAMPLE } from '../lib/analytics/metrics.ts'
import { markRepeat, __resetDedupe, buildEvent } from '../lib/analytics/record.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/** Minimal NextRequest stand-in: only headers, cookies and url are read. */
function req({ ip = '203.0.113.5', ua = 'Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120 Safari', headers = {}, cookies = {}, url = 'https://jobspark.test/jobs' } = {}) {
  const h = new Map(Object.entries({ 'x-forwarded-for': ip, 'user-agent': ua, ...headers }).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    url,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    cookies: { get: (k) => (k in cookies ? { value: cookies[k] } : undefined) },
  }
}

/* ========================== privacy: identity ============================ */
{
  const id = deriveIdentity(req())
  const serialised = JSON.stringify(id)

  // The load-bearing assertion of the whole design.
  t('the derived identity contains no IP address', !serialised.includes('203.0.113.5'), serialised)
  t('the derived identity contains no user agent', !serialised.includes('Mozilla'), serialised)
  t('it exposes only the declared fields',
    JSON.stringify(Object.keys(id).sort()) ===
      JSON.stringify(['browser', 'country', 'device', 'isBot', 'os', 'referrer', 'sessionId'].sort()),
    Object.keys(id))

  t('the session id is a fixed-width hash', /^[0-9a-f]{32}$/.test(id.sessionId), id.sessionId)

  // Same visitor, same day -> same id. Different visitor -> different id.
  const a = deriveIdentity(req({ ip: '198.51.100.1' }), new Date('2026-09-15T10:00:00Z'))
  const b = deriveIdentity(req({ ip: '198.51.100.1' }), new Date('2026-09-15T22:00:00Z'))
  const c = deriveIdentity(req({ ip: '198.51.100.2' }), new Date('2026-09-15T10:00:00Z'))
  t('the same visitor is stable within a day', a.sessionId === b.sessionId)
  t('a different visitor gets a different id', a.sessionId !== c.sessionId)

  // The salt rotation is what makes this anonymous rather than merely pseudonymous.
  const tomorrow = deriveIdentity(req({ ip: '198.51.100.1' }), new Date('2026-09-16T10:00:00Z'))
  t('the id does NOT survive into the next day', a.sessionId !== tomorrow.sessionId)

  // A different user agent behind one NAT is usually distinguished.
  const other = deriveIdentity(req({ ip: '198.51.100.1', ua: 'Mozilla/5.0 (Windows) Firefox/130' }), new Date('2026-09-15T10:00:00Z'))
  t('two people behind one address are usually separated', a.sessionId !== other.sessionId)
}

/* ============================ classification ============================= */
{
  t('iPhone is mobile', classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari') === 'mobile')
  t('iPad is tablet', classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0) Safari') === 'tablet')
  // An Android TABLET omits "Mobile"; checking mobile first mislabels it.
  t('Android without "Mobile" is a tablet', classifyDevice('Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome') === 'tablet')
  t('Android with "Mobile" is a phone', classifyDevice('Mozilla/5.0 (Linux; Android 13; Pixel) Mobile Chrome') === 'mobile')
  t('a plain desktop UA is desktop', classifyDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/120') === 'desktop')
  t('an empty UA is unknown', classifyDevice('') === 'unknown')

  // Every Chromium UA also says "Safari", and Edge also says "Chrome".
  t('Edge is not reported as Chrome', classifyBrowser('Mozilla/5.0 Chrome/120 Safari Edg/120') === 'edge')
  t('Chrome is not reported as Safari', classifyBrowser('Mozilla/5.0 Chrome/120 Safari/537') === 'chrome')
  t('Safari is Safari', classifyBrowser('Mozilla/5.0 (Macintosh) Version/17 Safari/605') === 'safari')
  t('Firefox is Firefox', classifyBrowser('Mozilla/5.0 Firefox/130') === 'firefox')

  // iPadOS reports "Macintosh" in desktop-site mode, so iOS must win.
  t('iPad desktop-mode is still iOS', classifyOs('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)') === 'ios')
  t('Windows is windows', classifyOs('Mozilla/5.0 (Windows NT 10.0)') === 'windows')
  t('Android is android', classifyOs('Mozilla/5.0 (Linux; Android 13)') === 'android')
}

/* ============================== bots ==================================== */
{
  for (const ua of [
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'curl/8.4.0',
    'python-requests/2.31',
    'HeadlessChrome/120',
    'Mozilla/5.0 AhrefsBot/7.0',
    'node-fetch/1.0',
  ]) {
    t(`bot detected: ${ua.slice(0, 32)}`, deriveIdentity(req({ ua })).isBot, ua)
  }
  t('a real browser is not a bot', !deriveIdentity(req()).isBot)
}

/* ============================== referrer ================================= */
// The class is stored; the URL never is.
{
  t('no referrer is direct', classifyReferrer(null, 'jobspark.test') === 'direct')
  t('our own host is internal', classifyReferrer('https://jobspark.test/jobs', 'jobspark.test') === 'internal')
  t('Google is a search engine', classifyReferrer('https://www.google.com/search?q=secret+terms', 'jobspark.test') === 'search_engine')
  t('LinkedIn is social', classifyReferrer('https://www.linkedin.com/feed', 'jobspark.test') === 'social')
  t('anything else is external', classifyReferrer('https://news.example.com/a', 'jobspark.test') === 'external')
  t('a malformed referrer is unknown', classifyReferrer('not a url', 'jobspark.test') === 'unknown')

  // The point of classifying: another site's query string never reaches storage.
  const id = deriveIdentity(req({ headers: { referer: 'https://www.google.com/search?q=very+private+thing' } }))
  t('the referring query string is not retained', !JSON.stringify(id).includes('very+private'), id)
}

/* =============================== country ================================= */
{
  t('reads the Vercel country header', readCountry(req({ headers: { 'x-vercel-ip-country': 'GB' } })) === 'GB')
  t('reads the Cloudflare country header', readCountry(req({ headers: { 'cf-ipcountry': 'in' } })) === 'IN')
  // Unknown is recorded as unknown. A wrong country is worse than a gap.
  t('no header means null, not a guess', readCountry(req()) === null)
  t('the XX placeholder is rejected', readCountry(req({ headers: { 'cf-ipcountry': 'XX' } })) === null)
  t('a malformed code is rejected', readCountry(req({ headers: { 'cf-ipcountry': 'GBR1' } })) === null)
}

/* ============================== opt-out ================================== */
{
  t('Global Privacy Control is honoured', hasOptedOut(req({ headers: { 'sec-gpc': '1' } })))
  t('DNT is honoured', hasOptedOut(req({ headers: { dnt: '1' } })))
  t('the opt-out cookie is honoured', hasOptedOut(req({ cookies: { js_no_analytics: '1' } })))
  t('an ordinary request is not opted out', !hasOptedOut(req()))
}

/* ====================== the client cannot assert ======================== */
{
  // A payload trying to claim a session, a country and a time.
  const forged = {
    type: 'search',
    query: 'engineer',
    sessionId: 'attacker-chosen',
    country: 'ZZ',
    device: 'desktop',
    isBot: false,
    ts: '1999-01-01T00:00:00.000Z',
  }
  const built = buildEvent(req({ headers: { 'cf-ipcountry': 'GB' }, ua: 'curl/8.4.0' }), forged)

  t('a client-supplied session id is ignored', built.sessionId !== 'attacker-chosen', built.sessionId)
  t('a client-supplied country is ignored', built.country === 'GB', built.country)
  t('a client-supplied timestamp is ignored', built.ts !== forged.ts, built.ts)
  t('the server decides bot status', built.isBot === true, built.isBot)
  t('the server decides device', built.device === 'bot', built.device)

  // The two commercially valuable events are refused from the browser outright.
  for (const type of SERVER_ONLY_EVENT_TYPES) {
    t(`"${type}" is refused from a client`, !ClientEventSchema.safeParse({ type }).success)
  }
}

/* ============================= validation =============================== */
{
  t('a valid event parses', ClientEventSchema.safeParse({ type: 'search', query: 'engineer' }).success)
  t('an unknown event type is refused', !ClientEventSchema.safeParse({ type: 'not_a_real_event' }).success)
  t('an over-long query is refused',
    !ClientEventSchema.safeParse({ type: 'search', query: 'x'.repeat(LIMITS.query + 1) }).success)
  t('too many filters are refused', (() => {
    const filters = {}
    for (let i = 0; i <= LIMITS.filters; i++) filters[`k${i}`] = 'v'
    return !ClientEventSchema.safeParse({ type: 'search', filters }).success
  })())
  t('a negative result count is refused',
    !ClientEventSchema.safeParse({ type: 'search', resultCount: -1 }).success)
  t('zero results IS valid — it is the interesting case',
    ClientEventSchema.safeParse({ type: 'search', resultCount: 0 }).success)

  t('an empty batch is refused', !ClientEventBatchSchema.safeParse({ events: [] }).success)
  t('an over-long batch is refused',
    !ClientEventBatchSchema.safeParse({ events: Array(LIMITS.batch + 1).fill({ type: 'page_view' }) }).success)
  t('a full batch is accepted',
    ClientEventBatchSchema.safeParse({ events: Array(LIMITS.batch).fill({ type: 'page_view' }) }).success)
}

/* ============================ normalisation ============================= */
{
  t('case and whitespace fold together',
    normalizeQuery('  Senior   Software   Engineer ') === 'senior software engineer')
  t('an empty query is null', normalizeQuery('   ') === null)
  t('null stays null', normalizeQuery(null) === null)
  t('C++ survives normalisation', normalizeQuery('C++ developer') === 'c++ developer')

  // A stable signature is what makes "which filters together" a group-by.
  t('filter order does not change the signature',
    filterSignature({ b: '2', a: '1' }) === filterSignature({ a: '1', b: '2' }))
  t('no filters is null', filterSignature({}) === null)

  // The path can carry the search terms; the query string is dropped.
  t('the query string is stripped from the path',
    normalizePath('/jobs?q=something+private') === '/jobs')
  t('the fragment is stripped from the path', normalizePath('/jobs#x') === '/jobs')
}

/* =========================== de-duplication ============================= */
{
  __resetDedupe()
  const mk = (type, jobId, sessionId = 's1') => ({
    id: Math.random().toString(36), type, ts: new Date().toISOString(), sessionId,
    jobId, device: 'desktop', browser: 'chrome', os: 'macos', referrer: 'direct',
    country: 'GB', isBot: false,
  })

  const first = mk('apply_click', 'j1')
  t('the first apply click is not a repeat', markRepeat(first) === false)
  const second = mk('apply_click', 'j1')
  t('an immediate second click IS a repeat', markRepeat(second) === true)
  t('and the repeat is marked on the event', second.metadata?.repeat === true, second.metadata)

  t('a different job is not a repeat', markRepeat(mk('apply_click', 'j2')) === false)
  t('a different session is not a repeat', markRepeat(mk('apply_click', 'j1', 's2')) === false)

  // Outside the window it counts again.
  __resetDedupe()
  const t0 = Date.now()
  markRepeat(mk('apply_click', 'j1'), t0)
  t('outside the window it is a fresh click',
    markRepeat(mk('apply_click', 'j1'), t0 + 31 * 60_000) === false)
}

/* =============================== metrics ================================ */
{
  const ev = (over) => ({
    id: Math.random().toString(36), ts: '2026-09-15T12:00:00.000Z', sessionId: 's1',
    device: 'desktop', browser: 'chrome', os: 'macos', referrer: 'direct',
    country: 'GB', isBot: false, ...over,
  })

  /* --- bots are excluded from metrics but not from storage --- */
  {
    const events = [
      ev({ type: 'search', query: 'engineer', resultCount: 10 }),
      ev({ type: 'search', query: 'engineer', resultCount: 10, isBot: true, sessionId: 'bot' }),
    ]
    const totals = computeTotals(events)
    t('a bot search is not counted', totals.searches.raw === 1, totals.searches)
    t('but the bot event IS reported separately', totals.botEvents === 1, totals.botEvents)
    t('and the total event count includes it', totals.totalEvents === 2)
  }

  /* --- rates are withheld below the sample floor --- */
  {
    const few = [
      ...Array(3).fill(0).map((_, i) => ev({ type: 'search_result_impression', jobId: 'j1', sessionId: `s${i}` })),
      ev({ type: 'job_detail_view', jobId: 'j1', sessionId: 's0' }),
    ]
    t('a rate on 3 impressions is withheld, not reported as 33%',
      computeTotals(few).detailCtr === null, computeTotals(few).detailCtr)

    const many = [
      ...Array(MIN_SAMPLE).fill(0).map((_, i) => ev({ type: 'search_result_impression', jobId: 'j1', sessionId: `s${i}` })),
      ...Array(5).fill(0).map((_, i) => ev({ type: 'job_detail_view', jobId: 'j1', sessionId: `s${i}` })),
    ]
    const r = computeTotals(many).detailCtr
    t('at the floor the rate is reported', r !== null && Math.abs(r - 5 / MIN_SAMPLE) < 1e-9, r)
  }

  /* --- unique vs raw --- */
  {
    const events = [
      ev({ type: 'job_detail_view', jobId: 'j1', sessionId: 's1' }),
      ev({ type: 'job_detail_view', jobId: 'j1', sessionId: 's1' }),
      ev({ type: 'job_detail_view', jobId: 'j1', sessionId: 's2' }),
    ]
    const totals = computeTotals(events)
    t('raw counts every view', totals.detailViews.raw === 3, totals.detailViews)
    t('unique counts sessions', totals.detailViews.unique === 2, totals.detailViews)
  }

  /* --- search -> apply only counts sessions that did BOTH --- */
  {
    const events = [
      ...Array(MIN_SAMPLE).fill(0).map((_, i) => ev({ type: 'search', query: 'x', resultCount: 5, sessionId: `s${i}` })),
      ev({ type: 'apply_click', jobId: 'j1', sessionId: 's0' }),
      // Arrived from a search engine, never searched here. Must not inflate it.
      ev({ type: 'apply_click', jobId: 'j1', sessionId: 'organic' }),
    ]
    const conv = computeTotals(events).searchToApply
    t('an applier who never searched does not inflate the funnel',
      conv !== null && Math.abs(conv - 1 / MIN_SAMPLE) < 1e-9, conv)
  }

  /* --- per-job aggregation --- */
  {
    const events = [
      ev({ type: 'search_result_impression', jobId: 'j1', companySlug: 'acme', source: 'greenhouse', position: 3, sessionId: 's1' }),
      ev({ type: 'search_result_impression', jobId: 'j1', companySlug: 'acme', position: 7, sessionId: 's2' }),
      ev({ type: 'job_detail_view', jobId: 'j1', companySlug: 'acme', sessionId: 's1' }),
      ev({ type: 'apply_click', jobId: 'j1', companySlug: 'acme', sessionId: 's1' }),
    ]
    const [row] = computeJobs(events, { from: new Date('2026-09-15T00:00:00Z'), to: new Date('2026-09-16T00:00:00Z') })
    t('impressions are counted per job', row.impressions === 2, row)
    t('average position is the mean rank', row.averagePosition === 5, row.averagePosition)
    t('the source is carried through', row.source === 'greenhouse', row.source)
    t('apply clicks are counted', row.uniqueApplyClicks === 1)
  }

  /* --- zero-result intelligence --- */
  {
    const events = [
      ev({ type: 'search', query: 'ai agent engineer', resultCount: 0, sessionId: 's1' }),
      ev({ type: 'search', query: 'ai agent engineer', resultCount: 0, sessionId: 's2' }),
      ev({ type: 'search', query: 'software engineer', resultCount: 500, sessionId: 's1' }),
    ]
    const rows = computeQueries(events)
    const zero = rows.find((r) => r.query === 'ai agent engineer')
    t('zero-result searches are identified', zero.zeroResultSearches === 2, zero)
    t('distinct searchers are counted', zero.uniqueSearchers === 2, zero)
    t('a query with results scores no opportunity',
      opportunityScore(rows.find((r) => r.query === 'software engineer')) === 0)
    t('a zero-result query scores above zero', opportunityScore(zero, Date.parse('2026-09-15T12:00:00Z')) > 0)

    // Recency halves weekly, so last quarter's gap does not outrank this week's.
    const old = opportunityScore(zero, Date.parse('2026-10-15T12:00:00Z'))
    const fresh = opportunityScore(zero, Date.parse('2026-09-15T12:00:00Z'))
    t('an older gap scores lower than a fresh one', old < fresh, { old, fresh })

    // Reach is logarithmic: one person refreshing 40 times must not outrank 40 people.
    const oneKeen = { query: 'a', zeroResultSearches: 40, uniqueSearchers: 1, lastSeen: '2026-09-15T12:00:00Z' }
    const manyPeople = { query: 'b', zeroResultSearches: 40, uniqueSearchers: 40, lastSeen: '2026-09-15T12:00:00Z' }
    const now = Date.parse('2026-09-15T12:00:00Z')
    t('breadth of demand beats one determined searcher',
      opportunityScore(manyPeople, now) > opportunityScore(oneKeen, now))
  }

  /* --- funnel is session-based --- */
  {
    const events = [
      ev({ type: 'search', sessionId: 's1' }), ev({ type: 'search', sessionId: 's1' }),
      ev({ type: 'search', sessionId: 's2' }),
      ev({ type: 'job_detail_view', jobId: 'j1', sessionId: 's1' }),
      ev({ type: 'apply_click', jobId: 'j1', sessionId: 's1' }),
    ]
    const funnel = computeFunnel(events)
    t('the funnel counts sessions, not events', funnel[0].sessions === 2, funnel[0])
    t('later stages narrow', funnel[2].sessions === 1, funnel[2])
    t('the first stage has no conversion', funnel[0].conversionFromPrevious === null)
  }

  /* --- dimensions --- */
  {
    const events = [
      ev({ type: 'page_view', country: 'GB', sessionId: 's1' }),
      ev({ type: 'page_view', country: 'GB', sessionId: 's1' }),
      ev({ type: 'page_view', country: 'IN', sessionId: 's2' }),
      ev({ type: 'page_view', country: null, sessionId: 's3' }),
    ]
    const rows = computeDimension(events, (e) => e.country)
    t('a dimension groups and sorts by volume', rows[0].value === 'GB' && rows[0].events === 2, rows)
    t('sessions are de-duplicated within a bucket', rows[0].sessions === 1, rows[0])
    t('null values are omitted rather than bucketed as "null"',
      !rows.some((r) => r.value === 'null'), rows)
  }

  /* --- empty input --- */
  {
    const totals = computeTotals([])
    t('no events yields zeroes, not NaN', totals.searches.raw === 0 && totals.uniqueVisitors === 0)
    t('and every rate is null rather than 0/0', totals.detailCtr === null && totals.applyCtr === null)
    t('an empty corpus produces no job rows', computeJobs([], { from: new Date(), to: new Date() }).length === 0)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
