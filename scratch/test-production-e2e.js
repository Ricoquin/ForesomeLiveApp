import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runProductionE2E() {
  console.log('=== STARTING PRODUCTION E2E VERIFICATION SCRIPT ===');
  const testEmail = `test_player_${Date.now()}@example.com`;
  const testPassword = `password123_${Date.now()}`;
  const testUsername = `Test Pro Player`;
  const testHandicap = 18;

  console.log(`\nStep 1: Signing up test user: ${testEmail}`);
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
  });

  if (signUpError) {
    console.error('❌ Sign up failed:', signUpError.message);
    process.exit(1);
  }

  const userId = signUpData.user?.id;
  if (!userId) {
    console.error('❌ Sign up succeeded but no User ID returned.');
    process.exit(1);
  }
  console.log(`✅ Sign up succeeded. User ID: ${userId}`);

  // Note: Check if the user is auto-confirmed or requires confirmation
  const isConfirmed = signUpData.user?.identities?.length > 0;
  console.log(`User confirmed: ${isConfirmed}`);

  console.log('\nStep 2: Creating profile in "profiles" table...');
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .insert([
      {
        id: userId,
        username: testUsername,
        handicap: testHandicap,
        initials: 'TP'
      }
    ])
    .select();

  if (profileError) {
    console.error('❌ Profile creation failed. (This is expected if your database schema table "profiles" has not been created yet):');
    console.error(profileError);
    process.exit(1);
  }
  console.log('✅ Profile creation succeeded! Data:', profileData);

  // If user is auto-confirmed, we should make sure we are signed in
  console.log('\nStep 3: Signing in...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInError) {
    // If confirmation is required, signInWithPassword might fail or warn
    console.log(`⚠️ Sign in warning (may require email confirmation depending on your Supabase config): ${signInError.message}`);
    console.log('Continuing script execution with session...');
  } else {
    console.log('✅ Sign in succeeded! Active Session User:', signInData.user?.id);
  }

  console.log('\nStep 4: Inserting a round...');
  const roundId = `prod_test_round_${Date.now()}`;
  const testRound = {
    id: roundId,
    user_id: userId,
    course_id: 'e2e_course_1',
    course_name: 'St. Andrews Old Course',
    tee: 'Gold',
    created_at: new Date().toISOString(),
    hole_scores: [{ hole: 1, score: '3', putts: '1', fir: true, gir: true }],
    summary: { score: 3, putts: 1, fir: 1, gir: 1 },
    completed_holes: 1
  };

  const { data: roundData, error: roundError } = await supabase
    .from('rounds')
    .insert([testRound])
    .select();

  if (roundError) {
    console.error('❌ Insert round failed:', roundError);
    process.exit(1);
  }
  console.log('✅ Round insertion succeeded! Data:', roundData);

  console.log('\nStep 5: Querying rounds...');
  const { data: queryRounds, error: queryRoundsError } = await supabase
    .from('rounds')
    .select('*')
    .eq('user_id', userId);

  if (queryRoundsError) {
    console.error('❌ Query rounds failed:', queryRoundsError);
    process.exit(1);
  }
  console.log(`✅ Query rounds succeeded! Found ${queryRounds.length} rounds.`);
  if (queryRounds.find(r => r.id === roundId)) {
    console.log('✅ Confirmed our inserted round was successfully fetched.');
  } else {
    console.error('❌ Our inserted round was NOT found in the queried rounds.');
    process.exit(1);
  }

  console.log('\nStep 6: Posting a snap to community...');
  const snapId = `prod_test_snap_${Date.now()}`;
  const testSnap = {
    user_id: userId,
    author_name: testUsername,
    content: 'E2E Testing out the dynamic community snaps! 🏌️‍♂️🔥',
    image_bg_color: '#b89a5c',
    image_text: '⛳️ ForeSome Test'
  };

  const { data: snapData, error: snapError } = await supabase
    .from('snaps')
    .insert([testSnap])
    .select();

  if (snapError) {
    console.error('❌ Posting snap failed:', snapError);
    process.exit(1);
  }
  console.log('✅ Posting snap succeeded! Data:', snapData);

  console.log('\nStep 7: Querying community snaps...');
  const { data: querySnaps, error: querySnapsError } = await supabase
    .from('snaps')
    .select('*')
    .limit(5);

  if (querySnapsError) {
    console.error('❌ Query snaps failed:', querySnapsError);
    process.exit(1);
  }
  console.log(`✅ Query snaps succeeded! Found ${querySnaps.length} snaps.`);

  console.log('\nStep 8: Inserting an alert (invitation)...');
  const testAlert = {
    user_id: userId,
    type: 'invitation',
    title: 'Tee Time Invitation',
    body: 'Keith M. invited you to join a foursome at Oak Ridge GC.',
    status: 'pending'
  };

  const { data: alertData, error: alertError } = await supabase
    .from('alerts')
    .insert([testAlert])
    .select();

  if (alertError) {
    console.error('❌ Inserting alert failed:', alertError);
    process.exit(1);
  }
  const insertedAlertId = alertData[0]?.id;
  console.log(`✅ Alert insertion succeeded! ID: ${insertedAlertId}`);

  console.log('\nStep 9: Accepting the invite (updating alert)...');
  const { data: updateAlertData, error: updateAlertError } = await supabase
    .from('alerts')
    .update({ status: 'accepted' })
    .eq('id', insertedAlertId)
    .select();

  if (updateAlertError) {
    console.error('❌ Updating alert status failed:', updateAlertError);
    process.exit(1);
  }
  console.log(`✅ Alert update succeeded! New status: ${updateAlertData[0]?.status}`);

  console.log('\n=== CLEANING UP TEST DATA ===');
  
  console.log('Deleting test round...');
  await supabase.from('rounds').delete().eq('id', roundId);

  console.log('Deleting test snap...');
  if (snapData[0]?.id) {
    await supabase.from('snaps').delete().eq('id', snapData[0].id);
  }

  console.log('Deleting test alert...');
  if (insertedAlertId) {
    await supabase.from('alerts').delete().eq('id', insertedAlertId);
  }

  console.log('Deleting profile...');
  await supabase.from('profiles').delete().eq('id', userId);

  console.log('\n🎉 ALL PRODUCTION PATHWAY E2E TESTS EXECUTED successfully! 🎉');
  console.log('Note: If any tables or RLS policies were not executed on the live DB, steps 2, 4, 6, or 8 would have thrown errors.');
}

runProductionE2E().catch(err => {
  console.error('Unexpected E2E execution error:', err);
  process.exit(1);
});
