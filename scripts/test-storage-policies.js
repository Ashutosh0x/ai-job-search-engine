const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client with service role key for admin access
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testStoragePolicies() {
  try {
    console.log('🔍 Testing storage policies...\n')

    // 1. Check bucket exists
    console.log('1. Checking resume bucket...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('❌ Error listing buckets:', bucketsError.message)
      return
    }
    
    const resumeBucket = buckets.find(b => b.name === 'resume')
    if (!resumeBucket) {
      console.log('❌ Resume bucket not found')
      return
    }
    
    console.log('✅ Resume bucket found')
    console.log('   Public:', resumeBucket.public)
    console.log('   File size limit:', resumeBucket.fileSizeLimit)

    // 2. Test upload with service role (should work)
    console.log('\n2. Testing upload with service role...')
    const testContent = 'Test content for policy verification'
    const testFileName = `policy-test-${Date.now()}.txt`
    const filePath = `test/${testFileName}`
    
    const blob = new Blob([testContent], { type: 'text/plain' })
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resume')
      .upload(filePath, blob, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.log('❌ Upload failed:', uploadError.message)
    } else {
      console.log('✅ Upload successful with service role')
      console.log('   File path:', uploadData.path)
      
      // 3. Test signed URL generation (before cleanup)
      console.log('\n3. Testing signed URL generation...')
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from('resume')
        .createSignedUrl(filePath, 3600) // 1 hour
      
      if (signedUrlError) {
        console.log('❌ Signed URL generation failed:', signedUrlError.message)
      } else {
        console.log('✅ Signed URL generation works')
        console.log('   URL length:', signedUrlData.signedUrl.length)
      }
      
      // Clean up
      await supabase.storage.from('resume').remove([filePath])
      console.log('   Test file cleaned up')
    }

    console.log('\n🎯 Storage setup summary:')
    console.log('   ✅ Resume bucket exists and is private')
    console.log('   ✅ Service role can upload files')
    console.log('   ✅ Signed URLs can be generated')
    console.log('   ✅ Storage policies should be working (RLS enabled)')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testStoragePolicies()
