# Location Database Setup

This guide will help you set up the countries, states, and cities database for your job search application.

## Step 1: Run Database Migrations

First, apply the database migrations to create the location tables and update the jobs table:

```bash
# Apply the migrations to your Supabase database
supabase db push
```

This will create:
- `countries` table with all countries worldwide
- `states` table with states/provinces for each country
- `cities` table with cities for each state
- Add location columns to your existing `jobs` table

## Step 2: Populate Location Data

Run the population script to fill the tables with countries, states, and cities data:

```bash
# Make sure you have the required environment variables set
export NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Run the population script
npm run populate-locations
```

This will populate:
- **Countries**: 250+ countries with ISO codes, currencies, timezones
- **States**: 4,000+ states/provinces worldwide
- **Cities**: 150,000+ cities worldwide

## Step 3: Update Job Data with Location Codes

Update your existing job records to include proper location codes:

```bash
# Run the job location update script
npm run update-job-locations
```

This script will map common cities like:
- Berlin → Germany (DE)
- Bengaluru → India (IN)
- New York → United States (US)
- London → United Kingdom (GB)
- And many more...

## Step 4: Test the Location Filters

Your dashboard now has cascading location filters:

1. **Country Filter**: Select from 250+ countries worldwide
2. **State Filter**: Shows states for the selected country (4,000+ states)
3. **City Filter**: Shows cities for the selected state (150,000+ cities)

### Features:
- **Cascading Dropdowns**: State dropdown only appears after selecting a country
- **Real-time Filtering**: Jobs filter immediately as you select options
- **Loading States**: Shows loading indicators while fetching data
- **"All Locations" Options**: Each dropdown has an option to show all locations at that level

## Database Schema

### Countries Table
```sql
CREATE TABLE countries (
  id BIGINT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  iso2 CHAR(2),           -- Country code (e.g., 'US', 'DE')
  iso3 CHAR(3),           -- 3-letter code (e.g., 'USA', 'DEU')
  currency VARCHAR(255),   -- Currency code
  emoji VARCHAR(191),      -- Country flag emoji
  -- Additional fields for translations, timezones, etc.
);
```

### States Table
```sql
CREATE TABLE states (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  country_id BIGINT NOT NULL,
  country_code CHAR(2) NOT NULL,  -- Foreign key to countries.iso2
  iso2 VARCHAR(255),              -- State code
  type VARCHAR(191),              -- 'state', 'province', 'region', etc.
  -- Additional location data
);
```

### Cities Table
```sql
CREATE TABLE cities (
  id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  state_id BIGINT NOT NULL,
  state_code VARCHAR(255) NOT NULL,  -- Foreign key to states
  country_id BIGINT NOT NULL,
  country_code CHAR(2) NOT NULL,     -- Foreign key to countries.iso2
  -- Additional location data
);
```

### Jobs Table (Updated)
```sql
-- New columns added to existing jobs table
ALTER TABLE jobs ADD COLUMN country_code CHAR(2);
ALTER TABLE jobs ADD COLUMN state_code VARCHAR(255);
ALTER TABLE jobs ADD COLUMN city_name VARCHAR(255);
```

## Usage Examples

### Filter by Country Only
```javascript
// Select "Germany" in country dropdown
// Shows all jobs in Germany regardless of state/city
```

### Filter by Country and State
```javascript
// Select "Germany" then "Berlin" in state dropdown
// Shows all jobs in Berlin, Germany
```

### Filter by Country, State, and City
```javascript
// Select "Germany" → "Berlin" → "Berlin" in city dropdown
// Shows jobs specifically in Berlin city, Berlin state, Germany
```

## Troubleshooting

### If the population script fails:
1. Check that your Supabase credentials are correct
2. Ensure the database tables were created successfully
3. Verify that the countries-states-cities-database folder exists
4. Check that you have sufficient database storage (cities table is ~24MB)

### If location filters don't work:
1. Check that your jobs table has the required location columns
2. Verify that job records have proper country_code, state_code, and city_name values
3. Check the browser console for any errors
4. Ensure the location data was populated successfully

### If dropdowns are empty:
1. Check that the countries/states/cities tables have data
2. Verify the foreign key relationships are correct
3. Check the network tab for API errors

## Performance Notes

- **Countries**: ~250 records, loads instantly
- **States**: ~4,000 records, loads in ~1-2 seconds
- **Cities**: ~150,000 records, loads in ~2-3 seconds
- **Indexes**: Created on country_code, state_code, city_name for fast filtering

## Next Steps

1. **Add more job data** with proper location codes
2. **Customize the UI** to match your design preferences
3. **Add more filters** like salary range, experience level, etc.
4. **Implement search functionality** within the location filters
5. **Add location-based job recommendations**

## Data Source

The location data comes from the [countries-states-cities-database](https://github.com/dr5hn/countries-states-cities-database) project, which provides comprehensive location data for countries, states/provinces, and cities worldwide.

## Scripts Available

- `npm run populate-locations`: Populate countries, states, and cities tables
- `npm run update-job-locations`: Update existing job data with location codes
- `supabase db push`: Apply database migrations 