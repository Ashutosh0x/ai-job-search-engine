import { readFile } from 'fs/promises';
import path from 'path';
import { EmailPattern } from './types';
import { discoverPatterns } from './email-patterns';

/**
 * Where a company's address pattern comes from when discovering one person.
 *
 * The daily crawl (scripts/build-recruiter-directory.mjs) already resolves and
 * verifies each company's GitHub organisation and counts its public commit
 * authors. Reading that committed result is both instant and far more accurate
 * than a live lookup at request time, because:
 *
 *   - GitHub's commit search allows 10 requests/minute unauthenticated, so a
 *     live call during a profile visit is usually rate-limited into returning
 *     nothing at all;
 *   - the crawl can afford to verify the org against the company's website,
 *     which is what stops another org's addresses being attributed here.
 *
 * Live mining stays as the fallback for a company the crawl has not reached.
 */

interface DirectoryPattern {
  pattern: string;
  share: number;
  sampleSize: number;
}

interface DirectoryEntry {
  domain: string;
  emailPattern: { domain: string; patterns: DirectoryPattern[] } | null;
}

let cache: { byDomain: Map<string, DirectoryEntry>; loadedAt: number } | null = null;
const TTL_MS = 5 * 60_000;

async function loadDirectory(): Promise<Map<string, DirectoryEntry>> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.byDomain;

  const byDomain = new Map<string, DirectoryEntry>();
  try {
    const file = path.join(process.cwd(), 'public', 'data', 'recruiter-directory.json');
    const doc = JSON.parse(await readFile(file, 'utf8'));
    for (const entry of Object.values(doc.companies ?? {}) as DirectoryEntry[]) {
      if (entry?.domain) byDomain.set(entry.domain.toLowerCase(), entry);
    }
  } catch {
    // No directory committed yet. Live mining below still applies.
  }

  cache = { byDomain, loadedAt: Date.now() };
  return byDomain;
}

export interface PatternLookup {
  patterns: EmailPattern[];
  /** `directory` when it came from the daily crawl, `live` from a request-time lookup. */
  origin: 'directory' | 'live' | 'none';
}

/**
 * The observed patterns for a domain, preferring the daily crawl's result.
 *
 * Returns an empty list with origin `none` when nothing has been observed —
 * never a default pattern. A caller with no pattern should say it cannot infer
 * an address, not infer one from a guess.
 */
export async function getObservedPatterns(domain: string): Promise<PatternLookup> {
  const normalized = domain.toLowerCase();
  const directory = await loadDirectory();
  const entry = directory.get(normalized);

  if (entry?.emailPattern?.patterns?.length) {
    const now = new Date();
    return {
      origin: 'directory',
      patterns: entry.emailPattern.patterns.map((p) => ({
        pattern: p.pattern,
        domain: entry.emailPattern!.domain,
        confidence: p.share,
        sampleSize: p.sampleSize,
        sampleEmails: [],
        sources: ['github'],
        createdAt: now,
        updatedAt: now,
      })),
    };
  }

  const live = await discoverPatterns(normalized);
  return { patterns: live, origin: live.length > 0 ? 'live' : 'none' };
}
