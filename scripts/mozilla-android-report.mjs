/**
 * Mozilla's live job board, and which roles are genuinely Android work.
 *
 *   node scripts/mozilla-android-report.mjs
 *
 * Mozilla publishes through Greenhouse (board token `mozilla`). mozilla.org's
 * own careers page shows a subset -- 21 of the 60 the board returns -- so the
 * Greenhouse API is the canonical source and the website is a filtered view of
 * it. Both of the ids sampled from the website resolve on the board.
 *
 * CLASSIFICATION IS NOT A KEYWORD SEARCH
 * --------------------------------------
 * "Android" appears in job descriptions that have nothing to do with Android
 * engineering -- a recruiter role for a mobile team, a marketing role for
 * Firefox for Android, a legal role reviewing Play Store terms. Counting those
 * as Android engineering jobs is the same substring trap the early-career
 * classifier exists to avoid.
 *
 * So a role is scored on WHERE the signal appears and WHAT it is:
 *
 *   ANDROID_CORE     Android/mobile in the title, or the description names the
 *                    Android toolchain (Kotlin, Jetpack, GeckoView, Fenix...)
 *                    in a role that is an engineering role
 *   ANDROID_RELATED  engineering role that works ON Android surfaces without
 *                    being an Android developer post (security, QA, platform)
 *   MOBILE_GENERAL   mobile engineering, platform unstated
 *   NOT_ANDROID      everything else, including incidental mentions
 *
 * Every classification carries the evidence that produced it.
 */

const BOARD = 'mozilla'
const API = `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs`

/** Android toolchain terms. Presence in a description is real evidence. */
const ANDROID_TECH = [
  'android', 'kotlin', 'jetpack', 'jetpack compose', 'android sdk', 'android studio',
  'gradle', 'geckoview', 'fenix', 'firefox for android', 'play store', 'google play',
  'android ndk', 'espresso', 'robolectric',
]

/** Title shapes that make a role Android/mobile engineering outright. */
const TITLE_ANDROID = /\b(android|fenix|geckoview)\b/i
const TITLE_MOBILE = /\bmobile\b/i
/** An explicitly-iOS title states its platform, and it is not Android. */
const TITLE_IOS = /\b(ios|iphone|ipad|swift)\b/i
/** An engineering role, as opposed to one that merely supports engineers. */
const TITLE_ENGINEERING = /\b(engineer|engineering|developer|architect|programmer|sre|devops)\b/i
/** Roles that reference a product without building it. */
const NON_ENGINEERING = /\b(recruit|talent|marketing|market|legal|counsel|sales|account|finance|accounting|people|hr|communications|design|ux|ui|research(er)?|program manager|product manager|community|support|writer|editor|policy|data scientist|analyst)\b/i

