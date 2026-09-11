import { getServiceClient, supabaseUnavailable } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
// Import the library directly rather than the package root. pdf-parse@1.1.1's
// index.js runs a debug branch guarded by `!module.parent`, which is always
// true once webpack bundles it -- it then reads ./test/data/05-versions-space.pdf,
// a fixture that is not shipped, and `next build` dies with ENOENT.
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { requireUser } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Built per request, never at module scope: `createClient(undefined!, ...)`
// throws while Next collects page data during `next build`, so one missing env
// var made the whole app unbuildable. See lib/supabase-admin.ts.
const supabase = getServiceClient();

/** Resumes are documents, not archives. Anything larger is abuse or a mistake. */
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/**
 * Strip anything that could escape the user's own storage prefix. `file.name`
 * is attacker-controlled: without this, "../../other-user/cv.pdf" would write
 * outside the caller's folder.
 */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'resume';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 128) || 'resume';
}

/**
 * Verify the file really is what its extension claims by checking magic bytes.
 * Both `file.type` and the extension come from the client and can be spoofed.
 */
function sniffType(buffer: Buffer): 'pdf' | 'docx' | 'doc' | null {
  if (buffer.length >= 4) {
    if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
    // DOCX is a ZIP container.
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'docx';
    // Legacy .doc OLE2 compound file signature.
    if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      return 'doc';
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Configuration absent -> this endpoint is unavailable, and says so. Every
  // other route, including all of job search, is unaffected.
  if (!supabase) return supabaseUnavailable()

  try {
    // Identity comes from the caller's token. It used to be read from the form
    // body, which meant anyone could upload a resume into anyone's account.
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;
    const userId = auth.user.id;

    if (checkRateLimit(`upload-resume:${userId}`, { windowMs: 60 * 60 * 1000, max: 20 })) {
      return NextResponse.json(
        { error: 'Too many uploads. Please try again later.' },
        { status: 429 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large. Maximum size is ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
        { status: 413 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffType(buffer);
    if (!sniffed) {
      return NextResponse.json(
        { error: 'Unsupported file format. Only PDF, DOC, or DOCX are supported.' },
        { status: 400 }
      );
    }

    const cleanName = safeFileName(file.name);
    const filePath = `${userId}/${Date.now()}-${cleanName}`;

    // Extract text before storing, so a corrupt file fails fast and we do not
    // leave an orphaned object behind.
    let parsedText = '';
    if (sniffed === 'pdf') {
      const data = await pdf(buffer);
      parsedText = data.text;
    } else {
      const result = await mammoth.extractRawText({ buffer });
      parsedText = result.value;
    }

    // Upload to Supabase Storage (private bucket 'resume')
    const { error: uploadError } = await supabase.storage
      .from('resume')
      .upload(filePath, buffer, {
        contentType: ALLOWED[sniffed === 'docx' ? 'docx' : sniffed],
        upsert: false,
      });
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

    // Save to DB (resumes table per migration)
    const { data: inserted, error: insertError } = await supabase
      .from('resumes')
      .insert({
        user_id: userId,
        file_name: cleanName,
        file_url: `resume/${filePath}`,
        file_size: file.size,
        file_type: ALLOWED[sniffed === 'docx' ? 'docx' : sniffed],
        parsed_text: parsedText,
        status: 'parsed',
        source: 'upload',
      })
      .select('id')
      .single();
    if (insertError) {
      // Do not strand the uploaded object if the row could not be written.
      await supabase.storage.from('resume').remove([filePath]).catch(() => {});
      return NextResponse.json(
        { error: 'Failed to save resume', details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      resume_id: inserted.id,
      file_url: signed.signedUrl,
      parsed_text: parsedText,
    });
  } catch (error) {
    console.error('upload-resume failed:', error);
    return NextResponse.json({ error: 'Failed to process resume' }, { status: 500 });
  }
}
