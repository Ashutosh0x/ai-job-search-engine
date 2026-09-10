const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client exactly like the browser
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testBrowserUpload() {
  try {
    console.log('🔍 Testing browser-like upload...\n')

    // 1. First authenticate like the browser does
    console.log('1. Authenticating...')
    const email = 'ashutoshkumarsingh0x@gmail.com'
    const password = 'ashutosh@123W'
    
    const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (signInError) {
      console.log('❌ Sign in failed:', signInError.message)
      return
    }
    
    console.log('✅ Signed in successfully!')
    console.log('   User:', user.email)
    console.log('   User ID:', user.id)

    // 2. Create a test file like the browser would
    console.log('\n2. Creating test file...')
    const testContent = 'Test resume content for browser simulation'
    const testFileName = `Ashutosh_Kumar_Singh.pdf`
    const sanitizedFileName = testFileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filePath = `public/${Date.now()}-${sanitizedFileName}`
    
    console.log('   Original filename:', testFileName)
    console.log('   Sanitized filename:', sanitizedFileName)
    console.log('   Upload path:', filePath)
    
    // 3. Create a File-like object (simulating browser File)
    const blob = new Blob([testContent], { type: 'application/pdf' })
    
    // 4. Try upload with authenticated client (like browser)
    console.log('\n3. Testing upload with authenticated client...')
    const { data: uploadData1, error: uploadError1 } = await supabase.storage
      .from('resume')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError1) {
      console.log('❌ Authenticated upload failed:', uploadError1.message)
      console.log('   Error details:', uploadError1)
    } else {
      console.log('✅ Authenticated upload successful!')
      console.log('   File path:', uploadData1.path)
    }

    // 5. Try upload with unauthenticated client
    console.log('\n4. Testing upload with unauthenticated client...')
    const supabaseUnauth = createClient(supabaseUrl, supabaseAnonKey)
    
    const { data: uploadData2, error: uploadError2 } = await supabaseUnauth.storage
      .from('resume')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError2) {
      console.log('❌ Unauthenticated upload failed:', uploadError2.message)
      console.log('   Error details:', uploadError2)
    } else {
      console.log('✅ Unauthenticated upload successful!')
      console.log('   File path:', uploadData2.path)
      
      // Test getting public URL
      const { data: urlData } = supabaseUnauth.storage
        .from('resume')
        .getPublicUrl(uploadData2.path)
      
      console.log('   Public URL:', urlData.publicUrl)
      
      // Clean up
      await supabaseUnauth.storage.from('resume').remove([uploadData2.path])
      console.log('✅ Test file cleaned up')
    }

    console.log('\n🎉 Browser upload simulation completed!')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testBrowserUpload() 