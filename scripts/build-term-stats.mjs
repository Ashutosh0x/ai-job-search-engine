/**
 * Corpus-derived term statistics.
 *
 *   node --max-old-space-size=10240 scripts/build-term-stats.mjs
 *
 * WHY THIS EXISTS -- IT IS THE ALTERNATIVE TO A HARDCODED KEYWORD LIST
 * ====================================================================
 * The brief's hardest requirement is that the intelligence must not be
 * hardcoded: no fixed keyword lists, no fixed importance, no "10 keywords =
 * good". The obvious but wrong response is to move the same list into a
 * database, which changes where the guess lives, not that it is a guess.
 *
 * We already own the thing that answers the question honestly: 225k live job
 * postings read from employers' own ATS boards. How much a term matters for a
 * role is not something to assert -- it is something to MEASURE:
 *
 *   - How many postings mention it at all?              (document frequency)
 *   - How many postings FOR THIS ROLE FAMILY mention it? (conditional DF)
 *   - How much more likely is it here than in general?   (lift)
 *
 * A term that appears in 62% of "platform engineer" postings and 3% of postings
 * overall is important for that role, and we can say so with a number and a
 * sample size rather than because someone typed it into a list. When the market
 * changes, the next crawl changes the statistic -- no code edit, no redeploy.
 *
 * Terms are discovered from the corpus text itself, so a technology nobody has
 * heard of yet enters the vocabulary the first time employers write it down.
 *
 * Output: public/data/term-stats.json (gitignored; regenerate from the index).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const IN = process.argv[2] ?? 'public/data/jobs-v2.json'
const OUT = process.argv[3] ?? 'public/data/term-stats.json'
/** A term seen in fewer postings than this is noise, not vocabulary. */
const MIN_DF = Number(process.env.MIN_DF ?? 25)

if (!existsSync(IN)) {
  console.error(`No index at ${IN}. Build one: npx tsx scripts/ingest-v2.mjs`)
  process.exit(1)
}

console.log(`reading ${IN} ...`)
const data = JSON.parse(readFileSync(IN, 'utf8'))
const jobs = data.jobs ?? []
console.log(`${jobs.length.toLocaleString()} postings`)

/* ----------------------------- tokenisation ------------------------------- */

// Deliberately permissive: keep dots, pluses and hashes so "node.js", "c++"
// and "c#" survive as single tokens instead of shattering into punctuation.
const TOKEN = /[a-z][a-z0-9+#.\-]{1,28}[a-z0-9+#]|[a-z]{2,}/g

// Structural English that carries no signal about a role. This is the ONE
// judgement call in the file, and it is about grammar rather than about which
// skills matter -- which is the part that must stay measured.
const STOP = new Set(`a an the and or but if then else for to of in on at by with from as is are was
were be been being this that these those we you they it our your their his her its will would can could
should may might must have has had do does did not no yes all any some each other more most such own same
so than too very just about into over under again further once here there when where why how what which who
whom whose i me my mine he she them us who's role job work working position opportunity team company please
apply candidate candidates applicant experience experienced years year new join looking seeking required
require requirements responsibilities qualifications benefits salary including include includes etc via
across within without per across also well strong ability able help make made making using use used
across offer offers offering across support supporting provide provides providing ensure ensuring
across day days week weeks month months full time part remote hybrid onsite office based across
across across you'll we're we'll don't it's plus preferred nice must across`.split(/\s+/))

function tokenize(text) {
  if (!text) return []
  const out = new Set()
  const lower = text.toLowerCase()
  const words = lower.match(TOKEN) ?? []

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/^[-.]+|[-.]+$/g, '')
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue
    out.add(w)
    // Bigrams catch the multi-word terms that matter most ("machine learning",
    // "site reliability"), which unigrams alone would lose.
    if (i + 1 < words.length) {
      const n = words[i + 1].replace(/^[-.]+|[-.]+$/g, '')
      if (n.length >= 2 && !STOP.has(n) && !/^\d+$/.test(n)) out.add(`${w} ${n}`)
    }
  }
  return [...out]
}

