const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkProfilesSchema() {
  try {
    console.log('🔍 Checking profiles table schema...')

    // Query to get table schema information
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'profiles')
      .eq('table_schema', 'public')

    if (error) {
      console.error('Error checking schema:', error)
      return
    }

    console.log('✅ Profiles table columns:')
    data.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`)
    })

    // Try a simple update to test
    console.log('\n🧪 Testing simple update...')
    const testUpdate = await supabase
      .from('profiles')
      .update({ full_name: 'Test Update' })
      .eq('id', 'test-id')
      .limit(1)

    console.log('Test update result:', testUpdate.error ? 'Error' : 'Success')
    if (testUpdate.error) {
      console.log('Error details:', testUpdate.error)
    }

  } catch (error) {
    console.error('Script error:', error)
  }
}

checkProfilesSchema()
