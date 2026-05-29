import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testAuth() {
  console.log('Testing anonymous sign-in...');
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Anonymous sign-in failed:', error.message);
  } else {
    console.log('Anonymous sign-in succeeded!');
    console.log('User ID:', data.user?.id);
    
    // Now let's try to insert a round using this user ID
    const testRound = {
      id: `test_auth_user_${Date.now()}`,
      user_id: data.user.id,
      course_id: 'test_course_id',
      course_name: 'Test Course (Auth User)',
      tee: 'Blue',
      created_at: new Date().toISOString(),
      hole_scores: [],
      summary: { score: 72, putts: 30, fir: 10, gir: 12 },
      completed_holes: 18
    };

    console.log('Attempting to insert round with active session and user_id...');
    const { data: insertData, error: insertError } = await supabase
      .from('rounds')
      .insert([testRound])
      .select();

    if (insertError) {
      console.error('Insert failed even with auth:', insertError);
    } else {
      console.log('Insert succeeded! Data:', insertData);
      
      console.log('Attempting to select rounds...');
      const { data: selectData, error: selectError } = await supabase
        .from('rounds')
        .select('*');
        
      if (selectError) {
        console.error('Select failed:', selectError);
      } else {
        console.log(`Select succeeded! Found ${selectData.length} rounds.`);
      }

      console.log('Cleaning up...');
      await supabase.from('rounds').delete().eq('id', testRound.id);
    }
  }
}

testAuth().catch(console.error);
