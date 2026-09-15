/**
 * Japan-specific location handling.
 *
 * WHAT THE CORPUS ACTUALLY CONTAINS
 * ---------------------------------
 * Measured over the 130,863-posting served index before this existed:
 *
 *   Japanese script in locationRaw       15 rows
 *   Japanese script in the TITLE        843 rows
 *   city "Tokyo"                      1,570
 *   city "Tokyo-to"                      64   same place, different spelling
 *   city "JP - Tokyo"                    24   same place again
 *   city "Hiroshima - Fab 15"           220   facility suffix not stripped
 *   city "Hiroshima"                     34   ...so one site reads as two cities
 *   city "Japan"                         69   a country sitting in the city field
 *
 * So the expensive-sounding work -- parsing all 47 prefectures in kanji -- would
 * touch 15 rows. The valuable work is unglamorous: three spellings of Tokyo and
 * a facility suffix account for ~380 rows, and they fragment the city facet so
 * that filtering "Tokyo" silently misses 88 postings that say Tokyo.
 *
 * Both are handled here, with effort proportional to the evidence.
 */

/**
 * Japanese place names that appear in this corpus, plus the ones likely to
 * arrive as coverage grows.
 *
 * Deliberately NOT a full gazetteer. A 47-prefecture table would be mostly
 * dead code against 15 rows, and every unused entry is one more thing that can
 * be wrong without anyone noticing. Entries are added when a crawl produces
 * them.
 */
const JAPANESE_PLACES: Record<string, string> = {
  // Cities seen in the corpus (市 = city, 区 = ward).
  '横浜市': 'Yokohama',
  '横浜': 'Yokohama',
  '東京': 'Tokyo',
  '東京都': 'Tokyo',
  '大阪市': 'Osaka',
  '大阪': 'Osaka',
  '大阪府': 'Osaka',
  '名古屋市': 'Nagoya',
  '名古屋': 'Nagoya',
  '京都市': 'Kyoto',
  '京都': 'Kyoto',
  '京都府': 'Kyoto',
  '福岡市': 'Fukuoka',
  '福岡': 'Fukuoka',
  '札幌市': 'Sapporo',
  '札幌': 'Sapporo',
  '神戸市': 'Kobe',
  '神戸': 'Kobe',
  '広島市': 'Hiroshima',
  '広島': 'Hiroshima',
  '仙台市': 'Sendai',
  '川崎市': 'Kawasaki',
  '千葉市': 'Chiba',
  '藤沢市': 'Fujisawa',
  '藤沢': 'Fujisawa',
  'さいたま市': 'Saitama',
  // Prefectures that show up as the region component.
  '神奈川県': 'Kanagawa',
  '千葉県': 'Chiba',
  '埼玉県': 'Saitama',
  '愛知県': 'Aichi',
  '兵庫県': 'Hyogo',
  '北海道': 'Hokkaido',
  '福岡県': 'Fukuoka',
  '広島県': 'Hiroshima',
  '静岡県': 'Shizuoka',
  '茨城県': 'Ibaraki',
  // Tokyo's 23 special wards that appear as a "city" in ATS feeds.
  '港区': 'Minato City',
  '渋谷区': 'Shibuya City',
  '新宿区': 'Shinjuku City',
  '千代田区': 'Chiyoda City',
  '中央区': 'Chuo City',
  '品川区': 'Shinagawa City',
  '目黒区': 'Meguro City',
  '文京区': 'Bunkyo City',
  '豊島区': 'Toshima City',
  '台東区': 'Taito City',
  // The country itself, so it can be recognised and kept OUT of the city field.
  '日本': 'Japan',
}

/** Does this string contain Japanese script (hiragana, katakana or kanji)? */
export function hasJapaneseScript(s: string): boolean {
  return /[぀-ゟ゠-ヿ一-龯]/.test(s)
}

/**
 * Map a Japanese place name to its English form, or null.
 *
 * Tries the whole string first, then strips the administrative suffix (市 city,
 * 区 ward, 県 prefecture, 都 metropolis, 府 urban prefecture) and tries again --
 * so 「藤沢市」 resolves even though only 「藤沢」 is listed.
 */
export function japanesePlaceToEnglish(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (JAPANESE_PLACES[s]) return JAPANESE_PLACES[s]

  const stripped = s.replace(/[市区県都府町村]$/u, '')
  if (stripped !== s && JAPANESE_PLACES[stripped]) return JAPANESE_PLACES[stripped]

  return null
}

/**
 * Spellings of a Japanese city that must collapse to one.
 *
 * "Tokyo", "Tokyo-to" and "JP - Tokyo" are the same place and were three
 * separate entries in the city facet, so a filter on any one of them missed the
 * other two. `-to` (都) is the administrative suffix for Tokyo Metropolis, and
 * "JP - " is a prefix one ATS puts on every location.
 */
const CITY_ALIASES: Record<string, string> = {
  'tokyo-to': 'Tokyo',
  'tokyo to': 'Tokyo',
  'tokyo metropolis': 'Tokyo',
  'tokyo prefecture': 'Tokyo',
  'osaka-fu': 'Osaka',
  'osaka-shi': 'Osaka',
  'kyoto-fu': 'Kyoto',
  'kyoto-shi': 'Kyoto',
  'yokohama-shi': 'Yokohama',
  'nagoya-shi': 'Nagoya',
  'sapporo-shi': 'Sapporo',
  'fukuoka-shi': 'Fukuoka',
  'kobe-shi': 'Kobe',
  'hiroshima-shi': 'Hiroshima',
  'kawasaki-shi': 'Kawasaki',
  'saitama-shi': 'Saitama',
  'sendai-shi': 'Sendai',
}

