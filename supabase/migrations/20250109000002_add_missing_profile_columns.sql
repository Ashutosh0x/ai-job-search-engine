-- Add missing columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS company TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS experience TEXT,
ADD COLUMN IF NOT EXISTS education TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';

-- Update existing profiles to have default values (only for columns that exist)
UPDATE profiles 
SET 
  title = COALESCE(title, ''),
  company = COALESCE(company, ''),
  bio = COALESCE(bio, ''),
  experience = COALESCE(experience, ''),
  education = COALESCE(education, ''),
  phone = COALESCE(phone, ''),
  location = COALESCE(location, '')
WHERE id IS NOT NULL;
