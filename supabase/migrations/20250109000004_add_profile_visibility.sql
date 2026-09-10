-- Add profile visibility and username fields
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS profile_visibility TEXT DEFAULT 'private' CHECK (profile_visibility IN ('public', 'recruiters', 'private')),
ADD COLUMN IF NOT EXISTS public_profile_url TEXT;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Create index for public profile visibility
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON profiles(profile_visibility);

-- Function to generate unique username
CREATE OR REPLACE FUNCTION generate_unique_username(full_name TEXT)
RETURNS TEXT AS $$
DECLARE
    base_username TEXT;
    generated_username TEXT;
    counter INTEGER := 0;
BEGIN
    -- Clean the name and create base username
    base_username := LOWER(REGEXP_REPLACE(full_name, '[^a-zA-Z0-9]', '', 'g'));
    
    -- If base_username is empty, use a default
    IF base_username = '' THEN
        base_username := 'user';
    END IF;
    
    generated_username := base_username;
    
    -- Keep trying until we find a unique username
    WHILE EXISTS(SELECT 1 FROM profiles WHERE username = generated_username) LOOP
        counter := counter + 1;
        generated_username := base_username || counter::TEXT;
    END LOOP;
    
    RETURN generated_username;
END;
$$ LANGUAGE plpgsql;

-- Update existing profiles with usernames if they don't have one
UPDATE profiles 
SET username = generate_unique_username(full_name)
WHERE username IS NULL;

-- Update public profile URLs for existing public profiles
UPDATE profiles 
SET public_profile_url = CONCAT('https://yourdomain.com/profile/', username)
WHERE profile_visibility = 'public' AND public_profile_url IS NULL;
