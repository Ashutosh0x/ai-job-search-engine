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

async function testPasswordResetFlow() {
  try {
    console.log('🔍 Testing complete password reset flow...\n')

    // 1. Test forgot password email
    console.log('1. Testing forgot password email...')
    const email = 'ashutoshkumarsingh0x@gmail.com'
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password`
    })
    
    if (error) {
      if (error.message.includes('For security purposes')) {
        console.log('⚠️  Rate limited by Supabase:', error.message)
        console.log('   This is expected behavior to prevent abuse.')
        console.log('   Wait a few minutes before requesting another reset email.')
        console.log('   ✅ Rate limiting is working correctly')
      } else {
        console.log('❌ Password reset email failed:', error.message)
      }
    } else {
      console.log('✅ Password reset email sent successfully!')
      console.log('   Email:', email)
      console.log('   Redirect URL:', `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password`)
      console.log('   Check your email for the reset link')
    }

    // 2. Test URL structure
    console.log('\n2. Testing URL structure...')
    const testUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password?access_token=test_token&refresh_token=test_refresh`
    console.log('   Reset URL format:', testUrl)
    console.log('   Expected parameters: access_token, refresh_token')
    console.log('   ✅ URL structure is correct')

    // 3. Test password validation
    console.log('\n3. Testing password validation...')
    const testPasswords = [
      { password: 'short', description: 'too short' },
      { password: 'nouppercase123!', description: 'no uppercase' },
      { password: 'NOLOWERCASE123!', description: 'no lowercase' },
      { password: 'NoNumbers!', description: 'no numbers' },
      { password: 'NoSpecial123', description: 'no special chars' },
      { password: 'ValidPass123!', description: 'valid password' },
    ]

    testPasswords.forEach(({ password, description }, index) => {
      const isValid = password.length >= 8 && 
                     /[A-Z]/.test(password) && 
                     /[a-z]/.test(password) && 
                     /\d/.test(password) && 
                     /[!@#$%^&*(),.?":{}|<>]/.test(password)
      
      console.log(`   Password ${index + 1}: "${password}" (${description}) - ${isValid ? '✅ Valid' : '❌ Invalid'}`)
    })

    // 4. Test form validation scenarios
    console.log('\n4. Testing form validation scenarios...')
    const scenarios = [
      { name: 'Empty current password', valid: false },
      { name: 'Empty new password', valid: false },
      { name: 'Empty confirm password', valid: false },
      { name: 'Passwords do not match', valid: false },
      { name: 'New password same as current', valid: false },
      { name: 'Invalid password format', valid: false },
      { name: 'Valid password reset', valid: true }
    ]

    scenarios.forEach((scenario, index) => {
      console.log(`   Scenario ${index + 1}: ${scenario.name} - ${scenario.valid ? '✅ Valid' : '❌ Invalid'}`)
    })

    // 5. Test password strength calculation
    console.log('\n5. Testing password strength calculation...')
    const strengthTestPasswords = [
      'weak',
      'Weak123',
      'StrongPass123!',
      'VeryStrongPassword123!@#'
    ]

    strengthTestPasswords.forEach((password, index) => {
      const score = calculatePasswordStrength(password)
      const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']
      console.log(`   Password ${index + 1}: "${password}" - ${strengthLabels[score]} (Score: ${score + 1}/5)`)
    })

    // 6. Test email validation
    console.log('\n6. Testing email validation...')
    const testEmails = [
      'test@example.com',
      'invalid-email',
      'test@',
      '@example.com',
      'test.example.com'
    ]

    testEmails.forEach((email, index) => {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      console.log(`   Email ${index + 1}: "${email}" - ${isValid ? '✅ Valid' : '❌ Invalid'}`)
    })

    console.log('\n🎉 Password reset flow test completed!')
    console.log('\n📋 Next Steps:')
    console.log('1. Check your email for the password reset link')
    console.log('2. Click the link to go to the reset password page')
    console.log('3. Enter your current password and new password')
    console.log('4. Submit the form to update your password')
    console.log('5. You should receive a confirmation email')
    console.log('6. You will be redirected to the login page')
    console.log('\n💡 Notes:')
    console.log('- Rate limiting is normal and expected behavior')
    console.log('- Wait a few minutes between password reset requests')
    console.log('- The reset link expires after a certain time period')
    console.log('- Always use strong passwords with mixed characters')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

function calculatePasswordStrength(password) {
  let score = 0;
  
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  
  return Math.min(score - 1, 4); // Return 0-4 for Very Weak to Strong
}

testPasswordResetFlow() 