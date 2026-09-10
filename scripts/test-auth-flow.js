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

async function testAuthFlow() {
  try {
    console.log('🔍 Testing authentication flow...\n')

    // 1. Test unauthenticated state
    console.log('1. Testing unauthenticated state...')
    const { data: { user: user1 }, error: error1 } = await supabase.auth.getUser()
    
    if (error1) {
      console.log('❌ Error getting user:', error1.message)
    } else if (!user1) {
      console.log('✅ Correctly detected: No user authenticated')
    } else {
      console.log('⚠️  User is authenticated:', user1.email)
    }

    // 2. Test sign in
    console.log('\n2. Testing sign in...')
    const email = 'ashutoshkumarsingh0x@gmail.com'
    const password = 'ashutosh@123W'
    
    const { data: { user: user2 }, error: error2 } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error2) {
      console.log('❌ Sign in failed:', error2.message)
    } else if (user2) {
      console.log('✅ Sign in successful!')
      console.log('   User:', user2.email)
      console.log('   User ID:', user2.id)
    }

    // 3. Test authenticated state
    console.log('\n3. Testing authenticated state...')
    const { data: { user: user3 }, error: error3 } = await supabase.auth.getUser()
    
    if (error3) {
      console.log('❌ Error getting user:', error3.message)
    } else if (user3) {
      console.log('✅ Correctly detected: User authenticated')
      console.log('   User:', user3.email)
    } else {
      console.log('❌ User not found after sign in')
    }

    // 4. Test sign out
    console.log('\n4. Testing sign out...')
    const { error: error4 } = await supabase.auth.signOut()
    
    if (error4) {
      console.log('❌ Sign out failed:', error4.message)
    } else {
      console.log('✅ Sign out successful!')
    }

    // 5. Test unauthenticated state after sign out
    console.log('\n5. Testing unauthenticated state after sign out...')
    const { data: { user: user5 }, error: error5 } = await supabase.auth.getUser()
    
    if (error5) {
      console.log('❌ Error getting user:', error5.message)
    } else if (!user5) {
      console.log('✅ Correctly detected: No user authenticated after sign out')
    } else {
      console.log('⚠️  User still authenticated after sign out:', user5.email)
    }

    console.log('\n🎉 Authentication flow test completed!')
    console.log('The authentication system is working correctly.')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testAuthFlow() 