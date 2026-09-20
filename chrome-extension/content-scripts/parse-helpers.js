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

  const helpers = {
    splitName,
    companyFromHeadline,
    normaliseProfileUrl,
    parseConnectionCount,
    isDiscoverable,
  };

  root.AIJobSearchParseHelpers = helpers;

  // Also expose for Node, so the test suite can load this file directly.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
