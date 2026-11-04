import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { STATUS_LABELS, money, when, friendly, rpc, downloadCsv } from './api';

const RANGES = { week: 7, month: 30, year: 365 };
const iso = (d) => d.toISOString().slice(0, 10);

// Course operators (Orion): check-in kiosk for staff, Events & Groups dashboard, staff and courses for admins.
export default function OperatorConsole({ session, roles, onBack, onOpenEvent, onCreateEvent }) {
  const [orgId, setOrgId] = useState(roles.staffOrgs[0]?.id || '');
  const org = roles.staffOrgs.find(o => o.id === orgId) || (roles.isPlatformAdmin ? { id: orgId, role: 'owner' } : null);
  const isAdmin = roles.isPlatformAdmin || ['owner', 'admin'].includes(org?.role);
  const [tab, setTab] = useState('checkin');
  if (!orgId) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div><div className="fs-empty">You're not on a course operator's staff.</div></div>;
  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button>
        {roles.staffOrgs.length > 1 && <select className="fs-input cm-orgsel" value={orgId} onChange={e => setOrgId(e.target.value)} aria-label="Operator">
          {roles.staffOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</div>
      <div className="fs-eyebrow">{org?.name || 'Operator'} · {org?.role}</div>
      <h1 className="fs-h1">Clubhouse</h1>
      <div className="fs-seg wrap">
        {[['checkin', 'Check-in'], ['dash', 'Events & Groups'], ...(isAdmin ? [['staff', 'Staff']] : []), ['courses', 'Courses']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'checkin' && <CheckIn orgId={orgId} />}
      {tab === 'dash' && <Dashboard orgId={orgId} onOpenEvent={onOpenEvent} />}
      {tab === 'staff' && isAdmin && <Staff orgId={orgId} me={session.user.id} myRole={roles.isPlatformAdmin ? 'owner' : org?.role} onChanged={roles.reload} />}
      {tab === 'courses' && <Courses orgId={orgId} onCreateEvent={onCreateEvent} />}
    </div>
  );
}

function CheckIn({ orgId }) {
  const [events, setEvents] = useState([]); const [regs, setRegs] = useState([]); const [names, setNames] = useState({});
  const [q, setQ] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null); const stopRef = useRef(null);

  const load = async () => {
    try {
      const today = iso(new Date());
      const d = await rpc('org_dashboard', { p_org_id: orgId, p_from: today, p_to: today });
      const evs = d.upcoming || []; setEvents(evs);
      if (!evs.length) { setRegs([]); return; }
      const { data: r } = await supabase.from('registrations').select('*').in('event_id', evs.map(e => e.id)).in('status', ['confirmed', 'checked_in', 'pending_payment']);
      setRegs(r || []);
      const ids = [...new Set((r || []).map(x => x.profile_id))];
      if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, username, initials').in('id', ids); setNames(Object.fromEntries((p || []).map(x => [x.id, x]))); }
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [orgId]);
  useEffect(() => {
    const ch = supabase.channel(`kiosk-${orgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); stopRef.current?.(); };
  }, [orgId]);

  const checkIn = async (id) => {
    setErr('');
    try { const r = await rpc('check_in', { p_registration_id: id }); setMsg(`${names[r.profile_id]?.username || 'Player'} checked in`); load(); }
    catch (e) { setErr(e.message); }
  };

  // Scan the golfer's QR with the device camera (Chrome / Android). Elsewhere, search by name.
  const scan = async () => {
    if (!('BarcodeDetector' in window)) { setErr("This browser can't scan codes. Search by name instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      const video = videoRef.current; video.srcObject = stream; await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let on = true;
      stopRef.current = () => { on = false; stream.getTracks().forEach(t => t.stop()); setScanning(false); };
      const tick = async () => {
        if (!on) return;
        const codes = await detector.detect(video).catch(() => []);
        const hit = codes.map(c => c.rawValue).find(v => v?.startsWith('foresome:checkin:'));
        if (hit) { stopRef.current(); checkIn(hit.split(':')[2]); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch { setErr('Camera not available.'); setScanning(false); }
  };

  const shown = regs.filter(r => !q || (names[r.profile_id]?.username || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="cm-actions">
        <button className="fs-small-btn" onClick={scanning ? () => stopRef.current?.() : scan}>{scanning ? 'Stop camera' : '📷 Scan QR'}</button>
        <button className="fs-small-btn ghost" onClick={() => document.documentElement.requestFullscreen?.()}>Kiosk mode</button>
      </div>
      <video ref={videoRef} className="cm-video" style={{ display: scanning ? 'block' : 'none' }} muted playsInline />
      {msg && <div className="fs-note cm-big">{msg}</div>}{err && <div className="fs-error">{err}</div>}
      <input className="fs-input" placeholder="Search player name…" value={q} onChange={e => setQ(e.target.value)} />
      {events.map(e => (
        <div key={e.id}>
          <div className="fs-section-title">{e.name} · {e.course} · {new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {e.checked_in}/{e.registered} in</div>
          {shown.filter(r => r.event_id === e.id).map(r => (
            <div key={r.id} className="fs-player cm-kiosk-row">
              <div className="player-dot filled">{names[r.profile_id]?.initials}</div>
              <div className="fs-board-who"><div className="fs-board-name">{names[r.profile_id]?.username || 'Player'}</div>
                <div className="fs-board-meta">{STATUS_LABELS[r.status]}{r.amount_due_cents ? ` · ${money(r.amount_due_cents)} ${r.paid_at_course_at ? 'paid' : 'due'}` : ''}</div></div>
              {r.amount_due_cents > 0 && !r.paid_at_course_at && <button className="fs-small-btn ghost" onClick={() => rpc('mark_paid_at_course', { p_registration_id: r.id }).then(load).catch(x => setErr(x.message))}>Paid</button>}
              {r.status === 'checked_in' ? <span className="fs-pill live">In ✓</span> : <button className="fs-small-btn" onClick={() => checkIn(r.id)}>Check in</button>}
            </div>
          ))}
        </div>
      ))}
      {!events.length && !err && <div className="fs-empty">No events at your courses today.</div>}
    </>
  );
}

function Dashboard({ orgId, onOpenEvent }) {
  const [range, setRange] = useState('month'); const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => {
    const from = new Date(); const to = new Date(); to.setDate(to.getDate() + RANGES[range]); from.setDate(from.getDate() - RANGES[range]);
    rpc('org_dashboard', { p_org_id: orgId, p_from: iso(from), p_to: iso(to) }).then(setD).catch(e => setErr(e.message));
  }, [orgId, range]);
  if (err) return <div className="fs-error">{err}</div>;
  if (!d) return <div className="fs-empty">Loading…</div>;
  const upcoming = (d.upcoming || []).filter(e => new Date(e.starts_at) >= new Date(Date.now() - 86400000));
  return (
    <>
      <div className="fs-seg">{Object.keys(RANGES).map(k => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
      <p className="fs-footnote">Past and next {range} at your courses.</p>
      <div className="cm-facts">
        <div><b>{d.checkins_today}</b><span>check-ins today</span></div>
        <div><b>{d.entries_total}</b><span>event entries</span></div>
        <div><b>{d.cross_course_players}</b><span>played 2+ courses</span></div>
        <div><b>{money(d.fees_collected_cents)}</b><span>of {money(d.fees_due_cents)} collected</span></div>
      </div>
      <div className="fs-section-title cm-row-title">Upcoming events <button className="fs-link" onClick={() => downloadCsv('events.csv', d.upcoming)}>CSV</button></div>
      {upcoming.map(e => (
        <button key={e.id} className="fs-card fs-card-btn" onClick={() => onOpenEvent(e.id)}>
          <div className="fs-card-row"><span className="fs-card-title">{e.name}</span><span className="fs-pill">{e.status}</span></div>
          <div className="fs-card-meta">{when(e.starts_at)} · {e.course}</div>
          <div className="cm-bar"><div style={{ width: `${e.capacity ? Math.min(100, (e.registered / e.capacity) * 100) : 0}%` }} /></div>
          <div className="fs-card-meta">{e.registered}{e.capacity ? ` / ${e.capacity}` : ''} registered · {e.waitlist} waitlist · {e.checked_in} checked in</div>
        </button>
      ))}
      {!upcoming.length && <div className="fs-empty">No upcoming events.</div>}
      <div className="fs-section-title cm-row-title">Top communities <button className="fs-link" onClick={() => downloadCsv('communities.csv', d.top_communities)}>CSV</button></div>
      {(d.top_communities || []).map((c, i) => (
        <div key={c.id} className="fs-board-row"><span className="fs-rank">{i + 1}</span>
          <div className="fs-board-who"><div className="fs-board-name">{c.name}</div><div className="fs-board-meta">{c.events} event{c.events == 1 ? '' : 's'}</div></div>
          <span className="fs-board-val">{c.entries} entries</span></div>
      ))}
      {!(d.top_communities || []).length && <div className="fs-empty">No community events yet.</div>}
    </>
  );
}

function Staff({ orgId, me, myRole, onChanged }) {
  const [staff, setStaff] = useState([]); const [names, setNames] = useState({}); const [q, setQ] = useState(''); const [found, setFound] = useState([]);
  const [role, setRole] = useState('staff'); const [err, setErr] = useState('');
  const load = async () => {
    const { data } = await supabase.from('organization_staff').select('*').eq('organization_id', orgId);
    setStaff(data || []);
    const ids = (data || []).map(s => s.profile_id);
    if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, username').in('id', ids); setNames(Object.fromEntries((p || []).map(x => [x.id, x.username]))); }
  };
  useEffect(() => { load(); }, [orgId]);
  useEffect(() => {
    if (q.length < 2) return setFound([]);
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id, username').ilike('username', `%${q}%`).limit(6); setFound(data || []); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const add = async (p) => {
    const { error } = await supabase.from('organization_staff').upsert([{ organization_id: orgId, profile_id: p.id, role }]);
    if (error) setErr(friendly(error)); else { setQ(''); load(); onChanged(); }
  };
  return (
    <>
      {err && <div className="fs-error">{err}</div>}
      {staff.map(s => (
        <div key={s.profile_id} className="fs-player">
          <div className="fs-board-who"><div className="fs-board-name">{names[s.profile_id] || 'Player'}{s.profile_id === me ? ' (you)' : ''}</div><div className="fs-board-meta">{s.role}</div></div>
          {s.profile_id !== me && (myRole === 'owner' || s.role === 'staff') &&
            <button className="fs-small-btn ghost" onClick={() => supabase.from('organization_staff').delete().eq('organization_id', orgId).eq('profile_id', s.profile_id).then(load)}>Remove</button>}
        </div>
      ))}
      <div className="fs-section-title">Add staff</div>
      <div className="cm-row2">
        <input className="fs-input" placeholder="Username…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="fs-input" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
          <option value="staff">Pro shop staff</option><option value="admin">Operator admin</option>
          {myRole === 'owner' && <option value="owner">Owner</option>}
        </select>
      </div>
      {found.map(p => <button key={p.id} className="fs-list-btn" onClick={() => add(p)}>+ {p.username}</button>)}
      <p className="fs-footnote">Staff can check players in and run events at your courses. Admins also manage staff and see every course.</p>
    </>
  );
}

function Courses({ orgId, onCreateEvent }) {
  const [list, setList] = useState([]);
  useEffect(() => { supabase.from('courses').select('id, name, city').eq('organization_id', orgId).order('name').then(({ data }) => setList(data || [])); }, [orgId]);
  return (
    <>
      {list.map(c => (
        <div key={c.id} className="fs-card fs-card-row">
          <div><div className="fs-card-title">{c.name}</div><div className="fs-card-meta">{c.city}</div></div>
          <button className="fs-small-btn" onClick={() => onCreateEvent({ organizationId: orgId, courseId: c.id })}>+ Event</button>
        </div>
      ))}
      {!list.length && <div className="fs-empty">No courses linked yet. ForeSome support links your courses.</div>}
    </>
  );
}
