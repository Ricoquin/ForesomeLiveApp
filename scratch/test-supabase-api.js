import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set in environment.');
  process.exit(1);
}

console.log('Initializing Supabase client...');
console.log('URL:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSupabase() {
  console.log('\n--- 1. Querying existing rounds ---');
  const { data: rounds, error: queryError } = await supabase
    .from('rounds')
    .select('*')
    .limit(5);

  if (queryError) {
    console.error('Query failed:', queryError);
  } else {
    console.log(`Successfully fetched ${rounds.length} rounds.`);
    console.log('Sample rounds:', JSON.stringify(rounds, null, 2));
  }

  console.log('\n--- 2. Attempting to insert a round WITHOUT user_id (as App.jsx currently does) ---');
  const testRoundNoUser = {
    id: `test_no_user_${Date.now()}`,
    course_id: 'test_course_id',
    course_name: 'Test Course (No User)',
    tee: 'Blue',
    created_at: new Date().toISOString(),
    hole_scores: [],
    summary: { score: 72, putts: 30, fir: 10, gir: 12 },
    completed_holes: 18
  };

  const { data: insertNoUserData, error: insertNoUserError } = await supabase
    .from('rounds')
    .insert([testRoundNoUser])
    .select();

  if (insertNoUserError) {
    console.log('Insert WITHOUT user_id failed (Expected if not-null constraint is active):');
    console.log('Error message:', insertNoUserError.message);
    console.log('Error details:', insertNoUserError.details);
    console.log('Error code:', insertNoUserError.code);
  } else {
    console.log('Insert WITHOUT user_id succeeded unexpectedly! Returned data:', insertNoUserData);
    // Cleanup if succeeded
    await supabase.from('rounds').delete().eq('id', testRoundNoUser.id);
  }

  console.log('\n--- 3. Attempting to insert a round WITH user_id ("anonymous") ---');
  const testRoundWithUser = {
    id: `test_with_user_${Date.now()}`,
    user_id: 'anonymous',
    course_id: 'test_course_id',
    course_name: 'Test Course (With User)',
    tee: 'Blue',
    created_at: new Date().toISOString(),
    hole_scores: [],
    summary: { score: 72, putts: 30, fir: 10, gir: 12 },
    completed_holes: 18
  };

  const { data: insertWithUserData, error: insertWithUserError } = await supabase
    .from('rounds')
    .insert([testRoundWithUser])
    .select();

  if (insertWithUserError) {
    console.error('Insert WITH user_id failed:', insertWithUserError);
  } else {
    console.log('Insert WITH user_id succeeded! Data:', insertWithUserData);
    // Cleanup
    const { error: deleteError } = await supabase.from('rounds').delete().eq('id', testRoundWithUser.id);
    if (deleteError) {
      console.error('Cleanup failed:', deleteError);
    } else {
      console.log('Cleanup successful.');
    }
  }
}

testSupabase().catch(console.error);