/* --------------------------- role family bucketing ------------------------ */

/**
 * Group postings by a coarse family derived from the title.
 *
 * This is derived from the corpus, not from a curated title taxonomy: the
 * family key is simply the normalised title's most distinctive tokens. Titles
 * that read alike bucket together without anyone enumerating job titles.
 */
function familyOf(title) {
  if (!title) return null
  const t = title.toLowerCase()
  const toks = (t.match(/[a-z][a-z0-9+#.\-]{1,20}/g) ?? []).filter(
    (w) => !STOP.has(w) && !/^(i|ii|iii|iv|senior|sr|junior|jr|staff|principal|lead|associate)$/.test(w)
  )
  return toks.slice(0, 3).sort().join(' ') || null
}

/* --------------------------------- count ---------------------------------- */

const df = new Map()            // term -> postings containing it
const byFamily = new Map()      // family -> { n, terms: Map<term, count> }
let counted = 0

for (const j of jobs) {
  // Only postings with real text can contribute vocabulary. A title-only
  // posting would otherwise make every title word look like a critical skill.
  const desc = j.description ?? ''
  if (desc.length < 200) continue
  counted++

  const terms = tokenize(`${j.title ?? ''} ${desc}`)
  for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1)

  const fam = familyOf(j.title)
  if (!fam) continue
  let bucket = byFamily.get(fam)
  if (!bucket) { bucket = { n: 0, terms: new Map() }; byFamily.set(fam, bucket) }
  bucket.n++
  for (const t of terms) bucket.terms.set(t, (bucket.terms.get(t) ?? 0) + 1)
}

console.log(`${counted.toLocaleString()} postings had usable text`)
console.log(`${df.size.toLocaleString()} raw terms`)

/* --------------------------------- prune ---------------------------------- */

const vocab = {}
for (const [term, n] of df) {
  if (n < MIN_DF) continue
  vocab[term] = { df: n, rate: n / counted }
}
console.log(`${Object.keys(vocab).length.toLocaleString()} terms above df>=${MIN_DF}`)

// Keep only families with enough postings for a rate to mean anything, and
// within each, only the terms that are genuinely over-represented (lift).
const families = {}
for (const [fam, b] of byFamily) {
  if (b.n < 40) continue

  // TITLE ECHO. The highest-lift terms for a family are otherwise the family's
  // own title words: "software engineer" occurs in 100% of software engineer
  // postings at 13x lift, which is tautological -- it tells a candidate nothing
  // they did not already know from the job title. Worse, it would dominate any
  // importance ranking built on lift and bury the actual skills. Drop any term
  // wholly composed of the family's own tokens.
  const famTokens = new Set(fam.split(' '))
  const isTitleEcho = (term) => term.split(' ').every((t) => famTokens.has(t))

  const terms = {}
  for (const [term, c] of b.terms) {
    const base = vocab[term]
    if (!base) continue
    if (isTitleEcho(term)) continue
    const rate = c / b.n
    // A term seen in a handful of postings has a rate that is mostly sampling
    // noise; require both an absolute floor and a share of the family.
    if (c < 10 || rate < 0.05) continue
    const lift = rate / base.rate
    if (lift < 2) continue
    terms[term] = { n: c, rate: Number(rate.toFixed(4)), lift: Number(lift.toFixed(2)) }
  }
  const top = Object.entries(terms)
    .sort((a, b2) => b2[1].lift * b2[1].rate - a[1].lift * a[1].rate)
    .slice(0, 120)
  if (top.length) families[fam] = { n: b.n, terms: Object.fromEntries(top) }
}
console.log(`${Object.keys(families).length.toLocaleString()} role families`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceIndex: IN,
    sourceGeneratedAt: data.generatedAt ?? null,
    postingsTotal: jobs.length,
    postingsWithText: counted,
    minDf: MIN_DF,
    vocab,
    families,
  })
)
console.log(`wrote ${OUT}`)
