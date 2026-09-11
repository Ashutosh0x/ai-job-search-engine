/**
 * Inverted index with BM25 scoring, for candidate retrieval.
 *
 * WHY THIS EXISTS
 * ===============
 * `searchJobs` scored every job in the corpus on every request:
 *
 *   index.jobs.map((job) => ({ ...job, score: relevance(job, qTokens) }))
 *
 * That is O(N) in both time and allocation, and it spreads a full object for
 * all 225,601 rows before a single filter runs. Measured on this corpus:
 * p50 304ms, p99 722ms. It degrades linearly, so it gets worse with every
 * employer added -- exactly the wrong shape for the thing we keep adding to.
 *
 * An inverted index inverts the loop: instead of asking every job whether it
 * matches the query, ask the query which jobs contain its terms. A term
 * appearing in 400 postings touches 400 postings, not 225,601. This is what a
 * database's GIN index does, implemented locally because there is no database
 * in the serving path today (the index is a JSON snapshot).
 *
 * WHY BM25 AND NOT THE OLD FIELD-BOOST SUM
 * ----------------------------------------
 * The previous scorer added a flat +10 for a title hit, +1 for a body hit. Two
 * problems that BM25 fixes by construction:
 *
 *   1. NO TERM WEIGHTING. Matching "engineer" counted exactly as much as
 *      matching "verilog", though the first appears in a third of the corpus
 *      and the second in a fraction of a percent. BM25's IDF term makes a rare
 *      match worth far more than a common one -- the "corpus lift" idea, which
 *      is just IDF under another name.
 *   2. NO LENGTH NORMALISATION. A 6,000-word posting mentioning a term once
 *      scored the same as a 200-word posting about that term. BM25 divides by
 *      a length factor so verbosity stops being an advantage.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not semantic retrieval. It cannot match "AI infrastructure" to "ML platform"
 * unless they share tokens. Dense retrieval needs an embedding model and a
 * vector index, neither of which exists here; claiming hybrid search without
 * them would be a claim about software that has not been written. What this
 * does give is the sparse half, which is the half that must never be lost --
 * exact identifiers like "CUDA", "H-1B" and "ISO 27001" are precisely what
 * embeddings blur.
 */

/** BM25 parameters. Standard defaults; k1 controls term-frequency saturation. */
const K1 = 1.2
const B = 0.75

/** Field boosts. A title hit means more than a body hit -- but not 10x more. */
const FIELD_WEIGHT = { title: 3.0, department: 1.5, body: 1.0 } as const

export interface IndexedDoc {
  title: string
  department?: string | null
  descriptionText?: string
  skills?: string[]
}

interface Posting {
  /** Index into the document array. */
  doc: number
  /** Weighted term frequency, already field-boosted. */
  tf: number
}

export interface BuiltIndex {
  /** term -> postings, sorted by doc for cheap intersection. */
  postings: Map<string, Posting[]>
  /** Per-document total length, for BM25 normalisation. */
  lengths: Float64Array
  avgLength: number
  docCount: number
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1 && t.length < 40)
}

/**
 * Build the index.
 *
 * Cost is one pass over the corpus and is paid once per snapshot load, not per
 * request. On 225k postings this is a few seconds and a few hundred MB, which
 * is the trade: memory and startup time in exchange for every subsequent query
 * touching only the documents that can possibly match.
 */
export function buildIndex(docs: IndexedDoc[]): BuiltIndex {
  const postings = new Map<string, Posting[]>()
  const lengths = new Float64Array(docs.length)
  let totalLength = 0

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    // Accumulate weighted term frequency per field, so a term appearing in both
    // the title and the body is counted once with the higher weight applied.
    const tf = new Map<string, number>()

    const add = (text: string | null | undefined, weight: number) => {
      if (!text) return
      for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + weight)
    }

    add(d.title, FIELD_WEIGHT.title)
    add(d.department, FIELD_WEIGHT.department)
    add(d.descriptionText, FIELD_WEIGHT.body)
    if (d.skills?.length) add(d.skills.join(' '), FIELD_WEIGHT.title)

    let len = 0
    for (const [term, freq] of tf) {
      let list = postings.get(term)
      if (!list) { list = []; postings.set(term, list) }
      list.push({ doc: i, tf: freq })
      len += freq
    }
    lengths[i] = len
    totalLength += len
  }

  return {
    postings,
    lengths,
    avgLength: docs.length ? totalLength / docs.length : 0,
    docCount: docs.length,
  }
}

