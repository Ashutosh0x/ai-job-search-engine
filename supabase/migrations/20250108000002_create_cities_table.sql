-- Create cities table
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  state_id INTEGER NOT NULL,
  state_code VARCHAR(255) NOT NULL,
  country_id INTEGER NOT NULL,
  country_code CHAR(2) NOT NULL,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flag BOOLEAN DEFAULT TRUE,
  wikiDataId VARCHAR(255),
  FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE CASCADE,
  FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all users to read cities
CREATE POLICY "Allow all users to read cities" ON cities
  FOR SELECT USING (true); 