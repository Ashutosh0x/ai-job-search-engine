-- Add enhanced profile fields
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS portfolio_projects JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS profile_completion INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS github_url TEXT,
ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
ADD COLUMN IF NOT EXISTS twitter_url TEXT;

-- Create index for profile completion
CREATE INDEX IF NOT EXISTS idx_profiles_completion ON profiles(profile_completion);

-- Create a function to calculate profile completion
CREATE OR REPLACE FUNCTION calculate_profile_completion()
RETURNS TRIGGER AS $$
DECLARE
    completion INTEGER := 0;
BEGIN
    -- Basic info (10 points each)
    IF NEW.full_name IS NOT NULL AND NEW.full_name != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Title (15 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'title') 
       AND NEW.title IS NOT NULL AND NEW.title != '' THEN
        completion := completion + 15;
    END IF;
    
    -- Company (10 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'company') 
       AND NEW.company IS NOT NULL AND NEW.company != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Bio (15 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'bio') 
       AND NEW.bio IS NOT NULL AND NEW.bio != '' THEN
        completion := completion + 15;
    END IF;
    
    -- Experience (10 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'experience') 
       AND NEW.experience IS NOT NULL AND NEW.experience != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Education (10 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'education') 
       AND NEW.education IS NOT NULL AND NEW.education != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Skills (10 points)
    IF NEW.skills IS NOT NULL AND array_length(NEW.skills, 1) > 0 THEN
        completion := completion + 10;
    END IF;
    
    -- Location (10 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'location') 
       AND NEW.location IS NOT NULL AND NEW.location != '' THEN
        completion := completion + 10;
    END IF;
    
    -- Phone (5 points) - only if column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'phone') 
       AND NEW.phone IS NOT NULL AND NEW.phone != '' THEN
        completion := completion + 5;
    END IF;
    
    -- Social links (5 points)
    IF (NEW.social_links IS NOT NULL AND NEW.social_links != '{}'::jsonb) OR
       (NEW.github_url IS NOT NULL AND NEW.github_url != '') OR
       (NEW.linkedin_url IS NOT NULL AND NEW.linkedin_url != '') OR
       (NEW.twitter_url IS NOT NULL AND NEW.twitter_url != '') OR
       (NEW.website IS NOT NULL AND NEW.website != '') THEN
        completion := completion + 5;
    END IF;
    
    NEW.profile_completion := completion;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically calculate profile completion
DROP TRIGGER IF EXISTS trigger_calculate_profile_completion ON profiles;
CREATE TRIGGER trigger_calculate_profile_completion
    BEFORE INSERT OR UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION calculate_profile_completion();
