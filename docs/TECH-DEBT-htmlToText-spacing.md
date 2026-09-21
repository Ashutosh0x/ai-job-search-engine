# Tech debt: `htmlToText` leaves a space before punctuation

**Status:** documented, not fixed. Raised during the Microsoft Careers adapter
work (2026-09-21) and deliberately left alone there — fixing it is a
corpus-wide change that does not belong in a single-source integration.

## Current behaviour

`htmlToText` strips tags by replacing each one with a space, so punctuation that
sat immediately after a closing tag ends up separated from the word it belongs
to:

```js
htmlToText('<p>Build <b>things</b>.</p>')   // => "Build things ."
```

The mechanism is in `lib/sources/types.ts`:

```js
.replace(/<[^>]+>/g, ' ')     // every tag becomes a space
```

followed by `.replace(/[ \t]+/g, ' ')`, which collapses the run to one space but
does not remove it. Entities and nested markup are handled correctly; only the
spacing is wrong.

## Measured blast radius

Counted over the live deploy index (`public/data/jobs-deploy.json`,
2026-09-21) by matching `/\s+[.,;:!?]/` in each job description:

| measure | value |
|---|---|
| jobs in the index | 51,019 |
| jobs with at least one occurrence | **808 (1.6%)** |
| total occurrences | 1,243 |

Example, from a real record:

> `…where science and innovation build a more sustainable future . It is a school of excellence…`

So this is a **cosmetic defect on a small minority of records**, not a
correctness problem: no field is lost, no classification depends on the space,
and search tokenisation splits on whitespace either way.

## Affected code

There are **two** copies of the function, which is part of the debt:

- `lib/sources/types.ts:321` — used by the v2 pipeline
- `lib/ats/types.ts:96` — used by the older v1 connector path

Call sites:

- `lib/pipeline/normalize.ts:35` — every job whose adapter supplies
  `descriptionHtml` rather than plain text
- `lib/sources/adapters/custom.ts:481,527`
- `lib/sources/adapters/microsoft.ts:271`
- `scripts/ingest-jobs.mjs`

Adapters that pass HTML through `descriptionHtml`, and are therefore affected:
`lib/sources/adapters/ats.ts` (Greenhouse, Lever, Ashby, SmartRecruiters,
Recruitee, Workday, Teamtailor, Personio, Workable, MokaHR, Keka, Oracle,
Radancy), `lib/sources/adapters/enterprise.ts` (Eightfold, Amazon, Oracle
Recruiting), `lib/sources/adapters/custom.ts`.

Microsoft is **not** materially affected: its JSON-LD ships plain text, and
`htmlToText` is applied there only as a guard against a future vendor template
change.

## Why it was not fixed now

`description` feeds `contentHash`. Changing the output changes the hash of every
affected record, which makes them all look **updated** on the next ingest:

- `newJobs` / `updatedJobs` / `unchangedJobs` in the ingest report become
  meaningless for one run
- repost detection (`detectReposts`) sees churn that did not happen
- any downstream consumer keyed on `contentHash` re-syncs

That is a corpus-wide event. It should be a deliberate, announced run — not a
side effect of adding one company.

## Proposed fix

Insert one rule into both copies, after the tag strip and before the whitespace
collapse:

```js
// A tag becomes a space, so punctuation that followed a closing tag is left
// orphaned: "<b>things</b>." -> "things .". Rejoin it.
.replace(/\s+([.,;:!?)\]])/g, '$1')
.replace(/([([])\s+/g, '$1')
```

Deliberately narrow: only the ASCII punctuation that is never preceded by a
space in English. French typography legitimately spaces `;` and `!`, so if the
corpus grows non-English descriptions this needs a language guard — worth
checking before shipping, since the index already carries French-language
postings (the sample above is from Institut Mines-Télécom).

Better still, the two copies should be collapsed into one shared helper as part
of the same change, so they cannot diverge further.

## Test strategy

1. Add cases to `scripts/test-html.mjs` (which already covers `htmlToText`):
   - `'<p>Build <b>things</b>.</p>'` → `'Build things.'`
   - `'a<br>b'` → newline preserved, not collapsed onto the punctuation rule
   - `'<p>(<b>x</b>)</p>'` → `'(x)'`
   - a French string with a legitimate space before `;` — pin whichever
     behaviour is chosen, so the decision is recorded rather than implied
   - idempotence: running the function twice changes nothing
2. Pin that both copies produce identical output for the same input, so the
   duplication cannot silently drift.
3. Run the full ingest into a scratch index and diff `contentHash` counts
   against the current index, to confirm the change touches ~808 records and no
   more.
4. Announce the resulting one-off spike in `updatedJobs` before the run, so the
   ingest report is not read as real churn.

## Recommendation

Low priority. Schedule it alongside the next deliberate full re-ingest rather
than on its own.
