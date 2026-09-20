-- Email patterns discovered per company domain
CREATE TABLE IF NOT EXISTS email_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  pattern TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  sample_emails TEXT[] DEFAULT '{}',
  sources TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(domain, pattern)
);

CREATE TABLE IF NOT EXISTS contact_reveals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  domain TEXT,
  title TEXT,
  linkedin_url TEXT,
  emails JSONB DEFAULT '[]',
  phones JSONB DEFAULT '[]',
  social_profiles JSONB DEFAULT '{}',
  revealed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, linkedin_url)
);

CREATE TABLE IF NOT EXISTS contact_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_list_items (
  list_id UUID REFERENCES contact_lists(id) ON DELETE CASCADE,
  reveal_id UUID REFERENCES contact_reveals(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, reveal_id)
);

CREATE INDEX IF NOT EXISTS idx_email_patterns_domain ON email_patterns(domain);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_user ON contact_reveals(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_domain ON contact_reveals(domain);
CREATE INDEX IF NOT EXISTS idx_contact_lists_user ON contact_lists(user_id);

-- RLS Policies
ALTER TABLE contact_reveals ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own reveals" ON contact_reveals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own reveals" ON contact_reveals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own reveals" ON contact_reveals FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users see own lists" ON contact_lists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own lists" ON contact_lists FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own list items" ON contact_list_items FOR SELECT
  USING (list_id IN (SELECT id FROM contact_lists WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own list items" ON contact_list_items FOR ALL
  USING (list_id IN (SELECT id FROM contact_lists WHERE user_id = auth.uid()));

-- email_patterns is public read, admin write
ALTER TABLE email_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read patterns" ON email_patterns FOR SELECT USING (true);
