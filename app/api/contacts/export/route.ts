import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const schema = z.object({
  contactIds: z.array(z.string().uuid()),
  format: z.enum(['csv', 'json', 'vcard']),
});

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Cookie: cookieStore.toString() } } }
    );
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { contactIds, format } = parsed.data;
    
    if (contactIds.length === 0) {
      return NextResponse.json({ error: 'No contact IDs provided' }, { status: 400 });
    }

    const { data: contacts, error } = await supabase
      .from('contact_reveals')
      .select('*')
      .in('id', contactIds)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }

    if (format === 'json') {
      return new NextResponse(JSON.stringify(contacts, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="contacts.json"',
        }
      });
    }

    if (format === 'csv') {
      const header = ['First Name', 'Last Name', 'Company', 'Title', 'Email', 'Email Confidence', 'Phone', 'LinkedIn URL'].join(',');
      const rows = contacts.map((c: any) => {
        const emailObj = Array.isArray(c.emails) && c.emails.length > 0 ? c.emails[0] : null;
        const email = typeof emailObj === 'object' && emailObj !== null ? (emailObj.address || '') : (emailObj || '');
        const confidence = typeof emailObj === 'object' && emailObj !== null ? (emailObj.confidence || '') : '';
        
        const phoneObj = Array.isArray(c.phones) && c.phones.length > 0 ? c.phones[0] : null;
        const phone = typeof phoneObj === 'object' && phoneObj !== null ? (phoneObj.number || '') : (phoneObj || '');
        
        return [
          c.first_name || '',
          c.last_name || '',
          c.company || '',
          c.title || '',
          email,
          confidence,
          phone,
          c.linkedin_url || ''
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
      });
      
      const csv = [header, ...rows].join('\n');
      
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="contacts.csv"',
        }
      });
    }

    if (format === 'vcard') {
      const vcards = contacts.map((c: any) => {
        const emailObj = Array.isArray(c.emails) && c.emails.length > 0 ? c.emails[0] : null;
        const email = typeof emailObj === 'object' && emailObj !== null ? (emailObj.address || '') : (emailObj || '');
        
        return `BEGIN:VCARD\nVERSION:3.0\nN:${c.last_name || ''};${c.first_name || ''};;;\nFN:${c.first_name || ''} ${c.last_name || ''}\nORG:${c.company || ''}\nTITLE:${c.title || ''}\nEMAIL:${email}\nURL:${c.linkedin_url || ''}\nEND:VCARD`;
      }).join('\n');

      return new NextResponse(vcards, {
        headers: {
          'Content-Type': 'text/vcard',
          'Content-Disposition': 'attachment; filename="contacts.vcf"',
        }
      });
    }

  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
