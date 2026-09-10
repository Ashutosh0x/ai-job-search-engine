require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function addGermanLocations() {
  console.log('Adding German locations...');
  
  try {
    // First, get Germany's country ID
    const { data: germany, error: germanyError } = await supabase
      .from('countries')
      .select('id')
      .eq('iso2', 'DE')
      .single();
    
    if (germanyError) {
      console.error('Error finding Germany:', germanyError);
      return;
    }
    
    console.log('Found Germany with ID:', germany.id);
    
    // Add German states
    const germanStates = [
      { name: 'Berlin', country_code: 'DE', iso2: 'BE' },
      { name: 'Bavaria', country_code: 'DE', iso2: 'BY' },
      { name: 'Baden-Württemberg', country_code: 'DE', iso2: 'BW' },
      { name: 'Hamburg', country_code: 'DE', iso2: 'HH' },
      { name: 'Hesse', country_code: 'DE', iso2: 'HE' },
      { name: 'Lower Saxony', country_code: 'DE', iso2: 'NI' },
      { name: 'North Rhine-Westphalia', country_code: 'DE', iso2: 'NW' },
      { name: 'Rhineland-Palatinate', country_code: 'DE', iso2: 'RP' },
      { name: 'Saarland', country_code: 'DE', iso2: 'SL' },
      { name: 'Saxony', country_code: 'DE', iso2: 'SN' },
      { name: 'Saxony-Anhalt', country_code: 'DE', iso2: 'ST' },
      { name: 'Schleswig-Holstein', country_code: 'DE', iso2: 'SH' },
      { name: 'Thuringia', country_code: 'DE', iso2: 'TH' },
      { name: 'Bremen', country_code: 'DE', iso2: 'HB' },
      { name: 'Brandenburg', country_code: 'DE', iso2: 'BB' },
      { name: 'Mecklenburg-Vorpommern', country_code: 'DE', iso2: 'MV' }
    ];
    
    console.log('Adding German states...');
    for (const state of germanStates) {
      const { error } = await supabase
        .from('states')
        .insert({
          name: state.name,
          country_id: germany.id,
          country_code: state.country_code,
          iso2: state.iso2,
          flag: true
        });
      
      if (error) {
        console.error(`Error inserting state ${state.name}:`, error.message);
      } else {
        console.log(`Added state: ${state.name}`);
      }
    }
    
    // Get Berlin state ID
    const { data: berlinState, error: berlinStateError } = await supabase
      .from('states')
      .select('id')
      .eq('name', 'Berlin')
      .single();
    
    if (berlinStateError) {
      console.error('Error finding Berlin state:', berlinStateError);
      return;
    }
    
    console.log('Found Berlin state with ID:', berlinState.id);
    
    // Add Berlin city
    const { error: berlinCityError } = await supabase
      .from('cities')
      .insert({
        name: 'Berlin',
        state_id: berlinState.id,
        state_code: 'BE',
        country_id: germany.id,
        country_code: 'DE',
        flag: true
      });
    
    if (berlinCityError) {
      console.error('Error inserting Berlin city:', berlinCityError.message);
    } else {
      console.log('Added city: Berlin');
    }
    
    // Add some other major German cities
    const majorCities = [
      { name: 'Munich', state_name: 'Bavaria', state_code: 'BY' },
      { name: 'Hamburg', state_name: 'Hamburg', state_code: 'HH' },
      { name: 'Frankfurt', state_name: 'Hesse', state_code: 'HE' },
      { name: 'Cologne', state_name: 'North Rhine-Westphalia', state_code: 'NW' },
      { name: 'Stuttgart', state_name: 'Baden-Württemberg', state_code: 'BW' },
      { name: 'Düsseldorf', state_name: 'North Rhine-Westphalia', state_code: 'NW' },
      { name: 'Dortmund', state_name: 'North Rhine-Westphalia', state_code: 'NW' },
      { name: 'Essen', state_name: 'North Rhine-Westphalia', state_code: 'NW' },
      { name: 'Leipzig', state_name: 'Saxony', state_code: 'SN' },
      { name: 'Bremen', state_name: 'Bremen', state_code: 'HB' }
    ];
    
    console.log('Adding major German cities...');
    for (const city of majorCities) {
      // Get state ID for this city
      const { data: state, error: stateError } = await supabase
        .from('states')
        .select('id')
        .eq('name', city.state_name)
        .single();
      
      if (stateError) {
        console.error(`Error finding state ${city.state_name}:`, stateError);
        continue;
      }
      
      const { error: cityError } = await supabase
        .from('cities')
        .insert({
          name: city.name,
          state_id: state.id,
          state_code: city.state_code,
          country_id: germany.id,
          country_code: 'DE',
          flag: true
        });
      
      if (cityError) {
        console.error(`Error inserting city ${city.name}:`, cityError.message);
      } else {
        console.log(`Added city: ${city.name}`);
      }
    }
    
    console.log('German locations added successfully!');
  } catch (error) {
    console.error('Error adding German locations:', error);
  }
}

addGermanLocations(); 