/**
 * Canonicalise a Japanese city string.
 *
 * Handles, in order:
 *   1. a "JP - " / "Japan - " country prefix some feeds prepend
 *   2. Japanese script
 *   3. the alias table above
 *   4. a facility suffix -- "Hiroshima - Fab 15" is Micron's fab, and leaving it
 *      in made one site read as a city distinct from Hiroshima itself, splitting
 *      254 postings across two facet entries
 *
 * Returns null when the value is not a city at all ("Japan"), so the caller can
 * leave the field empty rather than carrying a country in it.
 */
export function canonicalJapaneseCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = String(raw).trim()
  if (!s) return null

  // 1. Country prefix.
  s = s.replace(/^(?:jp|japan)\s*[-–—:|]\s*/i, '').trim()

  // 2. Japanese script.
  if (hasJapaneseScript(s)) {
    const english = japanesePlaceToEnglish(s)
    if (english) s = english
  }

  // 3. A bare country is not a city.
  if (/^(japan|日本|jp|jpn)$/i.test(s)) return null

  // 4. Facility decoration: "Hiroshima - Fab 15", "Tokyo (Office)".
  //    Only stripped when what remains is still a plausible place name, so a
  //    hyphenated city like "Higashi-Osaka" survives intact.
  const facility = s.match(/^(.+?)\s*[-–—]\s*(?:fab|plant|site|office|campus|building|bldg|works|factory|center|centre|hq)\b.*$/i)
  if (facility && facility[1].trim().length >= 3) s = facility[1].trim()
  s = s.replace(/\s*\((?:office|site|plant|fab|campus|hq)[^)]*\)\s*$/i, '').trim()

  // 5. The alias table, after the above so "JP - Tokyo-to" resolves too.
  const alias = CITY_ALIASES[s.toLowerCase()]
  if (alias) return alias

  return s || null
}

/**
 * Japanese job-title vocabulary, for SEARCH only.
 *
 * 843 postings in the corpus carry a Japanese title, so "infrastructure
 * engineer" cannot find 「インフラエンジニア」 and 「クラウドエンジニア」 is
 * invisible to anyone searching in English. These pairs are folded at index and
 * query time so either language finds both.
 *
 * Only unambiguous role and technology terms. Free-text Japanese is NOT
 * translated here -- that needs a tokeniser this project does not have, and
 * guessing at it would produce wrong matches rather than missing ones.
 */
export const JAPANESE_TERMS: Record<string, string> = {
  // Roles
  'エンジニア': 'engineer',
  'インフラエンジニア': 'infrastructure engineer',
  'インフラ': 'infrastructure',
  'クラウドエンジニア': 'cloud engineer',
  'クラウド': 'cloud',
  'ソフトウェアエンジニア': 'software engineer',
  'ソフトウェア': 'software',
  'バックエンド': 'backend',
  'フロントエンド': 'frontend',
  'ネットワークエンジニア': 'network engineer',
  'ネットワーク': 'network',
  'セキュリティエンジニア': 'security engineer',
  'セキュリティ': 'security',
  'データエンジニア': 'data engineer',
  'データサイエンティスト': 'data scientist',
  'アーキテクト': 'architect',
  'デザイナー': 'designer',
  'マネージャー': 'manager',
  'プロジェクトマネージャー': 'project manager',
  'プログラマー': 'programmer',
  '開発': 'development',
  '技術': 'technology',
  '営業': 'sales',
  '人事': 'hr',
  '経理': 'accounting',
  // Technologies, as commonly transliterated
  'クバネティス': 'kubernetes',
  'クーベネティス': 'kubernetes',
  'ドッカー': 'docker',
  'パイソン': 'python',
  'ジャバ': 'java',
  'ゴー': 'go',
  'ルビー': 'ruby',
  'リナックス': 'linux',
  'データベース': 'database',
  'サーバー': 'server',
  'セキュア': 'secure',
  // Employment terms
  '正社員': 'full-time',
  '契約社員': 'contract',
  'インターン': 'internship',
  'リモート': 'remote',
  '在宅': 'remote',
  '新卒': 'graduate',
  '中途': 'experienced',
}

/**
 * Expand Japanese terms in a string into their English equivalents.
 *
 * Returns the ADDITIONAL tokens to index alongside the original, rather than a
 * replacement: the Japanese text stays searchable for people typing Japanese,
 * and the English becomes searchable for everyone else. Longest match first, so
 * 「インフラエンジニア」 yields "infrastructure engineer" rather than the two
 * separate terms.
 */
export function japaneseTermTokens(text: string): string[] {
  if (!hasJapaneseScript(text)) return []

  const out: string[] = []
  const keys = Object.keys(JAPANESE_TERMS).sort((a, b) => b.length - a.length)
  let remaining = text

  for (const key of keys) {
    if (remaining.includes(key)) {
      out.push(...JAPANESE_TERMS[key].split(/\s+/))
      // Consume it so a longer match cannot also fire its own substrings.
      remaining = remaining.split(key).join(' ')
    }
  }

  return [...new Set(out)]
}
