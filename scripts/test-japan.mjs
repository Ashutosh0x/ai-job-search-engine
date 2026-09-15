/**
 * Japan location and search handling.
 *
 * WHAT THE EVIDENCE SAID
 * ----------------------
 * A market report proposed parsing all 47 prefectures in kanji as the priority.
 * Measured over the 130,863-posting served index, Japanese script appears in
 * locationRaw on FIFTEEN rows -- so that work would have touched 0.01% of the
 * corpus.
 *
 * The real damage was duller and forty times larger:
 *
 *   city "Tokyo"                  1,570
 *   city "Tokyo-to"                  64   same place
 *   city "JP - Tokyo"                24   same place again
 *   city "Hiroshima - Fab 15"       220   facility suffix
 *   city "Hiroshima"                 34   ...so one site read as two cities
 *   city "Japan"                     69   a country in the city field
 *
 * Filtering "Tokyo" silently missed 88 Tokyo postings, and Micron's Hiroshima
 * fab was split across two facet entries.
 *
 * Japanese script in TITLES is a different story -- 843 rows -- and the
 * ASCII-only tokeniser reduced every one of them to nothing.
 */
import { parseLocation } from '../lib/location.ts'
import { tokenizeText, expandQueryTokens } from '../lib/search/normalize.ts'
import {
  canonicalJapaneseCity,
  hasJapaneseScript,
  japanesePlaceToEnglish,
  japaneseTermTokens,
} from '../lib/location-japan.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}

/* ================= the fragmentation that actually mattered ============== */
{
  const tokyo = ['Tokyo', 'Tokyo-to', 'JP - Tokyo', 'Japan - Tokyo', 'tokyo metropolis']
  for (const v of tokyo) {
    t(`"${v}" canonicalises to Tokyo`, canonicalJapaneseCity(v) === 'Tokyo', canonicalJapaneseCity(v))
  }
  t('all Tokyo spellings collapse to ONE facet entry',
    new Set(tokyo.map(canonicalJapaneseCity)).size === 1)

  // Micron's fab read as a city distinct from the city it is in.
  t('"Hiroshima - Fab 15" is Hiroshima', canonicalJapaneseCity('Hiroshima - Fab 15') === 'Hiroshima')
  t('"Tokyo (Office)" is Tokyo', canonicalJapaneseCity('Tokyo (Office)') === 'Tokyo')
  t('"Osaka - Plant 2" is Osaka', canonicalJapaneseCity('Osaka - Plant 2') === 'Osaka')

  // A country is not a city.
  for (const v of ['Japan', 'JP', '日本', 'japan']) {
    t(`"${v}" is not treated as a city`, canonicalJapaneseCity(v) === null, canonicalJapaneseCity(v))
  }
}

/* --------------- hyphenated real places must NOT be damaged -------------- */
// The facility rule strips after a hyphen; a hyphenated city must survive it.
{
  t('"Higashi-Osaka" survives', canonicalJapaneseCity('Higashi-Osaka') === 'Higashi-Osaka')
  t('"Shin-Yokohama" survives', canonicalJapaneseCity('Shin-Yokohama') === 'Shin-Yokohama')
  // ...while the -shi/-fu administrative suffixes still resolve.
  t('"Osaka-shi" is Osaka', canonicalJapaneseCity('Osaka-shi') === 'Osaka')
  t('"Yokohama-shi" is Yokohama', canonicalJapaneseCity('Yokohama-shi') === 'Yokohama')
}

/* ========================= Japanese script ============================== */
{
  t('detects hiragana', hasJapaneseScript('ひらがな'))
  t('detects katakana', hasJapaneseScript('カタカナ'))
  t('detects kanji', hasJapaneseScript('東京'))
  t('plain ASCII is not Japanese', !hasJapaneseScript('Tokyo'))

  t('横浜市 -> Yokohama', japanesePlaceToEnglish('横浜市') === 'Yokohama')
  t('東京都 -> Tokyo', japanesePlaceToEnglish('東京都') === 'Tokyo')
  t('神奈川県 -> Kanagawa', japanesePlaceToEnglish('神奈川県') === 'Kanagawa')
  t('港区 -> Minato City', japanesePlaceToEnglish('港区') === 'Minato City')
  // The suffix-stripping fallback: 藤沢市 resolves from 藤沢.
  t('藤沢市 -> Fujisawa (via suffix strip)', japanesePlaceToEnglish('藤沢市') === 'Fujisawa')
  t('an unknown place stays unknown rather than being guessed',
    japanesePlaceToEnglish('架空市') === null, japanesePlaceToEnglish('架空市'))
}

/* ==================== end-to-end through parseLocation =================== */
{
  const cases = [
    ['Tokyo', { city: 'Tokyo' }],
    ['Tokyo-to', { city: 'Tokyo' }],
    ['JP - Tokyo', { city: 'Tokyo' }],
    ['Hiroshima - Fab 15', { city: 'Hiroshima' }],
    ['横浜市, jp', { city: 'Yokohama', country: 'Japan' }],
    ['横浜市, 神奈川県, jp', { city: 'Yokohama', region: 'Kanagawa', country: 'Japan' }],
    ['港区, Japan', { city: 'Minato City', country: 'Japan' }],
    ['Osaka-shi, Japan', { city: 'Osaka', country: 'Japan' }],
  ]
  for (const [input, want] of cases) {
    const p = parseLocation(input)
    for (const [k, v] of Object.entries(want)) {
      t(`${JSON.stringify(input)} -> ${k}=${v}`, p[k] === v, { got: p[k], want: v })
    }
  }

  // "Japan" alone is a country, and must not leave a city behind.
  const jp = parseLocation('Japan')
  t('"Japan" resolves to the country', jp.country === 'Japan', jp)
  t('and invents no city', jp.city === null, jp)
}

