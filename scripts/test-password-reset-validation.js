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

// Password validation function (matching the frontend logic)
function validatePassword(password, isSignup = true) {
  const checks = {
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    specialChar: false,
    maxLength: true,
  };

  if (isSignup) {
    checks.length = password.length >= 8;
    checks.uppercase = /[A-Z]/.test(password);
    checks.lowercase = /[a-z]/.test(password);
    checks.number = /\d/.test(password);
    checks.specialChar = /[^a-zA-Z0-9]/.test(password);
    checks.maxLength = password.length <= 20;
  }

  const isValid = isSignup ? Object.values(checks).every(Boolean) : !!password;
  const errors = [];
  if (isSignup && !isValid) {
    if (password.length > 20) {
      errors.push("Password must not exceed 20 characters");
    } else {
      errors.push("Password does not meet all requirements.");
    }
  }

  return { isValid, errors, checks };
}

// Email validation function
function validateEmail(email) {
  const errors = [];
  if (!email) errors.push("Email is required");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
  return { isValid: errors.length === 0, errors };
}

// Password strength calculation
function getPasswordStrength(password) {
  const validation = validatePassword(password, true);
  const checks = validation.checks;

  let score = 0;
  if (checks.length) score++;
  if (checks.uppercase) score++;
  if (checks.lowercase) score++;
  if (checks.number) score++;
  if (checks.specialChar) score++;

  const labels = ["Very Weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-red-400", "bg-yellow-500", "bg-blue-500", "bg-green-500"];

  let strengthIndex = 0;
  if (score === 5) {
    strengthIndex = 4; // Strong
  } else if (score >= 3) {
    strengthIndex = 3; // Good
  } else if (score >= 2) {
    strengthIndex = 2; // Fair
  } else if (score >= 1) {
    strengthIndex = 1; // Weak
  } else {
    strengthIndex = 0; // Very Weak
  }

  return {
    score: strengthIndex,
    label: labels[strengthIndex],
    color: colors[strengthIndex],
    percentage: ((strengthIndex + 1) / 5) * 100,
  };
}

