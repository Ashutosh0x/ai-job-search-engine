# Password Reset Flow Guide

## Overview

This document explains the password reset functionality in the JobSpark AI application, including how it works, testing procedures, and troubleshooting common issues.

## How the Password Reset Flow Works

### 1. Forgot Password Request
- User navigates to `/forgot-password`
- User enters their email address
- System sends a password reset email via Supabase
- User receives an email with a reset link

### 2. Password Reset Process
- User clicks the reset link in their email
- Link contains `access_token` and `refresh_token` parameters
- User is redirected to `/reset-password` with these tokens
- User enters their current password and new password
- System validates the current password and updates to the new password
- User receives a confirmation email
- User is redirected to the login page

## Password Requirements

### Minimum Requirements
- **Length**: At least 8 characters
- **Uppercase**: At least one uppercase letter (A-Z)
- **Lowercase**: At least one lowercase letter (a-z)
- **Numbers**: At least one number (0-9)
- **Special Characters**: At least one special character (!@#$%^&*(),.?":{}|&lt;&gt;)
- **Maximum Length**: No more than 20 characters

### Password Strength Levels
- **Very Weak**: 0-1 criteria met
- **Weak**: 2 criteria met
- **Fair**: 3 criteria met
- **Good**: 4 criteria met
- **Strong**: All 5 criteria met

## Testing the Password Reset Flow

### Available Test Scripts

1. **Basic Flow Test**: `npm run test-password-reset-flow`
   - Tests the complete password reset flow
   - Includes rate limiting handling
   - Tests URL structure and validation

2. **Validation Test**: `npm run test-password-reset-validation`
   - Comprehensive validation testing
   - Password strength calculation
   - Email validation
   - Form validation scenarios
   - URL parameter handling

### Rate Limiting

Supabase implements rate limiting for password reset emails to prevent abuse:

- **Rate Limit**: One password reset request per 30 seconds per email
- **Error Message**: "For security purposes, you can only request this after X seconds"
- **Handling**: The test scripts now properly handle and report rate limiting

### Test Output Examples

#### Successful Password Reset Email
```
✅ Password reset email sent successfully!
   Email: user@example.com
   Redirect URL: http://localhost:3000/reset-password
   Check your email for the reset link
```

#### Rate Limited Request
```
⚠️  Rate limited by Supabase: For security purposes, you can only request this after 26 seconds.
   This is expected behavior to prevent abuse.
   Wait a few minutes before requesting another reset email.
   ✅ Rate limiting is working correctly
```

## Form Validation Scenarios

### Valid Scenarios
- Current password is correct
- New password meets all requirements
- Confirm password matches new password
- New password is different from current password

### Invalid Scenarios
- Empty current password
- Empty new password
- Empty confirm password
- Passwords do not match
- New password same as current password
- Invalid password format (doesn't meet requirements)

## URL Structure

### Reset Password URL Format
```
http://localhost:3000/reset-password?access_token=TOKEN&refresh_token=REFRESH_TOKEN
```

### Required Parameters
- `access_token`: Supabase access token for authentication
- `refresh_token`: Supabase refresh token for session management

## Error Handling

### Common Errors and Solutions

1. **Rate Limiting**
   - **Error**: "For security purposes, you can only request this after X seconds"
   - **Solution**: Wait the specified time before requesting another reset

2. **Invalid Reset Link**
   - **Error**: "Invalid or expired reset link. Please request a new password reset."
   - **Solution**: Request a new password reset email

3. **Incorrect Current Password**
   - **Error**: "Current password is incorrect"
   - **Solution**: Enter the correct current password

4. **Password Requirements Not Met**
   - **Error**: "Password does not meet all requirements."
   - **Solution**: Ensure password meets all requirements (length, case, numbers, special chars)

5. **Passwords Don't Match**
   - **Error**: "New passwords do not match"
   - **Solution**: Ensure confirm password matches new password

## Security Features

### Built-in Security Measures
- Rate limiting on password reset requests
- Token-based authentication for reset process
- Current password verification before allowing changes
- Strong password requirements
- Session management with refresh tokens
- Audit logging for security events

### Best Practices
- Use strong, unique passwords
- Don't share reset links
- Complete the reset process promptly
- Log out of other sessions after password change
- Monitor account activity after password changes

## Troubleshooting

### Email Not Received
1. Check spam/junk folder
2. Verify email address is correct
3. Wait a few minutes for delivery
4. Request a new reset if needed

### Reset Link Not Working
1. Ensure link is complete and not truncated
2. Check if link has expired
3. Request a new reset link
4. Clear browser cache and try again

### Password Reset Fails
1. Verify current password is correct
2. Ensure new password meets all requirements
3. Check that confirm password matches
4. Try a different new password

## Development Notes

### Testing Without Rate Limits
- Use the validation test script for comprehensive testing
- Mock the email sending for development
- Test with different email addresses
- Verify all validation scenarios

### Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous key
- `NEXT_PUBLIC_SITE_URL`: Application base URL

### File Structure
```
app/
├── forgot-password/
│   └── page.tsx
└── reset-password/
    └── page.tsx

components/
├── auth-form.tsx
└── reset-password-form.tsx

lib/
├── validation.ts
└── supabase.ts

scripts/
├── test-password-reset-flow.js
└── test-password-reset-validation.js
```

## Future Enhancements

### Potential Improvements
- Add CAPTCHA for additional security
- Implement password history checking
- Add two-factor authentication support
- Enhanced audit logging
- Password strength meter improvements
- Mobile-optimized reset flow

### Monitoring and Analytics
- Track password reset success rates
- Monitor rate limiting events
- Analyze password strength patterns
- User behavior analytics

---

For technical support or questions about the password reset flow, please refer to the test scripts or contact the development team.
