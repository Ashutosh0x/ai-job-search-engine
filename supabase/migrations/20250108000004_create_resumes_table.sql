-- Create resumes table for storing uploaded resumes and analysis results
CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  file_type text,
  parsed_text text,
  parsed_info jsonb,
  ats_score integer,
  ats_analysis jsonb,
  insights jsonb,
  status text DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'parsed', 'analyzing', 'analyzed', 'failed')),
  source text DEFAULT 'upload',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_status ON resumes(status);
CREATE INDEX IF NOT EXISTS idx_resumes_created_at ON resumes(created_at);

-- Enable Row Level Security
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to only see their own resumes
CREATE POLICY "Users can view their own resumes" ON resumes
  FOR SELECT USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own resumes
CREATE POLICY "Users can insert their own resumes" ON resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own resumes
CREATE POLICY "Users can update their own resumes" ON resumes
  FOR UPDATE USING (auth.uid() = user_id);

-- Create policy to allow users to delete their own resumes
CREATE POLICY "Users can delete their own resumes" ON resumes
  FOR DELETE USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_resumes_updated_at BEFORE UPDATE ON resumes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 