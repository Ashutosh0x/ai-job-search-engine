const { createClient } = require('@supabase/supabase-js')

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function setupStorage() {
  try {
    console.log('Setting up Supabase storage for resumes...')

         // Create the resume bucket if it doesn't exist
     const { data: bucketData, error: bucketError } = await supabase.storage.createBucket('resume', {
       public: false,
       fileSizeLimit: 10485760, // 10MB
       allowedMimeTypes: [
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
     })

     if (bucketError) {
             if (bucketError.message.includes('already exists')) {
         console.log('Resume bucket already exists')
       } else {
        throw bucketError
      }
           } else {
         console.log('Created resume bucket successfully')
       }

    // Set up RLS policies for the bucket
    const policies = [
      {
        name: 'Users can upload their own resumes',
                 definition: `
           CREATE POLICY "Users can upload their own resumes" ON storage.objects
           FOR INSERT WITH CHECK (
             bucket_id = 'resume' AND 
             auth.uid()::text = (storage.foldername(name))[1]
           )
         `
      },
      {
        name: 'Users can view their own resumes',
                 definition: `
           CREATE POLICY "Users can view their own resumes" ON storage.objects
           FOR SELECT USING (
             bucket_id = 'resume' AND 
             auth.uid()::text = (storage.foldername(name))[1]
           )
         `
      },
      {
        name: 'Users can update their own resumes',
                 definition: `
           CREATE POLICY "Users can update their own resumes" ON storage.objects
           FOR UPDATE USING (
             bucket_id = 'resume' AND 
             auth.uid()::text = (storage.foldername(name))[1]
           )
         `
      },
      {
        name: 'Users can delete their own resumes',
                 definition: `
           CREATE POLICY "Users can delete their own resumes" ON storage.objects
           FOR DELETE USING (
             bucket_id = 'resume' AND 
             auth.uid()::text = (storage.foldername(name))[1]
           )
         `
      }
    ]

    for (const policy of policies) {
      try {
        // Note: This would need to be run as a SQL migration instead
        // as the storage API doesn't support policy creation directly
        console.log(`Policy "${policy.name}" should be created via SQL migration`)
      } catch (error) {
        console.log(`Policy "${policy.name}" already exists or failed to create`)
      }
    }

    console.log('Storage setup completed successfully!')
    console.log('\nNext steps:')
    console.log('1. Run the database migrations to create the resumes table')
    console.log('2. Set up the GEMINI_API_KEY in your .env.local file')
    console.log('3. Install dependencies: npm install')

  } catch (error) {
    console.error('Error setting up storage:', error)
    process.exit(1)
  }
}

setupStorage() 