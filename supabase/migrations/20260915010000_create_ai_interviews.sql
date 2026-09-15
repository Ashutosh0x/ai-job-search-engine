-- A transcript is sensitive candidate data. These tables deliberately store
-- text/structured evidence only; raw microphone audio is never persisted.
CREATE TABLE IF NOT EXISTS interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  job_title text NOT NULL,
  company_name text NOT NULL,
  job_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completing', 'completed', 'failed')),
  interview_type text NOT NULL DEFAULT 'mixed' CHECK (interview_type IN ('technical', 'behavioral', 'role-specific', 'mixed')),
  duration_seconds integer NOT NULL DEFAULT 1200 CHECK (duration_seconds IN (600, 1200, 1800)),
  started_at timestamptz,
  completed_at timestamptz,
  interview_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  interview_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluation jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_created
  ON interview_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_status
  ON interview_sessions(user_id, status);

CREATE TABLE IF NOT EXISTS interview_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  speaker text NOT NULL CHECK (speaker IN ('interviewer', 'candidate')),
  transcript text NOT NULL CHECK (char_length(transcript) <= 8000),
  question_id text,
  skills text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(interview_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_interview_turns_interview_sequence
  ON interview_turns(interview_id, sequence);

ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_turns ENABLE ROW LEVEL SECURITY;

-- The browser may read its own records, but cannot write state, turns, or an
-- evaluation directly. All mutations use the service-side API after an
-- ownership check.
CREATE POLICY "Users can read their own interview sessions"
  ON interview_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can read their own interview turns"
  ON interview_turns FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM interview_sessions
    WHERE interview_sessions.id = interview_turns.interview_id
      AND interview_sessions.user_id = auth.uid()
  ));

-- Mutations are intentionally service-side; the API verifies ownership before
-- inserting turns/evaluation, so a browser cannot forge a score.

CREATE OR REPLACE FUNCTION set_interview_sessions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_sessions_set_updated_at ON interview_sessions;
CREATE TRIGGER interview_sessions_set_updated_at
  BEFORE UPDATE ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION set_interview_sessions_updated_at();
