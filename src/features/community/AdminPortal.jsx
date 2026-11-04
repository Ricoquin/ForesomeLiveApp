import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, when, friendly, courseById } from './api';

export default function AdminPortal({
  session,
  profile,
  roles,
  onBack,
  onCreateEvent,
  onManageEvent,
  onEditEvent,
  onOpenCommunity,
  onCreateCommunity,
  onOpenClubhouse,
  onOpenPlatform
}) {
  const me = session?.user?.id;
  const [myEvents, setMyEvents] = useState([]);
  const [myCommunities, setMyCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // Inline Admin Account Create / Switch panel
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState('signup'); // 'signup' | 'login'
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminOrgName, setAdminOrgName] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState('');

  const loadAdminData = async () => {
    if (!me) return;
    setLoading(true);
    setErr('');
    try {
      // Ensure profile exists in public.profiles so foreign keys on events/communities never fail
      const fallbackName =
        profile?.username ||
        session?.user?.user_metadata?.username ||
        session?.user?.email?.split('@')[0] ||
        'Admin';
      const initials = fallbackName
        .split(' ')
        .map(s => s[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'AD';

      await supabase.from('profiles').upsert([
        {
          id: me,
          username: fallbackName,
          handicap: profile?.handicap ?? 10,
          initials
        }
      ], { onConflict: 'id' });

      // Communities where user is creator or admin
      const adminCommIds = (roles?.adminCommunities || []).map(c => c.id);
      let commQuery = supabase.from('communities').select('*').order('created_at', { ascending: false });
      if (adminCommIds.length > 0) {
        commQuery = commQuery.or(`created_by.eq.${me},id.in.(${adminCommIds.join(',')})`);
      } else {
        commQuery = commQuery.eq('created_by', me);
      }
      const { data: comms } = await commQuery;
      setMyCommunities(comms || []);

      // Events created by user or belonging to their communities
      const allCommIds = [...new Set([...adminCommIds, ...(comms || []).map(c => c.id)])];
      let evQuery = supabase.from('events').select('*').order('starts_at', { ascending: false }).limit(50);
      if (allCommIds.length > 0) {
        evQuery = evQuery.or(`created_by.eq.${me},community_id.in.(${allCommIds.join(',')})`);
      } else {
        evQuery = evQuery.eq('created_by', me);
      }
      const { data: evs, error: evErr } = await evQuery;
      if (evErr) setErr(friendly(evErr));
      setMyEvents(evs || []);
    } catch (e) {
      setErr(friendly(e));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAdminData();
  }, [me, roles?.adminCommunities?.length]);

  const handleAdminAccountSubmit = async () => {
    setAuthErr('');
    if (!adminEmail.trim() || !adminPassword.trim()) {
      setAuthErr('Email and password are required.');
      return;
    }
    setAuthBusy(true);
    try {
      if (authTab === 'signup') {
        if (!adminName.trim()) {
          setAuthErr('Admin name is required.');
          setAuthBusy(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: adminEmail.trim(),
          password: adminPassword,
          options: { data: { username: adminName.trim(), is_admin: true } }
        });
        if (error) {
          setAuthErr(error.message);
          setAuthBusy(false);
          return;
        }
        if (data?.user) {
          const initials = adminName
            .trim()
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'AD';
          await supabase.from('profiles').upsert([
            {
              id: data.user.id,
              username: adminName.trim(),
              handicap: 0,
              initials
            }
          ], { onConflict: 'id' });

          // If they entered a Community/League name, create it right away
          if (adminOrgName.trim()) {
            const slug = `${adminOrgName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 48);
            await supabase.from('communities').insert([
              {
                name: adminOrgName.trim(),
                slug,
                privacy: 'public',
                created_by: data.user.id
              }
            ]);
          }
          setMsg(`Admin account "${adminName.trim()}" created & signed in!`);
          setShowAuthModal(false);
          roles?.reload?.();
          loadAdminData();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: adminEmail.trim(),
          password: adminPassword
        });
        if (error) {
          setAuthErr(error.message);
          setAuthBusy(false);
          return;
        }
        setMsg(`Signed in as ${adminEmail.trim()}`);
        setShowAuthModal(false);
        roles?.reload?.();
        loadAdminData();
      }
    } catch (e) {
      setAuthErr(e.message || 'Authentication failed.');
    }
    setAuthBusy(false);
  };

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← BACK</button>
        <button className="fs-small-btn ghost" onClick={() => { setShowAuthModal(true); setAuthErr(''); }}>
          👤 Admin Login / New Admin
        </button>
      </div>

      <div className="fs-eyebrow">ORGANIZER &amp; ADMIN CONSOLE</div>
      <h1 className="fs-h1">Events &amp; Communities</h1>
      <p className="fs-sub">
        Create and manage golf communities, leagues, tournaments, pairings, check-ins, and live leaderboards.
      </p>

      {/* Signed-in Admin Profile Bar */}
      <div className="fs-card" style={{ borderColor: 'rgba(56, 217, 118, 0.35)', background: 'rgba(22, 156, 108, 0.08)' }}>
        <div className="fs-card-row">
          <div>
            <div className="fs-card-title">
              🛡️ {profile?.username || session?.user?.email?.split('@')[0] || 'Admin'}
            </div>
            <div className="fs-card-meta">{session?.user?.email}</div>
          </div>
          <span className="fs-pill live">ADMIN ACTIVE</span>
        </div>
      </div>

      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      {/* Primary Quick Creation Actions */}
      <div className="fs-section-title">Quick Create</div>
      <div className="cm-row2" style={{ gap: 10, marginBottom: 14 }}>
        <button
          className="fs-cta"
          style={{ marginTop: 0 }}
          onClick={() => onCreateEvent({})}
        >
          + Create Event
        </button>
        <button
          className="fs-cta secondary"
          style={{ marginTop: 0 }}
          onClick={onCreateCommunity}
        >
          + Create Community
        </button>
      </div>

      {/* My Communities Section */}
      <div className="fs-section-title">
        My Communities &amp; Leagues ({myCommunities.length})
      </div>
      {loading && <div className="fs-empty">Loading…</div>}
      {!loading && myCommunities.length === 0 && (
        <div className="fs-card">
          <div className="fs-card-title">No communities created yet</div>
          <div className="fs-card-meta" style={{ margin: '4px 0 10px' }}>
            Start a league, club, or tournament group to manage members, seasons, and events.
          </div>
          <button className="fs-small-btn" onClick={onCreateCommunity}>
            + Start Your First Community
          </button>
        </div>
      )}
      {myCommunities.map(c => {
        const homeCourse = courseById(c.home_course_id);
        return (
          <div key={c.id} className="fs-card">
            <div className="fs-card-row">
              <span className="fs-card-title">{c.name}</span>
              <span className="fs-pill live">{c.privacy}</span>
            </div>
            <div className="fs-card-meta">
              {homeCourse ? `${homeCourse.name} · ${homeCourse.city}` : 'KC Metro'}
              {c.description ? ` · ${c.description}` : ''}
            </div>
            <div className="cm-actions" style={{ marginTop: 10, marginBottom: 0 }}>
              <button className="fs-small-btn" onClick={() => onOpenCommunity(c.id)}>
                Manage Community
              </button>
              <button className="fs-small-btn ghost" onClick={() => onCreateEvent({ communityId: c.id })}>
                + Host Event
              </button>
            </div>
          </div>
        );
      })}

      {/* My Events Section */}
      <div className="fs-section-title">
        Events I Manage ({myEvents.length})
      </div>
      {!loading && myEvents.length === 0 && (
        <div className="fs-card">
          <div className="fs-card-title">No events hosted yet</div>
          <div className="fs-card-meta" style={{ margin: '4px 0 10px' }}>
            Host a stroke play, scramble, best ball, skins, or match play event at any KC course.
          </div>
          <button className="fs-small-btn" onClick={() => onCreateEvent({})}>
            + Host Your First Event
          </button>
        </div>
      )}
      {myEvents.map(ev => {
        const course = courseById(ev.course_id);
        return (
          <div key={ev.id} className="fs-card">
            <div className="fs-card-row">
              <span className="fs-card-title">{ev.name}</span>
              <span className={`fs-pill ${ev.status === 'live' || ev.status === 'published' ? 'live' : ''}`}>
                {ev.status}
              </span>
            </div>
            <div className="fs-card-meta">
              {when(ev.starts_at)} · {course?.name || 'Course'} · {FORMAT_LABELS[ev.format] || ev.format}
            </div>
            <div className="cm-actions" style={{ marginTop: 10, marginBottom: 0 }}>
              <button className="fs-small-btn" onClick={() => onManageEvent(ev.id)}>
                Manage &amp; Pairings
              </button>
              <button className="fs-small-btn ghost" onClick={() => onEditEvent(ev.id)}>
                Edit Details
              </button>
            </div>
          </div>
        );
      })}

      {/* Operator & Platform Admin links */}
      <div className="fs-section-title">Course &amp; Platform Tools</div>
      <div className="cm-actions">
        {roles?.staffOrgs?.length > 0 && (
          <button className="fs-small-btn ghost" onClick={onOpenClubhouse}>
            🏌️‍♂️ Course Clubhouse
          </button>
        )}
        <button className="fs-small-btn ghost" onClick={onOpenPlatform}>
          ⚙ Operator &amp; Platform Admin
        </button>
      </div>

      {/* Modal to Create a New Admin User or Switch Admin Account */}
      {showAuthModal && (
        <div className="player-search-overlay" style={{ zIndex: 9999 }}>
          <div className="player-search-modal" style={{ maxWidth: 380 }}>
            <div className="player-search-header">
              <span className="player-search-title">🛡️ Admin Account</span>
              <button className="player-search-close" onClick={() => setShowAuthModal(false)}>✕</button>
            </div>

            <div className="fs-seg" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={authTab === 'signup' ? 'on' : ''}
                onClick={() => { setAuthTab('signup'); setAuthErr(''); }}
              >
                Create Admin
              </button>
              <button
                type="button"
                className={authTab === 'login' ? 'on' : ''}
                onClick={() => { setAuthTab('login'); setAuthErr(''); }}
              >
                Admin Login
              </button>
            </div>

            {authErr && <div className="fs-error" style={{ marginBottom: 10 }}>{authErr}</div>}

            {authTab === 'signup' && (
              <>
                <label className="fs-field">
                  Admin Name
                  <input
                    className="fs-input"
                    placeholder="e.g. Rico Q."
                    value={adminName}
                    onChange={e => setAdminName(e.target.value)}
                  />
                </label>
                <label className="fs-field">
                  Community / League Name (optional)
                  <input
                    className="fs-input"
                    placeholder="e.g. KC Metro Golf Tour"
                    value={adminOrgName}
                    onChange={e => setAdminOrgName(e.target.value)}
                  />
                </label>
              </>
            )}

            <label className="fs-field">
              Admin Email
              <input
                className="fs-input"
                type="email"
                placeholder="admin@foresome.app"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
              />
            </label>

            <label className="fs-field">
              Password
              <input
                className="fs-input"
                type="password"
                placeholder="••••••••"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="fs-cta"
              disabled={authBusy}
              onClick={handleAdminAccountSubmit}
            >
              {authBusy
                ? 'Connecting…'
                : authTab === 'signup'
                ? '🛡️ Create Admin & Sign In'
                : '🛡️ Sign In as Admin'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

