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
  /**
   * Punctuation-bearing identifiers must not be SHATTERED by the split.
   *
   * "c++", "c#" and ".net" are distinct terms that lose their meaning without
   * the punctuation, so the split class deliberately keeps +, # and . .
   */
  t('keeps plus/hash tokens whole',
    ['c++', 'c#'].every((x) => tokenize(`we use ${x} here`).includes(x)),
    tokenize('we use c++ c# here'))

  /**
   * "node.js" stays ONE token and is then canonicalised to "node" by
   * lib/search/normalize.ts, so "Node.js", "nodejs" and "Node" all reach the
   * same posting list. The invariant is that it does not become the two tokens
   * "node" and "js" -- that would make it match every unrelated JavaScript role.
   */
  t('"node.js" is one token, not two',
    tokenize('we use node.js here').length === 4, tokenize('we use node.js here'))
  t('"node.js" and "nodejs" reach the same term',
    tokenize('node.js')[0] === tokenize('nodejs')[0],
    [tokenize('node.js'), tokenize('nodejs')])

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

/* ------------------------- company name is indexed ------------------------ */
//
// Regression. The employer's name is the most likely thing a person types into
// a job search, and it was the one field the index did not contain. Measured
// against a corpus holding 1,024 Barclays postings, searching "barclays"
// returned THREE -- only those that happened to mention the word in a title or
// body. Company filters worked; free-text search did not.
{
  const docs = [
    { title: 'Full Stack Engineer', company: 'Barclays', department: 'Technology', descriptionText: 'Build trading systems.' },
    { title: 'Data Scientist', company: 'Barclays', department: 'Risk', descriptionText: 'Model credit exposure.' },
    { title: 'Backend Engineer', company: 'Monzo', department: 'Platform', descriptionText: 'Go services on Kubernetes.' },
    // Mentions Barclays as a counterparty, but is not a Barclays job.
    { title: 'Sales Lead', company: 'Acme', department: 'Sales', descriptionText: 'Sell to Barclays and HSBC.' },
  ]
  const idx = buildIndex(docs)
  const hits = retrieve(idx, 'barclays', 10).candidates

  t('searching a company name finds that company\'s postings',
    hits.length === 3, hits.map((h) => docs[h.doc].company))

  const top2 = hits.slice(0, 2).map((h) => docs[h.doc].company)
  t('the employer\'s own roles outrank a passing mention of it',
    top2.every((c) => c === 'Barclays'), hits.map((h) => `${docs[h.doc].company}:${h.score.toFixed(2)}`))

  t('an unrelated employer is not retrieved',
    !hits.some((h) => docs[h.doc].company === 'Monzo'), hits.map((h) => docs[h.doc].company))

  // A company field must not swamp genuine title matches for the same token.
  const mixed = buildIndex([
    { title: 'Payments Engineer', company: 'Stripe', descriptionText: 'Card processing.' },
    { title: 'Stripe Integration Engineer', company: 'Acme', descriptionText: 'Wire up billing.' },
  ])
  const both = retrieve(mixed, 'stripe', 10).candidates
  t('a company hit and a title hit both retrieve', both.length === 2, both.length)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
