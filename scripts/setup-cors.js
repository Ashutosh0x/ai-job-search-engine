const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  console.log('Please check your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function setupCORS() {
  try {
    console.log('🔧 Setting up CORS for Supabase storage...\n')

    // Note: CORS configuration needs to be done manually in Supabase dashboard
    // This script provides instructions
    
    console.log('📋 Manual CORS Setup Required:')
    console.log('1. Go to your Supabase Dashboard')
    console.log('2. Navigate to: Project Settings → API → Storage → CORS')
    console.log('3. Add the following origins:')
    console.log('   - http://localhost:3000')
    console.log('   - http://127.0.0.1:3000')
    console.log('   - https://your-production-domain.com (when deployed)')
    console.log('4. Click "Save"')
    
    console.log('\n📋 Storage Bucket Configuration:')
    console.log('1. Go to Storage in your Supabase Dashboard')
    console.log('2. Check that the "resume" bucket exists')
    console.log('3. Verify bucket settings:')
    console.log('   - Public: false (private)')
    console.log('   - File size limit: 10MB')
    console.log('   - Allowed MIME types: application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    
    console.log('\n📋 RLS Policies Check:')
    console.log('Make sure these policies exist in your SQL editor:')
    console.log(`
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Users can upload their own resumes
CREATE POLICY "Users can upload their own resumes" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'resume' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own resumes
CREATE POLICY "Users can view their own resumes" ON storage.objects
FOR SELECT USING (
  bucket_id = 'resume' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own resumes
CREATE POLICY "Users can update their own resumes" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'resume' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own resumes
CREATE POLICY "Users can delete their own resumes" ON storage.objects
FOR DELETE USING (
  bucket_id = 'resume' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);
    `)

    console.log('\n✅ CORS setup instructions completed!')
    console.log('After configuring CORS, restart your development server.')

  } catch (error) {
    console.error('❌ Error during CORS setup:', error.message)
  }
}

setupCORS() 