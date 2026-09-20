import { mineDomainAuthors } from './github';

/**
 * Commit-author addresses on a company's domain, from its GitHub organisation.
 *
 * This used to query `author-email:@<domain>` directly. Measured against the
 * live API that returns zero results for every domain — `author-email:` matches
 * a complete address, never a suffix — and GitHub rejects qualifier-only commit
 * searches outright. It returned HTTP 200 with an empty list, so the source
 * looked healthy while contributing nothing. See lib/contacts/github.ts.
 */
export async function scrapeGitHubEmails(domain: string): Promise<{ email: string, name: string, source: string }[]> {
  const { authors } = await mineDomainAuthors(domain);
  return authors.map((a) => ({ email: a.email, name: a.name, source: 'github' }));
}

export interface CareersAddress {
  email: string;
  /** `careers-role` for a recruiting mailbox, `other` for anything else found. */
  source: string;
  /** False when published on a corporate alternate domain (jobs@wdc.com). */
  onCompanyDomain: boolean;
}

/**
 * Local-parts that indicate a recruiting mailbox.
 *
 * Anchored at the start and allowed to continue into a separator or a word, so
 * `talentacquisition@`, `talent-acquisition@` and `campusrecruiting@` all
 * match. The previous check was `startsWith('talent@')`, which matched none of
 * them.
 */
const RECRUITING_LOCAL =
  /^(careers?|recruit(ing|ment)?|hiring|talent|jobs?|campus|apply|applications?|university|graduate|grad|internships?|hr|employment|employee[._-]?verification)/i;

/** Artefacts of reading addresses out of encoded markup rather than real mail. */
const ENCODING_ARTEFACT = /^(%[0-9a-f]{2}|u00[0-9a-f]{2}|x[0-9a-f]{2}|amp|quot|lt|gt|nbsp)/i;

/**
 * File names that an email regex cannot tell from an address.
 *
 * A retina asset in a srcset — `career-hero@2x.webp`, and NVIDIA's
 * `career-home-web-explore-life-1024-t-v4@2x.jpg` — has the exact shape of
 * `local@domain.tld`, and because those file names begin with "career" they
 * sailed through the recruiting filter and were published as contact
 * addresses. The `@Nx` density suffix and the asset extension are each
 * sufficient on their own to rule an address out.
 */
const ASSET_EXTENSION =
  /\.(webp|jpe?g|png|gif|svg|avif|ico|bmp|tiff?|css|js|mjs|json|html?|xml|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz)$/i;
const DENSITY_SUFFIX = /^\d+(\.\d+)?x$/i;

/** True when a regex match is a file name rather than a mailbox. */
function looksLikeAsset(host: string): boolean {
  if (ASSET_EXTENSION.test(host)) return true;
  // `@2x.webp` splits to a host of "2x.webp"; also catches a bare "@3x".
  return DENSITY_SUFFIX.test(host.split('.')[0]);
}

/**
 * Scrape a company's careers and contact pages for published recruiting addresses.
 *
 * Measured across the 273-company registry, the previous version returned 182
 * addresses of which only 21 (11.5%) were recruiting-related: it kept any
 * address on the company's domain, so press@, sales-uki@, webmaster@ and
 * privacy@ all arrived labelled as careers contacts. Seven more were encoding
 * artefacts — `%20accommodations@adobe.com` from a URL-encoded mailto, and
 * `u003einfo@postman.com` from a JSON-escaped `>` — addresses that exist
 * nowhere and bounce if written to.
 *
 * Non-recruiting addresses are still returned, but labelled `other` so callers
 * can keep them out of a recruiting surface rather than having to guess.
 */
