-- Add CV URL to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS cv_url TEXT;

-- Optional index to speed up queries filtering by presence of cv_url
CREATE INDEX IF NOT EXISTS idx_profiles_cv_url_present ON profiles ((cv_url IS NOT NULL));

-- Add CV URL to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS cv_url TEXT;

-- Optional index for lookups/filtering by presence
CREATE INDEX IF NOT EXISTS idx_profiles_cv_url ON profiles((cv_url IS NOT NULL));
