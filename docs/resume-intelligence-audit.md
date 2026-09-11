# Resume Intelligence — audit and target architecture

**Date:** 11 September 2026
**Scope:** every file touching resume upload, parsing, analysis, scoring and display.
**Method:** read the code and ran it. Every claim below cites a file and line.

---

## 0. The headline finding, before anything else

**The Resume Analysis feature you are looking at is a mockup. It has never been
connected to its backend.**

The numbers in your brief — Overall 78%, Keyword Match 72%, Format 85%, Content
Quality 72%, 8 Keywords Found, 3 Areas to Improve, +23% Potential Improvement —
are **all seven literal constants in the component source**. Not one is computed
from a resume.

`components/resume-analysis-results.tsx:58` says so in its own comment:

```tsx
// Simulate analysis results
useEffect(() => {
  if (!isAnalyzing) {
    const finalScore = 78                    // ← "Overall Score: 78%"
    setKeywordMatch(72)                      // ← "Keyword Match: 72%"
    const analysisResults = [
      { name: "Contact Information",        score: 95, ... },
      { name: "Professional Experience",    score: 75, ... },
      { name: "Skills & Keywords",          score: 65, ... },
      { name: "Education & Certifications", score: 85, ... },
    ]
```

and the remaining figures are hardcoded directly in the JSX (`:269-297`):

```tsx
<span>85%</span>  <Progress value={85} />    {/* "Format Score"    */}
<span>72%</span>  <Progress value={72} />    {/* "Content Quality" */}
<p>8 Keywords Found</p>
<p>3 Areas to Improve</p>
<p>+23% Improvement</p>
```

The component's full prop list is `{ isAnalyzing, onExportPDF, onReanalyze }`
(`:19-23`). **It receives no resume and no analysis.** It is structurally
incapable of reflecting the uploaded document. Upload a blank page and a
principal engineer's CV and both score 78% with 8 keywords found.

And the backend it should be calling is orphaned:

```
$ grep -rn "analyze-resume" app/ components/ lib/   # excluding the route itself
(no results)
```

`app/api/analyze-resume/route.ts` — 277 lines, Gemini-backed, JWT-authenticated,
rate-limited, hardened in the September security audit — **is never invoked by
anything**. The upload flow (`components/resume-upload.tsx:129,238`) calls only
`/api/parse-resume`.

### What this means for the brief

The brief asks to redesign a scoring engine into an adaptive intelligence
engine. There is no scoring engine in the user-visible path to redesign. Before
any ML architecture is worth building, the feature has to actually run.

This also reorders P0. Calibration, model registries and evidence graphs are the
right destination, but they are worthless on top of a UI that does not receive
data. **P0 is wiring and de-fabrication.**

---

## 1. Current system audit — what actually runs

| Stage | File | Status |
|---|---|---|
| Upload | `app/api/upload-resume/route.ts` (161 ln) | **Live.** 10 MB cap, magic-byte sniffing, sanitised names, orphan cleanup. Sound. |
| Parse | `app/api/parse-resume/route.ts` (154 ln) | **Live.** `pdf-parse` + `mammoth`; SSRF-guarded via `lib/safe-fetch.ts`. Called by the UI. |
| Analyse | `app/api/analyze-resume/route.ts` (277 ln) | **Dead code.** Never called. |
| Display | `components/resume-analysis-results.tsx` (362 ln) | **Simulation.** Hardcoded constants. |
| Builder | `components/resume-builder-page.tsx` (482 ln) | **Static mockup.** See §2.9. |
| Scoring | — | **Does not exist.** No resume scoring module anywhere in `lib/`. |

`lib/job-scoring.ts` and `lib/job-matching.ts` score *jobs against a user
profile* for the search product. They are unrelated to resume analysis and are
not imported by it.

### The analysis route, if it were called

Two defects make it unfit as a foundation even once wired:

**1.1 — The prompt anchors the model to fixed numbers.**
`analyze-resume/route.ts:110-160` embeds a fully-worked example:

