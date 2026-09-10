-- Migration: Create otp_resets table for password reset OTPs
CREATE TABLE IF NOT EXISTS otp_resets (
  email TEXT PRIMARY KEY,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
