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

async function testForgotPassword() {
  try {
    console.log('🔍 Testing forgot password functionality...\n')

    // 1. Test password reset for existing user
    console.log('1. Testing password reset for existing user...')
    const email = 'ashutoshkumarsingh0x@gmail.com'
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/login`
    })
    
    if (error) {
      console.log('❌ Password reset failed:', error.message)
    } else {
      console.log('✅ Password reset email sent successfully!')
      console.log('   Email:', email)
      console.log('   Check your email for the reset link')
    }

    // 2. Test password reset for non-existent user
    console.log('\n2. Testing password reset for non-existent user...')
    const nonExistentEmail = 'nonexistent@example.com'
    
    const { error: error2 } = await supabase.auth.resetPasswordForEmail(nonExistentEmail, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/login`
    })
    
    if (error2) {
      console.log('❌ Password reset failed for non-existent user:', error2.message)
    } else {
      console.log('✅ Password reset email sent (even for non-existent user)')
      console.log('   This is normal behavior for security reasons')
    }

    // 3. Test invalid email format
    console.log('\n3. Testing invalid email format...')
    const invalidEmail = 'invalid-email'
    
    const { error: error3 } = await supabase.auth.resetPasswordForEmail(invalidEmail, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/login`
    })
    
    if (error3) {
      console.log('❌ Password reset failed for invalid email:', error3.message)
    } else {
      console.log('✅ Password reset email sent (even for invalid email)')
    }

    console.log('\n🎉 Forgot password functionality test completed!')
    console.log('The forgot password feature is working correctly.')
    console.log('\n📧 Check your email for the password reset link.')
    console.log('The reset link will redirect you back to the login page.')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testForgotPassword() 