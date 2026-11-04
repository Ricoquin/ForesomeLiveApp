import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { when, friendly, rpc, slugify, courseById, courseList } from './api';

const PRIVACY = { public: 'Public — anyone can join', closed: 'Closed — ask to join', secret: 'Secret — invite only' };

// Leagues, clubs, tours. Directory → community page → admin tools (for its admins).
export default function Communities({ session, roles, active, onBack, onOpenEvent, onCreateEvent }) {
  const [view, setView] = useState({ name: 'list' });
  if (view.name === 'create') return <CreateCommunity session={session} onCancel={() => setView({ name: 'list' })} onCreated={(id) => { roles.reload(); setView({ name: 'page', id }); }} />;
  if (view.name === 'page') return <CommunityPage session={session} roles={roles} id={view.id} onBack={() => setView({ name: 'list' })} onOpenEvent={onOpenEvent} onCreateEvent={onCreateEvent} />;
  return <Directory session={session} roles={roles} active={active} onBack={onBack} onOpen={(id) => setView({ name: 'page', id })} onCreate={() => setView({ name: 'create' })} />;
}

function Directory({ roles, active, onBack, onOpen, onCreate }) {
  const [list, setList] = useState([]); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    if (!active) return;
    supabase.from('communities').select('*').order('name').limit(200).then(({ data, error }) => error ? setErr(friendly(error)) : setList(data || []));
  }, [active]);
  const shown = list.filter(c => {
    const s = q.toLowerCase(); const course = courseById(c.home_course_id);
    return !s || c.name.toLowerCase().includes(s) || (course?.name || '').toLowerCase().includes(s) || (course?.city || '').toLowerCase().includes(s);
  });
  const mineIds = new Set([...roles.adminCommunities.map(c => c.id), ...(roles.memberships || []).filter(m => m.status === 'active').map(m => m.community_id)]);
  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← EVENTS</button><button className="fs-small-btn" onClick={onCreate}>+ Start one</button></div>
      <h1 className="fs-h1">Communities</h1>
      <p className="fs-sub">Leagues, clubs and outing groups. Find one by name, course or city.</p>
      {err && <div className="fs-error">{err}</div>}
      <input className="fs-input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
      {shown.map(c => {
        const course = courseById(c.home_course_id);
        const role = roles.adminCommunities.find(a => a.id === c.id)?.role;
        return (
          <button key={c.id} className="fs-card fs-card-btn" onClick={() => onOpen(c.id)}>
            <div className="fs-card-row"><span className="fs-card-title">{c.name}</span>
              {role ? <span className="fs-pill live">{role.replace('_', '-')}</span> : mineIds.has(c.id) ? <span className="fs-pill">Member</span> : <span className="fs-pill">{c.privacy}</span>}</div>
            <div className="fs-card-meta">{course ? `${course.name} · ${course.city}` : 'No home course'}{c.description ? ` · ${c.description}` : ''}</div>
          </button>
        );
      })}
      {!err && shown.length === 0 && <div className="fs-empty">No communities found.</div>}
    </div>
  );
}