/* ------------------------ no non-Japan regressions ---------------------- */
// The Japanese path runs on every city string, so it must be inert elsewhere.
{
  const untouched = [
    ['London, United Kingdom', 'London'],
    ['Austin, TX', 'Austin'],
    ['St Louis, MO, United States', 'St Louis'],
    ['São Paulo, Brazil', 'São Paulo'],
    ['Port St Lucie, FL, United States', 'Port St Lucie'],
    ['Winston-Salem, NC', 'Winston-salem'],
  ]
  for (const [input, city] of untouched) {
    t(`${JSON.stringify(input)} is unaffected`, parseLocation(input).city === city, parseLocation(input).city)
  }
}

/* ======================= Japanese titles in search ====================== */
/**
 * 843 postings carry a Japanese title. The tokeniser splits on an ASCII-only
 * class, so every one of them produced ZERO tokens and was unreachable.
 */
{
  t('インフラエンジニア tokenises', tokenizeText('インフラエンジニア').length > 0, tokenizeText('インフラエンジニア'))
  t('...to the same tokens as the English',
    JSON.stringify(tokenizeText('インフラエンジニア')) === JSON.stringify(tokenizeText('Infrastructure Engineer')),
    [tokenizeText('インフラエンジニア'), tokenizeText('Infrastructure Engineer')])

  t('クラウドエンジニア matches "cloud engineer"',
    JSON.stringify(tokenizeText('クラウドエンジニア')) === JSON.stringify(tokenizeText('Cloud Engineer')))
  t('ソフトウェアエンジニア matches "software engineer"',
    tokenizeText('ソフトウェアエンジニア').includes('software'))
  t('セキュリティエンジニア matches "security"', tokenizeText('セキュリティエンジニア').includes('security'))
  t('リモート matches "remote"', tokenizeText('リモート').includes('remote'))
  t('クバネティス matches "kubernetes"', tokenizeText('クバネティス').includes('kubernetes'))

  // Longest match wins, so the compound does not also emit its parts twice.
  const infra = japaneseTermTokens('インフラエンジニア')
  t('longest match wins over substrings',
    infra.length === 2 && infra.includes('infrastructure') && infra.includes('engineer'), infra)

  // A mixed-script title yields both halves.
  const mixed = tokenizeText('ボッシュ株式会社 クラウドエンジニア Global ADAS')
  t('a mixed-script title yields both languages',
    mixed.includes('cloud') && mixed.includes('global'), mixed)

  // Plain English must not pay for this.
  t('an ASCII-only title emits no Japanese tokens',
    japaneseTermTokens('Infrastructure Engineer').length === 0)
}

/* --------------------- search symmetry, both directions ----------------- */
// Index and query fold identically, or the posting is indexed under terms no
// query can produce.
{
  for (const [jpText, enQuery] of [
    ['インフラエンジニア', 'infrastructure engineer'],
    ['クラウドエンジニア', 'cloud engineer'],
    ['データエンジニア', 'data engineer'],
  ]) {
    const indexed = new Set(tokenizeText(jpText))
    const queried = expandQueryTokens(enQuery)
    t(`"${enQuery}" reaches ${jpText}`, queried.every((q) => indexed.has(q)), {
      indexed: [...indexed], queried,
    })
  }
}

/* ============== the search GATE must agree with the INDEX =============== */
/**
 * searchJobs decides whether a keyword query ran by tokenising it, and the
 * inverted index tokenises separately. Those were two different functions, and
 * they disagreed on exactly the input that matters: a Japanese query produced
 * zero tokens in the gate, so the keyword branch never ran and
 * 「インフラエンジニア」 returned the ENTIRE 130,863-posting corpus as though
 * nothing had been typed.
 *
 * Any input the index can retrieve on, the gate must see as a query.
 */
{
  for (const q of ['インフラエンジニア', 'クラウドエンジニア', 'リモート', 'エンジニア', 'セキュリティ']) {
    t(`"${q}" produces query tokens (the gate sees a query)`,
      tokenizeText(q).length > 0, tokenizeText(q))
  }
  t('a Japanese query and its English equivalent produce the same tokens',
    JSON.stringify(tokenizeText('インフラエンジニア').sort()) ===
      JSON.stringify(tokenizeText('infrastructure engineer').sort()))
  // Text with no recognised term still yields nothing, which is correct: an
  // unrecognised query must not silently match everything either.
  t('unmapped Japanese yields no invented tokens', japaneseTermTokens('猫犬鳥').length === 0)
}

/* ------------------------------ degenerate ------------------------------ */
{
  t('null city is null', canonicalJapaneseCity(null) === null)
  t('empty city is null', canonicalJapaneseCity('') === null)
  t('whitespace city is null', canonicalJapaneseCity('   ') === null)
  t('empty text yields no Japanese tokens', japaneseTermTokens('').length === 0)
  t('a short hyphen fragment is not over-stripped',
    canonicalJapaneseCity('AB - Fab 1') === 'AB - Fab 1', canonicalJapaneseCity('AB - Fab 1'))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
