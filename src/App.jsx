import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import courses from './data/courses.json';
import apiScorecards from './data/api_scorecards.json';
import foresomeLogo from './assets/foresome-logo.png';



// ── Real scorecard database for KC metro courses ──
// Verified hole-by-hole data: par, yardage (blue/back tees), handicap
const REAL_SCORECARDS = {
  // Shoal Creek Golf Course — Par 71, 6983 yds (Gold tees)
  'Shoal Creek Golf Course': {
    pars:  [4, 4, 3, 4, 3, 4, 5, 4, 5,  4, 3, 4, 5, 4, 4, 4, 3, 4],
    yards: [426, 427, 195, 418, 234, 364, 579, 447, 536,  388, 214, 360, 527, 420, 434, 352, 198, 464],
    hcps:  [3, 15, 13, 7, 11, 17, 1, 5, 9,  10, 14, 16, 4, 6, 8, 18, 12, 2]
  },
  // Swope Memorial Golf Course — Par 72, 6274 yds (Blue tees)
  'Swope Memorial Golf Course': {
    pars:  [4, 4, 4, 4, 5, 3, 4, 3, 5,  4, 4, 5, 3, 4, 4, 3, 5, 4],
    yards: [372, 317, 267, 368, 451, 172, 330, 167, 477,  384, 361, 504, 235, 416, 349, 134, 566, 404],
    hcps:  [3, 13, 17, 1, 5, 11, 15, 9, 7,  6, 12, 10, 16, 2, 14, 18, 8, 4]
  },
  // Heart Of America Golf Academy River Course — 9-hole, Par 35, 2604 yds
  // Doubled to 18 for tracker compatibility (play front nine twice)
  'Heart Of America Golf Academy River Course': {
    pars:  [4, 4, 3, 4, 4, 4, 5, 3, 4,  4, 4, 3, 4, 4, 4, 5, 3, 4],
    yards: [282, 374, 176, 295, 256, 221, 482, 138, 380,  282, 374, 176, 295, 256, 221, 482, 138, 380],
    hcps:  [3, 1, 7, 5, 9, 13, 11, 17, 15,  4, 2, 8, 6, 10, 14, 12, 18, 16]
  },
  // Tiffany Greens Golf Club — Par 72, 7055 yds (Back tees)
  'Tiffany Greens Golf Club': {
    pars:  [5, 4, 4, 3, 4, 3, 4, 4, 5,  3, 5, 4, 4, 4, 3, 5, 4, 4],
    yards: [537, 385, 425, 199, 370, 234, 410, 430, 575,  188, 540, 426, 400, 370, 195, 535, 415, 421],
    hcps:  [7, 9, 1, 11, 15, 13, 17, 3, 5,  10, 14, 6, 2, 18, 12, 8, 16, 4]
  },
  // Hodge Park Golf Club — Par 70, 6050 yds (Blue tees)
  'Hodge Park Golf Club': {
    pars:  [4, 4, 3, 4, 4, 4, 3, 4, 4,  4, 5, 3, 4, 4, 4, 3, 5, 4],
    yards: [414, 337, 155, 442, 438, 281, 164, 399, 392,  391, 459, 186, 388, 260, 328, 180, 518, 318],
    hcps:  [3, 17, 13, 7, 1, 15, 11, 9, 5,  4, 14, 10, 2, 18, 8, 6, 12, 16]
  }
};

// Generate yardage estimates based on par values
function generateYards(pars) {
  const yardRanges = { 3: [145, 200], 4: [350, 440], 5: [500, 560] };
  return pars.map((p, i) => {
    const [min, max] = yardRanges[p] || yardRanges[4];
    // Use hole index as seed for consistent yardage per course
    const t = ((i * 7 + 3) % 17) / 17;
    return Math.round((min + t * (max - min)) / 5) * 5;
  });
}

// Fallback: generate approximate data from a course's total par
function generateCourseData(course) {
  const totalPar = parseInt(course?.par) || 72;

  const parTemplates = {
    70: [4, 4, 3, 4, 4, 3, 5, 4, 4,   4, 3, 4, 4, 3, 5, 4, 4, 3],
    71: [4, 5, 3, 4, 4, 3, 5, 4, 4,   4, 3, 4, 4, 3, 5, 4, 4, 3],
    72: [4, 5, 3, 4, 4, 3, 5, 4, 4,   4, 3, 5, 4, 4, 3, 5, 4, 4],
    73: [4, 5, 3, 4, 4, 3, 5, 4, 5,   4, 3, 5, 4, 4, 3, 5, 4, 4],
  };
  const pars = parTemplates[totalPar] || parTemplates[72];
  const hcps = [7, 11, 15, 5, 1, 17, 9, 13, 3, 8, 16, 12, 4, 2, 18, 10, 14, 6];

  return {
    name: course?.name || 'Unknown Course',
    pars,
    yards: generateYards(pars),
    hcps
  };
}

// Lookup priority: REAL_SCORECARDS (verified + yardage) > API scorecards (par + hcp) > template fallback
const courseDataCache = {};
function getCourseData(course) {
  if (!course) return generateCourseData(course);
  if (!courseDataCache[course.id]) {
    // 1. Hand-verified scorecards with real yardage
    const real = REAL_SCORECARDS[course.name];
    if (real) {
      courseDataCache[course.id] = { name: course.name, ...real };
    }
    // 2. OpenGolf API scorecards (par + handicap, generated yardage)
    else if (apiScorecards[course.name]) {
      const api = apiScorecards[course.name];
      courseDataCache[course.id] = {
        name: course.name,
        pars: api.pars,
        yards: generateYards(api.pars),
        hcps: api.hcps
      };
    }
    // 3. Template fallback
    else {
      courseDataCache[course.id] = generateCourseData(course);
    }
  }
  return courseDataCache[course.id];
}

