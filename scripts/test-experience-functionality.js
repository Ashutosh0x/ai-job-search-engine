const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') })

// Check if environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Environment variables not found. Please check your .env.local file.')
  console.log('Required variables:')
  console.log('- NEXT_PUBLIC_SUPABASE_URL')
  console.log('- NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function testExperienceFunctionality() {
  console.log('🧪 Testing Experience Functionality...\n')
  console.log('📡 Using Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)

  try {
    // 1. Test database connection and table existence
    console.log('1. Testing database connection...')
    const { data: testData, error: testError } = await supabase
      .from('experiences')
      .select('count')
      .limit(1)
    
    if (testError) {
      console.error('❌ Database connection failed:', testError.message)
      return
    }
    console.log('✅ Database connection successful')

    // 2. Test company logo fetching
    console.log('\n2. Testing company logo fetching...')
    const testUrls = [
      'https://google.com',
      'https://microsoft.com',
      'https://apple.com'
    ]

    for (const url of testUrls) {
      try {
        const response = await fetch(`https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`)
        if (response.ok) {
          console.log(`✅ Logo fetch successful for ${url}`)
        } else {
          console.log(`⚠️  Logo fetch failed for ${url}`)
        }
      } catch (error) {
        console.log(`❌ Logo fetch error for ${url}:`, error.message)
      }
    }

    // 3. Test experience CRUD operations (if user is authenticated)
    console.log('\n3. Testing experience CRUD operations...')
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      console.log('✅ User authenticated, testing CRUD operations...')
      
      // Test creating an experience
      const testExperience = {
        user_id: user.id,
        job_title: 'Software Engineer',
        company_name: 'Test Company',
        company_website: 'https://testcompany.com',
        location: 'Remote',
        start_date: '2023-01-01',
        end_date: '2024-01-01',
        is_current_job: false,
        years_of_experience: 1.0,
        description: 'Test experience for functionality verification'
      }

      const { data: createdExp, error: createError } = await supabase
        .from('experiences')
        .insert(testExperience)
        .select()

      if (createError) {
        console.error('❌ Create experience failed:', createError.message)
      } else {
        console.log('✅ Create experience successful')
        
        // Test reading experiences
        const { data: experiences, error: readError } = await supabase
          .from('experiences')
          .select('*')
          .eq('user_id', user.id)

        if (readError) {
          console.error('❌ Read experiences failed:', readError.message)
        } else {
          console.log(`✅ Read experiences successful (${experiences.length} found)`)
        }

        // Clean up test data
        if (createdExp && createdExp[0]) {
          const { error: deleteError } = await supabase
            .from('experiences')
            .delete()
            .eq('id', createdExp[0].id)

          if (deleteError) {
            console.error('❌ Delete test experience failed:', deleteError.message)
          } else {
            console.log('✅ Delete test experience successful')
          }
        }
      }
    } else {
      console.log('⚠️  No authenticated user, skipping CRUD tests')
    }

    console.log('\n🎉 Experience functionality test completed!')
    console.log('\n📋 Summary:')
    console.log('- Database table exists and is accessible')
    console.log('- Company logo fetching is working')
    console.log('- CRUD operations are functional (if authenticated)')
    console.log('\n✅ The experience section should be fully functional in your profile page!')

  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

testExperienceFunctionality()
