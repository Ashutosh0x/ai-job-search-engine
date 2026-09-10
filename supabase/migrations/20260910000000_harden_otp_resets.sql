-- Harden the password-reset OTP table.
--
-- 1. `attempts` lets the verify endpoint burn a code after repeated wrong
--    guesses. Without it a six-digit code is only 10^6 wide and can be
--    enumerated by anyone who can call the endpoint.
-- 2. `created_at` supports expiring stale rows and auditing.
-- 3. RLS is enabled with NO policies: the table is only ever touched by the
--    service role (which bypasses RLS), so this makes it unreachable from the
--    anon/authenticated keys that the browser holds. Previously any client
--    could read every pending OTP.

ALTER TABLE otp_resets ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE otp_resets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE otp_resets ENABLE ROW LEVEL SECURITY;

-- Defensive: drop any permissive policy that may have been added by hand.
DROP POLICY IF EXISTS "otp_resets_select" ON otp_resets;
DROP POLICY IF EXISTS "otp_resets_insert" ON otp_resets;
DROP POLICY IF EXISTS "otp_resets_update" ON otp_resets;

REVOKE ALL ON otp_resets FROM anon, authenticated;

-- Expired codes are useless; keep the table small and reduce exposure.
CREATE INDEX IF NOT EXISTS otp_resets_expires_at_idx ON otp_resets (expires_at);
