-- Create states table
CREATE TABLE IF NOT EXISTS states (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  country_id INTEGER NOT NULL,
  country_code CHAR(2) NOT NULL,
  fips_code VARCHAR(255),
  iso2 VARCHAR(255),
  type VARCHAR(191),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flag BOOLEAN DEFAULT TRUE,
  wikiDataId VARCHAR(255),
  FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE states ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all users to read states
CREATE POLICY "Allow all users to read states" ON states
  FOR SELECT USING (true); 