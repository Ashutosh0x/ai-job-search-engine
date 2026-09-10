-- Create experiences table for storing multiple work experiences per user
CREATE TABLE IF NOT EXISTS experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_website TEXT,
  company_logo_url TEXT,
  location TEXT,
  start_date DATE,
  end_date DATE,
  is_current_job BOOLEAN DEFAULT false,
  years_of_experience DECIMAL(3,1),
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Create index for faster queries by user_id
CREATE INDEX IF NOT EXISTS idx_experiences_user_id ON experiences(user_id);

-- Create index for ordering by start_date
CREATE INDEX IF NOT EXISTS idx_experiences_start_date ON experiences(start_date DESC);

-- Enable Row Level Security on experiences table
ALTER TABLE experiences ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own experiences
CREATE POLICY "Users can view their own experiences"
  ON experiences
  FOR SELECT
  USING (user_id = auth.uid());

-- Create policy for users to insert their own experiences
CREATE POLICY "Users can insert their own experiences"
  ON experiences
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Create policy for users to update their own experiences
CREATE POLICY "Users can update their own experiences"
  ON experiences
  FOR UPDATE
  USING (user_id = auth.uid());

-- Create policy for users to delete their own experiences
CREATE POLICY "Users can delete their own experiences"
  ON experiences
  FOR DELETE
  USING (user_id = auth.uid());

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_experiences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_experiences_updated_at
  BEFORE UPDATE ON experiences
  FOR EACH ROW
  EXECUTE FUNCTION update_experiences_updated_at();
