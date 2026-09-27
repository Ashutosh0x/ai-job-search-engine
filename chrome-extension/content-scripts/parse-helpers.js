/**
 * Pure text helpers shared by the LinkedIn content scripts.
 *
 * These hold the decisions that are easy to get quietly wrong — where a name
 * splits, whether a headline actually names an employer, what a profile URL
 * reduces to. They live apart from the DOM walking so they can be tested
 * without a browser: scripts/test-linkedin-parser.mjs loads this exact file.
 *
 * Content scripts listed in the same manifest entry share one isolated-world
 * global, so this must be listed BEFORE the scripts that read it.
 */
(function (root) {
  /**
   * Split a display name into first and last.
   *
   * Returns an empty lastName for anything that is not a clean multi-word name.
   * Callers drop those: inventing a surname would send a fabricated identity
   * into contact discovery, which then infers an address for a person who does
   * not exist.
   */
  function splitName(fullName) {
    if (typeof fullName !== 'string') return { firstName: '', lastName: '' };

    const cleaned = fullName
      .replace(/\s*·.*$/, '')                        // "· 2nd" degree marker
      .replace(/\s*\b\d+(st|nd|rd|th)\b\s*/gi, ' ')  // bare degree markers
      .replace(/,.*$/, '')                           // ", PhD" and similar
      .replace(/\s*\((?:he|she|they)[^)]*\)\s*/gi, ' ') // pronoun parentheticals
      .replace(/[\uD800-\uDFFF]/g, ' ')              // emoji (surrogate pairs)
      .replace(/[•·]/g, ' ')               // bullet characters
      // Leading honorifics. Left in, "Dr. Aditi Sharma" yields the first name
      // "Dr." and then an inferred address of dr.sharma@…
      .replace(/^\s*(dr|mr|mrs|ms|miss|prof|professor|sir|er|ca)\.?\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return { firstName: '', lastName: '' };

    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length < 2) return { firstName: cleaned, lastName: '' };
    return { firstName: parts[0], lastName: parts[parts.length - 1] };
  }

  /**
   * Pull the employer out of a headline such as "Senior Recruiter at Acme Corp".
   *
   * Returns '' when the headline has no "at" clause. A headline on its own is
   * not evidence of where someone works, and a wrong employer produces an
   * address on the wrong domain entirely.
   */
  function companyFromHeadline(headline) {
    if (typeof headline !== 'string') return '';

    const match = headline.match(/\bat\s+(.+)$/i);
    if (!match) return '';

    return match[1]
      .split('|')[0]
      .split('·')[0]
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Reduce any LinkedIn profile href to its canonical /in/<slug> form. */
  function normaliseProfileUrl(href, origin) {
    if (typeof href !== 'string' || !href) return '';
    try {
      const url = new URL(href, origin || 'https://www.linkedin.com');
      const match = url.pathname.match(/\/in\/([^/]+)/);
      return match ? `https://www.linkedin.com/in/${decodeURIComponent(match[1])}` : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Read a connection or follower count out of its label.
   * Returns null when there is no number to read — never a zero standing in
   * for "unknown".
   */
  function parseConnectionCount(label) {
    if (typeof label !== 'string') return null;

    const match = label.replace(/,/g, '').match(/(\d+)(\+)?/);
    if (!match) return null;

    return { count: Number(match[1]), isMinimum: Boolean(match[2]) };
  }

  /** True when a parsed profile carries enough to attempt contact discovery. */
  function isDiscoverable(profile) {
    return Boolean(
      profile &&
      profile.firstName &&
      profile.lastName &&
      profile.company
    );
  }

  /**
   * Collapse whitespace and trim.
   *
   * `innerText` on LinkedIn's markup returns long runs of newlines and
   * non-breaking spaces. Left alone they reach the analyzer's prompt as wasted
   * tokens and make the fenced data block harder to read.
   */
  function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    const collapsed = value.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    return typeof maxLength === 'number' ? collapsed.slice(0, maxLength) : collapsed;
  }

  /**
   * First matching element's text, across a list of candidate selectors.
   *
   * The parser was a chain of `document.querySelector('.a')?.innerText.trim() ||
   * document.querySelector('.b')?.innerText.trim() || ''` — which reads as
   * tolerant and is not: `?.innerText.trim()` throws when `innerText` is
   * undefined, which happens for SVG and some custom elements. One such element
   * matching an early selector took down the whole parse and returned null for
   * the entire profile.
   *
   * LinkedIn's utility class names churn, so taking a list and using the first
   * that yields text is what survives a layout change rather than a selector
   * that happens to be right today.
   */
  function textFrom(root, selectors, maxLength) {
    if (!root || typeof root.querySelector !== 'function') return '';
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      let el = null;
      try {
        el = root.querySelector(selector);
      } catch (_) {
        continue; // an invalid selector must not end the parse
      }
      if (!el) continue;
      const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent;
      const text = cleanText(raw, maxLength);
      if (text) return text;
    }
    return '';
  }

  /** `querySelectorAll` as a real array, never throwing on a bad selector. */
  function allFrom(root, selectors) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of list) {
      try {
        const found = root.querySelectorAll(selector);
        if (found && found.length) return Array.from(found);
      } catch (_) {
        continue;
      }
    }
    return [];
  }

  /**
   * An https image URL, or ''.
   *
   * These are read straight off the page and end up in an `img src` and a
   * database row. A `data:` or `javascript:` value has no business in either.
   */
  function imageUrl(el) {
    if (!el || typeof el.src !== 'string') return '';
    try {
      const parsed = new URL(el.src, 'https://www.linkedin.com');
      return parsed.protocol === 'https:' ? parsed.toString() : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Drop duplicate roles.
   *
   * LinkedIn renders grouped positions (several roles at one employer) inside the
   * same list item as the ungrouped layout uses, so the old parser pushed both
   * the group's child roles AND a parent entry, and a promotion history appeared
   * twice. Keyed on title+company+dates rather than object identity, because the
   * duplicates are separate objects with equal content.
   */
  function dedupeEntries(entries, keyFields) {
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
      if (!entry) continue;
      const key = keyFields
        .map((f) => cleanText(String(entry[f] || '')).toLowerCase())
        .join('|');
      if (key === keyFields.map(() => '').join('|')) continue; // entirely empty
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
    return out;
  }

  /** Split "Jan 2020 - Present · 2 yrs" into its range and duration halves. */
  function splitDateCaption(caption) {
    const text = cleanText(caption);
    if (!text) return { dateRange: '', duration: '' };
    const parts = text.split('·').map((p) => cleanText(p));
    return { dateRange: parts[0] || '', duration: parts[1] || '' };
  }

  const helpers = {
    splitName,
    companyFromHeadline,
    normaliseProfileUrl,
    parseConnectionCount,
    isDiscoverable,
    cleanText,
    textFrom,
    allFrom,
    imageUrl,
    dedupeEntries,
    splitDateCaption,
  };

  root.AIJobSearchParseHelpers = helpers;

  // Also expose for Node, so the test suite can load this file directly.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
