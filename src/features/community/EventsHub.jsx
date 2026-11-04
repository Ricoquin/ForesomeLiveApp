import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, STATUS_LABELS, when, friendly, courseById } from './api';

// Golfer's events home: what's coming up, what I'm signed up for, and alerts.
export default function EventsHub({ session, active, onOpen, onCreate, onCommunities }) {
  const me = session.user.id;
  const [tab, setTab] = useState('upcoming');
  const [events, setEvents] = useState([]);
  const [mine, setMine] = useState([]);
  const [communities, setCommunities] = useState({});
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = async () => {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data, error } = await supabase.from('events').select('*')
      .in('status', ['published', 'live']).gte('starts_at', since).order('starts_at').limit(60);
    if (error) { setErr(friendly(error)); return; }
    setErr(''); setEvents(data || []);
    const { data: regs } = await supabase.from('registrations').select('*, events(*)')
      .eq('profile_id', me).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(50);
    setMine((regs || []).filter(r => r.events));
    const ids = [...new Set([...(data || []), ...(regs || []).map(r => r.events)].map(e => e?.community_id).filter(Boolean))];
    if (ids.length) {
      const { data: cs } = await supabase.from('communities').select('id, name').in('id', ids);
      setCommunities(Object.fromEntries((cs || []).map(c => [c.id, c.name])));
    }
    const { data: n } = await supabase.from('notification_outbox').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(10);
    setNotes(n || []);
  };
  useEffect(() => { if (active) load(); }, [active]);

  // New notifications (e.g. "you're off the waitlist") arrive live.
  useEffect(() => {
    const ch = supabase.channel(`notes-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_outbox', filter: `profile_id=eq.${me}` },
        (p) => setNotes(n => [p.new, ...n]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me]);

  const dismiss = async (n) => {
    setNotes(list => list.filter(x => x.id !== n.id));
    await supabase.from('notification_outbox').update({ read_at: new Date().toISOString() }).eq('id', n.id);
  };

  const card = (ev, extra) => {
    const course = courseById(ev.course_id);
    return (
      <button key={ev.id + (extra?.key || '')} className="fs-card fs-card-btn" onClick={() => onOpen(ev.id)}>
        <div className="fs-card-row">
          <span className="fs-card-title">{ev.name}</span>
          {ev.status === 'live' ? <span className="fs-pill live">Live</span> : extra?.pill}
        </div>
        <div className="fs-card-meta">{when(ev.starts_at)} · {course?.name || 'Course'}</div>
        <div className="fs-card-meta">{FORMAT_LABELS[ev.format]}{ev.community_id && communities[ev.community_id] ? ` · ${communities[ev.community_id]}` : ''}</div>
      </button>
    );
  };

  const list = events.filter(e => {
    const s = q.toLowerCase();
    return !s || e.name.toLowerCase().includes(s) || (courseById(e.course_id)?.name || '').toLowerCase().includes(s)
      || (courseById(e.course_id)?.city || '').toLowerCase().includes(s);
  });

  return (
    <div className="fs-page">
      <h1 className="fs-h1">Events</h1>
      <p className="fs-sub">Leagues, outings and tournaments at KC courses.</p>
      {notes.map(n => (
        <div key={n.id} className="cm-alert">
          <div>
            <b>{n.kind === 'waitlist_promoted' ? "You're off the waitlist!" : 'Update'}</b>
            <div>{n.kind === 'waitlist_promoted' ? `A spot opened in ${n.payload?.event_name}. You're confirmed.` : n.payload?.message || ''}</div>
          </div>
          <div className="cm-alert-actions">
            {n.payload?.event_id && <button className="fs-small-btn" onClick={() => { dismiss(n); onOpen(n.payload.event_id); }}>View</button>}
            <button className="fs-x" aria-label="Dismiss" onClick={() => dismiss(n)}>✕</button>
          </div>
        </div>
      ))}
      <div className="cm-actions">
        <button className="fs-small-btn" onClick={onCreate}>+ Host an event</button>
        <button className="fs-small-btn ghost" onClick={onCommunities}>Communities</button>
      </div>
      <div className="fs-seg">
        <button className={tab === 'upcoming' ? 'on' : ''} onClick={() => setTab('upcoming')}>Upcoming</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My events{mine.length ? ` (${mine.length})` : ''}</button>
      </div>
      {err && <div className="fs-error">{err}</div>}
      {tab === 'upcoming' && (
        <>
          <input className="fs-input" placeholder="Search by event, course or city…" value={q} onChange={e => setQ(e.target.value)} />
          {list.length === 0 && !err && <div className="fs-empty">No upcoming events yet.</div>}
          {list.map(ev => card(ev))}
        </>
      )}
      {tab === 'mine' && (
        <>
          {mine.length === 0 && <div className="fs-empty">You haven't signed up for anything yet.</div>}
          {mine.map(r => card(r.events, { key: r.id, pill: <span className="fs-pill">{STATUS_LABELS[r.status]}{r.status === 'waitlisted' ? ` #${r.waitlist_position}` : ''}</span> }))}
        </>
      )}
    </div>
  );
}
