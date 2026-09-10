require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function populateCountries() {
  console.log('Populating countries...');
  
  try {
    // Read the countries SQL file (PostgreSQL format)
    const countriesSqlPath = path.join(__dirname, '../countries-states-cities-database/psql/countries.sql');
    const countriesSql = fs.readFileSync(countriesSqlPath, 'utf8');
    
    // Extract INSERT statements
    const insertMatches = countriesSql.match(/INSERT INTO public\.countries VALUES[^;]+;/g);
    
    if (!insertMatches) {
      console.log('No INSERT statements found in countries.sql');
      return;
    }
    
    for (const insertStatement of insertMatches) {
      try {
        await supabase.rpc('exec_sql', { sql: insertStatement });
        console.log('Inserted countries batch');
      } catch (error) {
        console.error('Error inserting countries:', error.message);
      }
    }
    
    console.log('Countries populated successfully!');
  } catch (error) {
    console.error('Error populating countries:', error);
  }
}

async function populateStates() {
  console.log('Populating states...');
  
  try {
    // Read the states SQL file (PostgreSQL format)
    const statesSqlPath = path.join(__dirname, '../countries-states-cities-database/psql/states.sql');
    const statesSql = fs.readFileSync(statesSqlPath, 'utf8');
    
    // Extract INSERT statements
    const insertMatches = statesSql.match(/INSERT INTO public\.states VALUES[^;]+;/g);
    
    if (!insertMatches) {
      console.log('No INSERT statements found in states.sql');
      return;
    }
    
    for (const insertStatement of insertMatches) {
      try {
        await supabase.rpc('exec_sql', { sql: insertStatement });
        console.log('Inserted states batch');
      } catch (error) {
        console.error('Error inserting states:', error.message);
      }
    }
    
    console.log('States populated successfully!');
  } catch (error) {
    console.error('Error populating states:', error);
  }
}

async function populateCities() {
  console.log('Populating cities...');
  
  try {
    // Read the cities SQL file (PostgreSQL format)
    const citiesSqlPath = path.join(__dirname, '../countries-states-cities-database/psql/cities.sql');
    const citiesSql = fs.readFileSync(citiesSqlPath, 'utf8');
    
    // Extract INSERT statements
    const insertMatches = citiesSql.match(/INSERT INTO public\.cities VALUES[^;]+;/g);
    
    if (!insertMatches) {
      console.log('No INSERT statements found in cities.sql');
      return;
    }
    
    for (const insertStatement of insertMatches) {
      try {
        await supabase.rpc('exec_sql', { sql: insertStatement });
        console.log('Inserted cities batch');
      } catch (error) {
        console.error('Error inserting cities:', error.message);
      }
    }
    
    console.log('Cities populated successfully!');
  } catch (error) {
    console.error('Error populating cities:', error);
  }
}

async function main() {
  console.log('Starting location data population...');
  
  await populateCountries();
  await populateStates();
  await populateCities();
  
  console.log('Location data population completed!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { populateCountries, populateStates, populateCities }; 