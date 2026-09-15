/**
 * Search normalisation: folding, morphology and abbreviations.
 *
 * WHAT WAS WRONG
 * --------------
 * Tokenisation was `lowercase().split(/[^a-z0-9+#.]+/)`. Three consequences:
 *
 *   1. The split class is ASCII-only, so "Zürich" became the tokens "z" and
 *      "rich" -- the first dropped as too short, the second an unrelated word.
 *      Searching "Zurich" could not find a Zürich posting.
 *   2. "engineer" did not match "Engineering Manager".
 *   3. "SWE", "ML engineer" and "k8s" matched nothing at all.
 *
 * WHAT MUST NOT HAPPEN
 * --------------------
 * Over-merging. A job search lives on exact identifiers -- C++, C#, .NET, AWS,
 * CUDA -- and a general stemmer or edit-distance matcher blurs precisely those.
 * The second half of this file is the guard: terms that must stay distinct.
 */
import { tokenizeText, expandQueryTokens, foldToken, foldAccents } from '../lib/search/normalize.ts'

let pass = 0, fail = 0
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, got !== undefined ? `-> ${JSON.stringify(got)}` : '') }
}
const has = (text, term) => tokenizeText(text).includes(foldToken(term))

/* ============================ accent folding ============================== */
{
  t('folds a German umlaut', foldAccents('Zürich') === 'Zurich')
  t('folds a Portuguese tilde', foldAccents('São Paulo') === 'Sao Paulo')
  t('folds a French cedilla', foldAccents('Besançon') === 'Besancon')
  t('folds a Spanish accent', foldAccents('Asunción') === 'Asuncion')
  t('leaves ASCII alone', foldAccents('London') === 'London')

  // The failure this prevents: an accented word shattering into fragments.
  t('"Zürich" is one token, not "z" + "rich"',
    JSON.stringify(tokenizeText('Zürich')) === '["zurich"]', tokenizeText('Zürich'))
  t('a plain query finds the accented form', has('Zürich office', 'zurich'))
  t('an accented query finds the plain form', has('Zurich office', 'zürich'))
  t('"São Paulo" tokenises cleanly',
    JSON.stringify(tokenizeText('São Paulo')) === '["sao","paulo"]', tokenizeText('São Paulo'))
}

/* ============================== morphology =============================== */
{
  t('"engineer" matches "Engineering Manager"', has('Engineering Manager', 'engineer'))
  t('"engineering" matches "Software Engineer"', has('Software Engineer', 'engineering'))
  t('"engineers" folds to the same term', foldToken('engineers') === foldToken('engineer'))
  t('"developer" matches "Development Lead"', has('Development Lead', 'developer'))
  t('"programmer" folds to developer', foldToken('programmer') === 'developer')
  t('"analysts" matches "Data Analyst"', has('Data Analyst', 'analysts'))
  t('"managers" matches "Product Manager"', has('Product Manager', 'managers'))
  t('"designers" matches "Product Designer"', has('Product Designer', 'designers'))

  // Plain plurals.
  t('a plural query finds the singular', has('Backend Engineer', 'backends') || has('Backend Engineer', 'engineers'))
  t('"scientists" folds to "scientist"', foldToken('scientists') === 'scientist')
}

/* ============================ abbreviations ============================== */
{
  t('"SWE" matches a Software Engineer role', has('Software Engineer', 'swe'))
  t('"SDE" matches a Software Engineer role', has('Software Engineer', 'sde'))
  t('"eng" matches an engineering role', has('Engineering Manager', 'eng'))
  t('"k8s" matches Kubernetes', has('Kubernetes Platform Lead', 'k8s'))
  t('"js" matches JavaScript', has('JavaScript Developer', 'js'))
  t('"golang" matches Go', has('Go Backend Engineer', 'golang'))
  t('"postgres" matches PostgreSQL', has('PostgreSQL Administrator', 'postgres'))
  t('"nodejs" matches Node', has('Node Backend Engineer', 'nodejs'))
  t('"sr" expands to senior', expandQueryTokens('sr engineer').includes('senior'))
  t('"jr" expands to junior', expandQueryTokens('jr developer').includes('junior'))
  t('"grad" expands to graduate', expandQueryTokens('grad scheme').includes('graduate'))
}

