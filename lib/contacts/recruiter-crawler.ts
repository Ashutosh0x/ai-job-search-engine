import { parseRobots, robotsDecision, type RobotsPolicy } from '../sources/robots';

/**
 * Recruiter contact discovery by bounded, prioritised crawling.
 *
 * WHY THIS REPLACES THE FIXED-PATH SCRAPER
 * ========================================
 * `scrapeCareersPage` tries five hardcoded paths — /careers, /jobs,
 * /about/team, /contact, /careers/contact — and stops. Measured over the
 * 387-company registry it produced a recruiting inbox for 29 of them (7.5%)
 * and 34 addresses in total.
 *
 * Measured on an 8-domain sample, the reason is arithmetic rather than subtle:
 *
 *   fixed paths that actually resolve   17 of 40   (57% of guesses 404)
 *   domains publishing a sitemap         6 of 8
 *   URLs advertised in those sitemaps    23,052
 *   on-site links from one /careers page 93 (Stripe), 97 (Elastic)
 *
 * The engine was reading at most five URLs per company while the companies
 * themselves advertised tens of thousands. Recall was bounded by the guess
 * list, not by what is published.
 *
 * WHAT THIS DOES INSTEAD
 * ======================
 *   1. Discover URLs from robots.txt, sitemap indexes, the fixed paths, and
 *      links found on pages already fetched.
 *   2. Score every URL for recruiter relevance and crawl the best first.
 *   3. Extract addresses WITH their surrounding context.
 *   4. Classify each address, using that context, as a recruiting mailbox or
 *      not — and keep the evidence for why.
 *
 * Every limit is explicit and low by default. This reads other people's
 * websites; `maxPages`, `maxDepth`, `requestsPerMinute` and `concurrency` are
 * the contract that keeps it a polite crawler rather than a load test.
 */

const UA = 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0; +recruiter-contact-discovery)';

export interface CrawlLimits {
  maxPages: number;
  maxDepth: number;
  requestsPerMinute: number;
  concurrency: number;
  /** Bytes; a page larger than this is almost never a contact page. */
  maxBytes: number;
  timeoutMs: number;
}

export const DEFAULT_LIMITS: CrawlLimits = {
  maxPages: 40,
  maxDepth: 3,
  requestsPerMinute: 60,
  concurrency: 3,
  maxBytes: 3_000_000,
  timeoutMs: 15_000,
};

/* ------------------------------------------------------------------ */
/* URL relevance                                                       */
/* ------------------------------------------------------------------ */

/**
 * How likely a URL is to carry a recruiting contact.
 *
 * Used to order the queue, so a 40-page budget is spent on
 * /careers/contact-us rather than /blog/2019/some-post. Tuned so that a page
 * naming BOTH a recruiting concept and a contact concept outranks either alone
 * — those are where published inboxes actually live.
 */
const URL_SIGNALS: [RegExp, number][] = [
  [/recruit(ing|ment)?/i, 10],
  [/talent[-_/]?acquisition/i, 10],
  [/\btalent\b/i, 8],
  [/careers?/i, 8],
  [/university|campus|graduate|early[-_]?career|intern/i, 8],
  [/\bjobs?\b/i, 6],
  [/hiring|join[-_]?us|work[-_]?(with|for)[-_]?us/i, 6],
  [/contact/i, 5],
  [/\bteam\b|\bpeople\b|leadership/i, 4],
  [/about/i, 3],
  [/\bhr\b|human[-_]?resources/i, 5],
];

