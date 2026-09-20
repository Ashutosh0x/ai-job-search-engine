/**
 * GitHub mining for company email patterns.
 *
 * The engine originally queried `search/commits?q=author-email:@<domain>`.
 * Measured against the live API, that returns `total_count: 0` for every
 * domain, and the qualifier-only form is rejected outright:
 *
 *   "Search text is required when searching commits. Searches that use
 *    qualifiers only are not allowed."
 *
 * `author-email:` matches a COMPLETE address, never a domain suffix, so a
 * domain's authors cannot be enumerated with it. The query returned HTTP 200
 * with an empty list, so the failure was silent: pattern discovery fell through
 * to a hardcoded default for every company and nothing reported a problem.
 *
 * What does work is scoping to the company's GitHub organisation and reading
 * the author emails off those commits. That needs a domain -> org mapping, and
 * the mapping has to be VERIFIED: `github.com/apple` is not necessarily Apple
 * Inc, and attributing a stranger's commit emails to a company would invent a
 * naming pattern out of unrelated addresses.
 */

const UA = 'AIJobSearchBot/1.0';

/** Commit search demands free text; this is a term common enough to be neutral. */
const COMMIT_SEARCH_TERM = 'fix';

function headers(preview = false): HeadersInit {
  const h: Record<string, string> = {
    Accept: preview ? 'application/vnd.github.cloak-preview+json' : 'application/vnd.github.v3+json',
    'User-Agent': UA,
  };
  if (process.env.GITHUB_TOKEN) {
    h['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

export interface GitHubOrgMatch {
  login: string;
  /** How the org was tied to the domain. Never assumed. */
  verifiedBy: 'website' | 'email';
}

/** Strip a URL down to a comparable bare host. */
function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Find the GitHub organisation belonging to a domain.
 *
 * Returns null unless the org's own published website or email matches the
 * domain. An unverified guess is treated as no result: a wrong org yields real
 * addresses belonging to the wrong company, which is worse than none.
 */
export async function resolveGitHubOrg(domain: string): Promise<GitHubOrgMatch | null> {
  const candidate = domain.split('.')[0];
  if (!candidate || candidate.length < 2) return null;

  try {
    const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(candidate)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const org = await res.json();
    const target = domain.toLowerCase().replace(/^www\./, '');

    if (hostOf(org.blog) === target) {
      return { login: org.login, verifiedBy: 'website' };
    }
    if (typeof org.email === 'string' && org.email.toLowerCase().endsWith(`@${target}`)) {
      return { login: org.login, verifiedBy: 'email' };
    }

    return null;
  } catch {
    return null;
  }
}

export interface MinedAuthor {
  email: string;
  name: string;
}

/**
 * Collect commit-author addresses on `domain` from a verified org's repos.
 *
 * Returns [] rather than throwing so a rate-limited or missing org reads as
 * "nothing observed" at the call site, which is what it is.
 */
export async function mineOrgAuthors(org: string, domain: string): Promise<MinedAuthor[]> {
  const found = new Map<string, string>();

  try {
    const query = `${COMMIT_SEARCH_TERM} org:${org}`;
    const res = await fetch(
      `https://api.github.com/search/commits?q=${encodeURIComponent(query)}&per_page=100`,
      { headers: headers(true), signal: AbortSignal.timeout(20000) }
    );
    if (!res.ok) return [];

    const data = await res.json();
    const target = domain.toLowerCase();

    for (const item of data.items ?? []) {
      const email = item?.commit?.author?.email;
      const name = item?.commit?.author?.name;
      if (!email || !name) continue;

      const normalized = String(email).toLowerCase();
      if (normalized.includes('noreply')) continue;
      if (!normalized.endsWith(`@${target}`)) continue;

      if (!found.has(normalized)) found.set(normalized, String(name));
    }
  } catch {
    return [];
  }

  return Array.from(found.entries()).map(([email, name]) => ({ email, name }));
}

/** Resolve the org and mine it in one step. */
export async function mineDomainAuthors(domain: string): Promise<{
  org: GitHubOrgMatch | null;
  authors: MinedAuthor[];
}> {
  const org = await resolveGitHubOrg(domain);
  if (!org) return { org: null, authors: [] };
  return { org, authors: await mineOrgAuthors(org.login, domain) };
}
