import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    if (!file || !userId) {
      return NextResponse.json({ error: 'File and userId are required' }, { status: 400 });
    }
    const filePath = `${userId}/${Date.now()}-${file.name}`;
    // Upload to Supabase Storage (private bucket 'resume')
    const { error: uploadError } = await supabase.storage.from('resume').upload(filePath, file);
    if (uploadError) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
    // Generate a short-lived signed URL instead of a public URL
    const { data: signed, error: signedError } = await supabase.storage
      .from('resume')
      .createSignedUrl(filePath, 60 * 60); // 1 hour
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Failed to generate access URL' }, { status: 500 });
    }
    const signedUrl = signed.signedUrl;
    // Extract text
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsedText = '';
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    if (file.type.includes('pdf') || fileExtension === 'pdf') {
      const data = await pdf(buffer);
      parsedText = data.text;
    } else if (file.type.includes('word') || fileExtension === 'doc' || fileExtension === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      parsedText = result.value;
    } else {
      return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 });
    }
    // Save to DB (resumes table per migration)
    const { data: inserted, error: insertError } = await supabase
      .from('resumes')
      .insert({
        user_id: userId,
        file_name: file.name,
        file_url: `resume/${filePath}`,
        file_size: file.size,
        file_type: file.type,
        parsed_text: parsedText,
        status: 'parsed',
        source: 'upload',
      })
      .select('id')
      .single();
    if (insertError) {
      return NextResponse.json({ error: 'Failed to save resume', details: insertError.message }, { status: 500 });
    }
    // Return result (signed URL for immediate preview)
    return NextResponse.json({
      resume_id: inserted.id,
      file_url: signedUrl,
      parsed_text: parsedText,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process resume', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