function CreateCommunity({ session, onCancel, onCreated }) {
  const [f, setF] = useState({ name: '', description: '', privacy: 'public', home_course_id: '' });
  const [cq, setCq] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return setErr('Name your community.');
    setBusy(true);
    const slug = `${slugify(f.name)}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 48);
    const { data, error } = await supabase.from('communities').insert([{ ...f, name: f.name.trim(), slug, created_by: session.user.id, home_course_id: f.home_course_id || null }]).select('id').single();
    setBusy(false);
    if (error) return setErr(friendly(error));
    onCreated(data.id);
  };
  const matches = cq.length > 1 ? courseList.filter(c => c.name.toLowerCase().includes(cq.toLowerCase())).slice(0, 5) : [];
  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onCancel}>← BACK</button></div>
      <h1 className="fs-h1">Start a community</h1>
      <label className="fs-field">Name<input className="fs-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Swope Saturday League" /></label>
      <label className="fs-field">About<textarea className="fs-input" rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <div className="fs-section-title">Home course (optional)</div>
      {f.home_course_id ? <div className="fs-card fs-card-row"><span>{courseById(f.home_course_id)?.name}</span><button className="fs-link" onClick={() => setF({ ...f, home_course_id: '' })}>Change</button></div> : (
        <><input className="fs-input" placeholder="Search courses…" value={cq} onChange={e => setCq(e.target.value)} />
          {matches.map(c => <button key={c.id} className="fs-list-btn" onClick={() => { setF({ ...f, home_course_id: c.id }); setCq(''); }}>{c.name}</button>)}</>
      )}
      <div className="fs-section-title">Who can join</div>
      {Object.entries(PRIVACY).map(([k, l]) => <label key={k} className={`fs-radio ${f.privacy === k ? 'on' : ''}`}><input type="radio" checked={f.privacy === k} onChange={() => setF({ ...f, privacy: k })} /><span>{l}</span></label>)}
      {err && <div className="fs-error">{err}</div>}
      <button className="fs-cta" disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create community'}</button>
      <p className="fs-footnote">You'll be the owner. You can add admins and co-admins after.</p>
    </div>
  );
}

function CommunityPage({ session, roles, id, onBack, onOpenEvent, onCreateEvent }) {
  const me = session.user.id;
  const [c, setC] = useState(null); const [events, setEvents] = useState([]); const [seasons, setSeasons] = useState([]);
  const [standings, setStandings] = useState({}); const [tab, setTab] = useState('events'); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const myRole = roles.adminCommunities.find(a => a.id === id)?.role || (roles.isPlatformAdmin ? 'admin' : null);
  const membership = roles.memberOf(id);

  const load = async () => {
    const { data, error } = await supabase.from('communities').select('*').eq('id', id).single();
    if (error) return setErr(friendly(error));
    setC(data);
    const { data: ev } = await supabase.from('events').select('*').eq('community_id', id).order('starts_at', { ascending: false }).limit(40);
    setEvents(ev || []);
    const { data: ss } = await supabase.from('seasons').select('*').eq('community_id', id).order('starts_on', { ascending: false });
    setSeasons(ss || []);
    const st = {};
    for (const s of ss || []) { const { data: rows } = await supabase.rpc('season_standings', { p_season_id: s.id }); st[s.id] = rows || []; }
    setStandings(st);
  };
  useEffect(() => { load(); }, [id]);

  const join = async () => {
    try { const m = await rpc('join_community', { p_community_id: id }); setMsg(m.status === 'active' ? "You're a member!" : 'Request sent. An admin will approve it.'); roles.reload(); }
    catch (e) { setErr(e.message); }
  };
  const leave = async () => { if (!confirm('Leave this community?')) return; await supabase.from('memberships').delete().eq('community_id', id).eq('profile_id', me); roles.reload(); setMsg('You left.'); };

  if (err && !c) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← COMMUNITIES</button></div><div className="fs-error">{err}</div></div>;
  if (!c) return <div className="fs-page"><div className="fs-empty">Loading…</div></div>;
  const now = Date.now();
  const upcoming = events.filter(e => new Date(e.starts_at).getTime() > now - 86400000 && e.status !== 'cancelled').reverse();
  const past = events.filter(e => new Date(e.starts_at).getTime() <= now - 86400000 || e.status === 'completed');

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← COMMUNITIES</button>
        {myRole && <button className="fs-small-btn" onClick={() => onCreateEvent({ communityId: id })}>+ Event</button>}</div>
      <div className="fs-eyebrow">{c.privacy} community{myRole ? ` · you're ${myRole.replace('_', '-')}` : ''}</div>
      <h1 className="fs-h1">{c.name}</h1>
      {c.description && <p className="fs-sub">{c.description}</p>}
      {courseById(c.home_course_id) && <div className="fs-card-meta">Home course: {courseById(c.home_course_id).name}</div>}
      {!myRole && (membership === 'active' ? <button className="fs-small-btn ghost" onClick={leave}>Leave</button>
        : membership === 'pending' ? <span className="fs-pill">Request pending</span>
        : <button className="fs-cta" onClick={join}>{c.privacy === 'public' ? 'Join' : 'Ask to join'}</button>)}
      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      <div className="fs-seg wrap">
        {[['events', 'Events'], ['standings', 'Standings'], ...(myRole ? [['admin', 'Admin']] : [])].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'events' && (
        <>
          {upcoming.map(e => <EventRow key={e.id} e={e} onOpen={onOpenEvent} />)}
          {!upcoming.length && <div className="fs-empty">No upcoming events.</div>}
          {past.length > 0 && <div className="fs-section-title">Past</div>}
          {past.slice(0, 10).map(e => <EventRow key={e.id} e={e} onOpen={onOpenEvent} />)}
        </>
      )}

      {tab === 'standings' && (
        <>
          {!seasons.length && <div className="fs-empty">No seasons yet.</div>}
          {seasons.map(s => (
            <div key={s.id} className="fs-card">
              <div className="fs-card-row"><span className="fs-card-title">{s.name}</span><span className="fs-card-meta">{s.starts_on} → {s.ends_on}</span></div>
              {s.invite_top_n && <div className="fs-board-meta">Top {s.invite_top_n} earn invite-only outings</div>}
              {(standings[s.id] || []).map(r => (
                <div key={r.profile_id} className={`fs-board-row ${r.profile_id === me ? 'me' : ''}`}>
                  <span className="fs-rank">{r.place}</span><div className="player-dot filled">{r.initials}</div>
                  <div className="fs-board-who"><div className="fs-board-name">{r.username}</div><div className="fs-board-meta">{r.events_played} events · {r.courses_played} courses</div></div>
                  <span className="fs-board-val">{r.points} pts</span>
                </div>
              ))}
              {!(standings[s.id] || []).length && <div className="fs-empty">No points yet.</div>}
            </div>
          ))}
        </>
      )}

      {tab === 'admin' && myRole && <CommunityAdmin session={session} c={c} myRole={myRole} seasons={seasons} onChanged={() => { load(); roles.reload(); }} />}
    </div>
  );
}

