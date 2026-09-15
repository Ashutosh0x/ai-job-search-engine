/**
 * Query and document normalisation for search.
 *
 * WHAT WAS MISSING
 * ----------------
 * Tokenisation was `lowercase().split(/[^a-z0-9+#.]+/)`. Three consequences,
 * all measured against the served index:
 *
 *   1. NO ACCENT FOLDING. The split class is ASCII-only, so "Zürich" became the
 *      tokens "z" and "rich" -- the first dropped as too short, the second a
 *      word that has nothing to do with the city. Searching "Zurich" could not
 *      find a Zürich posting, and "rich" matched it.
 *
 *   2. NO MORPHOLOGY. "engineer" did not match "Engineering Manager", because
 *      "engineering" is a different string. Over the fixture corpus that is 10
 *      of 98 matching postings invisible to the most common query on the site.
 *
 *   3. NO ABBREVIATIONS. "SWE", "SDE", "ML engineer" and "k8s" are how people
 *      actually type, and none of them matched anything.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a stemmer and not fuzzy matching. Both over-merge: a Porter stemmer turns
 * "universal" and "university" into the same token, and edit-distance matching
 * makes "Java" find "Java" and "Kava" alike. In a job search the exact
 * identifiers are the high-value terms -- CUDA, H-1B, ISO 27001, C++ -- and
 * blurring them is worse than missing a plural.
 *
 * So everything here is EXPLICIT: a curated equivalence table and two narrow
 * suffix rules with guards. Every entry is a decision someone can read and
 * disagree with, rather than a black box that quietly merges terms.
 *
 * SYMMETRY
 * --------
 * `foldToken` runs on BOTH the document and the query, so the two always agree.
 * Query-side EXPANSION (`expandQueryTokens`) is separate and one-directional:
 * it adds alternatives to the query without growing the index.
 */

/* --------------------------- character folding ---------------------------- */

/**
 * Strip diacritics. "Zürich" -> "zurich", "São Paulo" -> "sao paulo".
 *
 * Applied before the split, so accented letters survive as letters instead of
 * being treated as separators and shattering the word.
 */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/* ------------------------------ equivalences ------------------------------ */

/**
 * Terms that mean the same thing in a job title, mapped to one canonical form.
 *
 * Applied to documents AND queries, so the canonical form is what actually sits
 * in the index. Entries are only added where the merge is unambiguous in a
 * hiring context -- "ml" is machine learning, not millilitres, because this
 * index contains job postings and nothing else.
 */
const CANONICAL: Record<string, string> = {
  // Morphology that matters for the most common query on the site.
  engineering: 'engineer',
  engineers: 'engineer',
  developers: 'developer',
  development: 'developer',
  developing: 'developer',
  programmer: 'developer',
  programmers: 'developer',
  analysts: 'analyst',
  analytics: 'analyst',
  scientists: 'scientist',
  managers: 'manager',
  designers: 'designer',
  architects: 'architect',
  administrators: 'administrator',
  administration: 'administrator',

  // Abbreviations people actually type.
  swe: 'engineer',
  sde: 'engineer',
  sdet: 'engineer',
  dev: 'developer',
  devs: 'developer',
  eng: 'engineer',
  mgr: 'manager',
  pm: 'manager',
  qa: 'quality',
  sre: 'reliability',
  ds: 'science',
  da: 'analyst',

  // Technology spellings that are genuinely the same thing.
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  k8s: 'kubernetes',
  golang: 'go',
  postgres: 'postgresql',
  'node.js': 'node',
  nodejs: 'node',
  reactjs: 'react',
  'react.js': 'react',
  vuejs: 'vue',
  'vue.js': 'vue',
  dotnet: '.net',
  csharp: 'c#',
  cpp: 'c++',
}

/**
 * Multi-word phrases that expand to additional query terms.
 *
 * QUERY SIDE ONLY. Expanding the index with these would inflate it and blur
 * document statistics; expanding the query costs one extra posting-list walk.
 * The phrase is matched on the folded token sequence.
 */
