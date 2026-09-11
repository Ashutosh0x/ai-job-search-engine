/**
 * Inverted index + BM25 retrieval.
 *
 * The properties these protect are the ones that make retrieval both fast and
 * correct: rare terms must outrank common ones, long documents must not win on
 * length alone, non-matching documents must never be visited, and the reported
 * total must never be the retrieval depth wearing a corpus fact's clothes.
 */

import { buildIndex, retrieve, reciprocalRankFusion, tokenize } from '../lib/search/inverted-index.ts'

let pass = 0, fail = 0
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log('        ', JSON.stringify(detail)?.slice(0, 240)) }
}

/* ------------------------------- tokenizer -------------------------------- */
{
  t('keeps dotted and plus/hash tokens',
    ['node.js', 'c++', 'c#'].every((x) => tokenize(`we use ${x} here`).includes(x)),
    tokenize('we use node.js c++ c# here'))
  t('drops single characters', !tokenize('a b node').includes('a'), tokenize('a b node'))
}

/* ------------------------------ IDF weighting ----------------------------- */
//
// The single most important property: a match on a rare term must beat a match
// on a ubiquitous one. The old scorer gave both a flat +10.
{
  const docs = []
  // "engineer" in every doc; "verilog" in exactly one.
  for (let i = 0; i < 200; i++) docs.push({ title: `Software Engineer ${i}`, descriptionText: 'engineer work' })
  docs.push({ title: 'Hardware Engineer', descriptionText: 'verilog rtl design' })

  const idx = buildIndex(docs)
  const rare = retrieve(idx, 'verilog', 10)
  const common = retrieve(idx, 'engineer', 10)

  t('a rare term retrieves the one doc that has it', rare.candidates.length === 1, rare.candidates.length)
  t('the rare match is the verilog doc', rare.candidates[0].doc === 200, rare.candidates[0])
  // A term in ~every document must still RETRIEVE -- the IDF floor may not turn
  // a very common query into an empty result set.
  t('a near-ubiquitous term still retrieves', common.candidates.length > 0, common.candidates.length)
  t('a rare match scores far above a common one',
    rare.candidates[0].score > common.candidates[0].score * 2,
    { rare: rare.candidates[0].score.toFixed(2), common: common.candidates[0].score.toFixed(2) })
}

/* --------------------------- length normalisation ------------------------- */
{
  const short = { title: 'Rust Engineer', descriptionText: 'rust' }
  const long = { title: 'Generalist', descriptionText: ('filler '.repeat(400)) + 'rust' }
  const idx = buildIndex([short, long])
  const r = retrieve(idx, 'rust', 10)
  t('a focused short doc outranks a long one mentioning the term once',
    r.candidates[0].doc === 0, r.candidates)
}

/* ----------------------------- no false matches --------------------------- */
{
  const idx = buildIndex([
    { title: 'Data Engineer', descriptionText: 'pipelines' },
    { title: 'Chef', descriptionText: 'kitchen' },
  ])
  const r = retrieve(idx, 'kubernetes', 10)
  t('a term in no document retrieves nothing', r.candidates.length === 0 && r.totalMatched === 0, r)

  const r2 = retrieve(idx, 'chef', 10)
  t('retrieval returns only documents containing the term',
    r2.candidates.length === 1 && r2.candidates[0].doc === 1, r2.candidates)
}

/* --------------------------- honest total reporting ----------------------- */
//
// Guards the bug this shipped with: `total` reported the retrieval depth, so a
// query matching 8,000 postings displayed "1,500 results".
{
  const docs = Array.from({ length: 500 }, (_, i) => ({ title: `Engineer ${i}`, descriptionText: 'python' }))
  const idx = buildIndex(docs)

  const capped = retrieve(idx, 'python', 50)
  t('truncated retrieval is flagged', capped.truncated === true, capped.truncated)
  t('truncated retrieval still reports the true match count',
    capped.totalMatched === 500, capped.totalMatched)
  t('truncated retrieval returns only `limit` candidates',
    capped.candidates.length === 50, capped.candidates.length)

  const uncapped = retrieve(idx, 'python', 1000)
  t('untruncated retrieval is not flagged', uncapped.truncated === false, uncapped.truncated)
  t('untruncated matched equals returned',
    uncapped.totalMatched === uncapped.candidates.length, {
      m: uncapped.totalMatched, c: uncapped.candidates.length })
}

/* ------------------------------ empty inputs ------------------------------ */
{
  const idx = buildIndex([{ title: 'X', descriptionText: 'y' }])
  const r = retrieve(idx, '', 10)
  t('empty query retrieves nothing rather than everything',
    r.candidates.length === 0 && r.totalMatched === 0, r)
  const empty = buildIndex([])
  t('empty corpus builds without dividing by zero',
    empty.docCount === 0 && Number.isFinite(empty.avgLength), empty.avgLength)
}

/* ------------------------- reciprocal rank fusion ------------------------- */
{
  // Two lists disagreeing: doc 5 is mid-rank in both, doc 1 is top of one only.
  const a = [{ doc: 1, score: 9 }, { doc: 5, score: 8 }, { doc: 9, score: 7 }]
  const b = [{ doc: 7, score: 99 }, { doc: 5, score: 50 }, { doc: 1, score: 1 }]
  const fused = reciprocalRankFusion([a, b], 60, 10)

  t('RRF returns every distinct doc', fused.length === 4, fused.map((f) => f.doc))
  t('a doc ranked well in BOTH lists wins',
    fused[0].doc === 5 || fused[0].doc === 1, fused.slice(0, 2))
  t('RRF output is sorted descending',
    fused.every((f, i, arr) => i === 0 || arr[i - 1].score >= f.score), fused)
  // RRF must use rank only -- b's scores are ~10x a's and must not dominate.
  t('RRF ignores score magnitude',
    fused.find((f) => f.doc === 7).score < fused.find((f) => f.doc === 5).score,
    fused)
  t('RRF of one list preserves that list\'s order',
    reciprocalRankFusion([a], 60, 10).map((f) => f.doc).join(',') === '1,5,9')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
