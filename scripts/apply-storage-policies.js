const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client with service role key for admin operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  console.error('Make sure you have SUPABASE_SERVICE_ROLE_KEY in your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function applyStoragePolicies() {
  try {
    console.log('🔧 Applying storage policies...\n')

    // 1. Enable RLS on storage.objects
    console.log('1. Enabling RLS on storage.objects...')
    const { error: rlsError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'
    })
    
    if (rlsError) {
      console.log('⚠️  RLS already enabled or error:', rlsError.message)
    } else {
      console.log('✅ RLS enabled on storage.objects')
    }

    // 2. Create policies for resume bucket
    const policies = [
      {
        name: 'Users can upload their own resumes',
        operation: 'INSERT',
        definition: `bucket_id = 'resume' AND auth.uid()::text = (storage.foldername(name))[1]`
      },
      {
        name: 'Users can view their own resumes',
        operation: 'SELECT',
        definition: `bucket_id = 'resume' AND auth.uid()::text = (storage.foldername(name))[1]`
      },
      {
        name: 'Users can update their own resumes',
        operation: 'UPDATE',
        definition: `bucket_id = 'resume' AND auth.uid()::text = (storage.foldername(name))[1]`
      },
      {
        name: 'Users can delete their own resumes',
        operation: 'DELETE',
        definition: `bucket_id = 'resume' AND auth.uid()::text = (storage.foldername(name))[1]`
      }
    ]

    console.log('\n2. Creating storage policies...')
    
    for (const policy of policies) {
      console.log(`   Creating policy: ${policy.name}`)
      
      const sql = `
        CREATE POLICY "${policy.name}" ON storage.objects
        FOR ${policy.operation} 
        ${policy.operation === 'INSERT' ? 'WITH CHECK' : 'USING'} (${policy.definition});
      `
      
      const { error: policyError } = await supabase.rpc('exec_sql', { sql })
      
      if (policyError) {
        if (policyError.message.includes('already exists')) {
          console.log(`   ⚠️  Policy "${policy.name}" already exists`)
        } else {
          console.log(`   ❌ Error creating policy "${policy.name}":`, policyError.message)
        }
      } else {
        console.log(`   ✅ Policy "${policy.name}" created successfully`)
      }
    }

    console.log('\n🎉 Storage policies applied!')
    console.log('Now test the upload with: npm run test-auth-upload')

  } catch (error) {
    console.error('❌ Error applying policies:', error.message)
    console.error('Full error:', error)
    
    console.log('\n💡 Alternative: Apply policies manually via Supabase Dashboard')
    console.log('1. Go to: https://supabase.com/dashboard/project/wembypirxqzhqaweautc')
    console.log('2. Navigate to SQL Editor')
    console.log('3. Run the SQL from the setup-cors.js script')
  }
}

applyStoragePolicies() 