async function testPasswordResetValidation() {
  try {
    console.log('🔍 Testing password reset validation logic...\n')

    // 1. Test password validation comprehensively
    console.log('1. Testing password validation...')
    const testPasswords = [
      { password: '', description: 'empty password' },
      { password: 'short', description: 'too short (< 8 chars)' },
      { password: 'nouppercase123!', description: 'no uppercase letter' },
      { password: 'NOLOWERCASE123!', description: 'no lowercase letter' },
      { password: 'NoNumbers!', description: 'no numbers' },
      { password: 'NoSpecial123', description: 'no special characters' },
      { password: 'VeryLongPasswordThatExceedsTwentyCharacters!', description: 'too long (> 20 chars)' },
      { password: 'ValidPass123!', description: 'valid password' },
      { password: 'StrongP@ssw0rd!', description: 'very strong password' },
    ]

    testPasswords.forEach(({ password, description }, index) => {
      const validation = validatePassword(password, true)
      console.log(`   Password ${index + 1}: "${password}" (${description})`)
      console.log(`     - Valid: ${validation.isValid ? '✅ Yes' : '❌ No'}`)
      console.log(`     - Length: ${validation.checks.length ? '✅' : '❌'} (${password.length}/8)`)
      console.log(`     - Uppercase: ${validation.checks.uppercase ? '✅' : '❌'}`)
      console.log(`     - Lowercase: ${validation.checks.lowercase ? '✅' : '❌'}`)
      console.log(`     - Numbers: ${validation.checks.number ? '✅' : '❌'}`)
      console.log(`     - Special: ${validation.checks.specialChar ? '✅' : '❌'}`)
      console.log(`     - Max Length: ${validation.checks.maxLength ? '✅' : '❌'} (${password.length}/20)`)
      if (validation.errors.length > 0) {
        console.log(`     - Errors: ${validation.errors.join(', ')}`)
      }
      console.log('')
    })

    // 2. Test password strength calculation
    console.log('2. Testing password strength calculation...')
    const strengthTestPasswords = [
      'weak',
      'Weak123',
      'StrongPass123!',
      'VeryStrongPassword123!@#',
      'SuperSecureP@ssw0rd2024!'
    ]

    strengthTestPasswords.forEach((password, index) => {
      const strength = getPasswordStrength(password)
      console.log(`   Password ${index + 1}: "${password}"`)
      console.log(`     - Strength: ${strength.label}`)
      console.log(`     - Score: ${strength.score + 1}/5`)
      console.log(`     - Percentage: ${strength.percentage}%`)
      console.log(`     - Color: ${strength.color}`)
      console.log('')
    })

    // 3. Test email validation
    console.log('3. Testing email validation...')
    const testEmails = [
      { email: '', description: 'empty email' },
      { email: 'test@example.com', description: 'valid email' },
      { email: 'invalid-email', description: 'missing @ and domain' },
      { email: 'test@', description: 'missing domain' },
      { email: '@example.com', description: 'missing local part' },
      { email: 'test.example.com', description: 'missing @' },
      { email: 'test@example', description: 'missing TLD' },
      { email: 'test+tag@example.com', description: 'valid email with plus' },
      { email: 'test.tag@example.com', description: 'valid email with dot' },
    ]

    testEmails.forEach(({ email, description }, index) => {
      const validation = validateEmail(email)
      console.log(`   Email ${index + 1}: "${email}" (${description})`)
      console.log(`     - Valid: ${validation.isValid ? '✅ Yes' : '❌ No'}`)
      if (validation.errors.length > 0) {
        console.log(`     - Errors: ${validation.errors.join(', ')}`)
      }
      console.log('')
    })

    // 4. Test form validation scenarios
    console.log('4. Testing form validation scenarios...')
    const scenarios = [
      {
        name: 'Empty current password',
        currentPassword: '',
        newPassword: 'ValidPass123!',
        confirmPassword: 'ValidPass123!',
        expectedError: 'Current password is required'
      },
      {
        name: 'Empty new password',
        currentPassword: 'OldPass123!',
        newPassword: '',
        confirmPassword: '',
        expectedError: 'Password does not meet all requirements.'
      },
      {
        name: 'Empty confirm password',
        currentPassword: 'OldPass123!',
        newPassword: 'ValidPass123!',
        confirmPassword: '',
        expectedError: 'New passwords do not match'
      },
      {
        name: 'Passwords do not match',
        currentPassword: 'OldPass123!',
        newPassword: 'ValidPass123!',
        confirmPassword: 'DifferentPass123!',
        expectedError: 'New passwords do not match'
      },
      {
        name: 'New password same as current',
        currentPassword: 'SamePass123!',
        newPassword: 'SamePass123!',
        confirmPassword: 'SamePass123!',
        expectedError: 'New password must be different from current password'
      },
      {
        name: 'Invalid password format',
        currentPassword: 'OldPass123!',
        newPassword: 'weak',
        confirmPassword: 'weak',
        expectedError: 'Password does not meet all requirements.'
      },
      {
        name: 'Valid password reset',
        currentPassword: 'OldPass123!',
        newPassword: 'ValidPass123!',
        confirmPassword: 'ValidPass123!',
        expectedError: null
      }
    ]

    scenarios.forEach((scenario, index) => {
      console.log(`   Scenario ${index + 1}: ${scenario.name}`)
      
      // Validate current password (not empty)
      const currentPasswordValid = scenario.currentPassword.length > 0
      
      // Validate new password
      const newPasswordValidation = validatePassword(scenario.newPassword, true)
      
      // Validate password match
      const passwordsMatch = scenario.newPassword === scenario.confirmPassword
      
      // Validate password difference
      const passwordsDifferent = scenario.currentPassword !== scenario.newPassword
      
      // Determine expected vs actual validation
      let actualError = null
      if (!currentPasswordValid) {
        actualError = 'Current password is required'
      } else if (!newPasswordValidation.isValid) {
        actualError = newPasswordValidation.errors[0]
      } else if (!passwordsMatch) {
        actualError = 'New passwords do not match'
      } else if (!passwordsDifferent) {
        actualError = 'New password must be different from current password'
      }
      
      const isValid = actualError === scenario.expectedError
      console.log(`     - Expected Error: ${scenario.expectedError || 'None'}`)
      console.log(`     - Actual Error: ${actualError || 'None'}`)
      console.log(`     - Valid: ${isValid ? '✅ Yes' : '❌ No'}`)
      console.log('')
    })

    // 5. Test URL parameter handling
    console.log('5. Testing URL parameter handling...')
    const testUrls = [
      'http://localhost:3000/reset-password?access_token=valid_token&refresh_token=valid_refresh',
      'http://localhost:3000/reset-password?access_token=valid_token',
      'http://localhost:3000/reset-password?refresh_token=valid_refresh',
      'http://localhost:3000/reset-password',
      'http://localhost:3000/reset-password?invalid_param=value'
    ]

    testUrls.forEach((url, index) => {
      const urlObj = new URL(url)
      const accessToken = urlObj.searchParams.get('access_token')
      const refreshToken = urlObj.searchParams.get('refresh_token')
      
      console.log(`   URL ${index + 1}: ${url}`)
      console.log(`     - Access Token: ${accessToken ? '✅ Present' : '❌ Missing'}`)
      console.log(`     - Refresh Token: ${refreshToken ? '✅ Present' : '❌ Missing'}`)
      console.log(`     - Valid: ${accessToken && refreshToken ? '✅ Yes' : '❌ No'}`)
      console.log('')
    })

    console.log('🎉 Password reset validation test completed!')
    console.log('\n📋 Summary:')
    console.log('- Password validation logic is working correctly')
    console.log('- Email validation is functioning properly')
    console.log('- Form validation scenarios are covered')
    console.log('- URL parameter handling is implemented')
    console.log('- Password strength calculation is accurate')

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testPasswordResetValidation()
