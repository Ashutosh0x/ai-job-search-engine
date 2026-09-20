CREATE TABLE IF NOT EXISTS linkedin_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_url TEXT NOT NULL,
  full_name TEXT,
  headline TEXT,
  location TEXT,
  about TEXT,
  photo_url TEXT,
  connection_count INTEGER,
  experience JSONB DEFAULT '[]',
  education JSONB DEFAULT '[]',
  skills TEXT[] DEFAULT '{}',
  certifications JSONB DEFAULT '[]',
  languages TEXT[] DEFAULT '{}',
  recommendation_count INTEGER DEFAULT 0,
  ai_analysis JSONB,
  contact_discovery JSONB,
  profile_type TEXT DEFAULT 'contact' CHECK (profile_type IN ('self', 'contact')),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, linkedin_url)
);

CREATE INDEX idx_linkedin_profiles_user ON linkedin_profiles(user_id);
CREATE INDEX idx_linkedin_profiles_url ON linkedin_profiles(linkedin_url);

-- RLS policies
ALTER TABLE linkedin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profiles" ON linkedin_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profiles" ON linkedin_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profiles" ON linkedin_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own profiles" ON linkedin_profiles FOR DELETE USING (auth.uid() = user_id);
