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

async function checkStoragePolicies() {
  try {
    console.log('🔍 Checking storage policies...\n')

    // 1. Check if RLS is enabled on storage.objects
    console.log('1. Checking RLS on storage.objects...')
    const { data: rlsData, error: rlsError } = await supabase
      .from('information_schema.tables')
      .select('is_insertable_into')
      .eq('table_schema', 'storage')
      .eq('table_name', 'objects')
      .single()
    
    if (rlsError) {
      console.log('❌ Error checking RLS:', rlsError.message)
    } else {
      console.log('✅ Storage.objects table found')
    }

    // 2. Check existing policies
    console.log('\n2. Checking existing storage policies...')
    const { data: policies, error: policiesError } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('schemaname', 'storage')
      .eq('tablename', 'objects')
    
    if (policiesError) {
      console.log('❌ Error checking policies:', policiesError.message)
    } else {
      console.log('📋 Current storage policies:')
      if (policies && policies.length > 0) {
        policies.forEach((policy, index) => {
          console.log(`   ${index + 1}. ${policy.policyname}`)
          console.log(`      Operation: ${policy.cmd}`)
          console.log(`      Definition: ${policy.qual}`)
        })
      } else {
        console.log('   ❌ No policies found')
      }
    }

    // 3. Check bucket settings
    console.log('\n3. Checking bucket settings...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    
    if (bucketsError) {
      console.log('❌ Error listing buckets:', bucketsError.message)
    } else {
      const resumeBucket = buckets.find(b => b.name === 'resume')
      if (resumeBucket) {
        console.log('✅ Resume bucket found')
        console.log('   Public:', resumeBucket.public)
        console.log('   File size limit:', resumeBucket.fileSizeLimit)
        console.log('   Allowed MIME types:', resumeBucket.allowedMimeTypes)
      } else {
        console.log('❌ Resume bucket not found')
        console.log('Available buckets:', buckets.map(b => b.name).join(', '))
      }
    }

    // 4. Test bucket access (using service role)
    console.log('\n4. Testing bucket access...')
    const testContent = 'Test content'
    const testFileName = `test-${Date.now()}.txt`
    const filePath = `test/${testFileName}`
    
    const blob = new Blob([testContent], { type: 'text/plain' })
    
    console.log('   Uploading to path:', filePath)
    
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
    } else {
      console.log('✅ Upload successful!')
      console.log('   File path:', uploadData.path)
      
      // Clean up
      await supabase.storage.from('resume').remove([filePath])
      console.log('   Test file cleaned up')
    }

  } catch (error) {
    console.error('❌ Check error:', error.message)
    console.error('Full error:', error)
  }
}

checkStoragePolicies() 