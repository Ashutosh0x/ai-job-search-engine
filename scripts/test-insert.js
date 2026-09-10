require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsert() {
  try {
    // Try inserting with minimal fields first
    const testData = {
      name: 'Test Country',
      iso2: 'TC',
      iso3: 'TST'
    };
    
    const { data, error } = await supabase
      .from('countries')
      .insert(testData)
      .select();
    
    console.log('Test insert result:', { data, error });
    
    if (error) {
      console.log('Error details:', error);
    }
    
  } catch (error) {
    console.error('Error in test insert:', error);
  }
}

testInsert(); 