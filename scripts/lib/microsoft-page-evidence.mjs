/**
 * Page-evidence helpers for the Microsoft careers audit.
 *
 * Extracted into their own module so they can be unit-tested without the
 * investigator's live fetches. The i18n guard below is the reason this file
 * exists at all -- it is a rule that decides whether a job gets called CLOSED,
 * so it needs tests, not just a comment.
 */

export const ldBlocks = (html) =>
  [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]

export const titleOf = (html) =>
  (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()

/** Text outside <script>/<style>. */
export const renderedText = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Markers of serialised data rather than prose.
 *
 * HTML-escaped quotes and a `"key": "value"` separator are everywhere in the
 * candidate portal's inline config blob and absent from a sentence written
 * for a person to read.
 */
export const JSON_ISH = /&#34;|&quot;|"\s*:\s*"/

export const CLOSURE_PATTERNS = [
  /this (job|position|posting) is no longer (available|accepting)/i,
  /no longer accepting applications/i,
  /(job|position|posting) (has been )?(closed|filled|removed|expired)/i,
  /we (are|'re) no longer accepting/i,
  /this (job|posting) (was|has been) removed/i,
  /job not found/i,
  /posting (is )?(unavailable|not available)/i,
]

/**
 * Does the page state, in text a person would read, that the role is gone?
 *
 * THE TRAP THIS GUARDS AGAINST
 * ============================
 * The first version stripped `<script>` and matched the rest, and reported
 * closure evidence on 43 of 44 pages. Every one of those 43 hits was the same
 * string:
 *
 *   "Position Closed": "Not selected"
 *
 * -- an entry in the candidate portal's i18n translation table, HTML-escaped
 * and sitting in an inline config blob that is NOT inside a script tag, so the
 * script strip never touched it. Acting on it would have reclassified 43
 * postings as CLOSED on the strength of a translation string.
 *
 * A match therefore counts only when its neighbourhood reads as prose. The
 * rejected matches are returned rather than dropped, so the audit can show
 * what it refused to count.
 */
export function closureEvidence(html) {
  const text = renderedText(html)
  const hits = []
  const rejectedAsSerialisedData = []

  for (const re of CLOSURE_PATTERNS) {
    const windowed = new RegExp(`.{0,120}${re.source}.{0,120}`, re.flags + 'g')
    for (const m of text.matchAll(windowed)) {
      const snippet = m[0].trim()
      if (JSON_ISH.test(snippet)) rejectedAsSerialisedData.push(snippet)
      else hits.push(snippet)
    }
  }
  return { hits, rejectedAsSerialisedData }
}