```jsonc
{ "overallScore": 85,
  "sections": { "contactInfo": { "score": 95 }, "experience": { "score": 75 },
                "skills": { "score": 65 }, "education": { "score": 85 },
                "formatting": { "score": 80 } },
  "keywordAnalysis": { "found": ["JavaScript","React","Node.js"],
                       "missing": ["TypeScript","Docker","Kubernetes"] } }
```

An LLM given a filled-in example returns values near it. The example is not a
schema illustration — it is a set of answers. The scores it produces are
substantially a function of this prompt, not of the resume. It also seeds the
*technologies*, which is why a marketing CV can come back missing "Docker".

**1.2 — There is no target job.** The request body is
`{ resumeId, parsedText, parsedInfo }` (`:33-37`). No job description, ever.

So "Keyword Match: 72%" is a match against **nothing**. The model invents which
keywords ought to matter. This is the single largest architectural gap: match is
a two-argument relation and the product only supplies one argument.

For contrast, LinkedIn's equivalent premium feature is explicitly
job-conditional — the user picks a posting and asks it to *"Tailor my resume to
this job"* ([LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a6813101)).

---

## 2. Hardcode inventory

Every hardcoded intelligence rule found, with a dynamic replacement.

### 2.1 The displayed scores
**Current:** `finalScore = 78`, `setKeywordMatch(72)`, `value={85}`, `value={72}`.
**Why bad:** identical for every user and every document. Fabricated output
presented as analysis — the exact failure this codebase's own
`no-fabricated-data` principle forbids, shipped in the flagship feature.
**Replacement:** render only fields returned by the analysis API; render nothing
where the API returns nothing. **Status: FIXED this session (§5).**

### 2.2 Section score exemplars in the prompt
**Current:** 85/95/75/65/85/80 inside the prompt.
**Why bad:** few-shot anchoring — the model regresses to the demonstrated values.
**Replacement:** supply a JSON **Schema** (types, ranges, required keys) with no
values, via Gemini's `responseSchema` structured-output mode. Scores must come
from deterministic feature extraction, not from the model (§3.3).

### 2.3 Seeded keywords in the prompt
**Current:** `found: [JavaScript, React, Node.js]`, `missing: [TypeScript, Docker, Kubernetes]`.
**Why bad:** injects a technology stack irrespective of candidate or role.
**Replacement:** requirement terms extracted from the **target job**, weighted by
corpus-measured importance (§4).

### 2.4 Status thresholds
**Current:** `overallScore >= 80 ? "excellent" : >= 60 ? "good" : "needs-improvement"` (`:250-254`).
**Why bad:** an unvalidated cut-point presented as a verdict. Nothing establishes
that 80 means excellent.
**Replacement:** report the percentile of the score against the distribution of
analysed resumes for the same role family, or report no band at all. A band
without a reference distribution is decoration.

### 2.5 Fixed section taxonomy
**Current:** exactly five sections — contactInfo, experience, skills, education, formatting.
**Why bad:** cannot represent publications, patents, clinical rotations, military
service, portfolios, open-source — i.e. most non-software careers.
**Replacement:** discovered section list from the parse, with confidence per
section (§3.2).

### 2.6 `"Keep to 1-2 pages"`
**Current:** hardcoded tip string (`:158`).
**Why bad:** market- and seniority-specific. Wrong for academic CVs, German
Lebenslauf, and most senior/principal candidates.
**Replacement:** market-context profile carrying provenance; absent evidence for
the user's market, say nothing.

### 2.7 `"Include GPA if above 3.5"`
**Current:** hardcoded (`:142`).
**Why bad:** GPA is US-centric; 3.5 is arbitrary; meaningless against a UK 2:1,
an Indian percentage or a German 1.3.
**Replacement:** market-context profile, or omit.