const EventRow = ({ e, onOpen }) => (
  <button className="fs-card fs-card-btn" onClick={() => onOpen(e.id)}>
    <div className="fs-card-row"><span className="fs-card-title">{e.name}</span><span className={`fs-pill ${e.status === 'live' ? 'live' : ''}`}>{e.status}</span></div>
    <div className="fs-card-meta">{when(e.starts_at)} · {courseById(e.course_id)?.name}</div>
  </button>
);

function CommunityAdmin({ session, c, myRole, seasons, onChanged }) {
  const [pending, setPending] = useState([]); const [members, setMembers] = useState([]); const [admins, setAdmins] = useState([]);
  const [names, setNames] = useState({}); const [q, setQ] = useState(''); const [found, setFound] = useState([]);
  const [season, setSeason] = useState({ name: '', starts_on: '', ends_on: '', invite_top_n: '', finish: '50,30,20,10,5', participation: '10', course_bonus: '5' });
  const [privacy, setPrivacy] = useState(c.privacy); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const isOwner = myRole === 'owner';

  const load = async () => {
    const { data: m } = await supabase.from('memberships').select('*').eq('community_id', c.id);
    const { data: a } = await supabase.from('community_admins').select('*').eq('community_id', c.id);
    const ids = [...new Set([...(m || []), ...(a || [])].map(x => x.profile_id))];
    const { data: p } = ids.length ? await supabase.from('profiles').select('id, username, initials, handicap').in('id', ids) : { data: [] };
    setNames(Object.fromEntries((p || []).map(x => [x.id, x])));
    setPending((m || []).filter(x => x.status === 'pending')); setMembers((m || []).filter(x => x.status === 'active')); setAdmins(a || []);
  };
  useEffect(() => { load(); }, [c.id]);
  useEffect(() => {
    if (q.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id, username, initials').ilike('username', `%${q}%`).limit(6); setFound(data || []); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (p, ok) => { setErr(''); const { error } = await p; if (error) setErr(friendly(error)); else { setMsg(ok); load(); onChanged(); } };
  const nm = (id) => names[id]?.username || 'Player';

  const createSeason = async () => {
    if (!season.name || !season.starts_on || !season.ends_on) return setErr('Season needs a name, start and end.');
    const { data, error } = await supabase.from('seasons').insert([{ name: season.name, community_id: c.id, starts_on: season.starts_on, ends_on: season.ends_on, invite_top_n: season.invite_top_n ? Number(season.invite_top_n) : null }]).select('id').single();
    if (error) return setErr(friendly(error));
    const rules = [
      ...season.finish.split(',').map(s => Number(s.trim())).filter(n => n >= 0).map((pts, i) => ({ season_id: data.id, rule_type: 'finish', position: i + 1, points: pts })),
      ...(season.participation ? [{ season_id: data.id, rule_type: 'participation', position: null, points: Number(season.participation) }] : []),
      ...(season.course_bonus ? [{ season_id: data.id, rule_type: 'course_bonus', position: null, points: Number(season.course_bonus) }] : []),
    ];
    await run(supabase.from('season_point_rules').insert(rules), `${season.name} created`);
    setSeason({ ...season, name: '' });
  };

  return (
    <>
      {msg && <div className="fs-note">{msg}</div>}{err && <div className="fs-error">{err}</div>}
      <div className="fs-section-title">Join requests</div>
      {pending.map(m => (
        <div key={m.id} className="fs-player"><div className="player-dot filled">{names[m.profile_id]?.initials}</div>
          <div className="fs-board-who"><div className="fs-board-name">{nm(m.profile_id)}</div></div>
          <button className="fs-small-btn" onClick={() => run(supabase.from('memberships').update({ status: 'active' }).eq('id', m.id), `${nm(m.profile_id)} approved`)}>Approve</button>
          <button className="fs-x" aria-label="Decline" onClick={() => run(supabase.from('memberships').delete().eq('id', m.id), 'Declined')}>✕</button></div>
      ))}
      {!pending.length && <div className="fs-empty">No requests.</div>}

      <div className="fs-section-title">Admins</div>
      {admins.map(a => (
        <div key={a.profile_id} className="fs-player"><div className="player-dot filled">{names[a.profile_id]?.initials}</div>
          <div className="fs-board-who"><div className="fs-board-name">{nm(a.profile_id)}</div><div className="fs-board-meta">{a.role.replace('_', '-')}</div></div>
          {a.role !== 'owner' && (isOwner || a.role === 'co_admin') && <button className="fs-small-btn ghost" onClick={() => run(supabase.from('community_admins').delete().eq('community_id', c.id).eq('profile_id', a.profile_id), 'Removed')}>Remove</button>}</div>
      ))}
      <input className="fs-input" placeholder="Add an admin by username…" value={q} onChange={e => setQ(e.target.value)} />
      {found.map(p => (
        <div key={p.id} className="fs-player"><span className="fs-board-name" style={{ flex: 1 }}>{p.username}</span>
          {isOwner && <button className="fs-small-btn" onClick={() => run(supabase.from('community_admins').insert([{ community_id: c.id, profile_id: p.id, role: 'admin' }]), `${p.username} is an admin`)}>Admin</button>}
          <button className="fs-small-btn ghost" onClick={() => run(supabase.from('community_admins').insert([{ community_id: c.id, profile_id: p.id, role: 'co_admin' }]), `${p.username} is a co-admin`)}>Co-admin</button>
          <button className="fs-small-btn ghost" onClick={() => run(supabase.from('memberships').insert([{ community_id: c.id, profile_id: p.id, status: 'active' }]), `${p.username} added as a member`)}>Member</button></div>
      ))}
      <p className="fs-footnote">Admins and co-admins run events and members. Only the owner can add admins.</p>

      <div className="fs-section-title">Members ({members.length})</div>
      {members.map(m => (
        <div key={m.id} className="fs-player"><div className="player-dot filled">{names[m.profile_id]?.initials}</div>
          <div className="fs-board-who"><div className="fs-board-name">{nm(m.profile_id)}</div><div className="fs-board-meta">HCP {names[m.profile_id]?.handicap ?? '—'}</div></div>
          {m.profile_id !== c.created_by && <button className="fs-x" aria-label="Remove member" onClick={() => confirm(`Remove ${nm(m.profile_id)}?`) && run(supabase.from('memberships').delete().eq('id', m.id), 'Removed')}>✕</button>}</div>
      ))}

      <div className="fs-section-title">New season</div>
      <div className="fs-card">
        <input className="fs-input" placeholder="2027 Season" value={season.name} onChange={e => setSeason({ ...season, name: e.target.value })} />
        <div className="cm-row2">
          <label className="fs-field">Starts<input className="fs-input" type="date" value={season.starts_on} onChange={e => setSeason({ ...season, starts_on: e.target.value })} /></label>
          <label className="fs-field">Ends<input className="fs-input" type="date" value={season.ends_on} onChange={e => setSeason({ ...season, ends_on: e.target.value })} /></label>
        </div>
        <label className="fs-field">Points for 1st, 2nd, 3rd… (comma separated)<input className="fs-input" value={season.finish} onChange={e => setSeason({ ...season, finish: e.target.value })} /></label>
        <div className="cm-row2">
          <label className="fs-field">For playing<input className="fs-input" type="number" value={season.participation} onChange={e => setSeason({ ...season, participation: e.target.value })} /></label>
          <label className="fs-field">Each new course<input className="fs-input" type="number" value={season.course_bonus} onChange={e => setSeason({ ...season, course_bonus: e.target.value })} /></label>
        </div>
        <label className="fs-field">Top N earn invite-only outings (optional)<input className="fs-input" type="number" value={season.invite_top_n} onChange={e => setSeason({ ...season, invite_top_n: e.target.value })} /></label>
        <button className="fs-small-btn" onClick={createSeason}>Create season</button>
      </div>

      <div className="fs-section-title">Privacy</div>
      {Object.entries(PRIVACY).map(([k, l]) => <label key={k} className={`fs-radio ${privacy === k ? 'on' : ''}`}><input type="radio" checked={privacy === k} onChange={() => { setPrivacy(k); run(supabase.from('communities').update({ privacy: k }).eq('id', c.id), 'Saved'); }} /><span>{l}</span></label>)}
    </>
  );
}
