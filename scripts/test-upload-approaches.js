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

async function testUploadApproaches() {
  try {
    console.log('🔍 Testing different upload approaches...\n')

    // 1. Sign in
    console.log('1. Signing in...')
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

    const testContent = 'Test resume content'
    const testFileName = `test-${Date.now()}.txt`

    // Approach 1: Simple path without user ID folder
    console.log('\n2. Testing Approach 1: Simple path...')
    const simplePath = testFileName
    const blob1 = new Blob([testContent], { type: 'text/plain' })
    
    const { data: upload1, error: error1 } = await supabase.storage
      .from('resume')
      .upload(simplePath, blob1, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (error1) {
      console.log('❌ Approach 1 failed:', error1.message)
    } else {
      console.log('✅ Approach 1 successful!')
      console.log('   File path:', upload1.path)
      // Clean up
      await supabase.storage.from('resume').remove([upload1.path])
    }

    // Approach 2: Different folder structure
    console.log('\n3. Testing Approach 2: Different folder structure...')
    const folderPath = `uploads/${testFileName}`
    const blob2 = new Blob([testContent], { type: 'text/plain' })
    
    const { data: upload2, error: error2 } = await supabase.storage
      .from('resume')
      .upload(folderPath, blob2, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (error2) {
      console.log('❌ Approach 2 failed:', error2.message)
    } else {
      console.log('✅ Approach 2 successful!')
      console.log('   File path:', upload2.path)
      // Clean up
      await supabase.storage.from('resume').remove([upload2.path])
    }

    // Approach 3: With user ID but different format
    console.log('\n4. Testing Approach 3: User ID with underscore...')
    const userPath = `${user.id.replace(/-/g, '_')}/${testFileName}`
    const blob3 = new Blob([testContent], { type: 'text/plain' })
    
    const { data: upload3, error: error3 } = await supabase.storage
      .from('resume')
      .upload(userPath, blob3, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (error3) {
      console.log('❌ Approach 3 failed:', error3.message)
    } else {
      console.log('✅ Approach 3 successful!')
      console.log('   File path:', upload3.path)
      // Clean up
      await supabase.storage.from('resume').remove([upload3.path])
    }

    // Approach 4: Try without authentication (if bucket is public)
    console.log('\n5. Testing Approach 4: Without authentication...')
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      await supabase.auth.signOut()
    }
    
    const publicPath = `public/${testFileName}`
    const blob4 = new Blob([testContent], { type: 'text/plain' })
    
    const { data: upload4, error: error4 } = await supabase.storage
      .from('resume')
      .upload(publicPath, blob4, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (error4) {
      console.log('❌ Approach 4 failed:', error4.message)
    } else {
      console.log('✅ Approach 4 successful!')
      console.log('   File path:', upload4.path)
      // Clean up
      await supabase.storage.from('resume').remove([upload4.path])
    }

    console.log('\n🎉 Upload approach testing completed!')
    console.log('Check which approach worked and update the resume upload component accordingly.')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testUploadApproaches() 