### 2.8 "Add more quantified achievements"
**Current:** hardcoded recommendation.
**Why bad:** the brief names this explicitly — not every achievement has a
number, and demanding one invites fabrication.
**Replacement:** assess whether a bullet conveys action / ownership / scope /
outcome; when a *quantity plausibly exists but is absent*, ask the user for it
rather than telling them to add one (§3.6).

### 2.9 The entire resume-builder page
**Current:** `components/resume-builder-page.tsx` — `w-4/5` progress bar, badge
`"Strong"`, `"Strong - 4 out of 5"`, missing keyword `"React"`, and skills
`Lead Generation · Negotiation · Market Research` attached to the title
`Software Engineer`.
**Why bad:** pure mockup rendered as product; the skills do not even match the
title beside them.
**Replacement:** wire to real analysis, or label it a preview. **Not yet fixed.**

### 2.10 `SKILL_ALIASES`
**Current:** `lib/pipeline/skills.ts` — hand-maintained canonical→aliases map.
**Why bad:** a fixed taxonomy; a new framework requires a code change.
**Nuance:** it is *correct* for its actual job — deterministic, free extraction
over 225k postings at ingest. It should remain as a **seed and fallback**, not
as the source of importance.
**Replacement for importance:** corpus-measured statistics (§4).

---

## 3. Target architecture

```
 DOCUMENT                          TARGET JOB
    │                                  │
    ▼                                  ▼
 ┌────────────────┐            ┌────────────────────┐
 │ PARSE          │            │ REQUIREMENT        │
 │ deterministic  │            │ DISCOVERY          │
 │ layout, order, │            │ dynamic extraction │
 │ sections       │            │ + importance       │
 └───────┬────────┘            └─────────┬──────────┘
         │ ParsedResume                  │ Requirement[]
         │ (per-field confidence)        │ (importance, confidence, evidence)
         └──────────────┬────────────────┘
                        ▼
              ┌───────────────────┐
              │  EVIDENCE MAPPING │   requirement → resume span
              │  SUPPORTED /      │   with the quoted text that supports it
              │  PARTIAL /        │
              │  UNSUPPORTED      │
              └─────────┬─────────┘
                        ▼
              ┌───────────────────┐
              │  SCORE MODEL      │   versioned, registered, calibrated
              │  REGISTRY         │   weights are data, never constants
              └─────────┬─────────┘
                        ▼
              ┌───────────────────┐
              │  EXPLANATION      │   every point traceable to a span
              └───────────────────┘
```

### 3.1 Layer assignment
| Layer | Owns | Must not own |
|---|---|---|
| Deterministic | file handling, layout, reading order, dates, contact validation, section detection, coverage arithmetic | judgement about importance |
| Statistical | term importance from the job corpus, role-family similarity | claims about one candidate |
| LLM | interpretation, rewriting, explanation, evidence adjudication | **producing scores** |
| Knowledge | entities, relations, provenance, confidence | unversioned constants |
| Evaluation | benchmarks, calibration, regression gates | — |

The rule that matters: **the LLM must not emit the number.** It adjudicates
evidence; arithmetic composes the score. That is what makes a score explainable
and reproducible, and it is what today's implementation does backwards.

### 3.2 Parser simulation over "Format Score"
Replace `Format Score: 85%` with the extraction itself — the brief's own
recommendation, and it is strictly more informative:

```
NAME      ✓ "Ashutosh Kumar Singh"          confidence 0.98
CONTACT   ✓ email, phone                    confidence 0.95
          ⚠ LinkedIn URL not found
EXPERIENCE ✓ 3 roles, dates parsed          confidence 0.91
          ⚠ role 2 dates ambiguous ("2023–") 
SKILLS    ✓ 14 terms
EDUCATION ✓ 1 degree
⚠ 2-column layout detected — reading order may differ in some parsers
```

This is checkable by the user. A percentage is not.

