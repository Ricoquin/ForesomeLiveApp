import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { supabase } from './supabaseClient';
import courses from './data/courses.json';

const cards = [
  {
    course: 'Oak Ridge GC',
    meta: '4 players · competition',
    time: '8:20',
    date: 'Fri · 6/5',
    players: ['KM', 'EA', 'JR', '+1']
  },
  {
    course: 'Blue Valley',
    meta: '3 players · casual',
    time: '11:45',
    date: 'Sat · 6/6',
    players: ['AC', 'TB', 'SM', '+1']
  }
];

const navItems = [
  { icon: '🏌️', label: 'Rounds' },
  { icon: '🧾', label: 'Stats' },
  { icon: '⚡', label: 'Snap' },
  { icon: '🔔', label: 'Alerts' }
];

export default function App() {
  const [selectedNav, setSelectedNav] = useState('Rounds');
  const [selectedCard, setSelectedCard] = useState(cards[0].course);
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id);
  const [selectedTee, setSelectedTee] = useState('Blue');
  const [screen, setScreen] = useState('home');
  const [savedRounds, setSavedRounds] = useState([]);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const teeOptions = ['Blue', 'White', 'Red'];
  
  // Auth & Profile states
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [handicapInput, setHandicapInput] = useState('12');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Snaps states
  const [snapsList, setSnapsList] = useState([]);
  const [loadingSnaps, setLoadingSnaps] = useState(false);
  const [isPostingSnap, setIsPostingSnap] = useState(false);
  const [snapContent, setSnapContent] = useState('');
  const [snapBgColor, setSnapBgColor] = useState('#2e4936');

  // Alerts states
  const [alertsList, setAlertsList] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);

  const [holeScores, setHoleScores] = useState(
    Array.from({ length: 18 }, (_, index) => ({
      hole: index + 1,
      score: '',
      fir: false,
      gir: false,
      putts: ''
    }))
  );

  const normalizeRound = (round) => ({
    id: round.id,
    courseId: round.course_id ?? round.courseId,
    courseName: round.course_name ?? round.courseName,
    tee: round.tee,
    createdAt: round.created_at ?? round.createdAt,
    holeScores: round.hole_scores ?? round.holeScores,
    summary: round.summary ?? round.summary,
    completedHoles: round.completed_holes ?? round.completedHoles
  });

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) {
        setProfile(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRounds = async (userId) => {
    if (!userId) return;
    setLoadingRounds(true);
    const { data, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading rounds:', error);
    } else {
      setSavedRounds((data || []).map(normalizeRound));
    }
    setLoadingRounds(false);
  };

  const fetchSnaps = async () => {
    setLoadingSnaps(true);
    const { data, error } = await supabase
      .from('snaps')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error loading snaps:', error);
    } else {
      setSnapsList(data || []);
    }
    setLoadingSnaps(false);
  };

  const fetchAlerts = async (userId) => {
    if (!userId) return;
    setLoadingAlerts(true);
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error loading alerts:', error);
    } else {
      setAlertsList(data || []);
    }
    setLoadingAlerts(false);
  };

  // Auth setup useEffect
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchRounds(session.user.id);
        fetchAlerts(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchRounds(session.user.id);
        fetchAlerts(session.user.id);
      } else {
        setProfile(null);
        setSavedRounds([]);
        setAlertsList([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch community snaps when tab switches to snaps
  useEffect(() => {
    if (selectedNav === 'Snap') {
      fetchSnaps();
    }
  }, [selectedNav]);

  const handleAuth = async () => {
    setAuthError('');
    setAuthLoading(true);
    if (!email || !password) {
      setAuthError('Email and password are required.');
      setAuthLoading(false);
      return;
    }

    try {
      if (authMode === 'signup') {
        if (!usernameInput) {
          setAuthError('Username is required.');
          setAuthLoading(false);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password
        });

        if (error) {
          setAuthError(error.message);
        } else if (data?.user) {
          const initials = usernameInput
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

          const { error: profileError } = await supabase.from('profiles').insert([
            {
              id: data.user.id,
              username: usernameInput,
              handicap: parseInt(handicapInput, 10) || 0,
              initials: initials || 'US'
            }
          ]);

          if (profileError) {
            console.error('Error saving profile:', profileError);
          }
          Alert.alert('Registration Successful', 'Welcome to ForeSome!');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) {
          setAuthError(error.message);
        }
      }
    } catch (err) {
      setAuthError(err.message || 'An unexpected error occurred.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePostSnap = async () => {
    if (!snapContent) {
      Alert.alert('Caption required', 'Please add a caption to share.');
      return;
    }

    try {
      setAuthLoading(true);
      const newSnap = {
        user_id: session.user.id,
        author_name: profile?.username || 'Golf Player',
        content: snapContent,
        image_bg_color: snapBgColor,
        image_text: '⛳️ Foresome Community'
      };

      const { error } = await supabase.from('snaps').insert([newSnap]);
      if (error) {
        Alert.alert('Error sharing snap', error.message);
      } else {
        setSnapContent('');
        setIsPostingSnap(false);
        fetchSnaps();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAlertAction = async (alertId, newStatus) => {
    try {
      const { error } = await supabase
        .from('alerts')
        .update({ status: newStatus })
        .eq('id', alertId);

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setAlertsList((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, status: newStatus } : a))
        );
        Alert.alert('Success', `You have ${newStatus} the invite.`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const roundSummary = holeScores.reduce(
    (acc, hole) => {
      const scoreValue = Number(hole.score);
      const puttsValue = Number(hole.putts);
      return {
        score: acc.score + (Number.isFinite(scoreValue) ? scoreValue : 0),
        putts: acc.putts + (Number.isFinite(puttsValue) ? puttsValue : 0),
        fir: acc.fir + (hole.fir ? 1 : 0),
        gir: acc.gir + (hole.gir ? 1 : 0)
      };
    },
    { score: 0, putts: 0, fir: 0, gir: 0 }
  );

  const completedHoles = holeScores.filter(
    (hole) => hole.score !== '' || hole.putts !== '' || hole.fir || hole.gir
  ).length;

  const saveRound = async () => {
    if (!session?.user) return;

    const round = {
      id: `${Date.now()}`,
      user_id: session.user.id,
      course_id: selectedCourseId,
      course_name: selectedCourse.name,
      tee: selectedTee,
      created_at: new Date().toISOString(),
      hole_scores: holeScores,
      summary: roundSummary,
      completed_holes: completedHoles
    };

    const { data, error } = await supabase.from('rounds').insert([round]).select();

    if (error) {
      console.error('Error saving round:', error);
      Alert.alert('Error saving round', error.message);
      return;
    }

    const saved = data?.[0] ? normalizeRound(data[0]) : normalizeRound(round);
    setSavedRounds((prev) => [saved, ...prev]);
    setHoleScores(
      Array.from({ length: 18 }, (_, index) => ({
        hole: index + 1,
        score: '',
        fir: false,
        gir: false,
        putts: ''
      }))
    );
    setScreen('home');
  };

  const updateHole = (index, field, value) => {
    setHoleScores((prev) =>
      prev.map((hole, holeIndex) =>
        holeIndex === index ? { ...hole, [field]: value } : hole
      )
    );
  };

  const nearestCourses = [...courses]
    .filter((course) => course.distance_mi != null)
    .sort((a, b) => Number(a.distance_mi) - Number(b.distance_mi))
    .slice(0, 6);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) || nearestCourses[0] || {};

  // Performance calculations across completed rounds
  const statsRounds = savedRounds.filter(r => r.summary && typeof r.summary.score === 'number' && r.completedHoles > 0);
  const totalRoundsCount = statsRounds.length;

  const avgScore = totalRoundsCount > 0
    ? (statsRounds.reduce((sum, r) => sum + r.summary.score, 0) / totalRoundsCount).toFixed(1)
    : '--';

  const avgPutts = totalRoundsCount > 0
    ? (statsRounds.reduce((sum, r) => sum + r.summary.putts, 0) / totalRoundsCount).toFixed(1)
    : '--';

  const totalCompletedHoles = statsRounds.reduce((sum, r) => sum + (r.completedHoles || 0), 0);
  const totalGirCount = statsRounds.reduce((sum, r) => sum + (r.summary.gir || 0), 0);
  const totalFirCount = statsRounds.reduce((sum, r) => sum + (r.summary.fir || 0), 0);

  const avgGir = totalCompletedHoles > 0
    ? Math.round((totalGirCount / totalCompletedHoles) * 100)
    : '--';

  const avgFir = totalCompletedHoles > 0
    ? Math.round((totalFirCount / totalCompletedHoles)  // If no active session, show premium signup/login screen
  if (!session) {
    return (
      <View style={styles.stage}>
        <View style={styles.headerBar}>
          <View style={styles.headerLeft}>
            <View style={styles.dot} />
            <Text style={styles.headerText}>KC Golf Community</Text>
          </View>
        </View>

        <View style={styles.phone}>
          <View style={styles.notch} />
          <View style={styles.statusBar}>
            <Text style={styles.statusText}>8:42</Text>
            <View style={styles.statusIcons}>
              <Text style={styles.iconText}>🔋</Text>
              <Text style={styles.iconText}>📶</Text>
              <Text style={styles.iconText}>☁️</Text>
            </View>
          </View>

          <ScrollView style={styles.screen} contentContainerStyle={{ padding: 24, justifyContent: 'center', minHeight: '80%' }}>
            <View style={{ alignItems: 'center', marginBottom: 28 }}>
              <Text style={{ fontFamily: 'Playfair Display', fontSize: 36, fontWeight: '900', color: '#f1ead9' }}>
                Fore<Text style={{ color: '#b89a5c', fontStyle: 'italic' }}>Some</Text>
              </Text>
              <Text style={{ fontSize: 9, letterSpacing: 2.5, textTransform: 'uppercase', color: '#c9bf9f', marginTop: 4 }}>
                Golf Community
              </Text>
            </View>

            <View style={{ flexDirection: 'row', backgroundColor: '#243d2c', borderRadius: 12, padding: 4, marginBottom: 20 }}>
              <Pressable 
                style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: authMode === 'login' ? '#1a2c20' : 'transparent' }}
                onPress={() => { setAuthMode('login'); setAuthError(''); }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: authMode === 'login' ? '#f1ead9' : '#c9bf9f' }}>Log In</Text>
              </Pressable>
              <Pressable 
                style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: authMode === 'signup' ? '#1a2c20' : 'transparent' }}
                onPress={() => { setAuthMode('signup'); setAuthError(''); }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: authMode === 'signup' ? '#f1ead9' : '#c9bf9f' }}>Sign Up</Text>
              </Pressable>
            </View>

            {authError ? (
              <View style={{ backgroundColor: 'rgba(232, 138, 138, 0.15)', borderWidth: 1, borderColor: '#e88a8a', borderRadius: 10, padding: 12, marginBottom: 18 }}>
                <Text style={{ color: '#e88a8a', fontSize: 12, lineHeight: 15 }}>{authError}</Text>
              </View>
            ) : null}

            <View style={{ marginBottom: 14 }}>
              <Text style={styles.inputLabel}>Email Address</Text>
              <TextInput
                style={[styles.input, { color: '#f1ead9', fontSize: 13, paddingVertical: 10 }]}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="you@example.com"
                placeholderTextColor="#8c8467"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={{ marginBottom: 14 }}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={[styles.input, { color: '#f1ead9', fontSize: 13, paddingVertical: 10 }]}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor="#8c8467"
                value={password}
                onChangeText={setPassword}
              />
            </View>

            {authMode === 'signup' && (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>Username / Name</Text>
                  <TextInput
                    style={[styles.input, { color: '#f1ead9', fontSize: 13, paddingVertical: 10 }]}
                    placeholder="Keith M."
                    placeholderTextColor="#8c8467"
                    value={usernameInput}
                    onChangeText={setUsernameInput}
                  />
                </View>

                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>Golf Handicap (HCP)</Text>
                  <TextInput
                    style={[styles.input, { color: '#f1ead9', fontSize: 13, paddingVertical: 10 }]}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor="#8c8467"
                    value={handicapInput}
                    onChangeText={setHandicapInput}
                  />
                </View>
              </>
            )}

            <Pressable 
              style={[styles.saveRoundBtn, { marginTop: 14, backgroundColor: '#b89a5c', opacity: authLoading ? 0.7 : 1 }]}
              onPress={handleAuth}
              disabled={authLoading}
            >
              <Text style={{ color: '#1a2c20', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {authLoading ? 'Please wait...' : authMode === 'login' ? 'Access Account' : 'Register Now'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <View style={styles.dot} />
          <Text style={styles.headerText}>KC Golf Community</Text>
        </View>
        <Pressable 
          style={styles.togglePro}
          onPress={() => {
            Alert.alert(
              'Sign Out',
              'Are you sure you want to sign out?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', onPress: () => supabase.auth.signOut() }
              ]
            );
          }}
        >
          <Text style={styles.toggleProText}>Sign Out</Text>
        </Pressable>
      </View>

      <View style={styles.phone}>
        <View style={styles.notch} />
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>8:42</Text>
          <View style={styles.statusIcons}>
            <Text style={styles.iconText}>🔋</Text>
            <Text style={styles.iconText}>📶</Text>
            <Text style={styles.iconText}>☁️</Text>
          </View>
        </View>

        {screen === 'scorecard' ? (
          <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
            <View style={styles.scorecardHeader}>
              <Pressable style={styles.backBtn} onPress={() => setScreen('home')}>
                <Text style={styles.backBtnText}>Back</Text>
              </Pressable>
              <View>
                <Text style={styles.screenTitle}>{selectedCourse.name || 'Round scorecard'}</Text>
                <Text style={styles.screenSubtitle}>Tee {selectedTee} · {selectedCourse.city}</Text>
              </View>
            </View>

            {holeScores.map((hole, index) => (
              <View key={hole.hole} style={styles.holeRow}>
                <View style={styles.holeMeta}>
                  <Text style={styles.holeLabel}>Hole {hole.hole}</Text>
                  <Text style={styles.holePar}>Par 4</Text>
                </View>
                <View style={styles.scoreInputsRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Score</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={hole.score}
                      onChangeText={(text) => updateHole(index, 'score', text)}
                    />
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Putts</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={hole.putts}
                      onChangeText={(text) => updateHole(index, 'putts', text)}
                    />
                  </View>
                </View>
                <View style={styles.toggleRow}>
                  <Pressable
                    style={[styles.toggleChip, hole.fir && styles.toggleChipActive]}
                    onPress={() => updateHole(index, 'fir', !hole.fir)}
                  >
                    <Text style={[styles.toggleText, hole.fir && styles.toggleTextActive]}>FIR</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.toggleChip, hole.gir && styles.toggleChipActive]}
                    onPress={() => updateHole(index, 'gir', !hole.gir)}
                  >
                    <Text style={[styles.toggleText, hole.gir && styles.toggleTextActive]}>GIR</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            <Pressable style={styles.saveRoundBtn} onPress={saveRound}>
              <Text style={styles.saveRoundText}>Save round</Text>
            </Pressable>
          </ScrollView>
        ) : selectedNav === 'Stats' ? (
          <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>Performance Dashboard</Text>
              <Text style={styles.statsSubtitle}>Overall analysis across {totalRoundsCount} rounds</Text>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{avgScore}</Text>
                <Text style={styles.statLabel}>Avg Score</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{avgPutts}</Text>
                <Text style={styles.statLabel}>Avg Putts</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{avgGir !== '--' ? `${avgGir}%` : '--'}</Text>
                <Text style={styles.statLabel}>GIR %</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{avgFir !== '--' ? `${avgFir}%` : '--'}</Text>
                <Text style={styles.statLabel}>FIR %</Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Round History</Text>
              </View>
              {savedRounds.length === 0 ? (
                <Text style={styles.emptyText}>No rounds recorded yet. Record a round to see history.</Text>
              ) : (
                savedRounds.map((round) => (
                  <View key={round.id} style={styles.historyCard}>
                    <View style={styles.historyRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyCourse} numberOfLines={1}>{round.courseName}</Text>
                        <Text style={styles.historyMeta}>{round.tee} tees · {new Date(round.createdAt).toLocaleDateString()}</Text>
                      </View>
                      <View style={styles.historyScoreContainer}>
                        <Text style={styles.historyScoreValue}>{round.summary.score}</Text>
                        <Text style={styles.historyScoreLabel}>Strokes</Text>
                      </View>
                    </View>
                    <View style={styles.historyStats}>
                      <View style={styles.historyStatBlock}>
                        <Text style={styles.historyStatVal}>{round.summary.putts}</Text>
                        <Text style={styles.historyStatLbl}>Putts</Text>
                      </View>
                      <View style={styles.historyStatBlock}>
                        <Text style={styles.historyStatVal}>{round.summary.fir}</Text>
                        <Text style={styles.historyStatLbl}>FIR</Text>
                      </View>
                      <View style={styles.historyStatBlock}>
                        <Text style={styles.historyStatVal}>{round.summary.gir}</Text>
                        <Text style={styles.historyStatLbl}>GIR</Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        ) : selectedNav === 'Snap' ? (
          <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>Community Snaps</Text>
              <Text style={styles.statsSubtitle}>Moments from the Kansas City Golf Community</Text>
            </View>

            {isPostingSnap ? (
              <View style={[styles.scorecardForm, { marginHorizontal: 16, marginBottom: 16 }]}>
                <Text style={[styles.inputLabel, { color: '#b89a5c', fontSize: 13, marginBottom: 10 }]}>Share your Golf Snap</Text>
                
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>Caption / Text</Text>
                  <TextInput
                    style={[styles.input, { color: '#f1ead9', fontSize: 12, height: 60, textAlignVertical: 'top' }]}
                    multiline
                    numberOfLines={3}
                    placeholder="Sunrise was great today at Swope Memorial GC!"
                    placeholderTextColor="#8c8467"
                    value={snapContent}
                    onChangeText={setSnapContent}
                  />
                </View>

                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.inputLabel}>Background Card Color</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 6 }}>
                    {['#2e4936', '#b89a5c', '#1a2c20', '#243d2c'].map((color) => (
                      <Pressable
                        key={color}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: color,
                          borderWidth: snapBgColor === color ? 2 : 0,
                          borderColor: '#f1ead9'
                        }}
                        onPress={() => setSnapBgColor(color)}
                      />
                    ))}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable style={[styles.saveRoundBtn, { flex: 1, marginVertical: 0 }]} onPress={handlePostSnap}>
                    <Text style={styles.saveRoundText}>Share</Text>
                  </Pressable>
                  <Pressable style={[styles.saveRoundBtn, { flex: 1, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#335041', marginVertical: 0 }]} onPress={() => setIsPostingSnap(false)}>
                    <Text style={[styles.saveRoundText, { color: '#c9bf9f' }]}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.snapPostBtn} onPress={() => setIsPostingSnap(true)}>
                <Text style={styles.snapPostBtnText}>📸 Share your Golf Snap</Text>
              </Pressable>
            )}

            {loadingSnaps ? (
              <Text style={styles.emptyText}>Loading community snaps…</Text>
            ) : snapsList.length === 0 ? (
              <Text style={styles.emptyText}>No community snaps yet. Be the first to share one!</Text>
            ) : (
              snapsList.map((snap) => (
                <View key={snap.id} style={styles.snapCard}>
                  <View style={styles.snapHeader}>
                    <Text style={styles.snapAuthor}>{snap.author_name}</Text>
                    <Text style={styles.snapTime}>{new Date(snap.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.snapText}>{snap.content}</Text>
                  {snap.image_url ? (
                    <View style={[styles.snapImage, { backgroundColor: '#1e3527' }]}>
                      <Text style={styles.snapImageText}>📷 Shared Photo</Text>
                    </View>
                  ) : (
                    <View style={[styles.snapImage, { backgroundColor: snap.image_bg_color || '#2e4936' }]}>
                      <Text style={styles.snapImageText}>{snap.image_text || '⛳️ ForeSome'}</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        ) : selectedNav === 'Alerts' ? (
          <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsTitle}>Alerts & Invites</Text>
              <Text style={styles.statsSubtitle}>Stay connected with your foursomes</Text>
            </View>

            {loadingAlerts ? (
              <Text style={styles.emptyText}>Loading alerts…</Text>
            ) : alertsList.length === 0 ? (
              <Text style={styles.emptyText}>No active alerts or invitations at this time.</Text>
            ) : (
              alertsList.map((alert) => (
                <View key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertHeader}>
                    <Text style={styles.alertTitle}>{alert.title}</Text>
                    <Text style={styles.alertTime}>{new Date(alert.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.alertBody}>{alert.body}</Text>
                  {alert.type === 'invitation' && alert.status === 'pending' && (
                    <View style={styles.alertActions}>
                      <Pressable style={styles.alertButtonAccept} onPress={() => handleAlertAction(alert.id, 'accepted')}>
                        <Text style={styles.alertButtonTextAccept}>Accept</Text>
                      </Pressable>
                      <Pressable style={styles.alertButtonDecline} onPress={() => handleAlertAction(alert.id, 'declined')}>
                        <Text style={styles.alertButtonTextDecline}>Decline</Text>
                      </Pressable>
                    </View>
                  )}
                  {alert.type === 'invitation' && alert.status !== 'pending' && (
                    <Text style={[styles.alertTime, { marginTop: 6, fontStyle: 'italic', textTransform: 'capitalize' }]}>
                      Status: {alert.status}
                    </Text>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        ) : (
          <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
            {/* User Greeting Section */}
            <View style={{ paddingHorizontal: 16, marginTop: 16, marginBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, color: '#f1ead9', fontFamily: 'Playfair Display', fontWeight: 'bold' }}>
                Hey, {profile?.username || 'Golf Player'}!
              </Text>
              <View style={{ backgroundColor: '#243d2c', borderWidth: 1, borderColor: '#b89a5c', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 }}>
                <Text style={{ fontSize: 9, color: '#b89a5c', fontWeight: '700', letterSpacing: 0.5 }}>
                  HCP {profile?.handicap !== undefined ? profile.handicap : '12'}
                </Text>
              </View>
            </View>

            <View style={styles.hero}>
              <Text style={styles.heroLabel}>Selected course</Text>
              <Text style={styles.heroTitle}>{selectedCourse.name || 'Select a course'}</Text>
              <Text style={styles.heroSubtitle} numberOfLines={2}>
                {selectedCourse.city}, {selectedCourse.state} · {selectedCourse.type}
              </Text>
              <View style={styles.heroStats}>
                <Text style={styles.heroStatText}>
                  <Text style={styles.heroStatValue}>{selectedCourse.par || '--'}</Text par
                </Text>
                <Text style={styles.heroStatText}>
                  <Text style={styles.heroStatValue}>
                    {selectedCourse.distance_mi != null ? selectedCourse.distance_mi.toFixed(1) : '--'}
                  </Text>{' '}
                  miles away
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Nearby courses</Text>
                <Text style={styles.sectionLink}>See all</Text>
              </View>
              {nearestCourses.map((course) => (
                <Pressable
                  key={course.id}
                  style={[styles.courseCard, selectedCourseId === course.id && styles.courseCardActive]}
                  onPress={() => setSelectedCourseId(course.id)}
                >
                  <View style={styles.courseCardRow}>
                    <View style={styles.courseInfo}>
                      <Text style={styles.courseCardTitle}>{course.name}</Text>
                      <Text style={styles.courseCardMeta}>{course.city} · {course.type}</Text>
                    </View>
                    <Text style={styles.courseDistance}>{course.distance_mi?.toFixed(1)} mi</Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Round setup</Text>
                <Text style={styles.sectionLink}>Edit</Text>
              </View>
              <Text style={styles.sectionSubtitle}>Pick the tee set for this round before you start logging hole-by-hole.</Text>
              <View style={styles.teeOptionsRow}>
                {teeOptions.map((tee) => {
                  const active = selectedTee === tee;
                  return (
                    <Pressable
                      key={tee}
                      style={[styles.teeOption, active && styles.teeOptionActive]}
                      onPress={() => setSelectedTee(tee)}
                    >
                      <Text style={[styles.teeOptionText, active && styles.teeOptionTextActive]}>{tee}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={styles.startRoundBtn} onPress={() => setScreen('scorecard')}>
                <Text style={styles.startRoundText}>Start round on {selectedTee} tees</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Latest saved round</Text>
                <Pressable onPress={() => fetchRounds(session?.user?.id)} style={styles.refreshButton}>
                  <Text style={styles.sectionLink}>{loadingRounds ? 'Refreshing…' : 'Refresh'}</Text>
                </Pressable>
              </View>
              {loadingRounds ? (
                <Text style={styles.emptyText}>Loading saved rounds…</Text>
              ) : savedRounds.length === 0 ? (
                <Text style={styles.emptyText}>No rounds saved yet. Save one to see summary here.</Text>
              ) : (
                <View style={styles.roundSummaryCard}>
                  <Text style={styles.summaryLabel}>{savedRounds[0].courseName}</Text>
                  <Text style={styles.summaryMeta}>{savedRounds[0].tee} tees · {new Date(savedRounds[0].createdAt).toLocaleDateString()}</Text>
                  <View style={styles.summaryStatsRow}>
                    <View style={styles.summaryStatBlock}>
                      <Text style={styles.summaryStatValue}>{savedRounds[0].summary.score}</Text>
                      <Text style={styles.summaryStatLabel}>Strokes</Text>
                    </View>
                    <View style={styles.summaryStatBlock}>
                      <Text style={styles.summaryStatValue}>{savedRounds[0].summary.putts}</Text>
                      <Text style={styles.summaryStatLabel}>Putts</Text>
                    </View>
                    <View style={styles.summaryStatBlock}>
                      <Text style={styles.summaryStatValue}>{savedRounds[0].summary.fir}</Text>
                      <Text style={styles.summaryStatLabel}>FIR</Text>
                    </View>
                    <View style={styles.summaryStatBlock}>
                      <Text style={styles.summaryStatValue}>{savedRounds[0].summary.gir}</Text>
                      <Text style={styles.summaryStatLabel}>GIR</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Upcoming tee times</Text>
                <Text style={styles.sectionLink}>View all</Text>
              </View>
              {cards.map((card) => {
                const isSelected = selectedCard === card.course;
                return (
                  <Pressable
                    key={card.course}
                    style={[styles.teeCard, isSelected && styles.teeCardActive]}
                    onPress={() => setSelectedCard(card.course)}
                  >
                    <View style={styles.row}>
                      <View>
                        <Text style={styles.course}>{card.course}</Text>
                        <Text style={styles.meta}>{card.meta}</Text>
                      </View>
                      <View style={styles.rightBlock}>
                        <Text style={styles.time}>{card.time}</Text>
                        <Text style={styles.date}>{card.date}</Text>
                      </View>
                    </View>
                    <View style={styles.footer}>
                      <View style={styles.players}>
                        {card.players.map((player, index) => (
                          <View key={`${player}-${index}`} style={styles.playerDot}>
                            <Text style={styles.playerDotText}>{player}</Text>
                          </View>
                        ))}
                      </View>
                      <Text style={styles.hcapBadge}>HCP {profile?.handicap !== undefined ? profile.handicap : '12'}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}

        {screen !== 'scorecard' && (
          <Pressable style={styles.fab} onPress={() => setScreen('scorecard')}>
            <Text style={styles.fabText}>+</Text>
          </Pressable>
        )}

        <View style={styles.bottomNav}>
          {navItems.map((item) => {
            const active = selectedNav === item.label;
            return (
              <Pressable key={item.label} style={styles.navBtn} onPress={() => setSelectedNav(item.label)}>
                <Text style={[styles.navIcon, active && styles.navActiveText]}>{item.icon}</Text>
                <Text style={[styles.navLabel, active && styles.navActiveText]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    minHeight: '100vh',
    width: '100%',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#1a2c20'
  },
  headerBar: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#b89a5c',
    marginRight: 6,
    shadowColor: '#b89a5c',
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 }
  },
  headerText: {
    fontSize: 11,
    color: '#c9bf9f',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  togglePro: {
    backgroundColor: '#243d2c',
    borderWidth: 1,
    borderColor: '#335041',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  toggleProText: {
    fontSize: 10,
    color: '#c9bf9f',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  phone: {
    width: '100%',
    maxWidth: 390,
    height: 812,
    backgroundColor: '#1a2c20',
    borderRadius: 36,
    borderWidth: 1,
    borderColor: '#335041',
    overflow: 'hidden',
    position: 'relative'
  },
  notch: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: [{ translateX: -55 }],
    width: 110,
    height: 26,
    backgroundColor: '#0d1812',
    borderRadius: 18,
    zIndex: 100
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 28
  },
  statusText: {
    fontSize: 13,
    color: '#f1ead9',
    fontWeight: '700'
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  iconText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#f1ead9'
  },
  screen: {
    flex: 1,
    paddingBottom: 100
  },
  screenContent: {
    paddingBottom: 20
  },
  hero: {
    marginTop: 20,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 20,
    backgroundColor: '#243d2c',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#335041'
  },
  heroLabel: {
    fontSize: 10,
    color: '#b89a5c',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6
  },
  heroTitle: {
    fontSize: 22,
    color: '#f1ead9',
    fontWeight: '600',
    marginBottom: 14
  },
  heroStats: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  heroStatText: {
    fontSize: 11,
    color: '#c9bf9f',
    flex: 1
  },
  heroStatValue: {
    color: '#f1ead9',
    fontWeight: '700'
  },
  heroSubtitle: {
    fontSize: 12,
    color: '#c9bf9f',
    marginTop: 4,
    marginBottom: 12
  },
  courseCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#1e3527',
    borderWidth: 1,
    borderColor: '#335041'
  },
  teeOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 14,
    marginHorizontal: 16
  },
  teeOption: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#335041',
    backgroundColor: '#243d2c',
    alignItems: 'center'
  },
  teeOptionActive: {
    backgroundColor: '#2a4632',
    borderColor: '#b89a5c'
  },
  teeOptionText: {
    fontSize: 11,
    color: '#c9bf9f',
    fontWeight: '600'
  },
  teeOptionTextActive: {
    color: '#f1ead9'
  },
  sectionSubtitle: {
    marginHorizontal: 16,
    fontSize: 11,
    color: '#c9bf9f',
    marginBottom: 12
  },
  emptyText: {
    marginHorizontal: 16,
    fontSize: 11,
    color: '#c9bf9f',
    marginBottom: 12
  },
  roundSummaryCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#243d2c',
    borderWidth: 1,
    borderColor: '#335041'
  },
  summaryLabel: {
    fontSize: 14,
    color: '#f1ead9',
    fontWeight: '700',
    marginBottom: 6
  },
  summaryMeta: {
    fontSize: 10,
    color: '#c9bf9f',
    marginBottom: 14
  },
  summaryStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  summaryStatBlock: {
    flex: 1,
    alignItems: 'center'
  },
  summaryStatValue: {
    fontSize: 15,
    color: '#f1ead9',
    fontWeight: '700'
  },
  summaryStatLabel: {
    fontSize: 9,
    color: '#c9bf9f',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.08
  },
  scorecardHeader: {
    marginTop: 20,
    marginHorizontal: 16,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  backBtn: {
    borderWidth: 1,
    borderColor: '#335041',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8
  },
  backBtnText: {
    color: '#b89a5c',
    fontSize: 11,
    fontWeight: '700'
  },
  screenTitle: {
    fontSize: 18,
    color: '#f1ead9',
    fontWeight: '700'
  },
  screenSubtitle: {
    fontSize: 11,
    color: '#c9bf9f',
    marginTop: 2
  },
  holeRow: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#243d2c',
    borderWidth: 1,
    borderColor: '#335041'
  },
  holeMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  holeLabel: {
    color: '#f1ead9',
    fontSize: 13,
    fontWeight: '700'
  },
  holePar: {
    color: '#c9bf9f',
    fontSize: 11
  },
  scoreInputsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10
  },
  inputGroup: {
    flex: 1
  },
  inputLabel: {
    color: '#c9bf9f',
    fontSize: 9,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.1
  },
  input: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#335041',
    paddingHorizontal: 12,
    color: '#f1ead9',
    backgroundColor: '#1a2c20'
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10
  },
  toggleChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#335041',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#1e3527'
  },
  toggleChipActive: {
    backgroundColor: '#2a4632',
    borderColor: '#b89a5c'
  },
  toggleText: {
    color: '#c9bf9f',
    fontSize: 11,
    fontWeight: '700'
  },
  toggleTextActive: {
    color: '#f1ead9'
  },
  saveRoundBtn: {
    marginHorizontal: 16,
    marginBottom: 28,
    borderRadius: 14,
    backgroundColor: '#b89a5c',
    paddingVertical: 14,
    alignItems: 'center'
  },
  saveRoundText: {
    color: '#1a2c20',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.15,
    textTransform: 'uppercase'
  },
  startRoundBtn: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#b89a5c',
    paddingVertical: 14,
    alignItems: 'center'
  },
  startRoundText: {
    color: '#1a2c20',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.15,
    textTransform: 'uppercase'
  },
  courseCardActive: {
    backgroundColor: '#2a4632',
    borderColor: '#b89a5c'
  },
  courseCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  courseInfo: {
    flex: 1,
    paddingRight: 10
  },
  courseCardTitle: {
    fontSize: 14,
    color: '#f1ead9',
    fontWeight: '700',
    marginBottom: 4
  },
  courseCardMeta: {
    fontSize: 10,
    color: '#c9bf9f'
  },
  courseDistance: {
    fontSize: 13,
    color: '#b89a5c',
    fontWeight: '700'
  },
  section: {
    marginBottom: 20
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
    paddingHorizontal: 4
  },
  sectionTitle: {
    fontSize: 10,
    color: '#c9bf9f',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  sectionLink: {
    fontSize: 10,
    color: '#b89a5c',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  refreshButton: {
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  teeCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#243d2c',
    borderWidth: 1,
    borderColor: '#335041'
  },
  teeCardActive: {
    backgroundColor: '#2a4632',
    borderColor: '#b89a5c'
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  course: {
    fontSize: 17,
    color: '#f1ead9',
    marginBottom: 4
  },
  meta: {
    fontSize: 10,
    color: '#c9bf9f',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  rightBlock: {
    alignItems: 'flex-end'
  },
  time: {
    fontSize: 13,
    color: '#b89a5c',
    fontWeight: '700'
  },
  date: {
    fontSize: 10,
    color: '#8c8467',
    marginTop: 2
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#426452'
  },
  players: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  playerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#243d2c',
    borderWidth: 1.5,
    borderColor: '#426452',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: -8
  },
  playerDotText: {
    fontSize: 9,
    color: '#c9bf9f',
    fontWeight: '700'
  },
  hcapBadge: {
    fontSize: 10,
    color: '#c9bf9f',
    backgroundColor: '#243d2c',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#335041'
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#b89a5c',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#b89a5c',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  fabText: {
    color: '#1a2c20',
    fontSize: 26,
    fontWeight: '700'
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,14,12,0.92)',
    borderTopWidth: 1,
    borderTopColor: '#335041',
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center'
  },
  navBtn: {
    alignItems: 'center'
  },
  navIcon: {
    fontSize: 18,
    color: '#c9bf9f'
  },
  navLabel: {
    fontSize: 9,
    color: '#c9bf9f',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  navActiveText: {
    color: '#b89a5c'
  },
  statsHeader: {
    marginTop: 20,
    marginHorizontal: 16,
    marginBottom: 16
  },
  statsTitle: {
    fontSize: 18,
    color: '#f1ead9',
    fontWeight: '700'
  },
  statsSubtitle: {
    fontSize: 11,
    color: '#c9bf9f',
    marginTop: 4
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 12,
    marginBottom: 20
  },
  statCard: {
    width: '45%',
    aspectRatio: 1.2,
    margin: '2.5%',
    backgroundColor: '#243d2c',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#335041',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10
  },
  statValue: {
    fontSize: 26,
    color: '#b89a5c',
    fontWeight: '700',
    marginBottom: 4
  },
  statLabel: {
    fontSize: 9,
    color: '#c9bf9f',
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  historyCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#243d2c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#335041'
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  historyCourse: {
    fontSize: 13,
    color: '#f1ead9',
    fontWeight: '700',
    marginBottom: 2
  },
  historyMeta: {
    fontSize: 9,
    color: '#c9bf9f'
  },
  historyScoreContainer: {
    alignItems: 'center',
    backgroundColor: '#1a2c20',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#335041'
  },
  historyScoreValue: {
    fontSize: 14,
    color: '#b89a5c',
    fontWeight: '700'
  },
  historyScoreLabel: {
    fontSize: 7,
    color: '#c9bf9f',
    textTransform: 'uppercase'
  },
  historyStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#335041',
    paddingTop: 8,
    marginTop: 4
  },
  historyStatBlock: {
    flex: 1,
    alignItems: 'center'
  },
  historyStatVal: {
    fontSize: 12,
    color: '#f1ead9',
    fontWeight: '700'
  },
  historyStatLbl: {
    fontSize: 8,
    color: '#c9bf9f',
    textTransform: 'uppercase'
  },
  snapPostBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#243d2c',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#335041',
    paddingVertical: 12,
    alignItems: 'center'
  },
  snapPostBtnText: {
    color: '#b89a5c',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  snapCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#243d2c',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#335041'
  },
  snapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  snapAuthor: {
    fontSize: 13,
    color: '#f1ead9',
    fontWeight: '700'
  },
  snapTime: {
    fontSize: 9,
    color: '#c9bf9f'
  },
  snapText: {
    fontSize: 12,
    color: '#c9bf9f',
    lineHeight: 16,
    marginBottom: 10
  },
  snapImage: {
    height: 120,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  snapImageText: {
    fontSize: 11,
    color: '#f1ead9',
    fontWeight: '600'
  },
  alertCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#243d2c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#335041'
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  alertTitle: {
    fontSize: 12,
    color: '#b89a5c',
    fontWeight: '700'
  },
  alertTime: {
    fontSize: 8,
    color: '#c9bf9f'
  },
  alertBody: {
    fontSize: 11,
    color: '#f1ead9',
    lineHeight: 15
  },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10
  },
  alertButtonAccept: {
    flex: 1,
    backgroundColor: '#b89a5c',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center'
  },
  alertButtonDecline: {
    flex: 1,
    backgroundColor: '#1a2c20',
    borderWidth: 1,
    borderColor: '#335041',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center'
  },
  alertButtonTextAccept: {
    fontSize: 10,
    color: '#1a2c20',
    fontWeight: '700'
  },
  alertButtonTextDecline: {
    fontSize: 10,
    color: '#f1ead9',
    fontWeight: '700'
  }
});

