/**
 * Android relevance classification.
 *
 * The failure that matters is the false positive. "Android" appears in job
 * descriptions with nothing to do with Android engineering -- a recruiter for a
 * mobile team, a marketer for Firefox for Android, a boilerplate benefits block
 * mentioning the Play Store. Measured on Mozilla's live board: all three open
 * mobile roles matched "play store" from boilerplate, and every one of them is
 * an iOS role.
 *
 * So most of these assertions are about what must NOT be called Android work.
 */

import { classifyAndroid } from './mozilla-android-report.mjs'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 200)) }
}
const lvl = (title, desc = '') => classifyAndroid(title, desc).level

/* ------------------------------ title variants ----------------------------- */
{
  for (const title of [
    'Android Engineer', 'Android Software Engineer', 'Senior Android Engineer',
    'Staff Android Engineer', 'Android Developer', 'Android Platform Engineer',
    'Firefox Android Engineer', 'Android Application Engineer',
    'Software Engineer, Android', 'Software Engineer — Android',
  ]) {
    t(`"${title}" is ANDROID_CORE`, lvl(title) === 'ANDROID_CORE', classifyAndroid(title))
  }
  t('"Fenix Engineer" is Android', lvl('Senior Fenix Engineer') === 'ANDROID_CORE')
  t('"GeckoView Engineer" is Android', lvl('GeckoView Engineer') === 'ANDROID_CORE')
}

/* ------------------- Android in the description, not the title ------------- */
{
  t('engineering role naming two Android tools is CORE',
    lvl('Senior Software Engineer', 'You will ship Kotlin using Jetpack Compose and the Android SDK.') === 'ANDROID_CORE')
  t('engineering role naming one Android tool is RELATED',
    lvl('Performance Engineer', 'Use C++, JavaScript, Kotlin and Rust to fix performance issues.') === 'ANDROID_RELATED')
  t('mobile engineering with no platform stated is MOBILE_GENERAL',
    lvl('Senior Mobile Engineer', 'Build our mobile apps.') === 'MOBILE_GENERAL')
}

/* ------------------------- the false positives that matter ----------------- */
{
  // The real Mozilla case: titled iOS, matched "play store" from boilerplate.
  t('"Senior Mobile Engineer, iOS" is NOT Android',
    lvl('Senior Mobile Engineer, iOS', 'Perks include a Google Play store credit.') === 'NOT_ANDROID',
    classifyAndroid('Senior Mobile Engineer, iOS', 'Google Play store credit'))
  t('an iOS/Swift role is NOT Android', lvl('Senior Swift Engineer', 'Ship our iPhone app.') === 'NOT_ANDROID')

  // Mentions the product, does not build it.
  t('recruiter for a mobile team is NOT Android',
    lvl('Technical Recruiter, Mobile', 'Hire Android and iOS engineers for Firefox for Android.') === 'NOT_ANDROID',
    classifyAndroid('Technical Recruiter, Mobile', 'Hire Android engineers'))
  t('marketing role for Firefox for Android is NOT Android',
    lvl('Product Marketing Manager', 'Own go-to-market for Firefox for Android.') === 'NOT_ANDROID')
  t('legal role reviewing Play Store terms is NOT Android',
    lvl('Senior Counsel', 'Review Google Play Store distribution terms.') === 'NOT_ANDROID')
  t('a data scientist mentioning Android is NOT Android',
    lvl('Staff Data Scientist', 'Analyse telemetry from Android and desktop clients.') === 'NOT_ANDROID')

  // Ordinary roles with no signal at all.
  for (const title of ['Staff Data Scientist, Ads', 'Director, Portfolio Management', 'Senior Counsel', 'Accountant']) {
    t(`"${title}" is NOT Android`, lvl(title) === 'NOT_ANDROID')
  }
}

/* -------------------------------- evidence --------------------------------- */
{
  const c = classifyAndroid('Android Engineer', 'Kotlin, Jetpack Compose, Gradle.')
  t('reports the technologies found', c.tech.includes('kotlin') && c.tech.includes('gradle'), c.tech)
  t('reports a reason', typeof c.reason === 'string' && c.reason.length > 4, c.reason)

  const none = classifyAndroid('Accountant')
  t('a non-match reports no technologies', none.tech.length === 0, none)
}

/* ------------------------------ HTML handling ------------------------------ */
{
  t('strips markup before matching',
    lvl('Senior Software Engineer', '<p>Use <b>Kotlin</b> and <i>Jetpack</i> daily.</p>') === 'ANDROID_CORE')
  t('decodes entities',
    lvl('Senior Software Engineer', 'Kotlin &amp; Jetpack Compose &amp; Gradle') === 'ANDROID_CORE')
  t('does not match inside a longer word',
    lvl('Senior Engineer', 'We use Javascript, not the JVM.') === 'NOT_ANDROID',
    classifyAndroid('Senior Engineer', 'We use Javascript'))
}

/* -------------------------------- degraded --------------------------------- */
{
  t('empty title does not throw', lvl('') === 'NOT_ANDROID')
  t('undefined description does not throw', lvl('Android Engineer', undefined) === 'ANDROID_CORE')
  t('null-ish input', classifyAndroid(undefined, undefined).level === 'NOT_ANDROID')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
