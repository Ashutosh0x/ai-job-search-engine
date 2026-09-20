import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { analyzeProfile } from '@/lib/linkedin/analyzer';
import { LinkedInProfile } from '@/lib/linkedin/types';
import { discoverContact } from '@/lib/contacts/enricher';

/**
 * Resolved per request, never at module scope.
 *
 * `createClient('', '')` throws "supabaseUrl is required", and a module-level
 * call runs at IMPORT time -- during `next build` that is the "Collecting page
 * data" phase, which has no env vars in CI or on a fresh Vercel project. A
 * top-level client therefore fails the whole build rather than one request.
 */
function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const requestSchema = z.object({
  profile: z.any(), // Assuming full profile object is passed
  userId: z.string().optional(),
  saveProfile: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error }, { status: 400 });
    }

    const { profile: rawProfile, userId, saveProfile } = parsed.data;
    const profile = rawProfile as LinkedInProfile;

    // 1. Analyze profile
    const analysis = await analyzeProfile(profile);

    // 2. Discover contacts (optional enrichment)
    let contactDiscovery = undefined;
    try {
      if (profile.name && profile.experience && profile.experience.length > 0) {
        const nameParts = profile.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');
        const company = profile.experience[0].company;

        if (firstName && lastName && company) {
          const discoveryResult = await discoverContact({ firstName, lastName, company });
          if (discoveryResult?.contact?.emails?.length) {
             contactDiscovery = { emails: discoveryResult.contact.emails };
          }
        }
      }
    } catch (e) {
      console.error('Contact discovery failed', e);
    }

    // 3. Save to Supabase if requested
    let savedAt = undefined;
    const supabase = getServiceClient();
    if (saveProfile && userId && supabase) {
      const { data, error } = await supabase
        .from('linkedin_profiles')
        .upsert(
          {
            user_id: userId,
            linkedin_url: profile.profileUrl,
            full_name: profile.name,
            headline: profile.headline,
            location: profile.location,
            about: profile.about,
            photo_url: profile.photoUrl,
            // Null, not 0, when LinkedIn did not show a count — a stored 0
            // reads back as "this person has no connections".
            connection_count: typeof profile.connectionCount === 'number' ? profile.connectionCount : null,
            experience: profile.experience,
            education: profile.education,
            skills: profile.skills.map(s => s.name),
            certifications: profile.certifications,
            languages: profile.languages,
            recommendation_count: profile.recommendationCount,
            ai_analysis: analysis,
            contact_discovery: contactDiscovery,
            profile_type: 'contact',
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id,linkedin_url' }
        )
        .select('updated_at')
        .single();

      if (error) {
        console.error('Error saving profile to Supabase:', error);
      } else if (data) {
        savedAt = data.updated_at;
      }
    }

    return NextResponse.json({
      profile,
      analysis,
      contactDiscovery,
      savedAt
    });

  } catch (error: any) {
    console.error('LinkedIn Insight API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const supabase = getServiceClient();
    if (!supabase) {
      // Fail closed and say so, rather than returning an empty list that reads
      // as "this user has saved no profiles".
      return NextResponse.json(
        { error: 'Profile storage is not configured on this deployment' },
        { status: 503 }
      );
    }

    const { data, error } = await supabase
      .from('linkedin_profiles')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ profiles: data });
  } catch (error: any) {
    console.error('Error fetching LinkedIn profiles:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
