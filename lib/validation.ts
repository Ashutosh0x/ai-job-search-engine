export const validateEmail = (email: string) => {
  const errors: string[] = []
  if (!email) errors.push("Email is required")
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format")
  return { isValid: errors.length === 0, errors }
}

/**
 * Upper bound exists only to stop absurd payloads reaching the hashing step;
 * it is not a complexity control. The old limit was 20 characters, which
 * rejected ordinary passphrases and anything a password manager generates.
 * NIST SP 800-63B asks for at least 64 to be accepted.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const validatePassword = (password: string, isSignup: boolean) => {
  const checks = {
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    specialChar: false,
    maxLength: true,
  };

  if (isSignup) {
    checks.length = password.length >= PASSWORD_MIN_LENGTH;
    checks.uppercase = /[A-Z]/.test(password);
    checks.lowercase = /[a-z]/.test(password);
    checks.number = /\d/.test(password);
    checks.specialChar = /[^a-zA-Z0-9]/.test(password);
    checks.maxLength = password.length <= PASSWORD_MAX_LENGTH;
  }

  const isValid = isSignup ? Object.values(checks).every(Boolean) : !!password;
  const errors: string[] = [];
  if (isSignup && !isValid) {
    if (password.length > PASSWORD_MAX_LENGTH) {
      errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
    } else if (password.length < PASSWORD_MIN_LENGTH) {
      errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    } else {
      errors.push("Password must include upper and lower case letters, a number and a symbol.");
    }
  }

  return { isValid, errors, checks };
};

export const validateName = (name: string) => {
  const errors: string[] = []
  if (!name) errors.push("Name is required")
  else if (name.length < 2) errors.push("Name must be at least 2 characters")
  return { isValid: errors.length === 0, errors }
}

export const getPasswordStrength = (password: string) => {
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
    // Was ((strengthIndex + 1) / 5) * 100, so an empty or hopeless password
    // still rendered a 20%-filled bar that never reached 0.
    percentage: (score / 5) * 100,
  };
};