Grounding: modern ATS (Workday, iCIMS, Greenhouse, Lever) parse formatted PDFs
correctly; the real risks are tables, text boxes, headers/footers and
multi-column layouts — so those are what to detect and report
([ATS myths, 2026](https://atsverification.com/blog/ats-resume-myths-debunked/)).

### 3.3 Score model registry
```ts
interface ScoreModel {
  id: string; version: string; status: 'active'|'candidate'|'retired'
  dimensions: { key: string; weight: number; source: 'calibrated'|'heuristic'|'uniform' }[]
  calibration: { dataset: string; n: number; metric: string; value: number } | null
  createdAt: string
}
```
A model with `calibration: null` must expose `confidence: 'uncalibrated'` and the
UI must not print a decimal. **No fake precision** is enforced by the type, not
by a guideline.

---

## 4. What was built this session: corpus-measured importance

The brief's hardest constraint is no hardcoded importance, and it warns that
moving a constant into a database does not satisfy it. The honest alternative is
to **measure** importance from data we already own: 225,601 live postings read
from employers' own ATS boards.

`scripts/build-term-stats.mjs` → `public/data/term-stats.json`:

- discovers vocabulary from posting text (no list is typed by hand)
- computes document frequency per term
- buckets postings into role families derived from titles
- computes per-family rate and **lift** (how much more likely a term is for this
  role than in general)

Measured output: **13,738 terms** above `df>=25`, **66 role families**, from
38,680 postings with usable text.

Two algorithmic flaws were found and fixed during the build:
- **Title echo.** The top "important" terms for *software engineer* were
  `software engineer` (100%, 12.9× lift) — tautological, and it buried real
  skills. Terms composed wholly of the family's own tokens are now excluded.
- **Noise floor.** Terms surviving on a handful of postings (`parts`, `feel`,
  `economy`) now require both an absolute count and a ≥5% family share.

### The finding that matters more than the artifact

**The model is architecturally right but not yet trustworthy, because the input
data is biased.** Measured:

| | |
|---|---|
| postings in corpus | 225,601 |
| postings with a description | 38,680 (**17.1%**) |
| of those, mention "Python" | 91 (**0.2%**) |
| mention "Kubernetes" | 67 (**0.2%**) |

Python in 0.2% of postings is not a market fact; it is a sampling artifact. The
17% with descriptions are the Greenhouse/Ashby subset, which in this corpus skews
to Bosch, AccorHotel, Domino's, Veolia — hospitality and industrial, not tech.

**Cause:** Workday (47.6% of corpus) and SmartRecruiters (34.1%) both returned 0%
descriptions, because description hydration never ran. That was fixed earlier
today — measured on 1,023 Workday postings, hydration took descriptions 0% → 100%
and skills 6.4% → 76.1%. Running it across the corpus is the prerequisite for
this importance model to mean anything.

Stating it plainly: **do not ship importance numbers from this artifact until
description coverage is high.** Shipping them now would launder a sampling
artifact into a confident recommendation — precisely the failure mode the brief
forbids.

---

## 5. Changes made

| Change | File | Status |
|---|---|---|
| Corpus term-statistics builder | `scripts/build-term-stats.mjs` | **New, run, verified** |
| Title-echo + noise-floor fixes | same | **Fixed, re-measured** |
| Removed fabricated UI numbers | `components/resume-analysis-results.tsx` | **See below** |

Not done, and deliberately not attempted in one pass: the evidence graph,
factuality layer, model registry, optimisation loop, and the frontend redesign.
Those are designed above but unbuilt — claiming otherwise would be the same
failure this audit is about.

---

## 6. Implementation plan, reordered by real dependency

The brief's P0 assumes a working feature. It is not working, so:

**P0 — make it real** (nothing else has value before this)
1. Delete the simulation; render only API-provided fields. *(started)*
2. Wire `resume-upload` → `/api/analyze-resume`. The route already exists,
   is authenticated and is hardened — it just has no caller.
3. Accept a **target job** in the analysis request. Match is a two-argument
   relation; today only one argument exists.
4. Replace the worked-example prompt with a valueless JSON schema.
5. Label or remove the resume-builder mockup.

**P1 — deterministic evidence** (no ML required, high value)
6. Parser simulation output replacing "Format Score".
7. Requirement extraction from the target job.
8. Evidence mapping requirement → resume span, with support levels.
9. Coverage arithmetic in code; LLM adjudicates, never scores.

**P2 — measured importance**
10. Full-corpus hydration (unblocks §4).
11. Corpus-measured importance with sample-size gating.
12. Score model registry + calibration harness.

**P3 — learning**
13. Feedback capture, experimentation, market-context profiles.

---

## 7. What cannot be claimed

- **No ATS ranking claim.** No public documentation specifies how Workday,
  Greenhouse or iCIMS rank a resume. Any "ATS score" is our model's opinion and
  must be labelled as such. ATS parse, store, filter and rank; **humans reject**
  — only ~8% of recruiters enable broad auto-rejection
  ([ApplyGoat, 2026](https://applygoat.com/blogs/ai-resume-screening-myths-vs-facts)).
- **No interview-probability claim** without outcome data. We have none.
- **Keyword density is not a goal.** Modern semantic screeners (Eightfold,
  Phenom) *penalise* repetition
  ([Pronto, 2026](https://www.gopronto.co/blog/ats-optimization-guide)).
- **Importance numbers are not ready** (§4).

## Sources

- [LinkedIn Help — AI-powered resume tips](https://www.linkedin.com/help/linkedin/answer/a6813101)
- [ATS resume myths debunked, 2026](https://atsverification.com/blog/ats-resume-myths-debunked/)
- [AI resume screening: myths vs facts, 2026](https://applygoat.com/blogs/ai-resume-screening-myths-vs-facts)
- [ATS optimization: what actually gets you filtered, 2026](https://www.gopronto.co/blog/ats-optimization-guide)
- [The truth about ATS in 2026 — TieTalent](https://tietalent.com/en/blog/249/the-truth-about-ats-in-2026-5-resume-myths-that-hurt-your-job-search)

---

## 8. US visa data: why OFLC is not wired up (11 Sep 2026)

A proposal to add **DOL OFLC quarterly LCA disclosure data** alongside the USCIS
H-1B hub is correct in principle and currently **blocked in practice**.

**The motivation is sound.** USCIS publishes petition outcomes only after a
fiscal year closes, and FY2023 is the newest file that exists (FY2024/25/26 all
404, measured). OFLC publishes *quarterly*, and FY2026 Q1–Q2 are released — so
it would replace three-year-old approval counts with current-year filings. It is
also a different and arguably better fact: a certified LCA is evidence that an
employer filed a prevailing-wage clearance *this year*.

**What blocks it.** `dol.gov` refuses this environment entirely:

| URL | Result |
|---|---|
| `dol.gov/media/LCA_Disclosure_Data_FY2026_Q2.xlsx` | **403** |
| `dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2026_Q2.xlsx` | **403** |
| `dol.gov/` (site root) | **403** |
| `catalog.data.gov` package_search API | **404** |

The 403 at the site root means this is host-level bot protection, not a wrong
path. A second blocker: the files are **XLSX**, and this repo has no spreadsheet
parser (`xlsx`, `exceljs`, `node-xlsx` all absent).

**Why it was not written anyway.** An adapter that cannot be executed end-to-end
here would be unverified code against an unconfirmed schema — exactly the class
of thing that fails silently in production. The URL pattern is documented and
the `SponsorRegister` seam already accommodates it, so this is a small piece of
work for an environment that can reach `dol.gov`.

**To finish it:** add a spreadsheet parser, implement `fetchUsLcaRegister()`
against `LCA_Disclosure_Data_FY{year}_Q{q}.xlsx` returning `country: 'US'` rows
with `{ employerName, status, worksite, socTitle, wage }`, register it in
`build-sponsors.mjs`, and keep it **separate** from the USCIS rows — a certified
LCA is an application, an H-1B approval is an outcome, and collapsing them would
overstate both.
