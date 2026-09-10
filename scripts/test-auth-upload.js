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

async function testAuthUpload() {
  try {
    console.log('🔐 Testing authenticated upload...\n')

    // 1. Sign in with credentials
    console.log('1. Signing in...')
    const email = 'ashutoshkumarsingh0x@gmail.com' // Replace with your email
    const password = 'ashutosh@123W' // Replace with your password
    
    const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (signInError) {
      console.log('❌ Sign in failed:', signInError.message)
      console.log('Please check your credentials or create an account first')
      return
    }
    
    console.log('✅ Signed in successfully!')
    console.log('   User:', user.email)
    console.log('   User ID:', user.id)

    // 2. Test upload with a simple file
    console.log('\n2. Testing file upload...')
    const testContent = 'This is a test resume content for upload testing.'
    const testFileName = `test-resume-${Date.now()}.txt`
    const filePath = `${user.id}/${testFileName}`
    
    // Create a Blob from the text content
    const blob = new Blob([testContent], { type: 'text/plain' })
    
    console.log('   Uploading to path:', filePath)
    console.log('   File size:', blob.size, 'bytes')
    
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
      return
    }
    
    console.log('✅ Upload successful!')
    console.log('   File path:', uploadData.path)
    
    // 3. Test getting public URL
    console.log('\n3. Testing public URL...')
    const { data: urlData } = supabase.storage
      .from('resume')
      .getPublicUrl(filePath)
    
    console.log('✅ Public URL:', urlData.publicUrl)
    
    // 4. Test listing files
    console.log('\n4. Testing file listing...')
    const { data: files, error: listError } = await supabase.storage
      .from('resume')
      .list(user.id)
    
    if (listError) {
      console.log('❌ List error:', listError.message)
    } else {
      console.log('✅ Files in user folder:', files.map(f => f.name))
    }
    
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
    
    console.log('\n🎉 Authenticated upload test completed successfully!')
    console.log('Your resume upload should now work in the web app!')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testAuthUpload() 