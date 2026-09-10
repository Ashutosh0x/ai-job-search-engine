const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client without authentication
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testSimpleUpload() {
  try {
    console.log('🔍 Testing simple upload...\n')

    const testContent = 'Test resume content'
    const testFileName = `test-${Date.now()}.txt`
    const filePath = `public/${Date.now()}-${testFileName}`
    
    console.log('Upload path:', filePath)
    
    const blob = new Blob([testContent], { type: 'text/plain' })
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resume')
      .upload(filePath, blob, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    if (uploadError) {
      console.log('❌ Upload failed:', uploadError.message)
      console.log('Error details:', uploadError)
    } else {
      console.log('✅ Upload successful!')
      console.log('File path:', uploadData.path)
      
      // Test getting public URL
      const { data: urlData } = supabase.storage
        .from('resume')
        .getPublicUrl(uploadData.path)
      
      console.log('Public URL:', urlData.publicUrl)
      
      // Clean up
      await supabase.storage.from('resume').remove([uploadData.path])
      console.log('✅ Test file cleaned up')
    }

  } catch (error) {
    console.error('❌ Test error:', error.message)
    console.error('Full error:', error)
  }
}

testSimpleUpload() 