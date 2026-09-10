require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  try {
    const { data, error } = await supabase
      .from('countries')
      .select('*')
      .limit(1);
    
    console.log('Schema check result:', { data, error });
    
    // Try to get table info
    const { data: tableInfo, error: tableError } = await supabase
      .rpc('exec_sql', { 
        sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'countries' ORDER BY ordinal_position;" 
      });
    
    console.log('Table info:', { tableInfo, tableError });
    
  } catch (error) {
    console.error('Error checking schema:', error);
  }
}

checkSchema(); 