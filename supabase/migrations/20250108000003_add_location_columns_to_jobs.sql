-- Add location columns to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country_code CHAR(2);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS state_code VARCHAR(255);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS city_name VARCHAR(255);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_jobs_country_code ON jobs(country_code);
CREATE INDEX IF NOT EXISTS idx_jobs_state_code ON jobs(state_code);
CREATE INDEX IF NOT EXISTS idx_jobs_city_name ON jobs(city_name); 