export default function App() {
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
  const [showInstallCard, setShowInstallCard] = useState(false);
  const deferredPromptRef = useRef(null);

  // App navigation state
  const [screen, setScreen] = useState('home'); // 'home', 'chat', 'snap-intro', 'log', 'stats', 'camera', 'review', 'paywall'
  const [isPro, setIsPro] = useState(false);
  const [savedRounds, setSavedRounds] = useState([]);
  const [loadingRounds, setLoadingRounds] = useState(false);

  // Player system state
  const [foursomePlayers, setFoursomePlayers] = useState([]); // [{id, username, initials, handicap, bio, status}]
  const [showPlayerSearch, setShowPlayerSearch] = useState(false);
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSearchResults, setPlayerSearchResults] = useState([]);
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [friends, setFriends] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [showFriendsList, setShowFriendsList] = useState(false);

  // Groups state
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupMessages, setGroupMessages] = useState([]);
  const [groupMsgInput, setGroupMsgInput] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupEmoji, setNewGroupEmoji] = useState('⛳');
  const [groupInviteSearch, setGroupInviteSearch] = useState('');
  const [groupInviteResults, setGroupInviteResults] = useState([]);
  const [pendingGroupInvites, setPendingGroupInvites] = useState([]);
  const groupChatRef = useRef(null);

  // Manual Tracker State
  const [currentHole, setCurrentHole] = useState(1);
  const [selectedCourse, setSelectedCourse] = useState(courses.find(c => c.name.includes("Shoal Creek")) || courses[0]);
  const [selectedTee, setSelectedTee] = useState('Blue');
  const [showEor, setShowEor] = useState(false);
  const [holeStatView, setHoleStatView] = useState('score');
  const [intelView, setIntelView] = useState('rounds'); // 'rounds' | 'lastRound'

  // Active course data — recalculates when selectedCourse changes
  const activeCourseData = getCourseData(selectedCourse);

  const [holeScores, setHoleScores] = useState(
    Array.from({ length: 18 }, (_, index) => ({
      hole: index + 1,
      score: activeCourseData.pars[index], // Default to hole par
      fir: false,
      gir: false,
      pen: false,
      putts: 2 // Default to 2 putts
    }))
  );

  // Quick Entry Form state
  const [quickCourse, setQuickCourse] = useState('Shoal Creek');
  const [quickTee, setQuickTee] = useState('Blue');
  const [quickDate, setQuickDate] = useState('2026-05-17');
  const [quickScore, setQuickScore] = useState(84);
  const [quickFir, setQuickFir] = useState(8);
  const [quickGir, setQuickGir] = useState(6);
  const [quickPutts, setQuickPutts] = useState(32);

  // Course search
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [quickCourseSearchQuery, setQuickCourseSearchQuery] = useState('');
  const [quickCourseSearchOpen, setQuickCourseSearchOpen] = useState(false);
  const courseSearchRef = useRef(null);
  const quickCourseSearchRef = useRef(null);

  // Filter courses by search query
  const filteredCourses = courses.filter(c =>
    c.name.toLowerCase().includes(courseSearchQuery.toLowerCase())
  ).slice(0, 8);
  const filteredQuickCourses = courses.filter(c =>
    c.name.toLowerCase().includes(quickCourseSearchQuery.toLowerCase())
  ).slice(0, 8);

  // Close search dropdowns on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (courseSearchRef.current && !courseSearchRef.current.contains(e.target)) setCourseSearchOpen(false);
      if (quickCourseSearchRef.current && !quickCourseSearchRef.current.contains(e.target)) setQuickCourseSearchOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInputText, setChatInputText] = useState('');

  // Camera Scanning simulation state
  const [isScanning, setIsScanning] = useState(false);
  const [processingStep, setProcessingStep] = useState('Extracting course & scores');

  // Review screen states (pre-filled with mockup scan results)
  const [reviewCourse, setReviewCourse] = useState('Shoal Creek');
  const [reviewTee, setReviewTee] = useState('Blue');
  const [reviewDate, setReviewDate] = useState('2026-05-17');
  const [reviewTotalPar, setReviewTotalPar] = useState(71);
  // Default Shoal Creek review scores:
  const [reviewScores, setReviewScores] = useState([4, 5, 3, 5, 5, 4, 6, 4, 5, 4, 4, 6, 5, 5, 3, 6, 4, 6]);

  // Auth setup useEffect
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchRounds(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
        fetchRounds(session.user.id);
      } else {
        setProfile(null);
        setSavedRounds([]);
      }
    });

    // Capture PWA install prompt
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

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
      setSavedRounds(data || []);
    }
    setLoadingRounds(false);
  };

  // ── Player Search & Invite System ──
  const searchPlayers = async (query) => {
    if (!query || query.length < 2) { setPlayerSearchResults([]); return; }
    setPlayerSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, initials, handicap, bio')
        .ilike('username', `%${query}%`)
        .neq('id', session?.user?.id || '')
        .limit(10);
      if (!error) setPlayerSearchResults(data || []);
    } catch (e) { console.error(e); }
    setPlayerSearchLoading(false);
  };

  // Debounced search
  useEffect(() => {
    if (!showPlayerSearch) return;
    const timer = setTimeout(() => searchPlayers(playerSearchQuery), 300);
    return () => clearTimeout(timer);
  }, [playerSearchQuery, showPlayerSearch]);

  const fetchFriends = async () => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase
        .from('friends')
        .select('*')
        .or(`user_id.eq.${session.user.id},friend_id.eq.${session.user.id}`);
      if (!error && data) {
        // Get profile info for each friend
        const friendIds = data.map(f => f.user_id === session.user.id ? f.friend_id : f.user_id);
        if (friendIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, initials, handicap, bio')
            .in('id', friendIds);
          setFriends(data.map(f => {
            const fId = f.user_id === session.user.id ? f.friend_id : f.user_id;
            const prof = (profiles || []).find(p => p.id === fId);
            return { ...f, profile: prof };
          }));
        } else {
          setFriends([]);
        }
      }
    } catch (e) { console.error(e); }
  };

  const fetchInvites = async () => {
    if (!session?.user?.id) return;
    try {
      // Invites received
      const { data: incoming } = await supabase
        .from('invites')
        .select('*')
        .eq('to_user_id', session.user.id)
        .eq('status', 'pending');
      // Get sender profiles
      if (incoming && incoming.length > 0) {
        const senderIds = incoming.map(i => i.from_user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, initials, handicap, bio')
          .in('id', senderIds);
        setPendingInvites(incoming.map(inv => ({
          ...inv,
          fromProfile: (profiles || []).find(p => p.id === inv.from_user_id)
        })));
      } else {
        setPendingInvites([]);
      }

      // Invites sent
      const { data: outgoing } = await supabase
        .from('invites')
        .select('*')
        .eq('from_user_id', session.user.id)
        .in('status', ['pending', 'accepted']);
      if (outgoing && outgoing.length > 0) {
        const toIds = outgoing.map(i => i.to_user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, initials, handicap, bio')
          .in('id', toIds);
        setSentInvites(outgoing.map(inv => ({
          ...inv,
          toProfile: (profiles || []).find(p => p.id === inv.to_user_id)
        })));
        // Auto-populate foursome with accepted invites
        const accepted = outgoing.filter(i => i.status === 'accepted');
        if (accepted.length > 0) {
          const acceptedProfiles = accepted.map(inv => {
            const prof = (profiles || []).find(p => p.id === inv.to_user_id);
            return prof ? { ...prof, status: 'confirmed' } : null;
          }).filter(Boolean);
          setFoursomePlayers(prev => {
            const existingIds = prev.map(p => p.id);
            const newPlayers = acceptedProfiles.filter(p => !existingIds.includes(p.id));
            return [...prev, ...newPlayers].slice(0, 3);
          });
        }
      } else {
        setSentInvites([]);
      }
    } catch (e) { console.error(e); }
  };

  // Fetch friends and invites when session loads
  useEffect(() => {
    if (session?.user?.id) {
      fetchFriends();
      fetchInvites();
    }
  }, [session?.user?.id]);

  const sendInvite = async (toUserId) => {
    if (!session?.user?.id) return;
    try {
      const { error } = await supabase.from('invites').insert([{
        from_user_id: session.user.id,
        to_user_id: toUserId,
        course_name: selectedCourse?.name || 'TBD',
        tee_time: '',
        tee_date: '',
        message: `${profile?.username || 'A player'} wants you to join their foursome!`,
        status: 'pending'
      }]);
      if (!error) {
        alert('Invite sent!');
        fetchInvites();
      } else {
        alert('Could not send invite: ' + error.message);
      }
    } catch (e) { console.error(e); }
  };

  const acceptInvite = async (inviteId) => {
    try {
      const { error } = await supabase
        .from('invites')
        .update({ status: 'accepted' })
        .eq('id', inviteId);
      if (!error) fetchInvites();
    } catch (e) { console.error(e); }
  };

  const declineInvite = async (inviteId) => {
    try {
      const { error } = await supabase
        .from('invites')
        .update({ status: 'declined' })
        .eq('id', inviteId);
      if (!error) fetchInvites();
    } catch (e) { console.error(e); }
  };

  const sendFriendRequest = async (friendId) => {
    if (!session?.user?.id) return;
    try {
      const { error } = await supabase.from('friends').insert([{
        user_id: session.user.id,
        friend_id: friendId,
        status: 'pending'
      }]);
      if (!error) {
        alert('Friend request sent!');
        fetchFriends();
      } else {
        if (error.message.includes('duplicate')) {
          alert('Friend request already sent!');
        } else {
          alert('Could not send request: ' + error.message);
        }
      }
    } catch (e) { console.error(e); }
  };

  const acceptFriend = async (friendshipId) => {
    try {
      const { error } = await supabase
        .from('friends')
        .update({ status: 'accepted' })
        .eq('id', friendshipId);
      if (!error) fetchFriends();
    } catch (e) { console.error(e); }
  };

  const removeFromFoursome = (playerId) => {
    setFoursomePlayers(prev => prev.filter(p => p.id !== playerId));
  };

  const addToFoursome = (player) => {
    if (foursomePlayers.length >= 3) { alert('Foursome is full (4 players max including you)'); return; }
    if (foursomePlayers.find(p => p.id === player.id)) { alert('Player already in foursome'); return; }
    setFoursomePlayers(prev => [...prev, { ...player, status: 'confirmed' }]);
  };

  // ── Groups System ──
  const fetchGroups = async () => {
    if (!session?.user?.id) return;
    try {
      // Groups where I'm admin
      const { data: adminGroups } = await supabase
        .from('groups')
        .select('*')
        .eq('admin_id', session.user.id);

      // Groups where I'm a member
      const { data: memberRows } = await supabase
        .from('group_members')
        .select('group_id, status')
        .eq('user_id', session.user.id)
        .in('status', ['active', 'invited']);

      let memberGroups = [];
      if (memberRows && memberRows.length > 0) {
        const gIds = memberRows.map(m => m.group_id);
        const { data } = await supabase.from('groups').select('*').in('id', gIds);
        memberGroups = (data || []).map(g => ({
          ...g,
          myStatus: memberRows.find(m => m.group_id === g.id)?.status
        }));
      }

      // Merge and deduplicate
      const allGroups = [...(adminGroups || []).map(g => ({ ...g, myRole: 'admin', myStatus: 'active' }))];
      (memberGroups || []).forEach(g => {
        if (!allGroups.find(ag => ag.id === g.id)) {
          allGroups.push({ ...g, myRole: 'member' });
        }
      });

      setGroups(allGroups);

      // Pending group invites
      const pending = allGroups.filter(g => g.myStatus === 'invited');
      setPendingGroupInvites(pending);
    } catch (e) { console.error('fetchGroups error:', e); }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) { alert('Group name is required'); return; }
    if (!session?.user?.id) return;
    try {
      // Insert group (no .select() chain to avoid RLS issues)
      const { error } = await supabase.from('groups').insert([{
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        admin_id: session.user.id,
        avatar_emoji: newGroupEmoji || '⛳',
        is_private: true
      }]);

      if (error) { alert('Error creating group: ' + error.message); return; }

      // Fetch the newly created group to get its ID
      const { data: newGroups } = await supabase
        .from('groups')
        .select('id')
        .eq('admin_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (newGroups && newGroups.length > 0) {
        // Add admin as active member
        await supabase.from('group_members').insert([{
          group_id: newGroups[0].id,
          user_id: session.user.id,
          role: 'admin',
          status: 'active'
        }]);
      }

      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupDesc('');
      setNewGroupEmoji('⛳');
      fetchGroups();
    } catch (e) { console.error(e); }
  };

  const fetchGroupDetail = async (groupId) => {
    try {
      // Fetch members with profiles
      const { data: members } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', groupId)
        .in('status', ['active', 'invited']);

      if (members && members.length > 0) {
        const userIds = members.map(m => m.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, initials, handicap, bio')
          .in('id', userIds);
        setGroupMembers(members.map(m => ({
          ...m,
          profile: (profiles || []).find(p => p.id === m.user_id)
        })));
      } else {
        setGroupMembers([]);
      }

      // Fetch messages
      const { data: msgs } = await supabase
        .from('group_messages')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (msgs && msgs.length > 0) {
        const userIds = [...new Set(msgs.map(m => m.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, initials')
          .in('id', userIds);
        setGroupMessages(msgs.map(m => ({
          ...m,
          senderProfile: (profiles || []).find(p => p.id === m.user_id)
        })));
      } else {
        setGroupMessages([]);
      }
    } catch (e) { console.error(e); }
  };

  const openGroup = (group) => {
    setSelectedGroup(group);
    setScreen('group-detail');
    fetchGroupDetail(group.id);
  };

  const inviteToGroup = async (userId) => {
    if (!selectedGroup) return;
    try {
      const { error } = await supabase.from('group_members').insert([{
        group_id: selectedGroup.id,
        user_id: userId,
        role: 'member',
        status: 'invited'
      }]);
      if (error) {
        if (error.message.includes('duplicate')) alert('Already invited!');
        else alert('Error: ' + error.message);
      } else {
        alert('Invite sent!');
        fetchGroupDetail(selectedGroup.id);
        setGroupInviteSearch('');
        setGroupInviteResults([]);
      }
    } catch (e) { console.error(e); }
  };

  const acceptGroupInvite = async (groupId) => {
    if (!session?.user?.id) return;
    try {
      const { error } = await supabase
        .from('group_members')
        .update({ status: 'active' })
        .eq('group_id', groupId)
        .eq('user_id', session.user.id);
      if (!error) fetchGroups();
    } catch (e) { console.error(e); }
  };

  const removeFromGroup = async (membershipId) => {
    try {
      await supabase.from('group_members').delete().eq('id', membershipId);
      if (selectedGroup) fetchGroupDetail(selectedGroup.id);
    } catch (e) { console.error(e); }
  };

  const leaveGroup = async (groupId) => {
    if (!session?.user?.id) return;
    if (!confirm('Leave this group?')) return;
    try {
      await supabase.from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', session.user.id);
      setScreen('groups');
      setSelectedGroup(null);
      fetchGroups();
    } catch (e) { console.error(e); }
  };

  const deleteGroup = async (groupId) => {
    if (!confirm('Delete this group? This cannot be undone.')) return;
    try {
      await supabase.from('groups').delete().eq('id', groupId);
      setScreen('groups');
      setSelectedGroup(null);
      fetchGroups();
    } catch (e) { console.error(e); }
  };

  const sendGroupMessage = async () => {
    if (!groupMsgInput.trim() || !selectedGroup || !session?.user?.id) return;
    try {
      const { error } = await supabase.from('group_messages').insert([{
        group_id: selectedGroup.id,
        user_id: session.user.id,
        text: groupMsgInput.trim()
      }]);
      if (!error) {
        setGroupMsgInput('');
        fetchGroupDetail(selectedGroup.id);
        setTimeout(() => {
          if (groupChatRef.current) groupChatRef.current.scrollTop = groupChatRef.current.scrollHeight;
        }, 100);
      }
    } catch (e) { console.error(e); }
  };

  // Search players to invite to group
  const searchGroupInvitePlayers = async (query) => {
    if (!query || query.length < 2) { setGroupInviteResults([]); return; }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, initials, handicap')
        .ilike('username', `%${query}%`)
        .neq('id', session?.user?.id || '')
        .limit(8);
      // Filter out existing members
      const memberIds = groupMembers.map(m => m.user_id);
      setGroupInviteResults((data || []).filter(p => !memberIds.includes(p.id)));
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (!groupInviteSearch) return;
    const t = setTimeout(() => searchGroupInvitePlayers(groupInviteSearch), 300);
    return () => clearTimeout(t);
  }, [groupInviteSearch]);

  // Fetch groups when session loads
  useEffect(() => {
    if (session?.user?.id) fetchGroups();
  }, [session?.user?.id]);

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
          // Show install card instead of alert
          setShowInstallCard(true);
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

  // Stats dashboard calculations
  const totalRoundsCount = savedRounds.length;
  const totalScores = savedRounds.reduce((acc, r) => acc + (r.summary?.score || 0), 0);
  const totalPutts = savedRounds.reduce((acc, r) => acc + (r.summary?.putts || 0), 0);
  const totalFir = savedRounds.reduce((acc, r) => acc + (r.summary?.fir || 0), 0);
  const totalGir = savedRounds.reduce((acc, r) => acc + (r.summary?.gir || 0), 0);

  const avgScore = totalRoundsCount > 0 ? (totalScores / totalRoundsCount).toFixed(1) : '84.2';
  const avgPutts = totalRoundsCount > 0 ? (totalPutts / totalRoundsCount).toFixed(1) : '32.4';
  const avgFir = totalRoundsCount > 0 ? Math.round((totalFir / (totalRoundsCount * 18)) * 100) : 52;
  const avgGir = totalRoundsCount > 0 ? Math.round((totalGir / (totalRoundsCount * 18)) * 100) : 41;

  // Quick entry save
  const saveQuickRound = async () => {
    if (!session?.user) return;

    const roundData = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      course_name: quickCourse,
      tee: quickTee,
      created_at: new Date(quickDate).toISOString(),
      completed_holes: 18,
      summary: {
        score: Number(quickScore),
        putts: Number(quickPutts),
        fir: Number(quickFir),
        gir: Number(quickGir)
      },
      hole_scores: Array.from({ length: 18 }, (_, index) => ({
        hole: index + 1,
        score: Math.round(Number(quickScore) / 18),
        fir: index < Number(quickFir),
        gir: index < Number(quickGir),
        putts: index < Number(quickPutts) % 18 ? 2 : 1
      }))
    };

    const { data, error } = await supabase.from('rounds').insert([roundData]).select();
    if (error) {
      alert('Error saving round: ' + error.message);
    } else {
      alert('Round saved successfully!');
      fetchRounds(session.user.id);
      setScreen('stats'); // Go to Intel
    }
  };

  // Manual tracker logic
  const currentHoleData = holeScores[currentHole - 1];

  const adjustScore = (delta) => {
    const newScore = currentHoleData.score + delta;
    if (newScore < 1 || newScore > 12) return;
    setHoleScores(prev =>
      prev.map(h => h.hole === currentHole ? { ...h, score: newScore } : h)
    );
  };

  const setPutts = (n) => {
    setHoleScores(prev =>
      prev.map(h => h.hole === currentHole ? { ...h, putts: n } : h)
    );
  };

  const toggleStat = (statName) => {
    if (statName === 'fir' && activeCourseData.pars[currentHole - 1] === 3) return;
    setHoleScores(prev =>
      prev.map(h => h.hole === currentHole ? { ...h, [statName]: !h[statName] } : h)
    );
  };

  // Calculations for tracker running totals
  const played = currentHole - 1;
  let runningTotal = 0;
  let runningPar = 0;
  for (let i = 0; i < played; i++) {
    runningTotal += Number(holeScores[i].score);
    runningPar += activeCourseData.pars[i];
  }
  const vsParDiff = runningTotal - runningPar;
  const vsParText = played === 0 ? 'E' : (vsParDiff === 0 ? 'E' : (vsParDiff > 0 ? `+${vsParDiff}` : `${vsParDiff}`));

  // Stepper score diff formatting
  const currentPar = activeCourseData.pars[currentHole - 1];
  const currentDiff = currentHoleData.score - currentPar;
  let stepperLabel = 'PAR';
  let stepperResult = 'EVEN';
  let stepperClass = 'score-result';
  if (currentDiff <= -2) { stepperLabel = 'EAGLE'; stepperResult = `${currentDiff}`; stepperClass += ' eagle'; }
  else if (currentDiff === -1) { stepperLabel = 'BIRDIE'; stepperResult = '−1'; stepperClass += ' birdie'; }
  else if (currentDiff === 0) { stepperLabel = 'PAR'; stepperResult = 'EVEN'; }
  else if (currentDiff === 1) { stepperLabel = 'BOGEY'; stepperResult = '+1'; stepperClass += ' bogey'; }
  else if (currentDiff === 2) { stepperLabel = 'DOUBLE'; stepperResult = '+2'; stepperClass += ' double'; }
  else if (currentDiff >= 3) { stepperLabel = `+${currentDiff}`; stepperResult = `+${currentDiff}`; stepperClass += ' double'; }

  // Foursome score calculation
  const youScore = played === 0 ? 0 : runningTotal;
  const youDiff = vsParDiff;

  const getDiffText = (diff) => {
    if (diff === 0) return 'E';
    if (diff > 0) return `+${diff}`;
    return `${diff}`;
  };

  const nextHole = () => {
    if (currentHole === 18) {
      setShowEor(true);
      return;
    }
    setCurrentHole(prev => prev + 1);
  };

  const prevHole = () => {
    if (currentHole === 1) return;
    setCurrentHole(prev => prev - 1);
  };

  const saveManualRound = async () => {
    if (!session?.user) return;

    const totalScore = holeScores.reduce((acc, h) => acc + Number(h.score || 0), 0);
    const totalPutts = holeScores.reduce((acc, h) => acc + Number(h.putts || 0), 0);
    const totalFir = holeScores.reduce((acc, h) => acc + (h.fir ? 1 : 0), 0);
    const totalGir = holeScores.reduce((acc, h) => acc + (h.gir ? 1 : 0), 0);

    const roundData = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      course_name: selectedCourse.name || 'Shoal Creek',
      tee: selectedTee,
      created_at: new Date().toISOString(),
      completed_holes: 18,
      summary: {
        score: totalScore,
        putts: totalPutts,
        fir: totalFir,
        gir: totalGir
      },
      hole_scores: holeScores
    };

    const { data, error } = await supabase.from('rounds').insert([roundData]).select();
    if (error) {
      alert('Error saving round: ' + error.message);
    } else {
      alert('Round saved successfully!');
      fetchRounds(session.user.id);
      // Reset manual tracker
      setHoleScores(
        Array.from({ length: 18 }, (_, index) => ({
          hole: index + 1,
          score: activeCourseData.pars[index],
          fir: false,
          gir: false,
          pen: false,
          putts: 2
        }))
      );
      setCurrentHole(1);
      setShowEor(false);
      setScreen('stats'); // Go to Intel
    }
  };

  const eorChooseSnap = () => {
    setShowEor(false);
    if (isPro) {
      setScreen('camera');
    } else {
      setScreen('paywall');
    }
  };

  // Camera Scanning simulation
  const startCameraScan = () => {
    setIsScanning(true);
    setProcessingStep('Extracting course & scores');
    setTimeout(() => {
      setProcessingStep('Verifying math...');
      setTimeout(() => {
        setIsScanning(false);
        setScreen('review');
      }, 1000);
    }, 1500);
  };

  // Confirm review scan score updates
  const updateReviewScore = (index, value) => {
    setReviewScores(prev => prev.map((s, i) => i === index ? Number(value) : s));
  };

  const saveReviewRound = async () => {
    if (!session?.user) return;

    const totalScore = reviewScores.reduce((acc, s) => acc + Number(s || 0), 0);
    // Mock review stats totals
    const roundData = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      course_name: reviewCourse,
      tee: reviewTee,
      created_at: new Date(reviewDate).toISOString(),
      completed_holes: 18,
      summary: {
        score: totalScore,
        putts: 31,
        fir: 9,
        gir: 8
      },
      hole_scores: reviewScores.map((s, index) => ({
        hole: index + 1,
        score: s,
        fir: index % 2 === 0,
        gir: index % 3 === 0,
        putts: index % 5 === 0 ? 1 : 2
      }))
    };

    const { data, error } = await supabase.from('rounds').insert([roundData]).select();
    if (error) {
      alert('Error saving round: ' + error.message);
    } else {
      alert('Round saved successfully!');
      fetchRounds(session.user.id);
      setScreen('stats'); // Go to Intel
    }
  };

  // Chat/Banter handlers
  const sendChatText = () => {
    if (!chatInputText.trim()) return;
    setChatMessages(prev => [
      ...prev,
      { sender: 'YOU', text: chatInputText.trim(), isMe: true }
    ]);
    setChatInputText('');
  };

  const sendQuickChat = (text) => {
    setChatMessages(prev => [
      ...prev,
      { sender: 'YOU', text: text, isMe: true }
    ]);
  };

  // Auth screen render
  if (!session) {
    return (
      <div className="stage">
        <div className="header-bar">
          <span><img src={foresomeLogo} alt="ForeSome" style={{ height: '28px', verticalAlign: 'middle' }} /></span>
          <button className="toggle-pro" style={{ opacity: 0.5 }}>
            <span>FREE USER</span>
          </button>
        </div>
        <div className="phone">
          
          <div className="screen auth-screen">
            {/* Logo + Branding */}
            <div className="auth-brand">
              <img src={foresomeLogo} alt="ForeSome" className="auth-logo" />
              <div className="auth-tagline">Find Your Foursome</div>
              <div className="auth-sub">Track · Compete · Connect</div>
            </div>

            {/* Tab Switcher */}
            <div className="auth-tabs">
              <button 
                type="button"
                className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setAuthError(''); }}
              >
                Log In
              </button>
              <button 
                type="button"
                className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signup'); setAuthError(''); }}
              >
                Sign Up
              </button>
            </div>

            {authError && (
              <div className="auth-error">{authError}</div>
            )}

            {/* Form */}
            <div className="auth-form">
              <div className="auth-field">
                <label>Email Address</label>
                <input 
                  type="email" 
                  placeholder="you@example.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="auth-field">
                <label>Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {authMode === 'signup' && (
                <>
                  <div className="auth-field">
                    <label>Your Name</label>
                    <input 
                      type="text" 
                      placeholder="Keith M." 
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                    />
                  </div>

                  <div className="auth-field">
                    <label>Golf Handicap (HCP)</label>
                    <input 
                      type="number" 
                      placeholder="12" 
                      value={handicapInput}
                      onChange={(e) => setHandicapInput(e.target.value)}
                    />
                  </div>
                </>
              )}

              <button 
                className="auth-submit" 
                onClick={handleAuth} 
                disabled={authLoading}
              >
                {authLoading ? 'Connecting...' : authMode === 'login' ? '⛳ ACCESS ACCOUNT' : '🏌️ REGISTER NOW'}
              </button>
            </div>

            {/* Install App Section — always visible on auth screen */}
            <div style={{
              margin: '16px 24px', padding: '18px 16px',
              background: 'linear-gradient(135deg, rgba(184, 154, 92, 0.08), rgba(184, 154, 92, 0.02))',
              border: '1px solid rgba(184, 154, 92, 0.2)',
              borderRadius: '14px'
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px'
              }}>
                <span style={{ fontSize: '20px' }}>📲</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 700,
                  color: 'var(--gold)', letterSpacing: '0.12em'
                }}>GET THE APP</span>
              </div>

              <div style={{
                fontFamily: 'var(--body)', fontSize: '12px', color: 'var(--text-dim)',
                lineHeight: 1.5, marginBottom: '12px'
              }}>
                Install ForeSome on your phone for the full experience — works like a real app, no app store needed.
              </div>

              {deferredPromptRef.current ? (
                <button
                  onClick={async () => {
                    const prompt = deferredPromptRef.current;
                    if (prompt) {
                      prompt.prompt();
                      const result = await prompt.userChoice;
                      if (result.outcome === 'accepted') {
                        deferredPromptRef.current = null;
                      }
                    }
                  }}
                  style={{
                    width: '100%', padding: '12px', border: 'none', borderRadius: '10px',
                    background: 'linear-gradient(135deg, #b89a5c 0%, #8a7240 100%)',
                    color: '#1a2c20', fontFamily: 'var(--mono)', fontSize: '11px',
                    fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                    cursor: 'pointer', boxShadow: '0 4px 16px rgba(184, 154, 92, 0.3)'
                  }}
                >INSTALL FORESOME</button>
              ) : (
                <div style={{
                  fontFamily: 'var(--body)', fontSize: '11px', color: 'var(--text-dim)',
                  lineHeight: 1.6
                }}>
                  <b style={{ color: 'var(--cream)' }}>iPhone:</b> Tap <b style={{ color: 'var(--cream)' }}>Share</b> ⬆️ → <b style={{ color: 'var(--cream)' }}>Add to Home Screen</b><br/>
                  <b style={{ color: 'var(--cream)' }}>Android:</b> Tap <b style={{ color: 'var(--cream)' }}>⋮</b> → <b style={{ color: 'var(--cream)' }}>Install app</b>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="auth-footer">
              KC METRO · FOR ALL GOLFERS · V0.1
            </div>

            {/* Install App Card — shows after signup or when install is available */}
            {showInstallCard && (
              <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(10, 18, 14, 0.92)', backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, padding: '24px'
              }}>
                <div style={{
                  background: 'linear-gradient(135deg, #243d2c, #1a2c20)',
                  border: '1px solid rgba(184, 154, 92, 0.3)',
                  borderRadius: '20px', padding: '28px 24px', maxWidth: '340px',
                  width: '100%', textAlign: 'center',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏌️</div>
                  <div style={{
                    fontFamily: 'var(--display)', fontSize: '22px', fontWeight: 700,
                    color: 'var(--cream)', marginBottom: '6px'
                  }}>Welcome to ForeSome!</div>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)',
                    letterSpacing: '0.05em', marginBottom: '20px', lineHeight: 1.5
                  }}>
                    Your account is ready. Install the app on your phone for the best experience.
                  </div>

                  {/* Native install prompt (Chrome/Edge/Android) */}
                  {deferredPromptRef.current && (
                    <button
                      onClick={async () => {
                        const prompt = deferredPromptRef.current;
                        if (prompt) {
                          prompt.prompt();
                          const result = await prompt.userChoice;
                          if (result.outcome === 'accepted') {
                            deferredPromptRef.current = null;
                          }
                        }
                        setShowInstallCard(false);
                      }}
                      style={{
                        width: '100%', padding: '16px', border: 'none', borderRadius: '12px',
                        background: 'linear-gradient(135deg, #b89a5c 0%, #8a7240 100%)',
                        color: '#1a2c20', fontFamily: 'var(--mono)', fontSize: '12px',
                        fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
                        cursor: 'pointer', marginBottom: '10px',
                        boxShadow: '0 8px 24px rgba(184, 154, 92, 0.35)'
                      }}
                    >📲 INSTALL FORESOME</button>
                  )}

                  {/* iOS Safari instructions (no beforeinstallprompt) */}
                  {!deferredPromptRef.current && (
                    <div style={{
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px', padding: '14px', marginBottom: '10px'
                    }}>
                      <div style={{
                        fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 700,
                        color: 'var(--gold)', letterSpacing: '0.1em', marginBottom: '8px'
                      }}>INSTALL ON iPHONE</div>
                      <div style={{
                        fontFamily: 'var(--body)', fontSize: '12px', color: 'var(--text-dim)',
                        lineHeight: 1.6, textAlign: 'left'
                      }}>
                        1. Tap the <b style={{ color: 'var(--cream)' }}>Share</b> button <span style={{ fontSize: '14px' }}>⬆️</span><br/>
                        2. Scroll down, tap <b style={{ color: 'var(--cream)' }}>Add to Home Screen</b><br/>
                        3. Tap <b style={{ color: 'var(--cream)' }}>Add</b> — done!
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setShowInstallCard(false)}
                    style={{
                      width: '100%', padding: '14px', background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
                      color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '11px',
                      letterSpacing: '0.1em', cursor: 'pointer'
                    }}
                  >CONTINUE TO APP →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active main view
  return (
    <div className="stage" id="stage">
      <div className="header-bar">
        <span><img src={foresomeLogo} alt="ForeSome" style={{ height: '28px', verticalAlign: 'middle' }} /></span>
        <button 
          className={`toggle-pro ${isPro ? 'active' : ''}`} 
          id="proToggle"
          onClick={() => setIsPro(prev => !prev)}
        >
          <span id="proLabel">{isPro ? 'PRO USER' : 'FREE USER'}</span>
        </button>
      </div>

      <div className="phone">

        {/* ============== TEES SCREEN (HOME) ============== */}
        <div className={`screen ${screen === 'home' ? '' : 'hidden'}`} id="home-screen">
          <div className="app-header">
            <div className="app-header-left">
              <img src={foresomeLogo} alt="ForeSome" className="app-header-logo" />
              <div>
                <div className="app-title">ForeSome</div>
                <div className="app-subtitle">THE SOCIAL GOLF APP</div>
              </div>
            </div>
            <div className="app-header-right" onClick={() => { if(confirm("Are you sure you want to sign out?")) supabase.auth.signOut(); }}>
              <div className="avatar" id="avatar">
                {profile?.initials || 'RQ'}
              </div>
              {isPro && <div className="pro-badge-top">PRO</div>}
            </div>
          </div>

          {/* Pending Invites Banner */}
          {pendingInvites.length > 0 && (
            <div className="section-head">
              <span className="section-title">▸ Incoming Invites</span>
              <span className="section-link">{pendingInvites.length} NEW</span>
            </div>
          )}
          {pendingInvites.map(inv => (
            <div key={inv.id} className="invite-banner">
              <div className="invite-banner-content">
                <div className="player-dot filled">{inv.fromProfile?.initials || '??'}</div>
                <div className="invite-banner-text">
                  <div className="invite-banner-name">{inv.fromProfile?.username || 'Someone'}</div>
                  <div className="invite-banner-detail">Invited you to play at {inv.course_name}</div>
                </div>
              </div>
              <div className="invite-banner-actions">
                <button className="invite-accept-btn" onClick={() => acceptInvite(inv.id)}>✓ JOIN</button>
                <button className="invite-decline-btn" onClick={() => declineInvite(inv.id)}>✗</button>
              </div>
            </div>
          ))}

          {/* Friend Requests */}
          {friends.filter(f => f.status === 'pending' && f.friend_id === session?.user?.id).length > 0 && (
            <div className="section-head">
              <span className="section-title">▸ Friend Requests</span>
            </div>
          )}
          {friends.filter(f => f.status === 'pending' && f.friend_id === session?.user?.id).map(f => (
            <div key={f.id} className="invite-banner">
              <div className="invite-banner-content">
                <div className="player-dot filled">{f.profile?.initials || '??'}</div>
                <div className="invite-banner-text">
                  <div className="invite-banner-name">{f.profile?.username || 'Someone'}</div>
                  <div className="invite-banner-detail">Wants to be your golf buddy</div>
                </div>
              </div>
              <div className="invite-banner-actions">
                <button className="invite-accept-btn" onClick={() => acceptFriend(f.id)}>✓ ACCEPT</button>
              </div>
            </div>
          ))}

          {/* Your Foursome */}
          <div className="section-head">
            <span className="section-title">▸ Your Foursome</span>
            <span className="section-link" onClick={() => setShowPlayerSearch(true)}>FIND PLAYERS →</span>
          </div>

          <div className="foursome-roster">
            {/* Slot 1: You */}
            <div className="roster-slot filled">
              <div className="roster-avatar you">{profile?.initials || 'ME'}</div>
              <div className="roster-info">
                <div className="roster-name">{profile?.username || 'You'}</div>
                <div className="roster-detail">HCP {profile?.handicap || '–'} · You</div>
              </div>
            </div>

            {/* Slots 2-4: Foursome players or empty */}
            {[0, 1, 2].map(i => {
              const player = foursomePlayers[i];
              if (player) {
                return (
                  <div key={player.id} className="roster-slot filled">
                    <div className="roster-avatar">{player.initials || '??'}</div>
                    <div className="roster-info">
                      <div className="roster-name">{player.username}</div>
                      <div className="roster-detail">HCP {player.handicap || '–'} · {player.status === 'confirmed' ? '✓ Confirmed' : '⏳ Invited'}</div>
                    </div>
                    <button className="roster-remove" onClick={() => removeFromFoursome(player.id)}>✕</button>
                  </div>
                );
              }
              return (
                <div key={`empty-${i}`} className="roster-slot empty" onClick={() => setShowPlayerSearch(true)}>
                  <div className="roster-avatar-empty">+</div>
                  <div className="roster-info">
                    <div className="roster-name empty-label">Invite Player</div>
                    <div className="roster-detail">Tap to search & invite</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-head">
            <span className="section-title">▸ Open Tee Times · Near You</span>
            <span className="section-link">VIEW ALL →</span>
          </div>

          <div className="course-search-wrap" ref={courseSearchRef}>
            <input
              type="text"
              className="course-search-input"
              placeholder="Search courses near you…"
              value={courseSearchQuery}
              onChange={(e) => { setCourseSearchQuery(e.target.value); setCourseSearchOpen(true); }}
              onFocus={() => setCourseSearchOpen(true)}
            />
            {courseSearchOpen && courseSearchQuery.length > 0 && (
              <div className="course-search-dropdown">
                {filteredCourses.length === 0 ? (
                  <div className="course-search-empty">No courses found</div>
                ) : filteredCourses.map(c => (
                  <div
                    key={c.id}
                    className="course-search-item"
                    onClick={() => {
                      setSelectedCourse(c);
                      setQuickCourse(c.name);
                      setCourseSearchQuery('');
                      setCourseSearchOpen(false);
                      setScreen('log');
                    }}
                  >
                    <div className="course-search-name">{c.name}</div>
                    <div className="course-search-meta">{c.type} · {c.city}, {c.state} · {c.distance_mi} mi</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* My Friends Quick Access */}
          {friends.filter(f => f.status === 'accepted').length > 0 && (
            <>
              <div className="section-head">
                <span className="section-title">▸ Friends</span>
              </div>
              <div className="friends-quick-list">
                {friends.filter(f => f.status === 'accepted').map(f => (
                  <div key={f.id} className="friend-chip" onClick={() => {
                    if (foursomePlayers.length < 3 && !foursomePlayers.find(p => p.id === f.profile?.id)) {
                      sendInvite(f.profile?.id);
                    }
                  }}>
                    <div className="player-dot filled">{f.profile?.initials || '??'}</div>
                    <span>{f.profile?.username}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="footer-note">
            <div>THE SOCIAL GOLF APP · <span className="accent">FOR ALL GOLFERS</span></div>
          </div>

          {/* ===== PLAYER SEARCH MODAL ===== */}
          {showPlayerSearch && (
            <div className="player-search-overlay">
              <div className="player-search-modal">
                <div className="player-search-header">
                  <span className="player-search-title">Find Players</span>
                  <button className="player-search-close" onClick={() => { setShowPlayerSearch(false); setPlayerSearchQuery(''); setPlayerSearchResults([]); }}>✕</button>
                </div>
                <input
                  type="text"
                  className="player-search-input"
                  placeholder="Search by username…"
                  value={playerSearchQuery}
                  onChange={(e) => setPlayerSearchQuery(e.target.value)}
                  autoFocus
                />
                <div className="player-search-results">
                  {playerSearchLoading && <div className="player-search-loading">Searching…</div>}
                  {!playerSearchLoading && playerSearchQuery.length >= 2 && playerSearchResults.length === 0 && (
                    <div className="player-search-empty">No players found</div>
                  )}
                  {playerSearchResults.map(p => {
                    const isFriend = friends.find(f => (f.user_id === p.id || f.friend_id === p.id));
                    const isInvited = sentInvites.find(i => i.to_user_id === p.id && i.status === 'pending');
                    const isInFoursome = foursomePlayers.find(fp => fp.id === p.id);
                    return (
                      <div key={p.id} className="player-card">
                        <div className="player-card-top">
                          <div className="player-card-avatar">{p.initials || '??'}</div>
                          <div className="player-card-info">
                            <div className="player-card-name">{p.username}</div>
                            <div className="player-card-hcp">HCP {p.handicap || '–'}</div>
                          </div>
                        </div>
                        {p.bio && <div className="player-card-bio">{p.bio}</div>}
                        <div className="player-card-actions">
                          {isInFoursome ? (
                            <button className="pc-btn disabled" disabled>IN FOURSOME</button>
                          ) : isInvited ? (
                            <button className="pc-btn disabled" disabled>INVITED ✓</button>
                          ) : (
                            <button className="pc-btn invite" onClick={() => { sendInvite(p.id); addToFoursome(p); }}>
                              ⛳ INVITE TO FOURSOME
                            </button>
                          )}
                          {isFriend ? (
                            <button className="pc-btn disabled" disabled>
                              {isFriend.status === 'accepted' ? 'FRIENDS ✓' : 'PENDING'}
                            </button>
                          ) : (
                            <button className="pc-btn friend" onClick={() => sendFriendRequest(p.id)}>
                              👋 ADD FRIEND
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============== LOG SCREEN ============== */}
        <div className={`screen ${screen === 'log' ? '' : 'hidden'}`} id="log-screen">
          <div style={{ padding: '16px 16px 0' }}>
            <button className="back-btn" onClick={() => setScreen('home')}>← BACK</button>
          </div>
          <div className="screen-title">Log Round</div>
          <div className="screen-subtitle">CHOOSE ENTRY METHOD</div>

          <div className="log-method">
            <div className="method-card" onClick={() => setScreen('tracker')}>
              <div className="method-icon">✍️</div>
              <div className="method-name">Hole by Hole</div>
              <div className="method-desc">Log each hole as you play</div>
            </div>
            <div className="method-card" onClick={() => {
              const el = document.querySelector('.scorecard-form');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}>
              <div className="method-icon">⚡</div>
              <div className="method-name">Quick Entry</div>
              <div className="method-desc">Just totals — fill in below</div>
            </div>
          </div>

          <div style={{ margin: '6px 0 14px', padding: '10px 14px', background: 'rgba(184, 154, 92, 0.08)', border: '1px solid var(--gold-deep)', borderRadius: '10px', display: 'flex', alignHTMLs: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>📸</span>
            <div style={{ flex: 1, fontFamily: 'var(--body)', fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.3 }}>
              <b style={{ color: 'var(--cream)' }}>Snap Card unlocks at end of round.</b> Log hole-by-hole, then verify your scorecard photo with Pro.
            </div>
          </div>

          <div className="scorecard-form">
            <div className="form-row">
              <div className="form-field" ref={quickCourseSearchRef} style={{ position: 'relative' }}>
                <label>Course</label>
                <input
                  type="text"
                  className="course-search-input-sm"
                  placeholder="Type to search…"
                  value={quickCourseSearchOpen ? quickCourseSearchQuery : quickCourse}
                  onChange={(e) => { setQuickCourseSearchQuery(e.target.value); setQuickCourseSearchOpen(true); }}
                  onFocus={() => { setQuickCourseSearchQuery(''); setQuickCourseSearchOpen(true); }}
                />
                {quickCourseSearchOpen && (
                  <div className="course-search-dropdown course-search-dropdown-sm">
                    {filteredQuickCourses.length === 0 ? (
                      <div className="course-search-empty">No courses found</div>
                    ) : filteredQuickCourses.map(c => (
                      <div
                        key={c.id}
                        className="course-search-item"
                        onClick={() => {
                          setQuickCourse(c.name);
                          setQuickCourseSearchQuery('');
                          setQuickCourseSearchOpen(false);
                          setSelectedCourse(c);
                        }}
                      >
                        <div className="course-search-name">{c.name}</div>
                        <div className="course-search-meta">{c.type} · {c.city}, {c.state}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-field">
                <label>Tees</label>
                <select value={quickTee} onChange={(e) => setQuickTee(e.target.value)}>
                  <option>Blue</option>
                  <option>White</option>
                  <option>Black</option>
                  <option>Red</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={quickDate} onChange={(e) => setQuickDate(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Total Score</label>
                <input type="number" value={quickScore} onChange={(e) => setQuickScore(e.target.value)} />
              </div>
            </div>

            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.1em', color: 'var(--text-faint)', textTransform: 'uppercase', margin: '8px 0' }}>▸ Stats (Optional)</div>

            <div className="stat-grid">
              <div className="stat-input">
                <label>FIR</label>
                <input type="number" value={quickFir} onChange={(e) => setQuickFir(e.target.value)} />
              </div>
              <div className="stat-input">
                <label>GIR</label>
                <input type="number" value={quickGir} onChange={(e) => setQuickGir(e.target.value)} />
              </div>
              <div className="stat-input">
                <label>Putts</label>
                <input type="number" value={quickPutts} onChange={(e) => setQuickPutts(e.target.value)} />
              </div>
            </div>

            <button className="save-btn" onClick={saveQuickRound}>SAVE ROUND</button>
          </div>

          <div className="teaser" id="teaser">
            <div className="teaser-label">▸ ONE INSIGHT FROM PRO</div>
            <div className="teaser-text">
              Golfers in your handicap range average <b>32.4 putts</b> at Shoal Creek. You averaged <b>34.1</b> last 3 rounds here. <br />
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Unlock full course intel with Pro →</span>
            </div>
          </div>
        </div>

        {/* ============== TRACKER SCREEN ============== */}
        <div className={`screen ${screen === 'tracker' ? '' : 'hidden'}`} id="tracker-screen" style={{ paddingBottom: 0 }}>
          <div className="track-header">
            <div className="track-course">
              <b id="trackerCourse">{selectedCourse?.name?.toUpperCase() || 'SHOAL CREEK'}</b> · {selectedTee.toUpperCase()} · MAY 17
            </div>
            <button className="track-exit" onClick={() => setScreen('home')}>SAVE & EXIT</button>
          </div>

          <div className="hole-progress" id="holeProgress">
            {holeScores.map((h, i) => (
              <div 
                key={h.hole} 
                className={`hole-dot ${i + 1 < currentHole ? 'done' : ''} ${i + 1 === currentHole ? 'current' : ''}`}
              />
            ))}
          </div>

          <div className="running-total">
            <span>HOLE <b id="trackHoleNum">{currentHole}</b> / 18</span>
            <span>RUNNING <b id="trackRunning">{runningTotal || '—'}</b> <span className={`vs-par ${vsParDiff > 0 ? 'over' : ''}`} id="trackVsPar">{vsParText}</span></span>
            <span>THRU <b id="trackThru">{played}</b></span>
          </div>

          <div className="hole-hero hole-hero-split">
            <h3 className="hole-title-center" id="trackHoleBig">Hole {currentHole}</h3>
            <div className="hole-info-row">
              <div className="hole-info-left">
                <div className="hole-info-value" id="trackPar">PAR {currentPar}</div>
              </div>
              <div className="hole-info-right">
                <div className="hole-info-value" id="trackYards">{activeCourseData.yards[currentHole - 1]} YDS</div>
                <div className="hole-info-sub" id="trackHcp">HCP {activeCourseData.hcps[currentHole - 1]}</div>
              </div>
            </div>
          </div>

          <div className="score-stepper-wrap">
            <div className="score-stepper-label">Your Score</div>
            <div className="score-stepper">
              <button className="stepper-btn" onClick={() => adjustScore(-1)}>−</button>
              <div className="stepper-display">
                <div className="score-val" id="trackScore">{currentHoleData.score}</div>
                <div className="score-label" id="trackScoreLabel">{stepperLabel}</div>
              </div>
              <button className="stepper-btn" onClick={() => adjustScore(1)}>+</button>
            </div>
            <div className={stepperClass} id="trackResult">{stepperResult}</div>
          </div>

          <div className="stat-toggle-row">
            <div 
              className={`stat-toggle ${currentPar === 3 ? 'disabled' : ''} ${currentHoleData.fir ? 'active' : ''}`} 
              id="firToggle" 
              onClick={() => toggleStat('fir')}
            >
              <div className="toggle-icon">🎯</div>
              <div className="toggle-label">FIR</div>
              <div className="toggle-sub">Fairway hit</div>
            </div>
            <div 
              className={`stat-toggle ${currentHoleData.gir ? 'active' : ''}`} 
              id="girToggle" 
              onClick={() => toggleStat('gir')}
            >
              <div className="toggle-icon">⛳</div>
              <div className="toggle-label">GIR</div>
              <div className="toggle-sub">Green in reg</div>
            </div>
            <div 
              className={`stat-toggle ${currentHoleData.pen ? 'active' : ''}`} 
              id="penToggle" 
              onClick={() => toggleStat('pen')}
            >
              <div className="toggle-icon">💧</div>
              <div className="toggle-label">PENALTY</div>
              <div className="toggle-sub">Hazard/OB</div>
            </div>
          </div>

          <div className="putts-row">
            <div className="pr-label">Putts</div>
            <div className="putts-stepper">
              {[0, 1, 2, 3, 4].map((n) => (
                <div 
                  key={n} 
                  className={`putt-pill ${currentHoleData.putts === n ? 'active' : ''}`} 
                  onClick={() => setPutts(n)}
                >
                  {n === 4 ? '4+' : n}
                </div>
              ))}
            </div>
          </div>

          <div className="foursome-scores">
            <div className="fs-chip you">
              <div className="fs-name">You</div>
              <div className="fs-score">{youScore}</div>
              <div className="fs-thru">{getDiffText(youDiff)} thru {played}</div>
            </div>
            {foursomePlayers.map(p => (
              <div key={p.id} className="fs-chip">
                <div className="fs-name">{p.username?.split(' ')[0] || p.initials}</div>
                <div className="fs-score">–</div>
                <div className="fs-thru">awaiting</div>
              </div>
            ))}
            {[...Array(Math.max(0, 3 - foursomePlayers.length))].map((_, i) => (
              <div key={`empty-fs-${i}`} className="fs-chip empty-chip" onClick={() => setShowPlayerSearch(true)}>
                <div className="fs-name">+</div>
                <div className="fs-score">–</div>
                <div className="fs-thru">invite</div>
              </div>
            ))}
          </div>

          <div className="pro-nudge" onClick={() => setScreen('paywall')}>
            <span className="nudge-icon">📸</span>
            <div className="nudge-text">
              Tired of tapping after every hole? <b>Snap the card at the end with Pro.</b>
            </div>
            <span className="nudge-arrow">›</span>
          </div>

          <div style={{ height: '100px' }}></div>

          <div className="track-actions">
            <button className="track-btn prev" onClick={prevHole}>← PREV</button>
            <button 
              className={`track-btn next ${currentHole === 18 ? 'finish' : ''}`} 
              id="trackNextBtn" 
              onClick={nextHole}
            >
              {currentHole === 18 ? 'FINISH ROUND ✓' : 'NEXT HOLE →'}
            </button>
          </div>

          {/* ===== END-OF-ROUND PROMPT OVERLAY ===== */}
          <div className={`eor-overlay ${showEor ? 'show' : ''}`} id="eorOverlay">
            <div className="eor-sheet">
              <div className="eor-flag">▸ Round Complete</div>
              <div className="eor-title">Nice round, <i>{profile?.username?.split(' ')[0] || 'Rico'}</i></div>
              <div className="eor-summary" id="eorSummary">
                {selectedCourse?.name || 'Shoal Creek'} · <b>{holeScores.reduce((acc, h) => acc + h.score, 0)}</b> · <b>{getDiffText(holeScores.reduce((acc, h) => acc + h.score, 0) - 71)}</b> · 18 holes logged
              </div>

              <div className="eor-options">
                <button className="eor-option primary" onClick={eorChooseSnap}>
                  <div className="eor-option-icon">📸</div>
                  <div className="eor-option-body">
                    <div className="eor-option-title">Snap the scorecard <span className="eor-pro-tag">PRO</span></div>
                    <div className="eor-option-desc">Verify your scores from the card. Auto-checks math.</div>
                  </div>
                  <span className="eor-option-arrow">›</span>
                </button>

                <button className="eor-option" onClick={saveManualRound}>
                  <div className="eor-option-icon">✓</div>
                  <div className="eor-option-body">
                    <div className="eor-option-title">Confirm manually</div>
                    <div className="eor-option-desc">Trust what you logged. Save and head home.</div>
                  </div>
                  <span className="eor-option-arrow">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ============== PAYWALL SCREEN ============== */}
        <div className={`screen ${screen === 'paywall' ? '' : 'hidden'}`} id="paywall-screen">
          <div style={{ padding: '16px' }}>
            <button className="back-btn" onClick={() => setScreen('log')}>← BACK</button>
          </div>

          <div className="paywall-hero">
            <div className="paywall-badge">FORESOME PRO</div>
            <div className="paywall-title">Elevate your game</div>
            <div className="paywall-subtitle">Join the premier golf community and unlock advanced scanning & statistics.</div>
          </div>

          <div className="features-list">
            <div className="feature-item">
              <span className="feat-icon">📸</span>
              <div className="feat-body">
                <div className="feat-title">Snap Scorecard Scanner</div>
                <div className="feat-desc">Instant score extraction from handwritten cards. Double checks match math.</div>
              </div>
            </div>
            <div className="feature-item">
              <span className="feat-icon">📊</span>
              <div className="feat-body">
                <div className="feat-title">Advanced Statistics</div>
                <div className="feat-desc">Detailed analytics across KC metro courses. Track trends, FIR, GIR, & putting averages.</div>
              </div>
            </div>
            <div className="feature-item">
              <span className="feat-icon">⛳</span>
              <div className="feat-body">
                <div className="feat-title">Youth Camps Donation</div>
                <div className="feat-desc">10% of subscription revenue ($7.90) goes directly to First Tee Kansas City.</div>
              </div>
            </div>
          </div>

          <div className="price-selector">
            <div className="price-card selected">
              <div className="price-term">Annual Plan</div>
              <div className="price-amt">$79<span className="price-sub">/yr</span></div>
              <div className="price-desc">Best value · Donate $7.90 to First Tee</div>
            </div>
          </div>

          <div style={{ padding: '0 24px', textAlign: 'center' }}>
            <button className="cta-primary" onClick={() => { setIsPro(true); setScreen('stats'); }}>
              START PRO · $79/YR
            </button>
            <button className="cta-secondary" onClick={() => setScreen('log')}>
              Maybe later
            </button>
          </div>
        </div>

        {/* ============== BANTER CHAT SCREEN ============== */}
        <div className={`screen ${screen === 'chat' ? '' : 'hidden'}`} id="chat-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingBottom: 0 }}>
          <div style={{ padding: '14px 16px 6px' }}>
            <button className="back-btn" onClick={() => setScreen('home')}>← BACK</button>
          </div>
          <div className="chat-header">
            <div className="chat-course">{selectedCourse?.name || 'Foursome'} · Banter</div>
            <div className="chat-meta">{foursomePlayers.length + 1} / 4 PLAYERS</div>
            <div className="chat-foursome">
              <div className="player-dot filled">{profile?.initials || 'ME'}</div>
              {foursomePlayers.map(p => (
                <div key={p.id} className="player-dot filled">{p.initials || '??'}</div>
              ))}
              {[...Array(Math.max(0, 3 - foursomePlayers.length))].map((_, i) => (
                <div key={`empty-chat-${i}`} className="player-dot empty">+</div>
              ))}
              <span className="roster-name">
                You{foursomePlayers.map(p => ` · ${p.username?.split(' ')[0]}`).join('')}
                {foursomePlayers.length < 3 ? ` · (${3 - foursomePlayers.length} open)` : ''}
              </span>
            </div>
          </div>

          <div className="chat-thread" id="chatThread" style={{ flex: 1, overflowY: 'auto', paddingBottom: '100px' }}>
            <div className="chat-day">YESTERDAY · 6:24 PM</div>
            {chatMessages.map((msg, index) => {
              if (msg.system) {
                return (
                  <div key={index}>
                    {msg.time && <div className="chat-day">{msg.time}</div>}
                    <div className="system-msg">{msg.text}</div>
                  </div>
                );
              }
              return (
                <div key={index} className={`msg ${msg.isMe ? 'me' : 'them'}`}>
                  <div className="msg-stack">
                    <div className="sender">{msg.sender}</div>
                    <div className="bubble">{msg.text}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="banter-input-area">
            <div className="quick-reactions">
              {['🍺 19th hole?', 'On my way', 'Running late', 'Send GPS 📍', '💸 Press the bet?'].map((reaction) => (
                <div 
                  key={reaction} 
                  className="quick-chip" 
                  onClick={() => sendQuickChat(reaction)}
                  style={{ cursor: 'pointer' }}
                >
                  {reaction}
                </div>
              ))}
            </div>
            <div className="chat-compose">
              <textarea
                className="chat-textarea"
                placeholder="Type a message…"
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatText(); } }}
                rows={1}
              />
              <button 
                className="chat-send-btn"
                onClick={sendChatText}
                disabled={!chatInputText.trim()}
              >
                SEND
              </button>
            </div>
          </div>
        </div>

        {/* ============== STATS DASHBOARD ============== */}
        <div className={`screen ${screen === 'stats' ? '' : 'hidden'}`} id="stats-screen">
          <div style={{ padding: '16px 16px 0' }}>
            <button className="back-btn" onClick={() => setScreen('home')}>← HOME</button>
          </div>
          <div className="screen-title">Your Intel</div>
          <div className="screen-subtitle">LAST {totalRoundsCount || 12} ROUNDS · KC METRO</div>

          <div className="stats-hero">
            <div className="stats-grid-hero">
              <div className="stat-big">
                <div className="stat-num">{avgScore}<span className="trend">▼ 1.8</span></div>
                <div className="stat-lbl">Scoring Avg</div>
              </div>
              <div className="stat-big">
                <div className="stat-num">{profile?.handicap || '11.4'}<span className="trend">▼ 0.6</span></div>
                <div className="stat-lbl">Handicap Idx</div>
              </div>
              <div className="stat-big">
                <div className="stat-num">{avgFir}%<span className="trend">▲ 7%</span></div>
                <div className="stat-lbl">FIR</div>
              </div>
              <div className="stat-big">
                <div className="stat-num">{avgGir}%<span className="trend">▲ 4%</span></div>
                <div className="stat-lbl">GIR</div>
              </div>
            </div>
          </div>

          <div className="insight-card">
            <div className="insight-eyebrow">▸ FORESOME INSIGHT</div>
            <div className="insight-text">
              You score <b>3.2 strokes better</b> when paired with players within 3 of your handicap.
            </div>
          </div>

          <div style={{ padding: '0 16px' }}>
            <div className="section-head" style={{ padding: '8px 4px' }}>
              <span className="section-title">▸ Round History</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', margin: '0 0 10px' }}>
              <button
                className={`hole-stat-btn ${intelView === 'rounds' ? 'active' : ''}`}
                onClick={() => setIntelView('rounds')}
              >ALL ROUNDS</button>
              <button
                className={`hole-stat-btn ${intelView === 'lastRound' ? 'active' : ''}`}
                onClick={() => setIntelView('lastRound')}
              >LAST ROUND</button>
            </div>
          </div>

          {intelView === 'rounds' && (
            <div style={{ padding: '0 16px 16px' }}>
              {loadingRounds ? (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px', fontFamily: 'var(--mono)', fontSize: '11px' }}>Loading rounds...</div>
              ) : savedRounds.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.05em' }}>No rounds logged yet. Go play!</div>
              ) : (
                savedRounds.map((r, idx) => {
                  const score = r.summary?.score || 0;
                  const coursePar = courses.find(c => c.name === r.course_name)?.par || 72;
                  const diff = score - Number(coursePar);
                  const diffText = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`;
                  const dateStr = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return (
                    <div key={r.id || idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '12px 14px', marginBottom: '6px',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '10px', cursor: 'pointer'
                    }}>
                      <div>
                        <div style={{ fontFamily: 'var(--heading)', fontSize: '13px', color: 'var(--cream)', fontWeight: 600 }}>
                          {r.course_name}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-dim)', letterSpacing: '0.05em', marginTop: '2px' }}>
                          {dateStr} · {r.tee || 'Blue'} · {r.completed_holes || 18}H
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--heading)', fontSize: '22px', color: 'var(--cream)', fontWeight: 700, lineHeight: 1 }}>
                          {score}
                        </div>
                        <div style={{
                          fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.05em', marginTop: '2px',
                          color: diff < 0 ? 'var(--green)' : diff > 0 ? '#e74c3c' : 'var(--text-dim)'
                        }}>
                          {diffText}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {intelView === 'lastRound' && (
          <div className="hole-grid-wrap">
            <div className="hole-grid-head">
              <div>
                <div className="hole-grid-title">Shoal Creek · Blue</div>
                <div className="hole-grid-meta">MAY 17 · 84 (+12) · TJ, K, E</div>
              </div>
              <div className="course-score">84</div>
            </div>

            <div className="hole-stat-toggle">
              <button className={`hole-stat-btn ${holeStatView === 'score' ? 'active' : ''}`} onClick={() => setHoleStatView('score')}>SCORE</button>
              <button className={`hole-stat-btn ${holeStatView === 'putts' ? 'active' : ''}`} onClick={() => setHoleStatView('putts')}>PUTTS</button>
              <button className={`hole-stat-btn ${holeStatView === 'firgir' ? 'active' : ''}`} onClick={() => setHoleStatView('firgir')}>FIR/GIR</button>
            </div>

            {(() => {
              const mockScores = [4, 5, 3, 5, 5, 4, 6, 4, 5, 4, 4, 6, 5, 5, 3, 6, 4, 6];
              const mockPutts  = [2, 2, 1, 3, 2, 2, 2, 1, 2, 2, 1, 3, 2, 2, 1, 2, 2, 3];
              const mockFir    = [1, 0, null, 1, 0, null, 1, 1, 0, 0, null, 1, 1, 0, null, 1, 0, 1]; // null = par 3 (no fairway)
              const mockGir    = [1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];

              const cellContent = (holeIdx) => {
                if (holeStatView === 'putts') return mockPutts[holeIdx];
                if (holeStatView === 'firgir') {
                  const fir = mockFir[holeIdx];
                  const gir = mockGir[holeIdx];
                  const firLabel = fir === null ? '—' : fir ? '✓' : '✗';
                  const girLabel = gir ? '✓' : '✗';
                  return (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center', fontSize: '9px' }}>
                      <span style={{ color: fir === 1 ? 'var(--green)' : fir === 0 ? 'var(--red, #e74c3c)' : 'var(--text-dim)' }}>{firLabel}</span>
                      <span style={{ color: gir ? 'var(--green)' : 'var(--red, #e74c3c)' }}>{girLabel}</span>
                    </span>
                  );
                }
                return mockScores[holeIdx];
              };

              const totalLabel = (arr, start, end) => arr.slice(start, end).reduce((a, b) => a + b, 0);

              const totalsContent = (start, end) => {
                if (holeStatView === 'putts') return totalLabel(mockPutts, start, end);
                if (holeStatView === 'firgir') {
                  const firHit = mockFir.slice(start, end).filter(v => v === 1).length;
                  const girHit = mockGir.slice(start, end).filter(v => v === 1).length;
                  return (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', alignItems: 'center', fontSize: '9px' }}>
                      <span>{firHit}</span>
                      <span>{girHit}</span>
                    </span>
                  );
                }
                return totalLabel(mockScores, start, end);
              };

              return (
                <>
                  {holeStatView === 'firgir' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 16px 0', gap: '12px' }}>
                      <span style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>FIR ↑</span>
                      <span style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--text-dim)', letterSpacing: '0.05em' }}>GIR ↓</span>
                    </div>
                  )}
                  <div className="nine-label">FRONT 9</div>
                  <div className="hole-grid">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => (
                      <div key={h} className="hole-col">
                        <div className="grid-header">H{h}</div>
                        <div className="grid-par">{activeCourseData.pars[h - 1]}</div>
                        <div className="grid-score">{cellContent(h - 1)}</div>
                      </div>
                    ))}
                    <div className="hole-col total">
                      <div className="grid-header">OUT</div>
                      <div className="grid-par">37</div>
                      <div className="grid-score">{totalsContent(0, 9)}</div>
                    </div>
                  </div>

                  <div className="nine-label" style={{ marginTop: '14px' }}>BACK 9</div>
                  <div className="hole-grid">
                    {[10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => (
                      <div key={h} className="hole-col">
                        <div className="grid-header">H{h}</div>
                        <div className="grid-par">{activeCourseData.pars[h - 1]}</div>
                        <div className="grid-score">{cellContent(h - 1)}</div>
                      </div>
                    ))}
                    <div className="hole-col total">
                      <div className="grid-header">IN</div>
                      <div className="grid-par">34</div>
                      <div className="grid-score">{totalsContent(9, 18)}</div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          )}
        </div>

        {/* ============== SNAP INTRO SCREEN ============== */}
        <div className={`screen ${screen === 'snap-intro' ? '' : 'hidden'}`} id="snap-intro-screen">
          <div style={{ padding: '16px 16px 0' }}>
            <button className="back-btn" onClick={() => setScreen('home')}>← BACK</button>
          </div>

          <div className="snap-intro-hero">
            <div className="snap-intro-badge">PRO FEATURE</div>
            <div className="snap-intro-icon">📸</div>
            <div className="snap-intro-title">Snap your <i>scorecard</i></div>
            <div className="snap-intro-sub">
              Best used at the end of your round — capture all 18 holes and we'll verify your scores automatically.
            </div>
          </div>

          <div className="snap-intro-content">
            <div className="snap-intro-step">
              <div className="snap-intro-step-num">1</div>
              <div className="snap-intro-step-body">
                <div className="snap-intro-step-title">Finish your round</div>
                <div className="snap-intro-step-desc">Log holes manually as you play, then snap the card when you're done.</div>
              </div>
            </div>

            <div className="snap-intro-step">
              <div className="snap-intro-step-num">2</div>
              <div className="snap-intro-step-body">
                <div className="snap-intro-step-title">Capture the card</div>
                <div className="snap-intro-step-desc">Lay it flat under good light. Make sure all 18 holes and the totals row are in frame.</div>
              </div>
            </div>

            <div className="snap-intro-step">
              <div className="snap-intro-step-num">3</div>
              <div className="snap-intro-step-body">
                <div className="snap-intro-step-title">Review &amp; confirm</div>
                <div className="snap-intro-step-desc">We extract scores, flag anything we're unsure about, and check the math. You confirm and the round saves.</div>
              </div>
            </div>
          </div>

          {isPro ? (
            <div className="snap-intro-cta" id="snapIntroCtaPro">
              <button className="snap-intro-primary" onClick={() => setScreen('camera')}>📸 OPEN CAMERA</button>
              <button className="snap-intro-secondary" onClick={() => alert('Photo library upload mock — in production triggers system file selector.')}>UPLOAD FROM LIBRARY</button>
              <div className="snap-intro-tip">
                <b>Tip:</b> Most accurate at end-of-round when all scores are filled in. Mid-round captures may miss holes.
              </div>
            </div>
          ) : (
            <div className="snap-intro-locked" id="snapIntroCtaLocked">
              <div className="snap-intro-locked-icon">🔒</div>
              <div className="snap-intro-locked-title">Snap Card is a Pro feature</div>
              <div className="snap-intro-locked-text">
                Skip the manual entry. Snap your card after the round and we'll verify all 18 scores in seconds.
              </div>
              <button className="snap-intro-locked-btn" onClick={() => setScreen('paywall')}>UNLOCK PRO</button>
            </div>
          )}
        </div>

        {/* ============== CAMERA SCREEN ============== */}
        <div className={`screen ${screen === 'camera' ? '' : 'hidden'}`} id="camera-screen">
          <div className="cam-topbar">
            <button className="cam-cancel" onClick={() => setScreen('snap-intro')}>✕ CANCEL</button>
            <div className="cam-title">Snap Card</div>
            <div className="cam-pro-badge">PRO</div>
          </div>

          <div className="cam-viewport">
            <div className="cam-frame">
              <span className="corner-bl"></span>
              <span className="corner-br"></span>
              <div className="cam-frame-hint">ALIGN SCORECARD INSIDE FRAME</div>
            </div>

            {isScanning && (
              <div className="cam-processing-overlay" id="camProcessing" style={{ display: 'flex' }}>
                <div className="cam-spinner"></div>
                <div className="cam-processing-text">Reading your card...</div>
                <div className="cam-processing-sub" id="camProcessingStep">{processingStep}</div>
              </div>
            )}
          </div>

          <div className="cam-tips">
            <div className="cam-tips-label">▸ For best results</div>
            <ul>
              <li>Lay card flat — fold creases trip up the scanner</li>
              <li>Soft light, no glare — pro shop counter is usually perfect</li>
              <li>Capture all 18 holes + totals row in frame</li>
            </ul>
          </div>

          <div className="cam-actionbar">
            <button className="cam-side-btn" onClick={() => alert('Photo library upload mock')} title="From library">🖼</button>
            <div style={{ position: 'relative' }}>
              <button className="cam-shutter" id="camShutter" onClick={startCameraScan} title="Capture"></button>
              <div className="cam-shutter-label">TAP TO SCAN</div>
            </div>
            <button className="cam-side-btn" onClick={() => alert('Flash toggle mock')} title="Flash">⚡</button>
          </div>
        </div>

        {/* ============== REVIEW SCAN SCREEN ============== */}
        <div className={`screen ${screen === 'review' ? '' : 'hidden'}`} id="review-screen">
          <div className="review-header">
            <button className="review-back" onClick={() => setScreen('camera')}>← RETAKE</button>
            <div className="review-h-title">Review Scan</div>
            <div className="review-confidence-pill mid" id="reviewConfPill">87% CONF</div>
          </div>

          <div className="review-content">
            <div className="review-thumb-row">
              <div className="review-thumb">📇</div>
              <div className="review-thumb-meta">
                <div className="review-course-name" id="reviewCourseName">{reviewCourse}</div>
                <div className="review-course-sub">{reviewTee} tees · {new Date(reviewDate).toLocaleDateString()} · KC, MO</div>
              </div>
            </div>

            <div className="review-warning" id="reviewWarning">
              <div className="review-warning-icon">⚠</div>
              <div className="review-warning-text">
                <b>Two scores flagged for review.</b> Hole 7 and hole 14 had ambiguous handwriting — tap to confirm or correct.
              </div>
            </div>

            <div className="review-section-head">
              <span className="review-section-title">▸ Round Details</span>
            </div>
            <div className="review-field-row">
              <div className="review-field">
                <div className="review-field-label">
                  <span>Course</span>
                  <span className="review-field-conf">99%</span>
                </div>
                <input type="text" value={reviewCourse} onChange={(e) => setReviewCourse(e.target.value)} />
              </div>
              <div className="review-field">
                <div className="review-field-label">
                  <span>Tees</span>
                  <span className="review-field-conf">94%</span>
                </div>
                <select value={reviewTee} onChange={(e) => setReviewTee(e.target.value)}>
                  <option>Blue</option><option>White</option><option>Black</option><option>Red</option>
                </select>
              </div>
            </div>
            <div className="review-field-row">
              <div className="review-field">
                <div className="review-field-label">
                  <span>Date</span>
                  <span className="review-field-conf">98%</span>
                </div>
                <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
              </div>
              <div className="review-field warn">
                <div className="review-field-label">
                  <span>Total Par</span>
                  <span className="review-field-conf low">62%</span>
                </div>
                <input type="number" value={reviewTotalPar} onChange={(e) => setReviewTotalPar(Number(e.target.value))} />
              </div>
            </div>

            <div className="math-banner" id="mathBanner">
              <span className="mc-icon">✓</span>
              <div>Math checks out. Hole scores sum to recorded totals for all 4 players.</div>
            </div>

            <div className="review-section-head">
              <span className="review-section-title">▸ Scores · Tap to edit</span>
            </div>

            {/* Rico score block */}
            <div className="review-player-block">
              <div className="review-player-head">
                <div className="review-player-name">{profile?.username || 'Rico'}</div>
                <div className="review-player-total">
                  {reviewScores.reduce((a, b) => a + b, 0)} <span className="vs">+{reviewScores.reduce((a, b) => a + b, 0) - 71}</span>
                </div>
              </div>

              {/* Front 9 */}
              <div className="review-hole-grid">
                <div className="gh row-label">HOLE</div>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <div key={n} className="gh">{n}</div>)}
                <div className="gh row-label">PAR</div>
                {[4, 5, 3, 4, 4, 3, 5, 4, 4].map((p, i) => <div key={i} className="par-cell">{p}</div>)}
                <div className="gh row-label">SCORE</div>
                {reviewScores.slice(0, 9).map((s, idx) => (
                  <input 
                    key={idx} 
                    className={`score-cell ${idx === 6 ? 'flagged' : ''}`} 
                    type="number" 
                    value={s} 
                    onChange={(e) => updateReviewScore(idx, e.target.value)}
                  />
                ))}
              </div>
              <div className="review-out-in">
                <span>OUT <b>{reviewScores.slice(0, 9).reduce((a, b) => a + b, 0)}</b></span>
              </div>

              {/* Back 9 */}
              <div className="review-hole-grid" style={{ marginTop: '10px' }}>
                <div className="gh row-label">HOLE</div>
                {[10, 11, 12, 13, 14, 15, 16, 17, 18].map(n => <div key={n} className="gh">{n}</div>)}
                <div className="gh row-label">PAR</div>
                {[4, 3, 5, 4, 4, 3, 5, 4, 4].map((p, i) => <div key={i} className="par-cell">{p}</div>)}
                <div className="gh row-label">SCORE</div>
                {reviewScores.slice(9, 18).map((s, idx) => (
                  <input 
                    key={idx} 
                    className={`score-cell ${idx === 4 ? 'flagged' : ''}`} 
                    type="number" 
                    value={s} 
                    onChange={(e) => updateReviewScore(idx + 9, e.target.value)}
                  />
                ))}
              </div>
              <div className="review-out-in">
                <span>IN <b>{reviewScores.slice(9, 18).reduce((a, b) => a + b, 0)}</b></span>
              </div>
            </div>


          </div>

          <div className="review-actionbar">
            <button className="review-retake-btn" onClick={() => setScreen('camera')}>↺ RETAKE</button>
            <button className="review-save-btn" onClick={saveReviewRound}>CONFIRM &amp; SAVE ROUND →</button>
          </div>
        </div>

        {/* ============== GROUPS LIST SCREEN ============== */}
        <div className={`screen ${screen === 'groups' ? '' : 'hidden'}`} id="groups-screen">
          <div className="groups-topbar">
            <span className="groups-title">Groups</span>
            <button className="groups-create-btn" onClick={() => setShowCreateGroup(true)}>+ NEW</button>
          </div>

          {/* Pending Group Invites */}
          {pendingGroupInvites.length > 0 && (
            <div className="section-head" style={{marginTop: 8}}>
              <span className="section-title">▸ Group Invites</span>
              <span className="section-link">{pendingGroupInvites.length} NEW</span>
            </div>
          )}
          {pendingGroupInvites.map(g => (
            <div key={g.id} className="invite-banner">
              <div className="invite-banner-content">
                <div className="group-emoji-avatar">{g.avatar_emoji || '⛳'}</div>
                <div className="invite-banner-text">
                  <div className="invite-banner-name">{g.name}</div>
                  <div className="invite-banner-detail">{g.description || 'Private group'}</div>
                </div>
              </div>
              <div className="invite-banner-actions">
                <button className="invite-accept-btn" onClick={() => acceptGroupInvite(g.id)}>✓ JOIN</button>
              </div>
            </div>
          ))}

          {/* My Groups */}
          {groups.filter(g => g.myStatus === 'active').length > 0 ? (
            <div className="groups-list">
              {groups.filter(g => g.myStatus === 'active').map(g => (
                <div key={g.id} className="group-card" onClick={() => openGroup(g)}>
                  <div className="group-card-emoji">{g.avatar_emoji || '⛳'}</div>
                  <div className="group-card-info">
                    <div className="group-card-name">{g.name}</div>
                    <div className="group-card-meta">
                      {g.myRole === 'admin' && <span className="admin-badge-sm">ADMIN</span>}
                      {g.description || 'Private group'}
                    </div>
                  </div>
                  <div className="group-card-arrow">›</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="groups-empty">
              <div className="groups-empty-emoji">👥</div>
              <div className="groups-empty-title">No Groups Yet</div>
              <div className="groups-empty-text">Create a group to organize your golf crew</div>
              <button className="groups-empty-btn" onClick={() => setShowCreateGroup(true)}>+ CREATE GROUP</button>
            </div>
          )}

          {/* Create Group Modal */}
          {showCreateGroup && (
            <div className="player-search-overlay">
              <div className="player-search-modal">
                <div className="player-search-header">
                  <span className="player-search-title">Create Group</span>
                  <button className="player-search-close" onClick={() => setShowCreateGroup(false)}>✕</button>
                </div>
                <div className="create-group-form">
                  <div className="cg-emoji-picker">
                    {['⛳', '🏌️', '🏆', '🍺', '🔥', '💪', '🎯', '⭐', '🦅', '🐯', '🌅', '👑'].map(e => (
                      <button key={e} className={`cg-emoji-btn ${newGroupEmoji === e ? 'active' : ''}`} onClick={() => setNewGroupEmoji(e)}>{e}</button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="player-search-input"
                    placeholder="Group name…"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    maxLength={40}
                  />
                  <input
                    type="text"
                    className="player-search-input"
                    placeholder="Description (optional)…"
                    value={newGroupDesc}
                    onChange={e => setNewGroupDesc(e.target.value)}
                    maxLength={100}
                  />
                  <button className="cg-create-btn" onClick={createGroup}>CREATE GROUP</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============== GROUP DETAIL SCREEN ============== */}
        <div className={`screen ${screen === 'group-detail' ? '' : 'hidden'}`} id="group-detail-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingBottom: 0 }}>
          {selectedGroup && (
            <>
              <div style={{ padding: '14px 16px 0' }}>
                <button className="back-btn" onClick={() => { setScreen('groups'); setSelectedGroup(null); }}>← GROUPS</button>
              </div>

              {/* Group Header */}
              <div className="gd-header">
                <div className="gd-emoji">{selectedGroup.avatar_emoji || '⛳'}</div>
                <div className="gd-title">{selectedGroup.name}</div>
                {selectedGroup.description && <div className="gd-desc">{selectedGroup.description}</div>}
                <div className="gd-meta">
                  {groupMembers.filter(m => m.status === 'active').length} members
                  {selectedGroup.myRole === 'admin' && <span className="admin-badge">ADMIN</span>}
                </div>
              </div>

              {/* Members */}
              <div className="gd-members-section">
                <div className="gd-section-head">
                  <span>MEMBERS</span>
                  {selectedGroup.myRole === 'admin' && (
                    <button className="gd-invite-btn" onClick={() => setGroupInviteSearch(' ')}>+ INVITE</button>
                  )}
                </div>
                <div className="gd-members-list">
                  {groupMembers.map(m => (
                    <div key={m.id} className="gd-member">
                      <div className="player-dot filled">{m.profile?.initials || '??'}</div>
                      <div className="gd-member-info">
                        <div className="gd-member-name">
                          {m.profile?.username || 'Unknown'}
                          {m.role === 'admin' && <span className="admin-badge-sm">ADMIN</span>}
                          {m.status === 'invited' && <span className="invited-badge-sm">INVITED</span>}
                        </div>
                        <div className="gd-member-hcp">HCP {m.profile?.handicap || '–'}</div>
                      </div>
                      {selectedGroup.myRole === 'admin' && m.user_id !== session?.user?.id && (
                        <button className="roster-remove" onClick={() => removeFromGroup(m.id)}>✕</button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Invite Search (inline) */}
                {groupInviteSearch && (
                  <div className="gd-invite-area">
                    <input
                      type="text"
                      className="player-search-input"
                      placeholder="Search by username…"
                      value={groupInviteSearch === ' ' ? '' : groupInviteSearch}
                      onChange={e => setGroupInviteSearch(e.target.value)}
                      autoFocus
                    />
                    <button className="player-search-close" style={{position:'absolute',right:26,top:8}} onClick={() => { setGroupInviteSearch(''); setGroupInviteResults([]); }}>✕</button>
                    {groupInviteResults.map(p => (
                      <div key={p.id} className="gd-invite-result" onClick={() => inviteToGroup(p.id)}>
                        <div className="player-dot filled">{p.initials}</div>
                        <span>{p.username}</span>
                        <span className="gd-invite-add">+ INVITE</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Group Actions */}
              <div className="gd-actions">
                {selectedGroup.myRole === 'admin' ? (
                  <button className="gd-danger-btn" onClick={() => deleteGroup(selectedGroup.id)}>🗑 DELETE GROUP</button>
                ) : (
                  <button className="gd-danger-btn" onClick={() => leaveGroup(selectedGroup.id)}>🚪 LEAVE GROUP</button>
                )}
              </div>

              {/* Group Chat */}
              <div className="gd-chat-label">GROUP CHAT</div>
              <div className="gd-chat-thread" ref={groupChatRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: '100px' }}>
                {groupMessages.length === 0 && (
                  <div className="gd-chat-empty">No messages yet — say something!</div>
                )}
                {groupMessages.map((msg, i) => {
                  const isMe = msg.user_id === session?.user?.id;
                  return (
                    <div key={msg.id || i} className={`msg ${isMe ? 'me' : 'them'}`}>
                      <div className="msg-stack">
                        <div className="sender">{isMe ? 'YOU' : (msg.senderProfile?.username || '??')}</div>
                        <div className="bubble">{msg.text}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Chat Input */}
              <div className="banter-input-area">
                <input
                  type="text"
                  className="banter-input"
                  placeholder="Message the group…"
                  value={groupMsgInput}
                  onChange={e => setGroupMsgInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendGroupMessage(); }}
                />
                <button className="banter-send" onClick={sendGroupMessage}>SEND</button>
              </div>
            </>
          )}
        </div>

        {/* ============== PERSISTENT BOTTOM NAVIGATION BAR ============== */}
        {!['chat', 'paywall', 'tracker', 'camera', 'review', 'group-detail'].includes(screen) && (
          <div className="bottom-nav">
            <button className={`nav-btn ${screen === 'home' ? 'active' : ''}`} onClick={() => setScreen('home')}>
              <span className="icon">⛳</span>
              <span>TEES</span>
            </button>
            <button className={`nav-btn ${screen === 'groups' ? 'active' : ''}`} onClick={() => setScreen('groups')}>
              <span className="icon">👥</span>
              <span>GROUPS</span>
            </button>
            <button className={`nav-btn snap ${screen === 'snap-intro' || screen === 'camera' || screen === 'review' ? 'active' : ''}`} onClick={() => setScreen('snap-intro')}>
              <span className="icon">📸</span>
              <span>SNAP</span>
            </button>
            <button className={`nav-btn ${screen === 'log' ? 'active' : ''}`} onClick={() => setScreen('log')}>
              <span className="icon">📝</span>
              <span>LOG</span>
            </button>
            <button className={`nav-btn ${screen === 'stats' ? 'active' : ''}`} onClick={() => setScreen('stats')}>
              <span className="icon">📊</span>
              <span>INTEL</span>
            </button>
          </div>
        )}
      </div>

      <div className="header-bar" style={{ marginTop: '20px', opacity: 0.6 }}>
        <span style={{ fontSize: '9px' }}>PROTOTYPE · TAP THROUGH THE FLOW</span>
        <span style={{ fontSize: '9px' }}>v0.1 · KC METRO</span>
      </div>
    </div>
  );
}