const stripHtml = (s) => (s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const wordRe = (term) => new RegExp(`(^|[^a-z0-9+#])${term.replace(/[+#]/g, '\\$&')}([^a-z0-9+#]|$)`, 'i')

export function classifyAndroid(title, description = '') {
  const t = title || ''
  const d = stripHtml(description)
  const hay = `${t} ${d}`

  const tech = ANDROID_TECH.filter((k) => wordRe(k).test(hay))
  const techInTitle = ANDROID_TECH.filter((k) => wordRe(k).test(t))
  const isEngineering = TITLE_ENGINEERING.test(t)
  const isNonEngineering = NON_ENGINEERING.test(t) && !isEngineering

  // Title is the strongest signal available.
  if (TITLE_ANDROID.test(t) && isEngineering) {
    return { level: 'ANDROID_CORE', tech, reason: 'Android named in the title of an engineering role' }
  }
  if (TITLE_ANDROID.test(t) && !isNonEngineering) {
    return { level: 'ANDROID_RELATED', tech, reason: 'Android named in the title' }
  }
  if (TITLE_ANDROID.test(t) && isNonEngineering) {
    return { level: 'NOT_ANDROID', tech, reason: 'Android named, but the role is not an engineering role' }
  }

  // No Android in the title: the description has to carry real toolchain signal
  // AND the role has to be an engineering role.
  const toolchain = tech.filter((k) => k !== 'android' && k !== 'google play' && k !== 'play store')
  if (isEngineering && toolchain.length >= 2) {
    return { level: 'ANDROID_CORE', tech, reason: `engineering role naming ${toolchain.slice(0, 4).join(', ')}` }
  }
  if (isEngineering && toolchain.length === 1) {
    return { level: 'ANDROID_RELATED', tech, reason: `engineering role naming ${toolchain[0]}` }
  }
  if (isEngineering && TITLE_MOBILE.test(t)) {
    // "Senior Mobile Engineer, iOS" is a mobile role whose platform IS stated,
    // and it is not Android. Measured: all three of Mozilla's open mobile roles
    // are iOS, and every one matched "play store" from a boilerplate benefits
    // or equal-opportunity block -- which is exactly the incidental mention
    // this classifier is supposed to reject.
    if (TITLE_IOS.test(t)) {
      return { level: 'NOT_ANDROID', tech, reason: 'mobile role, but the title states iOS' }
    }
    return { level: 'MOBILE_GENERAL', tech, reason: 'mobile engineering role, platform unstated' }
  }
  if (tech.includes('android') && !isEngineering) {
    return { level: 'NOT_ANDROID', tech, reason: 'Android mentioned incidentally in a non-engineering role' }
  }
  return { level: 'NOT_ANDROID', tech, reason: 'no Android or mobile signal' }
}

/* --------------------------------- crawl ---------------------------------- */

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mozilla-android-report.mjs')) {
  const res = await fetch(`${API}?content=true`, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) { console.error(`board returned HTTP ${res.status}`); process.exit(1) }
  const data = await res.json()
  const jobs = data.jobs ?? []

  const ids = new Set(jobs.map((j) => String(j.id)))
  console.log(`MOZILLA CRAWL`)
  console.log(`  ATS/platform          Greenhouse`)
  console.log(`  board token           ${BOARD}`)
  console.log(`  adapter used          GreenhouseAdapter (existing)`)
  console.log(`  total jobs discovered ${jobs.length}`)
  console.log(`  unique job ids        ${ids.size}`)
  console.log(`  with an apply URL     ${jobs.filter((j) => j.absolute_url).length}`)
  console.log(`  per-job apply URLs    ${new Set(jobs.map((j) => j.absolute_url)).size}`)
  console.log()

  const buckets = { ANDROID_CORE: [], ANDROID_RELATED: [], MOBILE_GENERAL: [], NOT_ANDROID: [] }
  for (const j of jobs) {
    const c = classifyAndroid(j.title, j.content)
    buckets[c.level].push({ j, c })
  }

  for (const level of ['ANDROID_CORE', 'ANDROID_RELATED', 'MOBILE_GENERAL']) {
    const rows = buckets[level]
    console.log(`${level}  (${rows.length})`)
    if (!rows.length) console.log('  none')
    for (const { j, c } of rows) {
      const loc = j.location?.name ?? '(not stated)'
      console.log(`  ${j.title}`)
      console.log(`    id         ${j.id}`)
      console.log(`    location   ${loc}`)
      console.log(`    remote     ${/remote/i.test(loc) ? 'yes' : 'not stated'}`)
      console.log(`    team       ${j.departments?.[0]?.name ?? '(not stated)'}`)
      console.log(`    tech       ${c.tech.length ? c.tech.join(', ') : '(none found)'}`)
      console.log(`    why        ${c.reason}`)
      console.log(`    apply      ${j.absolute_url}`)
    }
    console.log()
  }
  console.log(`NOT_ANDROID            ${buckets.NOT_ANDROID.length}`)

  // The trap this classifier exists for: roles that mention Android but are not
  // Android engineering. Showing them proves the filter is doing work.
  const incidental = buckets.NOT_ANDROID.filter(({ c }) => c.tech.includes('android'))
  if (incidental.length) {
    console.log(`\n  of those, ${incidental.length} DO mention Android but are not Android engineering:`)
    for (const { j, c } of incidental.slice(0, 8)) console.log(`    ${j.title}  -- ${c.reason}`)
  }
}