const PHRASE_EXPANSIONS: { phrase: string[]; add: string[] }[] = [
  { phrase: ['ml'], add: ['machine', 'learning'] },
  { phrase: ['ai'], add: ['artificial', 'intelligence'] },
  { phrase: ['mlops'], add: ['machine', 'learning', 'operations'] },
  { phrase: ['devops'], add: ['operations', 'infrastructure'] },
  { phrase: ['nlp'], add: ['natural', 'language'] },
  { phrase: ['ux'], add: ['user', 'experience', 'design'] },
  { phrase: ['ui'], add: ['user', 'interface', 'design'] },
  { phrase: ['fullstack'], add: ['full', 'stack'] },
  { phrase: ['full', 'stack'], add: ['fullstack'] },
  { phrase: ['front', 'end'], add: ['frontend'] },
  { phrase: ['frontend'], add: ['front', 'end'] },
  { phrase: ['back', 'end'], add: ['backend'] },
  { phrase: ['backend'], add: ['back', 'end'] },
  { phrase: ['infosec'], add: ['security', 'information'] },
  { phrase: ['cyber'], add: ['security'] },
  { phrase: ['grad'], add: ['graduate'] },
  { phrase: ['jr'], add: ['junior'] },
  { phrase: ['sr'], add: ['senior'] },
]

/**
 * Tokens whose trailing "s" is part of the word, not a plural.
 *
 * Without this the plural rule turns "aws" into "aw", "kubernetes" into
 * "kubernete" and "devops" into "devop" -- and while folding both sides keeps
 * those CONSISTENT, it also merges them with unrelated words that happen to
 * share the stem. These are the identifiers a job search must not blur.
 */
const NEVER_DEPLURALISE = new Set([
  'aws', 'ios', 'devops', 'mlops', 'kubernetes', 'kafka', 'redis', 'nodes',
  'analytics', 'ops', 'sas', 'sass', 'css', 'js', 'ts', 'cs', 'gis', 'ux',
  'series', 'business', 'access', 'process', 'address', 'express', 'sales',
  'operations', 'communications', 'systems', 'services', 'solutions', 'news',
  'physics', 'mathematics', 'statistics', 'logistics', 'robotics', 'graphics',
  'plus', 'gas', 'bus', 'campus', 'status', 'focus', 'bonus', 'virus',
])

/**
 * Fold one token to its canonical form.
 *
 * Order matters: the explicit table wins over the plural rule, so an entry like
 * `analytics -> analyst` is not first mangled into "analytic".
 */
export function foldToken(token: string): string {
  /**
   * Accents are folded HERE as well as in tokenizeText.
   *
   * tokenizeText folds the whole string before splitting, so tokens reaching
   * this function are already plain -- but callers also fold a single term
   * directly (a query word, a facet value), and without this the two paths
   * disagreed: `foldToken('zürich')` stayed accented and therefore never
   * matched the indexed `zurich`. NFD normalisation is idempotent, so doing it
   * twice costs nothing and makes the function correct on its own.
   */
  const t = foldAccents(token).toLowerCase()
  const mapped = CANONICAL[t]
  if (mapped) return mapped

  // Conservative de-pluralisation. Guarded on length so short identifiers are
  // untouched, and on the sets above so domain terms survive intact.
  if (t.length >= 5 && t.endsWith('s') && !NEVER_DEPLURALISE.has(t) && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) {
    const singular = t.slice(0, -1)
    return CANONICAL[singular] ?? singular
  }
  return t
}

/**
 * Tokenise text for indexing or querying.
 *
 * `+`, `#` and `.` survive the split because they are load-bearing in this
 * domain: C++, C#, .NET and Node.js are all distinct terms that lose their
 * meaning without them.
 */
export function tokenizeText(text: string): string[] {
  return foldAccents(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1 && t.length < 40)
    .map(foldToken)
}

/**
 * Query tokens, plus curated alternatives.
 *
 * Returns the folded query tokens with phrase expansions appended. Duplicates
 * are removed so a term cannot be counted twice by the scorer.
 */
export function expandQueryTokens(text: string): string[] {
  const base = tokenizeText(text)
  const out = [...base]

  for (const { phrase, add } of PHRASE_EXPANSIONS) {
    const folded = phrase.map(foldToken)
    for (let i = 0; i + folded.length <= base.length; i++) {
      if (folded.every((p, k) => base[i + k] === p)) {
        out.push(...add.map(foldToken))
        break
      }
    }
  }

  return [...new Set(out)]
}

/** Exposed for tests and tuning. */
export const __tables = { CANONICAL, PHRASE_EXPANSIONS, NEVER_DEPLURALISE }
