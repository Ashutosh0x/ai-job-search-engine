import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { discoverContact } from '@/lib/contacts/enricher';

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  domain: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }
    
    const result = await discoverContact(parsed.data);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error('Discover error:', error);
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}
