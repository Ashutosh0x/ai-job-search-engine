const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: '.env.local' })

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  console.log('Please check your .env.local file')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function testUpload() {
  try {
    console.log('🧪 Testing file upload functionality...\n')

    // Check authentication first
    console.log('🔐 Checking authentication...')
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      console.log('❌ No authenticated user found')
      console.log('Please log in through the web interface first')
      console.log('Then run this test again')
      return
    }
    
    console.log('✅ User authenticated:', user.email)
    
    // Create a test file
    console.log('\n📄 Creating test file...')
    const testContent = 'This is a test resume file for upload testing.'
    const testFileName = `test-resume-${Date.now()}.txt`
    const testFilePath = path.join(__dirname, testFileName)
    
    fs.writeFileSync(testFilePath, testContent)
    console.log('✅ Test file created:', testFileName)
    
    // Test upload
    console.log('\n📤 Testing file upload...')
    const filePath = `${user.id}/${Date.now()}-${testFileName}`
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resume')
      .upload(filePath, fs.createReadStream(testFilePath), {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      })
    
    // Clean up test file
    fs.unlinkSync(testFilePath)
    
    if (uploadError) {
      console.log('❌ Upload failed:', uploadError.message)
      return
    }
    
    console.log('✅ Upload successful!')
    console.log('File path:', uploadData.path)
    
    // Test getting public URL
    console.log('\n🔗 Testing public URL generation...')
    const { data: urlData } = supabase.storage
      .from('resume')
      .getPublicUrl(filePath)
    
    console.log('✅ Public URL generated:', urlData.publicUrl)
    
    // Test file listing
    console.log('\n📁 Testing file listing...')
    const { data: files, error: listError } = await supabase.storage
      .from('resume')
      .list(user.id)
    
    if (listError) {
      console.log('❌ File listing failed:', listError.message)
    } else {
      console.log('✅ Files in user folder:', files.length)
      files.forEach(file => {
        console.log(`   - ${file.name} (${file.metadata?.size || 'unknown'} bytes)`)
      })
    }
    
    console.log('\n🎉 Upload test completed successfully!')
    console.log('Your resume upload functionality should work correctly when logged in.')

  } catch (error) {
    console.error('❌ Error during upload test:', error.message)
  }
}

testUpload() 