/* ========================= phrase expansion ============================== */
// Query-side only: the index is not inflated with synonyms.
{
  const ml = expandQueryTokens('ml engineer')
  t('"ml engineer" also searches machine', ml.includes('machine'), ml)
  t('"ml engineer" also searches learning', ml.includes('learning'), ml)
  t('and keeps the original term', ml.includes('engineer'), ml)

  const ai = expandQueryTokens('ai researcher')
  t('"ai" expands to artificial intelligence',
    ai.includes('artificial') && ai.includes('intelligence'), ai)

  const fs = expandQueryTokens('full stack developer')
  t('"full stack" also searches fullstack', fs.includes('fullstack'), fs)
  const fe = expandQueryTokens('frontend')
  t('"frontend" also searches front + end', fe.includes('front') && fe.includes('end'), fe)
  const be = expandQueryTokens('back end engineer')
  t('"back end" also searches backend', be.includes('backend'), be)

  const ux = expandQueryTokens('ux designer')
  t('"ux" expands to user experience', ux.includes('user') && ux.includes('experience'), ux)

  t('expansion does not duplicate terms',
    new Set(expandQueryTokens('ml ml engineer')).size === expandQueryTokens('ml ml engineer').length)
}

/* ==================== WHAT MUST STAY DISTINCT ============================ */
/**
 * The precision guard. Each of these pairs is one a general stemmer or a fuzzy
 * matcher would merge, and each merge would be visibly wrong on a job board.
 */
{
  const distinct = [
    ['java', 'javascript'],
    ['c++', 'c#'],
    ['go', 'google'],
    ['react', 'reactor'],
    ['aws', 'aw'],
    ['ios', 'io'],
    ['data', 'database'],
    ['sales', 'sale'],
    ['security', 'secure'],
    ['analyst', 'analysis'],
  ]
  for (const [a, b] of distinct) {
    t(`"${a}" and "${b}" stay distinct`, foldToken(a) !== foldToken(b), [foldToken(a), foldToken(b)])
  }

  // Technology names ending in "s" must not be de-pluralised into something else.
  for (const term of ['aws', 'devops', 'mlops', 'kubernetes', 'analytics', 'robotics', 'graphics', 'statistics']) {
    t(`"${term}" is not de-pluralised`, foldToken(term) === term || term === 'analytics', foldToken(term))
  }
  // "analytics" is a deliberate exception: it maps to "analyst" so that a
  // search for one finds the other, which is the intent on a job board.
  t('"analytics" deliberately folds to analyst', foldToken('analytics') === 'analyst')

  // Punctuation-bearing identifiers survive tokenisation.
  t('"C++" survives', tokenizeText('C++ Developer').includes('c++'), tokenizeText('C++ Developer'))
  t('"C#" survives', tokenizeText('C# Developer').includes('c#'), tokenizeText('C# Developer'))
  t('".NET" survives', tokenizeText('.NET Engineer').some((x) => x.includes('net')), tokenizeText('.NET Engineer'))
  t('"Node.js" survives as a term', tokenizeText('Node.js Engineer').length >= 2, tokenizeText('Node.js Engineer'))
}

/* ============================== symmetry ================================= */
// Documents and queries must fold identically, or the index and the query
// disagree and nothing matches.
{
  for (const term of ['Engineering', 'ENGINEERS', 'engineer', 'Zürich', 'DevOps', 'kubernetes']) {
    t(`"${term}" folds identically on both sides`,
      JSON.stringify(tokenizeText(term)) === JSON.stringify(tokenizeText(term.toLowerCase())),
      tokenizeText(term))
  }
}

/* ============================= degenerate ================================ */
{
  t('empty text yields no tokens', tokenizeText('').length === 0)
  t('punctuation only yields no tokens', tokenizeText('!!! ,,, ---').length === 0)
  t('single characters are dropped', tokenizeText('a b c').length === 0)
  t('a very long token is dropped', tokenizeText('x'.repeat(50)).length === 0)
  t('expansion of an empty query is empty', expandQueryTokens('').length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
