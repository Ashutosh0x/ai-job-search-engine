-- Fix avatar upload by updating storage policies
-- Drop existing policies
DROP POLICY IF EXISTS "Users can upload their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own files" ON storage.objects;

-- Create new policies that allow avatar uploads
CREATE POLICY "Users can upload their own files" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'resume' AND 
  (
    -- Allow uploads to user's own folder
    auth.uid()::text = (storage.foldername(name))[1] OR
    -- Allow uploads to avatars folder with user ID
    (storage.foldername(name))[1] = 'avatars' AND 
    auth.uid()::text = (storage.foldername(name))[2] OR
    -- Allow direct avatar uploads
    name LIKE 'avatars/%' OR
    -- Allow uploads to root with user ID prefix
    name LIKE auth.uid()::text || '/%'
  )
);

CREATE POLICY "Users can view their own files" ON storage.objects
FOR SELECT USING (
  bucket_id = 'resume' AND 
  (
    -- Allow viewing own files
    auth.uid()::text = (storage.foldername(name))[1] OR
    -- Allow viewing avatars
    (storage.foldername(name))[1] = 'avatars' AND 
    auth.uid()::text = (storage.foldername(name))[2] OR
    -- Allow viewing avatar files
    name LIKE 'avatars/%' OR
    -- Allow viewing files with user ID prefix
    name LIKE auth.uid()::text || '/%'
  )
);

CREATE POLICY "Users can update their own files" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'resume' AND 
  (
    -- Allow updating own files
    auth.uid()::text = (storage.foldername(name))[1] OR
    -- Allow updating avatars
    (storage.foldername(name))[1] = 'avatars' AND 
    auth.uid()::text = (storage.foldername(name))[2] OR
    -- Allow updating avatar files
    name LIKE 'avatars/%' OR
    -- Allow updating files with user ID prefix
    name LIKE auth.uid()::text || '/%'
  )
);

CREATE POLICY "Users can delete their own files" ON storage.objects
FOR DELETE USING (
  bucket_id = 'resume' AND 
  (
    -- Allow deleting own files
    auth.uid()::text = (storage.foldername(name))[1] OR
    -- Allow deleting avatars
    (storage.foldername(name))[1] = 'avatars' AND 
    auth.uid()::text = (storage.foldername(name))[2] OR
    -- Allow deleting avatar files
    name LIKE 'avatars/%' OR
    -- Allow deleting files with user ID prefix
    name LIKE auth.uid()::text || '/%'
  )
);
