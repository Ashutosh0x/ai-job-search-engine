import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { discoverContact } from '@/lib/contacts/enricher';
import { InvalidDomainError, normalizePublicHostname } from '@/lib/contacts/domain';
import { guard } from '@/lib/api-guard';

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  // A plain public hostname only: this route is anonymous, and the domain is
  // turned into server-side fetches (see lib/contacts/domain.ts).
  domain: z
    .string()
    .max(253)
    .refine((d) => normalizePublicHostname(d) !== null, 'domain must be a plain public hostname, e.g. example.com')
    .optional(),
  linkedinUrl: z.string().url().optional(),
});

/**
 * Anonymous by design (lib/contacts/client.ts, chrome-extension/background.js),
 * and each call fans out to several outbound requests (careers pages, GitHub,
 * DNS, RDAP), so it is rate-limited per client. The limiter is per-process --
 * see lib/api-guard.ts for what that does and does not bound.
 */
const DISCOVER_LIMIT = { windowMs: 60_000, max: 10 };

export async function POST(req: NextRequest) {
  const limited = guard(req, 'contacts-discover', DISCOVER_LIMIT);
  if (limited) return limited;

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await discoverContact(parsed.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof InvalidDomainError) {
      // The domain derived from `company` was not a usable hostname.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Discover error:', error);
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}
