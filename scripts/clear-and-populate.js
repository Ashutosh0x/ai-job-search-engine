require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function clearTables() {
  console.log('Clearing existing data...');
  
  try {
    // Clear tables in reverse dependency order
    await supabase.from('cities').delete().neq('id', 0);
    await supabase.from('states').delete().neq('id', 0);
    await supabase.from('countries').delete().neq('id', 0);
    
    console.log('Tables cleared successfully!');
  } catch (error) {
    console.error('Error clearing tables:', error);
  }
}

async function populateCountries() {
  console.log('Populating countries...');
  
  try {
    // Read the countries SQL file
    const countriesSqlPath = path.join(__dirname, '../countries-states-cities-database/psql/countries.sql');
    const countriesSql = fs.readFileSync(countriesSqlPath, 'utf8');
    
    // Extract INSERT statements and parse them
    const insertMatches = countriesSql.match(/INSERT INTO public\.countries VALUES[^;]+;/g);
    
    if (!insertMatches) {
      console.log('No INSERT statements found in countries.sql');
      return;
    }
    
    console.log(`Found ${insertMatches.length} country insert statements`);
    
    // Process each INSERT statement
    for (let i = 0; i < insertMatches.length; i++) {
      const insertStatement = insertMatches[i];
      
      // Extract values from the INSERT statement
      const valuesMatch = insertStatement.match(/VALUES\s*\(([^)]+)\)/);
      if (valuesMatch) {
        const valuesStr = valuesMatch[1];
        const values = parseValues(valuesStr);
        
        if (values.length >= 4) { // Ensure we have at least id, name, iso2
          const countryData = {
            id: parseInt(values[0]),
            name: values[1].replace(/^'|'$/g, ''), // Remove quotes
            iso2: values[4].replace(/^'|'$/g, ''), // Remove quotes
            iso3: values[2].replace(/^'|'$/g, ''),
            numeric_code: values[3].replace(/^'|'$/g, ''),
            phonecode: values[5].replace(/^'|'$/g, ''),
            capital: values[6].replace(/^'|'$/g, ''),
            currency: values[7].replace(/^'|'$/g, ''),
            currency_name: values[8].replace(/^'|'$/g, ''),
            currency_symbol: values[9].replace(/^'|'$/g, ''),
            tld: values[10].replace(/^'|'$/g, ''),
            native: values[11].replace(/^'|'$/g, ''),
            region: values[12].replace(/^'|'$/g, ''),
            subregion: values[14].replace(/^'|'$/g, ''),
            nationality: values[16].replace(/^'|'$/g, ''),
            timezones: values[17].replace(/^'|'$/g, ''),
            translations: values[18].replace(/^'|'$/g, ''),
            latitude: parseFloat(values[19]) || null,
            longitude: parseFloat(values[20]) || null,
            emoji: values[21].replace(/^'|'$/g, ''),
            emojiu: values[22].replace(/^'|'$/g, ''),
            flag: parseInt(values[25]) || 1,
            wikidataid: values[26].replace(/^'|'$/g, '')
          };
          
          try {
            const { error } = await supabase
              .from('countries')
              .insert(countryData);
              
            if (error) {
              console.error(`Error inserting country ${countryData.name}:`, error.message);
            } else {
              console.log(`Inserted country: ${countryData.name}`);
            }
          } catch (error) {
            console.error(`Error inserting country ${countryData.name}:`, error.message);
          }
        }
      }
    }
    
    console.log('Countries populated successfully!');
  } catch (error) {
    console.error('Error populating countries:', error);
  }
}

function parseValues(valuesStr) {
  // Simple CSV-like parsing for the values
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < valuesStr.length; i++) {
    const char = valuesStr[i];
    
    if (char === "'" && (i === 0 || valuesStr[i-1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    values.push(current.trim());
  }
  
  return values;
}

async function main() {
  console.log('Starting location data population...');
  
  await clearTables();
  await populateCountries();
  
  console.log('Location data population completed!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { populateCountries }; 