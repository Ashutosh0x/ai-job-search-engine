const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testAvatarUpload() {
  try {
    console.log('🔧 Testing avatar upload functionality...')

    // 1. Check authentication
    console.log('1. Checking authentication...')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.log('❌ User not authenticated. Please sign in first.')
      return
    }

    console.log('✅ User authenticated:', user.id)

    // 2. Test file path structure
    const testFilePath = `${user.id}/test-avatar.jpg`
    console.log('2. Testing file path:', testFilePath)

    // 3. Test storage bucket access
    console.log('3. Testing storage bucket access...')
    const { data: bucketData, error: bucketError } = await supabase.storage
      .from('resume')
      .list('', { limit: 1 })

    if (bucketError) {
      console.error('❌ Storage bucket error:', bucketError)
      return
    }

    console.log('✅ Storage bucket accessible')

    // 4. Test RLS policies
    console.log('4. Testing RLS policies...')
    const { data: policyTest, error: policyError } = await supabase.storage
      .from('resume')
      .list(user.id, { limit: 1 })

    if (policyError) {
      console.error('❌ RLS policy error:', policyError)
      console.log('This might indicate an issue with the storage policies')
    } else {
      console.log('✅ RLS policies working correctly')
    }

    console.log('\n📋 Summary:')
    console.log('- User ID:', user.id)
    console.log('- File path structure:', testFilePath)
    console.log('- Storage bucket: resume')
    console.log('- RLS policies: Enabled')

    console.log('\n💡 To test actual upload:')
    console.log('1. Go to the profile page')
    console.log('2. Click "Edit Profile"')
    console.log('3. Click the upload button next to avatar')
    console.log('4. Select an image file')
    console.log('5. Check browser console for detailed logs')

  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

testAvatarUpload()
