import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runE2E() {
  console.log('Starting E2E verification for Supabase connection...');
  console.log('Supabase URL:', supabaseUrl);

  const testRoundId = `e2e_test_${Date.now()}`;
  const testRound = {
    id: testRoundId,
    user_id: 'anonymous',
    course_id: 'e2e_course',
    course_name: 'E2E Test Course',
    tee: 'White',
    created_at: new Date().toISOString(),
    hole_scores: [
      { hole: 1, score: '4', putts: '2', fir: true, gir: true }
    ],
    summary: { score: 4, putts: 2, fir: 1, gir: 1 },
    completed_holes: 1
  };

  console.log('\nStep 1: Attempting to insert round...');
  const { data: insertData, error: insertError } = await supabase
    .from('rounds')
    .insert([testRound])
    .select();

  if (insertError) {
    console.error('❌ Insert failed! Error details:');
    console.error(insertError);
    console.log('\nNOTE: If you get a row-level security (RLS) violation, it means the policies in "supabase/policies.sql" have not been applied to your live Supabase project yet. You must apply them through the Supabase Dashboard SQL Editor.');
    process.exit(1);
  }

  console.log('✅ Insert succeeded! Data returned:', insertData);

  console.log('\nStep 2: Querying all rounds...');
  const { data: queryData, error: queryError } = await supabase
    .from('rounds')
    .select('*')
    .order('created_at', { ascending: false });

  if (queryError) {
    console.error('❌ Query failed:', queryError);
    process.exit(1);
  }

  console.log(`✅ Query succeeded! Found ${queryData.length} rounds.`);
  const foundTestRound = queryData.find(r => r.id === testRoundId);
  if (foundTestRound) {
    console.log('✅ Confirmed our inserted test round exists in query results.');
  } else {
    console.error('❌ Test round not found in query results.');
    process.exit(1);
  }

  console.log('\nStep 3: Cleaning up (deleting the test round)...');
  const { error: deleteError } = await supabase
    .from('rounds')
    .delete()
    .eq('id', testRoundId);

  if (deleteError) {
    console.error('❌ Deletion/cleanup failed:', deleteError);
    process.exit(1);
  }

  console.log('✅ Cleanup succeeded.');
  console.log('\n🎉 ALL SUPABASE PATHWAY TESTS PASSED SUCCESSFULLY! 🎉');
}

runE2E().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