export async function scrapeCareersPage(domain: string): Promise<CareersAddress[]> {
  const results: CareersAddress[] = [];
  const paths = ['/careers', '/jobs', '/about/team', '/contact', '/careers/contact'];
  const seenEmails = new Set<string>();
  const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  for (const path of paths) {
    try {
      const url = `https://www.${domain}${path}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIJobSearchBot/1.0)' },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) continue;

      // Decode before matching: an address inside a mailto or a JSON blob is
      // percent- or backslash-escaped, and matching the raw bytes captures the
      // escape as part of the local part.
      const text = decodeMarkup(await response.text());
      const matches = text.match(emailRegex) || [];

      for (const email of matches) {
        const normalized = email.toLowerCase();
        if (seenEmails.has(normalized)) continue;
        seenEmails.add(normalized);

        const [local, host] = normalized.split('@');
        if (ENCODING_ARTEFACT.test(local)) continue;
        if (looksLikeAsset(host)) continue;

        const isRecruiting = RECRUITING_LOCAL.test(local);
        const ownDomain = isOwnDomain(host, domain);

        // Employers routinely publish recruiting mail on a corporate alternate
        // domain: westerndigital.com prints jobs@wdc.com, discord.com prints
        // jobs@discordapp.com, expel.com prints careers@expel.io. Requiring an
        // exact domain match dropped every one of those real addresses.
        //
        // So an off-domain address is kept only when its local part is itself
        // recruiting ("careers@", "campusrecruiting@") and the host is not a
        // known ATS vendor — that pair is narrow enough to exclude the
        // unrelated addresses that also appear on a careers page.
        const offDomainRecruiting = !ownDomain && isRecruiting && !isVendorDomain(host);

        if (!ownDomain && !offDomainRecruiting) continue;

        results.push({
          email: normalized,
          source: isRecruiting ? 'careers-role' : 'other',
          onCompanyDomain: ownDomain,
        });
      }
    } catch (error) {
      // Ignore errors for individual paths (e.g. 404s, timeouts)
    }
  }

  return results;
}

/**
 * Applicant tracking systems and recruiting vendors.
 *
 * A careers page linking to `careers@greenhouse.io` is showing its ATS, not its
 * own mailbox, and attributing that address to the employer would be wrong for
 * every employer using that vendor.
 */
const VENDOR_DOMAINS = new Set([
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workday.com', 'myworkday.com',
  'icims.com', 'smartrecruiters.com', 'workable.com', 'recruitee.com',
  'teamtailor.com', 'jobvite.com', 'bamboohr.com', 'successfactors.com',
  'taleo.net', 'oraclecloud.com', 'eightfold.ai', 'phenompeople.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com',
]);

function registrableHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Whether a host is the company's own domain, or a subdomain of it.
 *
 * Employers routinely run recruiting mail on a subdomain. Duolingo's own
 * careers page states its recruiters write from `@duolingo.com` OR
 * `@recruiting.duolingo.com`; an exact-match check silently discarded every
 * address of the second kind, which is precisely the set a candidate most
 * needs to recognise.
 */
function isOwnDomain(host: string, domain: string): boolean {
  const h = registrableHost(host);
  const d = registrableHost(domain);
  return h === d || h.endsWith(`.${d}`);
}

function isVendorDomain(host: string): boolean {
  const h = registrableHost(host);
  return [...VENDOR_DOMAINS].some((v) => h === v || h.endsWith(`.${v}`));
}

/** Undo the escaping that wraps addresses embedded in HTML attributes and JSON. */
function decodeMarkup(text: string): string {
  return text
    .replace(/\\u0026|&amp;/gi, '&')
    .replace(/\\u003c|&lt;/gi, '<')
    .replace(/\\u003e|&gt;/gi, '>')
    .replace(/\\u0040|&#0*64;|%40/gi, '@')
    .replace(/&#0*46;|%2e/gi, '.')
    .replace(/%20/g, ' ')
    .replace(/\\\//g, '/');
}

export interface PublicProfiles {
  github?: string;
  twitter?: string;
  email?: string;
}

/**
 * Scrape public profiles for a person.
 */
export async function scrapePublicProfiles(name: string, company: string): Promise<PublicProfiles> {
  try {
    const headers: HeadersInit = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'AIJobSearchBot/1.0',
    };
    
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const query = `${name} ${company}`;
    const response = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=1`, { 
      headers,
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      const data = await response.json();
      const item = data.items?.[0];
      if (item) {
        // Fetch detailed profile for email
        const userRes = await fetch(item.url, { headers });
        if (userRes.ok) {
          const userData = await userRes.json();
          return {
            github: item.html_url,
            twitter: userData.twitter_username ? `https://twitter.com/${userData.twitter_username}` : undefined,
            email: userData.email || undefined
          };
        }
        return { github: item.html_url };
      }
    }
  } catch (error) {
    console.error(`Failed to scrape profiles for ${name} at ${company}:`, error);
  }
  
  return {};
}
