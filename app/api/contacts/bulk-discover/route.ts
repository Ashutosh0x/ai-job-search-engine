import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { discoverContact } from '@/lib/contacts/enricher';
import { saveReveal } from '@/lib/contacts/persist';

const profileSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  domain: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
});

const schema = z.object({
  // `.min(1)`: an empty batch is a malformed request, not a batch that found
  // nothing. Without it the route answered 200 with an empty result set, so a
  // caller that built its profile list wrongly got a success it could not
  // distinguish from "none of these people could be discovered".
  profiles: z.array(profileSchema).min(1).max(50),
  /** Persist each result against the signed-in user. Ignored when signed out. */
  save: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { profiles, save } = parsed.data;

    // Only resolve a session when the caller actually asked for persistence.
    let userId: string | null = null;
    let supabase = null;
    if (save) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
      }
      const cookieStore = cookies();
      supabase = createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Cookie: cookieStore.toString() } },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    }

    const limit = 3;
    const results: any[] = [];
    let i = 0;

    const runWorker = async () => {
      while (i < profiles.length) {
        const currentIndex = i++;
        const profile = profiles[currentIndex];
        try {
          const res = await discoverContact(profile);

          let savedId: string | null = null;
          if (supabase && userId) {
            const { data, error } = await saveReveal(supabase, userId, res.contact);
            // A failed write must not be reported as a successful save.
            if (error) throw new Error(error.message ?? 'Failed to save contact');
            savedId = data?.id ?? null;
          }

          results[currentIndex] = { profile, result: res, savedId, status: 'success' };
        } catch (err) {
          results[currentIndex] = {
            profile,
            error: err instanceof Error ? err.message : 'Unknown error',
            status: 'error'
          };
        }
      }
    };

    const workers = Array.from({ length: Math.min(limit, profiles.length) }, () => runWorker());
    await Promise.all(workers);

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error('Bulk discover error:', error);
    return NextResponse.json({ error: 'Bulk discovery failed' }, { status: 500 });
  }
}
