import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * The recruiter directory, as built by the daily crawl.
 *
 * Serves public/data/recruiter-directory.json — the artefact
 * scripts/build-recruiter-directory.mjs commits and
 * scripts/verify-recruiter-directory.mjs gates. Reading the committed file
 * rather than crawling per request is what keeps the page fast and keeps
 * employer sites from being hit once per visitor.
 */

export interface DirectoryRecruiter {
  fullName: string;
  title: string | null;
  department: string | null;
  identityStatus: string;
  emailStatus: string;
  linkedinUrl: string | null;
  sourceUrls: string[];
}

export interface DirectoryEntry {
  slug: string;
  name: string;
  domain: string;
  logoUrl: string;
  recruiters: DirectoryRecruiter[];
  recruiterCount: number;
  publishedContacts: { address: string; kind: string; evidence: string; onCompanyDomain?: boolean }[];
  publicRecords?: { address: string; kind: string; evidence: string }[];
  emailPattern: { domain: string; patterns: { pattern: string; share: number; sampleSize: number }[] } | null;
  mailPosture: { hasMx: boolean; mx: string[]; hasSpf: boolean; dmarcPolicy: string | null } | null;
  reachability: 'direct' | 'named' | 'pattern' | 'ats-only';
  atsOnly: boolean;
  crawledAt: string | null;
}

interface Directory {
  generatedAt: string;
  method: string;
  notCollected: string[];
  summary: Record<string, unknown>;
  companies: Record<string, DirectoryEntry>;
}

let cache: { doc: Directory; loadedAt: number } | null = null;
const TTL_MS = 5 * 60_000;

async function load(): Promise<Directory | null> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.doc;
  try {
    const file = path.join(process.cwd(), 'public', 'data', 'recruiter-directory.json');
    const doc = JSON.parse(await readFile(file, 'utf8')) as Directory;
    cache = { doc, loadedAt: Date.now() };
    return doc;
  } catch {
    // The directory has never been built, or the build was not committed.
    // Say so rather than serving an empty one that reads like "no recruiters".
    return null;
  }
}

export async function GET(req: NextRequest) {
  const doc = await load();
  if (!doc) {
    return NextResponse.json(
      { error: 'The recruiter directory has not been built yet. Run scripts/build-recruiter-directory.mjs.' },
      { status: 503 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const slug = sp.get('slug');

  if (slug) {
    const entry = doc.companies[slug];
    if (!entry) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    return NextResponse.json({ generatedAt: doc.generatedAt, company: entry });
  }

  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const reach = sp.get('reachability') ?? 'all';
  const page = Math.max(1, Number(sp.get('page') ?? '1'));
  const perPage = Math.min(60, Math.max(1, Number(sp.get('perPage') ?? '24')));

  let entries = Object.values(doc.companies);

  if (q) {
    entries = entries.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.domain.includes(q) ||
      e.recruiters.some((r) => r.fullName.toLowerCase().includes(q) || (r.title ?? '').toLowerCase().includes(q))
    );
  }

  if (reach !== 'all') {
    entries = entries.filter((e) => e.reachability === reach);
  }

  // Most contactable first: a published mailbox beats a named person beats a
  // pattern. Within a tier, more evidence first.
  const rank: Record<string, number> = { direct: 0, named: 1, pattern: 2, 'ats-only': 3 };
  entries.sort((a, b) =>
    (rank[a.reachability] - rank[b.reachability]) ||
    (b.publishedContacts.length - a.publishedContacts.length) ||
    (b.recruiterCount - a.recruiterCount) ||
    a.name.localeCompare(b.name)
  );

  const total = entries.length;
  const start = (page - 1) * perPage;

  return NextResponse.json({
    generatedAt: doc.generatedAt,
    method: doc.method,
    notCollected: doc.notCollected,
    summary: doc.summary,
    total,
    page,
    perPage,
    hasMore: start + perPage < total,
    facets: {
      direct: Object.values(doc.companies).filter((e) => e.reachability === 'direct').length,
      named: Object.values(doc.companies).filter((e) => e.reachability === 'named').length,
      pattern: Object.values(doc.companies).filter((e) => e.reachability === 'pattern').length,
      'ats-only': Object.values(doc.companies).filter((e) => e.reachability === 'ats-only').length,
    },
    companies: entries.slice(start, start + perPage),
  });
}
