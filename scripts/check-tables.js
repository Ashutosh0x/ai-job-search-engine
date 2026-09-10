const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  console.log('Please check your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkTables() {
  try {
    console.log('🔍 Checking Supabase database tables...\n')

    // Check if resumes table exists
    console.log('📋 Checking resumes table...')
    const { data: resumesData, error: resumesError } = await supabase
      .from('resumes')
      .select('*')
      .limit(1)

    if (resumesError) {
      if (resumesError.code === 'PGRST116') {
        console.log('❌ Resumes table does not exist')
      } else {
        console.log('❌ Error checking resumes table:', resumesError.message)
      }
    } else {
      console.log('✅ Resumes table exists')
    }

    // Check if jobs table exists
    console.log('\n📋 Checking jobs table...')
    const { data: jobsData, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .limit(1)

    if (jobsError) {
      if (jobsError.code === 'PGRST116') {
        console.log('❌ Jobs table does not exist')
      } else {
        console.log('❌ Error checking jobs table:', jobsError.message)
      }
    } else {
      console.log('✅ Jobs table exists')
    }

    // Check if profiles table exists
    console.log('\n📋 Checking profiles table...')
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .limit(1)

    if (profilesError) {
      if (profilesError.code === 'PGRST116') {
        console.log('❌ Profiles table does not exist')
      } else {
        console.log('❌ Error checking profiles table:', profilesError.message)
      }
    } else {
      console.log('✅ Profiles table exists')
    }

    // Check storage buckets
    console.log('\n📦 Checking storage buckets...')
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()

    if (bucketsError) {
      console.log('❌ Error checking storage buckets:', bucketsError.message)
    } else {
      console.log('✅ Storage buckets found:', buckets.map(b => b.name))

      // Check if resume bucket exists
      const resumeBucket = buckets.find(b => b.name === 'resume')
      if (resumeBucket) {
        console.log('✅ Resume storage bucket exists')
      } else {
        console.log('❌ Resume storage bucket does not exist')
      }
    }

    // Get table count for existing tables
    console.log('\n📊 Table statistics:')
    
    if (!resumesError) {
      const { count: resumesCount } = await supabase
        .from('resumes')
        .select('*', { count: 'exact', head: true })
      console.log(`   - Resumes: ${resumesCount || 0} records`)
    }

    if (!jobsError) {
      const { count: jobsCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
      console.log(`   - Jobs: ${jobsCount || 0} records`)
    }

    if (!profilesError) {
      const { count: profilesCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
      console.log(`   - Profiles: ${profilesCount || 0} records`)
    }

    console.log('\n🎯 Summary:')
    console.log('To complete the resume optimization setup, you need to:')
    
    if (resumesError) {
      console.log('1. ✅ Create the resumes table (run the SQL migration)')
    } else {
      console.log('1. ✅ Resumes table exists')
    }
    
         if (!buckets.find(b => b.name === 'resume')) {
       console.log('2. ✅ Create the resume storage bucket')
     } else {
       console.log('2. ✅ Resume storage bucket exists')
     }
    
    console.log('3. ✅ Set up your GEMINI_API_KEY in .env.local')
    console.log('4. ✅ Install dependencies (npm install)')

  } catch (error) {
    console.error('❌ Error checking database:', error.message)
  }
}

checkTables() 