/** Paths that cost budget and never carry a recruiting inbox. */
const URL_PENALTIES: [RegExp, number][] = [
  [/\/blog\/|\/news\/|\/press\/|\/events?\//i, -6],
  [/\/(privacy|legal|terms|cookie|security|patents?)\b/i, -8],
  [/\/(login|signin|signup|register|cart|checkout)\b/i, -10],
  [/\.(jpg|jpeg|png|gif|svg|webp|css|js|zip|mp4|ico|woff2?)$/i, -100],
  [/\/(product|pricing|docs?|documentation|api|support|help)\//i, -4],
  [/\/\d{4}\/\d{2}\//, -5],  // dated archives
];

export function scoreUrl(url: string): number {
  let score = 0;
  const path = url.toLowerCase();
  for (const [re, pts] of URL_SIGNALS) if (re.test(path)) score += pts;
  for (const [re, pts] of URL_PENALTIES) if (re.test(path)) score += pts;
  // Shallow pages are more likely to be the canonical contact page.
  const depth = (url.match(/\//g) ?? []).length - 2;
  return score - Math.max(0, depth - 2);
}

/* ------------------------------------------------------------------ */
/* Email extraction with context                                       */
/* ------------------------------------------------------------------ */

export interface EmailEvidence {
  email: string;
  sourceUrl: string;
  sourceType: 'mailto' | 'text' | 'jsonld' | 'obfuscated';
  /** Text immediately around the address; what classification reads. */
  context: string;
  personName?: string;
  /** Split components, so callers never re-parse the joined string. */
  firstName?: string;
  lastName?: string;
  personTitle?: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Undo the common ways a site hides an address from naive scrapers.
 *
 * These are published addresses written for humans — "jobs [at] acme [dot]
 * com" is an invitation to write, not an access control. Anything still
 * obfuscated after this simply is not extracted.
 */
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*\[\s*at\s*\]\s*|\s*\(\s*at\s*\)\s*|\s+at\s+(?=[a-z0-9.-]+\s*(\[|\()?\s*dot)/gi, '@')
    .replace(/\s*\[\s*dot\s*\]\s*|\s*\(\s*dot\s*\)\s*|\s+dot\s+/gi, '.')
    .replace(/&#64;|&#x40;/gi, '@')
    .replace(/&#46;|&#x2e;/gi, '.');
}

/** Strip markup to readable text, keeping enough structure for context. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Titles that mark the person beside an address as a recruiter.
 *
 * Each alternative ends at a word boundary so the captured string is a whole
 * title. Without the trailing `\w*`, "Senior Technical Recruiter" captured as
 * "Technical Recruit" — a title nobody holds, shown to the reader as evidence.
 */
const RECRUITER_TITLE = new RegExp([
  '(?:senior|lead|principal|staff|head\\s+of|global|regional)?\\s*technical\\s+recruit\\w*',
  '(?:campus|university|executive|corporate|technical)\\s+recruit\\w*',
  'recruit(?:er|ing|ment)\\w*',
  'talent\\s+(?:acquisition|partner|sourcer|management)\\w*',
  'executive\\s+search',
  'early\\s+(?:careers?|talent)',
  'sourcer', 'staffing\\s+\\w+',
  'people\\s+(?:operations|partner)',
  'human\\s+resources', '\\bhr\\b',
  'hiring\\s+(?:manager|partner|lead)',
].join('|'), 'i');

const PERSON_NAME = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b/;

/**
 * Words that appear in job titles and therefore never in a name we accept.
 *
 * A title sits between the name and the address in the usual
 * "Name / Title / email" block, so a nearest-match search reaches the TITLE
 * first. Without this, "Jane Smith / Senior Technical Recruiter" yields a
 * recruiter named "Senior Technical".
 */
const TITLE_WORD = /^(senior|junior|lead|principal|staff|head|chief|director|manager|associate|assistant|global|regional|technical|executive|campus|university|corporate|talent|people|human|hiring|recruiting|recruiter|recruitment|sourcer|specialist|partner|coordinator|consultant|officer|vice|president|team|group|early|graduate|intern|program|programme|operations|acquisition)$/i;

/**
 * Capitalised word pairs that are not people.
 *
 * `PERSON_NAME` matches any two capitalised words, and careers pages are full
 * of them — "Equal Opportunity", "United States", "Talent Acquisition",
 * "Privacy Policy". Treating those as recruiter identities produces a named
 * person who does not exist, attached to a real address.
 */
const NOT_A_PERSON = new RegExp([
  'equal\\s+(opportunity|employment)', 'privacy\\s+policy', 'cookie\\s+policy',
  'terms\\s+(of|and)', 'united\\s+(states|kingdom)', 'new\\s+york', 'san\\s+francisco',
  'talent\\s+acquisition', 'human\\s+resources', 'people\\s+operations',
  'learn\\s+more', 'read\\s+more', 'apply\\s+now', 'view\\s+all', 'contact\\s+us',
  'job\\s+(title|alert|description)', 'full\\s+time', 'part\\s+time',
  'our\\s+(team|people|mission|values)', 'the\\s+\\w+', 'this\\s+\\w+',
  'all\\s+rights', 'sign\\s+(in|up)', 'get\\s+started', 'email\\s+address',
].join('|'), 'i');

/**
 * A first/last name pair from the text before an address, or null.
 *
 * Returns null rather than a guess. A wrong name is worse than no name: it
 * asserts an identity the page never stated, and the directory presents named
 * people as evidence-backed.
 */
export function extractPersonName(before: string): { first: string; last: string } | null {
  const tail = before.slice(-200);
  // Nearest-first: the name usually sits directly above the address. But the
  // TITLE sits between them, and "Senior Technical" is a capitalised pair too
  // — taking the nearest match blindly yields a recruiter called
  // "Senior Technical".
  const candidates = [...tail.matchAll(new RegExp(PERSON_NAME.source, 'g'))].reverse();

  for (const m of candidates) {
    const full = `${m[1]} ${m[2]}`;
    if (NOT_A_PERSON.test(full)) continue;
    if (RECRUITER_TITLE.test(full)) continue;
    // Either word being a job-title word disqualifies the pair. A person can
    // be called Grace or Wells; nobody is called "Senior Technical".
    if (TITLE_WORD.test(m[1]) || TITLE_WORD.test(m[2])) continue;
    return { first: m[1], last: m[2] };
  }
  return null;
}

/**
 * Pull addresses out of one page, each with the text around it.
 *
 * Context is the whole point. "For security questions contact
 * security@acme.com" and a name-title-email block are both just an address to
 * a regex; only the surrounding words separate them.
 */
export function extractEmails(html: string, sourceUrl: string): EmailEvidence[] {
  const found = new Map<string, EmailEvidence>();

  /**
   * `before` and `after` are passed separately rather than recovered by
   * splitting a combined window on the address.
   *
   * Splitting fails whenever the address does not appear literally in the
   * window — a mailto href survives markup stripping differently from the link
   * text — and the split then returns the WHOLE window as "before". The name
   * search ran past the address into whatever followed, so
   * "…Email Jane</a></div><footer>For security…" produced a recruiter called
   * "Jane For", and every address on the page inherited the same name.
   */
  const add = (
    raw: string,
    sourceType: EmailEvidence['sourceType'],
    before: string,
    after: string
  ) => {
    const email = raw.toLowerCase().trim().replace(/^mailto:/, '').split('?')[0];
    if (!EMAIL_RE.test(email)) { EMAIL_RE.lastIndex = 0; return; }
    EMAIL_RE.lastIndex = 0;
    if (found.has(email)) return;

    // A title may sit before the address ("Jane / Recruiter / email") or just
    // after it; a name only ever precedes it.
    const titleMatch = `${before} ${after}`.match(RECRUITER_TITLE);
    const name = extractPersonName(before);

    found.set(email, {
      email,
      sourceUrl,
      sourceType,
      context: `${before} ${email} ${after}`.replace(/\s+/g, ' ').trim().slice(0, 600),
      personName: name ? `${name.first} ${name.last}` : undefined,
      firstName: name?.first,
      lastName: name?.last,
      personTitle: titleMatch ? titleMatch[0].trim() : undefined,
    });
  };

  // mailto: links carry the strongest intent — someone meant this to be written to.
  for (const m of html.matchAll(/href=["']mailto:([^"'?]+)/gi)) {
    const idx = m.index ?? 0;
    add(
      m[1], 'mailto',
      toText(html.slice(Math.max(0, idx - 500), idx)),
      toText(html.slice(idx + m[0].length, idx + m[0].length + 200))
    );
  }

  // JSON-LD often carries an organisation's contactPoint.
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const e of m[1].matchAll(EMAIL_RE)) {
      const i = e.index ?? 0;
      add(e[0], 'jsonld', m[1].slice(Math.max(0, i - 300), i), m[1].slice(i + e[0].length, i + 200));
    }
  }

  const text = toText(html);
  for (const m of text.matchAll(EMAIL_RE)) {
    const idx = m.index ?? 0;
    add(m[0], 'text', text.slice(Math.max(0, idx - 300), idx), text.slice(idx + m[0].length, idx + m[0].length + 200));
  }

  const deob = deobfuscate(text);
  if (deob !== text) {
    for (const m of deob.matchAll(EMAIL_RE)) {
      const idx = m.index ?? 0;
      add(m[0], 'obfuscated', deob.slice(Math.max(0, idx - 300), idx), deob.slice(idx + m[0].length, idx + m[0].length + 200));
    }
  }

  return [...found.values()];
}

/* ------------------------------------------------------------------ */
/* Recruiter classification                                            */
/* ------------------------------------------------------------------ */

const RECRUITING_LOCAL = /^(careers?|recruit(ing|ment)?|hiring|talent|jobs?|campus|apply|applications?|university|graduate|grad|internships?|hr|employment|people|joinus|join|work|employee[._-]?verification)/i;

/**
 * Mailboxes that exist on every corporate domain and never take applications.
 * Matching the domain is not evidence of anything on its own.
 */
const NON_RECRUITING_LOCAL = /^(security|abuse|privacy|legal|press|media|pr|support|help|sales|billing|accounts?|info|contact|hello|admin|dmarc|postmaster|webmaster|noreply|no-reply|donotreply|marketing|newsletter|subscribe|investor|ir|partners?|vendor|procurement)\b/i;

/**
 * Candidate-support mailboxes that sit on recruiting pages but are not
 * recruiting contacts.
 *
 * `candidate_accessibility@elastic.co` and `accommodations@stripe.com` are
 * disability-accommodation and application-feedback addresses. They live on
 * careers pages, surrounded by recruiting language, and writing to them about
 * a job helps nobody — the accessibility team cannot progress an application.
 *
 * The first of these was accepted by the earlier scoring because page and
 * context signals alone cleared the threshold without the local part ever
 * naming a recruiting function.
 */
const CANDIDATE_SUPPORT_LOCAL =
  /^(candidate[._-]?(accessibility|support|feedback|care|experience)|accommodations?|accessibility|applicant[._-]?(support|accommodation)|disability|ada[._-]?request)/i;

export interface RecruiterScore {
  score: number;
  isRecruiting: boolean;
  reasons: string[];
}

/**
 * Decide whether an address is a recruiting contact, and record why.
 *
 * The reasons are not decoration: they are what lets the directory answer
 * "why do we believe this" instead of presenting a bare number.
 */
export function scoreRecruiterRelevance(ev: EmailEvidence, companyDomain: string): RecruiterScore {
  const reasons: string[] = [];
  let score = 0;

  const [local, host] = ev.email.split('@');

  if (NON_RECRUITING_LOCAL.test(local)) {
    return {
      score: -40,
      isRecruiting: false,
      reasons: [`"${local}@" is a generic corporate mailbox, not a recruiting one`],
    };
  }

  if (CANDIDATE_SUPPORT_LOCAL.test(local)) {
    return {
      score: -30,
      isRecruiting: false,
      reasons: [`"${local}@" is candidate support (accessibility/feedback), not a recruiting contact`],
    };
  }

  const localIsRecruiting = RECRUITING_LOCAL.test(local);
  if (localIsRecruiting) {
    score += 40;
    reasons.push(`local part "${local}" names a recruiting function`);
  }

  if (ev.personTitle) {
    score += 30;
    reasons.push(`published beside the title "${ev.personTitle}"`);
  }

  if (ev.personName && ev.personTitle) {
    score += 15;
    reasons.push(`attributed to ${ev.personName}`);
  }

  // Context matters most where the local part is neutral.
  if (RECRUITER_TITLE.test(ev.context)) {
    score += 15;
    reasons.push('recruiting language surrounds the address on the page');
  }

  const base = companyDomain.toLowerCase().replace(/^www\./, '');
  const h = (host ?? '').replace(/^www\./, '');
  if (h === base || h.endsWith(`.${base}`)) {
    score += 15;
    reasons.push('on the company domain');
  } else {
    score -= 30;
    reasons.push(`on ${h}, not ${base}`);
  }

  if (scoreUrl(ev.sourceUrl) >= 8) {
    score += 10;
    reasons.push('found on a recruiting-relevant page');
  }

  if (ev.sourceType === 'mailto') {
    score += 10;
    reasons.push('published as a mailto link');
  }

  /**
   * Precision gate: page context alone may NOT admit an address.
   *
   * An address qualifies only if the mailbox itself names a recruiting
   * function, or a named person with a recruiter title is published beside it.
   * Surrounding words are corroboration, never the sole basis — every page on
   * a careers site is full of recruiting language, so context-only scoring
   * admits whatever mailbox happens to appear there. That is exactly how
   * `candidate_accessibility@elastic.co` was accepted.
   */
  const hasNamedRecruiter = Boolean(ev.personName && ev.personTitle);
  const admissible = localIsRecruiting || hasNamedRecruiter;

  if (!admissible && score >= 40) {
    reasons.push('rejected: only page context suggested recruiting, and neither the mailbox nor a named recruiter confirmed it');
  }

  return { score, isRecruiting: admissible && score >= 40, reasons };
}

/* ------------------------------------------------------------------ */
/* The crawl                                                           */
/* ------------------------------------------------------------------ */

interface Task { url: string; depth: number; priority: number }

export interface CrawlResult {
  domain: string;
  pagesCrawled: number;
  pagesSkipped: number;
  urlsDiscovered: number;
  recruiting: (EmailEvidence & { recruiterScore: RecruiterScore })[];
  other: (EmailEvidence & { recruiterScore: RecruiterScore })[];
  robotsBlocked: number;
  errors: string[];
  elapsedMs: number;
}

/** Fixed seeds, kept because they are right often enough to be worth one try. */
const SEED_PATHS = [
  '/careers', '/careers/contact', '/jobs', '/join-us', '/work-with-us',
  '/about/team', '/contact', '/talent', '/recruiting', '/university',
  '/campus', '/early-careers', '/people',
];

function normaliseUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    // Tracking parameters create infinite distinct URLs for one page.
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function sameSite(url: string, domain: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const base = domain.toLowerCase().replace(/^www\./, '');
    return h === base || h.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

/** Sitemap indexes nest; follow them, but not forever. */
async function collectSitemapUrls(
  domain: string,
  fetchText: (u: string) => Promise<string | null>,
  cap = 3000
): Promise<string[]> {
  const out = new Set<string>();
  const queue = [`https://www.${domain}/sitemap.xml`, `https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap_index.xml`];
  const seen = new Set<string>();

  while (queue.length && out.size < cap) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    if (seen.size > 12) break;   // bound the index fan-out

    const xml = await fetchText(sm);
    if (!xml || !xml.includes('<loc>')) continue;

    const isIndex = /<sitemapindex/i.test(xml);
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = m[1].trim();
      if (isIndex) {
        // Only follow child sitemaps that look relevant; a 13k-URL blog
        // sitemap costs a request and yields nothing.
        if (scoreUrl(loc) > 0 || /sitemap/i.test(loc)) queue.push(loc);
      } else if (out.size < cap) {
        out.add(loc);
      }
    }
  }
  return [...out];
}

export async function crawlForRecruiterContacts(
  domain: string,
  limits: Partial<CrawlLimits> = {}
): Promise<CrawlResult> {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  const started = Date.now();

  const result: CrawlResult = {
    domain, pagesCrawled: 0, pagesSkipped: 0, urlsDiscovered: 0,
    recruiting: [], other: [], robotsBlocked: 0, errors: [], elapsedMs: 0,
  };

  const minGapMs = Math.ceil(60_000 / Math.max(1, cfg.requestsPerMinute));
  let lastRequestAt = 0;

  async function pace() {
    const wait = lastRequestAt + minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  }

  async function fetchText(url: string): Promise<string | null> {
    await pace();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml' },
        redirect: 'follow',
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      if (!res.ok) return null;

      const type = res.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xml|text\/xml|text\/plain/.test(type)) return null;

      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > cfg.maxBytes) return null;

      const body = await res.text();
      return body.length > cfg.maxBytes ? body.slice(0, cfg.maxBytes) : body;
    } catch (err) {
      result.errors.push(`${url}: ${err instanceof Error ? err.message : 'fetch failed'}`);
      return null;
    }
  }

  // robots.txt first: it states the policy AND advertises sitemaps.
  let policy: RobotsPolicy | null = null;
  const robotsTxt = await fetchText(`https://www.${domain}/robots.txt`)
    ?? await fetchText(`https://${domain}/robots.txt`);
  if (robotsTxt) {
    try { policy = parseRobots(robotsTxt, 'AIJobSearchBot'); } catch { policy = null; }
  }

  const allowed = (url: string) => {
    if (!policy) return true;          // no stated policy
    try { return robotsDecision(policy, url).allowed; } catch { return true; }
  };

  /* ---- Build the frontier ---- */

  const queue: Task[] = [];
  const queued = new Set<string>();

  const push = (rawUrl: string, depth: number) => {
    const url = normaliseUrl(rawUrl, `https://${domain}`);
    if (!url || queued.has(url) || !sameSite(url, domain)) return;
    const priority = scoreUrl(url);
    if (priority <= -10) return;       // assets and dead ends
    queued.add(url);
    queue.push({ url, depth, priority });
    result.urlsDiscovered++;
  };

  for (const p of SEED_PATHS) push(`https://www.${domain}${p}`, 0);

  // Sitemaps are the big win: they enumerate what the fixed paths only guess at.
  for (const loc of await collectSitemapUrls(domain, fetchText)) {
    if (scoreUrl(loc) >= 5) push(loc, 1);
  }

  /* ---- Crawl, best-first ---- */

  const seenEmails = new Map<string, EmailEvidence & { recruiterScore: RecruiterScore }>();

  while (queue.length > 0 && result.pagesCrawled < cfg.maxPages) {
    queue.sort((a, b) => b.priority - a.priority);
    const task = queue.shift()!;

    if (!allowed(task.url)) { result.robotsBlocked++; continue; }

    const html = await fetchText(task.url);
    if (!html) { result.pagesSkipped++; continue; }
    result.pagesCrawled++;

    for (const ev of extractEmails(html, task.url)) {
      const recruiterScore = scoreRecruiterRelevance(ev, domain);
      const existing = seenEmails.get(ev.email);
      // Keep the strongest evidence for a repeated address.
      if (!existing || recruiterScore.score > existing.recruiterScore.score) {
        seenEmails.set(ev.email, { ...ev, recruiterScore });
      }
    }

    // Follow links only while there is depth and budget left.
    if (task.depth < cfg.maxDepth) {
      for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
        push(m[1], task.depth + 1);
      }
    }
  }

  for (const ev of seenEmails.values()) {
    (ev.recruiterScore.isRecruiting ? result.recruiting : result.other).push(ev);
  }
  result.recruiting.sort((a, b) => b.recruiterScore.score - a.recruiterScore.score);
  result.other.sort((a, b) => b.recruiterScore.score - a.recruiterScore.score);

  result.elapsedMs = Date.now() - started;
  return result;
}
