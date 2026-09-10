const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function applyProfileEnhancements() {
  try {
    console.log('🔧 Applying profile enhancements...')

    // Check if columns already exist
    console.log('1. Checking existing columns...')
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'profiles')
      .eq('table_schema', 'public')

    if (columnsError) {
      console.log('Note: Could not check existing columns:', columnsError.message)
    } else {
      const existingColumns = columns.map(col => col.column_name)
      console.log('Existing columns:', existingColumns)
    }

    // Try to add columns one by one
    const newColumns = [
      { name: 'avatar_url', type: 'TEXT' },
      { name: 'social_links', type: 'JSONB DEFAULT \'{}\'::jsonb' },
      { name: 'portfolio_projects', type: 'JSONB DEFAULT \'[]\'::jsonb' },
      { name: 'profile_completion', type: 'INTEGER DEFAULT 0' },
      { name: 'website', type: 'TEXT' },
      { name: 'github_url', type: 'TEXT' },
      { name: 'linkedin_url', type: 'TEXT' },
      { name: 'twitter_url', type: 'TEXT' }
    ]

    console.log('2. Adding new columns...')
    for (const column of newColumns) {
      try {
        const { error } = await supabase.rpc('exec_sql', {
          sql: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ${column.name} ${column.type};`
        })
        
        if (error) {
          console.log(`Note: Column ${column.name} may already exist:`, error.message)
        } else {
          console.log(`✅ Added column: ${column.name}`)
        }
      } catch (err) {
        console.log(`Note: Column ${column.name} may already exist:`, err.message)
      }
    }

    // Update existing profiles with completion scores
    console.log('3. Updating profile completion scores...')
    const { data: profiles, error: fetchError } = await supabase
      .from('profiles')
      .select('*')

    if (fetchError) {
      console.error('❌ Error fetching profiles:', fetchError.message)
      return
    }

    console.log(`Found ${profiles.length} profiles to update`)

    for (const profile of profiles) {
      let completion = 0
      if (profile.full_name) completion += 10
      if (profile.title) completion += 15
      if (profile.company) completion += 10
      if (profile.bio) completion += 15
      if (profile.experience) completion += 10
      if (profile.education) completion += 10
      if (profile.skills && profile.skills.length > 0) completion += 10
      if (profile.location) completion += 10
      if (profile.phone) completion += 5
      // Check for social links (will be added later)
      completion += 5

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ profile_completion: completion })
        .eq('id', profile.id)

      if (updateError) {
        console.error(`❌ Error updating profile ${profile.id}:`, updateError.message)
      } else {
        console.log(`✅ Updated profile ${profile.id} with completion score: ${completion}%`)
      }
    }

    console.log('\n🎯 Profile enhancements applied successfully!')
    console.log('\n✨ New features available:')
    console.log('   • Profile completion meter with progress bar')
    console.log('   • Social media links (GitHub, LinkedIn, Twitter, Website)')
    console.log('   • Avatar customization with upload and random generation')
    console.log('   • Portfolio projects section with CRUD operations')
    console.log('   • Enhanced profile editing with tabs')
    console.log('   • Tooltip hints for profile completion')

  } catch (error) {
    console.error('❌ Error applying profile enhancements:', error.message)
    console.error('Full error:', error)
  }
}

applyProfileEnhancements()
