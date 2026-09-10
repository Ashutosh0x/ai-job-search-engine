-- Create countries table
CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  iso3 CHAR(3),
  numeric_code CHAR(3),
  iso2 CHAR(2),
  phonecode VARCHAR(255),
  capital VARCHAR(255),
  currency VARCHAR(255),
  currency_name VARCHAR(255),
  currency_symbol VARCHAR(255),
  tld VARCHAR(255),
  native VARCHAR(255),
  region VARCHAR(255),
  region_id INTEGER,
  subregion VARCHAR(255),
  subregion_id INTEGER,
  nationality VARCHAR(255),
  timezones TEXT,
  translations TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  emoji VARCHAR(191),
  emojiU VARCHAR(191),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  flag BOOLEAN DEFAULT TRUE,
  wikiDataId VARCHAR(255)
);

-- Enable RLS
ALTER TABLE countries ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all users to read countries
CREATE POLICY "Allow all users to read countries" ON countries
  FOR SELECT USING (true); 