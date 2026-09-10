-- Create educations table for storing multiple education entries per user
CREATE TABLE IF NOT EXISTS educations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  degree TEXT,
  field_of_study TEXT,
  education_website TEXT,
  education_logo_url TEXT,
  location TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT false,
  years_of_education DECIMAL(3,1),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_educations_user_id ON educations(user_id);
CREATE INDEX IF NOT EXISTS idx_educations_start_date ON educations(start_date DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE educations ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$ BEGIN
  -- Drop existing policies if they exist to keep migration idempotent
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'educations' AND policyname = 'Users can view their own educations.'
  ) THEN
    EXECUTE 'DROP POLICY "Users can view their own educations." ON public.educations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'educations' AND policyname = 'Users can insert their own educations.'
  ) THEN
    EXECUTE 'DROP POLICY "Users can insert their own educations." ON public.educations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'educations' AND policyname = 'Users can update their own educations.'
  ) THEN
    EXECUTE 'DROP POLICY "Users can update their own educations." ON public.educations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'educations' AND policyname = 'Users can delete their own educations.'
  ) THEN
    EXECUTE 'DROP POLICY "Users can delete their own educations." ON public.educations';
  END IF;
END $$;

CREATE POLICY "Users can view their own educations."
  ON educations FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own educations."
  ON educations FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own educations."
  ON educations FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own educations."
  ON educations FOR DELETE USING (auth.uid() = user_id);


