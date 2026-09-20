import { SupabaseClient } from '@supabase/supabase-js';
import { EnrichedContact } from './types';

/**
 * Find this user's existing row for the same person.
 *
 * `UNIQUE(user_id, linkedin_url)` cannot carry this on its own: Postgres treats
 * NULLs as distinct, so every reveal without a LinkedIn URL would conflict with
 * nothing and insert a fresh duplicate. Match on the URL when we have one and on
 * name + domain when we don't.
 */
export async function findExistingReveal(
  supabase: SupabaseClient,
  userId: string,
  contact: { firstName: string; lastName: string; domain: string; linkedinUrl?: string }
): Promise<string | null> {
  let query = supabase.from('contact_reveals').select('id').eq('user_id', userId);

  if (contact.linkedinUrl) {
    query = query.eq('linkedin_url', contact.linkedinUrl);
  } else {
    query = query
      .is('linkedin_url', null)
      .eq('domain', contact.domain)
      .ilike('first_name', contact.firstName)
      .ilike('last_name', contact.lastName);
  }

  const { data } = await query.limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Write a discovered contact to `contact_reveals` for one user, updating the
 * existing row when this person has been revealed before.
 */
export async function saveReveal(
  supabase: SupabaseClient,
  userId: string,
  contact: EnrichedContact
): Promise<{ data: any; error: any }> {
  const row = {
    user_id: userId,
    first_name: contact.firstName,
    last_name: contact.lastName,
    company: contact.company,
    domain: contact.domain,
    title: contact.title,
    linkedin_url: contact.linkedinUrl ?? null,
    emails: contact.emails,
    phones: contact.phones,
    social_profiles: contact.socialProfiles,
    revealed_at: contact.discoveredAt.toISOString(),
  };

  const existingId = await findExistingReveal(supabase, userId, contact);

  return existingId
    ? await supabase.from('contact_reveals').update(row).eq('id', existingId).select().single()
    : await supabase.from('contact_reveals').insert(row).select().single();
}
