require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = 'ashutoshkumarsingh0x@gmail.com';
const password = 'ashutosh@123W';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testRLS() {
  // 1. Sign in
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    console.error('Sign in failed:', signInError.message, signInError);
    return;
  }
  console.log('Signed in as:', signInData.user.email);

  // 2. Try to select your own profile
  const { data: profiles, error: selectError } = await supabase
    .from('profiles')
    .select('*');
  console.log('Select profiles:', profiles, selectError);

  // 3. Try to update your own profile
  if (profiles && profiles.length > 0) {
    const { data: updateData, error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: 'Updated Name' })
      .eq('id', signInData.user.id);
    console.log('Update profile:', updateData, updateError);
  } else {
    console.log('No profile found to update.');
  }

  // 4. Try to insert a profile with a different id (should fail)
  const { data: insertData, error: insertError } = await supabase
    .from('profiles')
    .insert([{ id: 'some-other-id', full_name: 'Hacker', preferences: {} }]);
  console.log('Insert profile (should fail):', insertData, insertError);
}

testRLS();