const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  console.log('Please check your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testStorage() {
  try {
    console.log('🧪 Testing Supabase storage connectivity...\n')

    // Test 1: Check if we can list buckets
    console.log('📦 Test 1: Listing storage buckets...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('❌ Failed to list buckets:', bucketsError.message)
      return
    }
    
    console.log('✅ Buckets found:', buckets.map(b => b.name))
    
    // Test 2: Check if resume bucket exists
    const resumeBucket = buckets.find(b => b.name === 'resume')
    if (!resumeBucket) {
      console.log('❌ Resume bucket not found')
      return
    }
    
    console.log('✅ Resume bucket exists')
    
    // Test 3: Try to list files in resume bucket (this tests permissions)
    console.log('\n📁 Test 2: Testing bucket access...')
    const { data: files, error: filesError } = await supabase.storage
      .from('resume')
      .list('', { limit: 1 })
    
    if (filesError) {
      console.log('❌ Failed to access resume bucket:', filesError.message)
      console.log('This might be a permissions issue. Check RLS policies.')
    } else {
      console.log('✅ Resume bucket access successful')
      console.log('Files in bucket:', files.length)
    }
    
    // Test 4: Check authentication
    console.log('\n🔐 Test 3: Checking authentication...')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError) {
      console.log('❌ Authentication error:', authError.message)
      console.log('Note: You need to be logged in to upload files')
    } else if (user) {
      console.log('✅ User authenticated:', user.email)
    } else {
      console.log('⚠️  No user authenticated')
      console.log('Note: You need to be logged in to upload files')
    }
    
    console.log('\n🎯 Summary:')
    console.log('If you see authentication errors, make sure you are logged in.')
    console.log('If you see bucket access errors, check your RLS policies.')
    console.log('If everything looks good, try uploading a file again.')

  } catch (error) {
    console.error('❌ Error during storage test:', error.message)
  }
}

testStorage() 