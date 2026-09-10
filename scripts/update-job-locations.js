require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Location mapping for common cities
const locationMapping = {
  'Berlin': { country_code: 'DE', state_code: 'BE', city_name: 'Berlin' },
  'Bengaluru': { country_code: 'IN', state_code: 'KA', city_name: 'Bengaluru' },
  'Mumbai': { country_code: 'IN', state_code: 'MH', city_name: 'Mumbai' },
  'New York': { country_code: 'US', state_code: 'NY', city_name: 'New York' },
  'San Francisco': { country_code: 'US', state_code: 'CA', city_name: 'San Francisco' },
  'London': { country_code: 'GB', state_code: 'ENG', city_name: 'London' },
  'Paris': { country_code: 'FR', state_code: 'IDF', city_name: 'Paris' },
  'Tokyo': { country_code: 'JP', state_code: '13', city_name: 'Tokyo' },
  'Sydney': { country_code: 'AU', state_code: 'NSW', city_name: 'Sydney' },
  'Toronto': { country_code: 'CA', state_code: 'ON', city_name: 'Toronto' }
};

async function updateJobLocations() {
  console.log('Updating job locations...');
  
  try {
    // Get all jobs
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, location');
    
    if (error) throw error;
    
    console.log(`Found ${jobs.length} jobs to update`);
    
    for (const job of jobs) {
      if (job.location && locationMapping[job.location]) {
        const mapping = locationMapping[job.location];
        
        const { error: updateError } = await supabase
          .from('jobs')
          .update({
            country_code: mapping.country_code,
            state_code: mapping.state_code,
            city_name: mapping.city_name
          })
          .eq('id', job.id);
        
        if (updateError) {
          console.error(`Error updating job ${job.id}:`, updateError.message);
        } else {
          console.log(`Updated job ${job.id} (${job.location})`);
        }
      }
    }
    
    console.log('Job locations updated successfully!');
  } catch (error) {
    console.error('Error updating job locations:', error);
  }
}

if (require.main === module) {
  updateJobLocations().catch(console.error);
}

module.exports = { updateJobLocations }; 