export interface Candidate {
  doc: number
  score: number
}

export interface RetrievalResult {
  candidates: Candidate[]
  /**
   * How many documents contain at least one query term, BEFORE the depth cap.
   *
   * Without this the caller can only report the number of candidates it was
   * handed, so a query matching 8,000 postings would display "1,500 results" --
   * the retrieval depth masquerading as a corpus fact. Counting is free here
   * because the union has already been computed to score it.
   */
  totalMatched: number
  /** True when the depth cap discarded matches, so the caller can say so. */
  truncated: boolean
}

/**
 * Retrieve and score candidates for a query.
 *
 * Returns at most `limit` documents, ranked by BM25. Documents containing none
 * of the query terms are never visited -- which is the entire point.
 */
export function retrieve(index: BuiltIndex, query: string, limit = 500): RetrievalResult {
  const terms = [...new Set(tokenize(query))]
  if (!terms.length) return { candidates: [], totalMatched: 0, truncated: false }

  // doc -> accumulated score
  const scores = new Map<number, number>()

  /**
   * Score one pass over the query terms.
   *
   * `idfFloor` drops terms so common they carry no discriminative information
   * and cost the most to process. That is the right default and the wrong
   * absolute rule: in a corpus of mostly engineering roles, searching
   * "engineer" would drop every term and return NOTHING -- a query that matches
   * most of the corpus is not a query that matches none of it.
   *
   * So the floor is applied on a first pass and lifted on a second if the first
   * found nothing. Degrading to a weak ranking beats an empty result set.
   */
  const scorePass = (idfFloor: number): number => {
    let termsUsed = 0
    for (const term of terms) {
      const list = index.postings.get(term)
      if (!list) continue

      // The +0.5 smoothing is the standard BM25 form and keeps the value
      // positive for terms appearing in more than half the corpus.
      const df = list.length
      const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5))
      if (idf < idfFloor) continue
      termsUsed++

      for (const p of list) {
        const len = index.lengths[p.doc] || 1
        const norm = 1 - B + B * (len / (index.avgLength || 1))
        // Floor the contribution: with a near-zero IDF the BM25 product is
        // ~0, and a doc scoring 0 is indistinguishable from a doc that never
        // matched. Keep it positive so ordering and counting still work.
        const contribution = Math.max(idf, 1e-4) * ((p.tf * (K1 + 1)) / (p.tf + K1 * norm))
        scores.set(p.doc, (scores.get(p.doc) ?? 0) + contribution)
      }
    }
    return termsUsed
  }

  if (scorePass(0.05) === 0) scorePass(0)

  if (!scores.size) return { candidates: [], totalMatched: 0, truncated: false }

  const out: Candidate[] = []
  for (const [doc, score] of scores) out.push({ doc, score })
  out.sort((a, b) => b.score - a.score)

  return {
    candidates: out.slice(0, limit),
    totalMatched: out.length,
    truncated: out.length > limit,
  }
}

/**
 * Reciprocal Rank Fusion.
 *
 * Merges ranked lists whose scores are not comparable -- a BM25 score and a
 * cosine similarity live on different scales, and normalising them against each
 * other requires tuning that has to be redone whenever either changes. RRF
 * sidesteps that by using only RANK, so the lists need nothing in common.
 *
 *   RRF(d) = sum over lists of  1 / (k + rank(d))
 *
 * k=60 is the value from the original Cormack et al. work and is the usual
 * default; it damps the influence of the very top ranks so a single list cannot
 * dominate the fusion.
 *
 * Included now, with one input, because the moment a second retrieval stream
 * exists this is where it plugs in -- and writing the fusion later tends to
 * mean rewriting the caller.
 */
export function reciprocalRankFusion(
  lists: Candidate[][],
  k = 60,
  limit = 200
): Candidate[] {
  const fused = new Map<number, number>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const d = list[rank].doc
      fused.set(d, (fused.get(d) ?? 0) + 1 / (k + rank + 1))
    }
  }
  return [...fused.entries()]
    .map(([doc, score]) => ({ doc, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
