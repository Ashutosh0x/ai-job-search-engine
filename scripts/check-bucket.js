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

async function checkBucket() {
  try {
    console.log('🔍 Checking resume bucket...\n')

    // List all buckets
    console.log('1. Listing all buckets...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('❌ Error listing buckets:', bucketsError.message)
      return
    }
    
    console.log('📦 All buckets:')
    buckets.forEach((bucket, index) => {
      console.log(`   ${index + 1}. ${bucket.name} (public: ${bucket.public})`)
    })
    
    // Check specifically for resume bucket
    const resumeBucket = buckets.find(b => b.name === 'resume')
    if (resumeBucket) {
      console.log('\n✅ Resume bucket found!')
      console.log('   Name:', resumeBucket.name)
      console.log('   Public:', resumeBucket.public)
      console.log('   File size limit:', resumeBucket.fileSizeLimit)
      console.log('   Allowed MIME types:', resumeBucket.allowedMimeTypes)
    } else {
      console.log('\n❌ Resume bucket not found!')
      console.log('Available buckets:', buckets.map(b => b.name).join(', '))
    }

  } catch (error) {
    console.error('❌ Check error:', error.message)
    console.error('Full error:', error)
  }
}

checkBucket() 