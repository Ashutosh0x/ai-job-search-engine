const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function debugUpload() {
  try {
    console.log('🔍 Debugging upload issue...\n')

    // 1. Check authentication
    console.log('1. Checking authentication...')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError) {
      console.log('❌ Auth error:', authError.message)
      return
    }
    
    if (!user) {
      console.log('❌ No user found - need to log in')
      return
    }
    
    console.log('✅ User authenticated:', user.email)
    console.log('   User ID:', user.id)

    // 2. Check bucket access
    console.log('\n2. Checking bucket access...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('❌ Bucket list error:', bucketsError.message)
      return
    }
    
    const resumeBucket = buckets.find(b => b.name === 'resume')
    if (!resumeBucket) {
      console.log('❌ Resume bucket not found')
      return
    }
    
    console.log('✅ Resume bucket found')
    console.log('   Bucket settings:', {
      public: resumeBucket.public,
      fileSizeLimit: resumeBucket.fileSizeLimit,
      allowedMimeTypes: resumeBucket.allowedMimeTypes
    })

    // 3. Test with a simple text file
    console.log('\n3. Testing upload with simple text file...')
    const testContent = 'Test resume content'
    const testFileName = `test-${Date.now()}.txt`
    const filePath = `${user.id}/${testFileName}`
    
    // Create a Blob from the text content
    const blob = new Blob([testContent], { type: 'text/plain' })
    
    console.log('   Uploading to path:', filePath)
    console.log('   File size:', blob.size, 'bytes')
    console.log('   MIME type:', blob.type)
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resume')
      .upload(filePath, blob, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.log('❌ Upload failed!')
      console.log('   Error message:', uploadError.message)
      console.log('   Error details:', uploadError.details)
      console.log('   Error hint:', uploadError.hint)
      console.log('   Full error object:', JSON.stringify(uploadError, null, 2))
      return
    }
    
    console.log('✅ Upload successful!')
    console.log('   File path:', uploadData.path)
    
    // 4. Test getting public URL
    console.log('\n4. Testing public URL...')
    const { data: urlData } = supabase.storage
      .from('resume')
      .getPublicUrl(filePath)
    
    console.log('✅ Public URL:', urlData.publicUrl)
    
    // 5. Clean up test file
    console.log('\n5. Cleaning up test file...')
    const { error: deleteError } = await supabase.storage
      .from('resume')
      .remove([filePath])
    
    if (deleteError) {
      console.log('⚠️  Could not delete test file:', deleteError.message)
    } else {
      console.log('✅ Test file deleted')
    }
    
    console.log('\n🎉 Debug test completed successfully!')
    console.log('If this worked, the issue might be with:')
    console.log('- File size (try a smaller PDF)')
    console.log('- File type (check MIME type restrictions)')
    console.log('- Special characters in filename')

  } catch (error) {
    console.error('❌ Debug error:', error.message)
    console.error('Full error:', error)
  }
}

debugUpload() 