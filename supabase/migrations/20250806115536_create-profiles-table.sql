-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  location TEXT,
  title TEXT,
  company TEXT,
  bio TEXT,
  experience TEXT,
  education TEXT,
  skills TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  preferences JSONB DEFAULT '{}'::jsonb
);

-- Enable Row Level Security on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view their own profile
CREATE POLICY "Users can view their own profile"
  ON profiles
  FOR SELECT
  USING (id = auth.uid());

-- Create policy for users to update their own profile
CREATE POLICY "Users can update their own profile"
  ON profiles
  FOR UPDATE
  USING (id = auth.uid());

-- Create policy for users to insert their own profile
CREATE POLICY "Users can insert their own profile"
  ON profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

-- Create policy for users to delete their own profile
CREATE POLICY "Users can delete their own profile"
  ON profiles
  FOR DELETE
  USING (id = auth.uid());
