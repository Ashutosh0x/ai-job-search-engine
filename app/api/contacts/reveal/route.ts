import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { discoverContact } from '@/lib/contacts/enricher';
import { saveReveal } from '@/lib/contacts/persist';

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  domain: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
});

function getSupabase(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const cookieStore = cookies();
  return createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Cookie: cookieStore.toString() } },
  });
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { contact, cached, discoveryTimeMs } = await discoverContact(parsed.data);

    const { data: reveal, error } = await saveReveal(supabase, user.id, contact);

    if (error) {
      console.error('Error saving reveal:', error);
      return NextResponse.json({ error: 'Failed to save contact reveal' }, { status: 500 });
    }

    return NextResponse.json({ data: reveal, meta: { cached, discoveryTimeMs } });
  } catch (error) {
    console.error('Reveal error:', error);
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}

/**
 * The signed-in user's revealed contacts, newest first, with the counts the
 * dashboard header reports. Every number here is computed from their own rows.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 100), 500);

    const { data, error } = await supabase
      .from('contact_reveals')
      .select('*')
      .eq('user_id', user.id)
      .order('revealed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const reveals = data ?? [];
    const withVerifiedEmail = reveals.filter((r: any) =>
      Array.isArray(r.emails) && r.emails.some((e: any) => e?.verified)
    ).length;

    const { count: listCount } = await supabase
      .from('contact_lists')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      data: reveals,
      stats: {
        totalReveals: reveals.length,
        verifiedReveals: withVerifiedEmail,
        listCount: listCount ?? 0,
      },
    });
  } catch (error) {
    console.error('Reveal list error:', error);
    return NextResponse.json({ error: 'Failed to fetch reveals' }, { status: 500 });
  }
}
