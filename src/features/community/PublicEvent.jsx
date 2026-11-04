import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, money, when } from './api';
import Leaderboard from './Leaderboard';
import '../features.css';
import './community.css';

// Shareable event page: /e/:eventId. Anyone can look; signing in is needed to register.
export default function PublicEvent({ eventId }) {
  const [info, setInfo] = useState(undefined);
  useEffect(() => { supabase.rpc('public_event', { p_event_id: eventId }).then(({ data }) => setInfo(data || null)); }, [eventId]);
  const goRegister = () => { try { localStorage.setItem('fs_pending_event', eventId); } catch {} window.location.href = `/?event=${eventId}`; };
  if (info === undefined) return <div className="cm-public"><div className="fs-empty">Loading…</div></div>;
  if (!info) return <div className="cm-public"><div className="fs-page"><h1 className="fs-h1">Event not found</h1><p className="fs-sub">It may be private or no longer available.</p><a className="fs-cta" href="/">Open ForeSome</a></div></div>;
  const ev = info.event; const t = info.tickets?.[0];
  return (
    <div className="cm-public">
      <div className="fs-page">
        <div className="fs-eyebrow">ForeSome{info.community ? ` · ${info.community.name}` : ''}</div>
        <h1 className="fs-h1">{ev.name}</h1>
        <div className="fs-card-meta">{when(ev.starts_at)}</div>
        <div className="fs-card-meta">{info.course.name}{info.course.address ? ` · ${info.course.address}` : ''}</div>
        <div className="cm-tags"><span className="fs-pill">{FORMAT_LABELS[ev.format]}</span>{ev.status === 'live' && <span className="fs-pill live">Live</span>}</div>
        {ev.description && <p className="fs-sub" style={{ whiteSpace: 'pre-line' }}>{ev.description}</p>}
        <div className="cm-facts">
          <div><b>{ev.capacity ? `${info.confirmed}/${ev.capacity}` : info.confirmed}</b><span>players</span></div>
          <div><b>{t ? money(t.price_cents) : 'Free'}</b><span>entry, paid at course</span></div>
        </div>
        {['published', 'live'].includes(ev.status) && <button className="fs-cta" onClick={goRegister}>{ev.capacity && info.confirmed >= ev.capacity ? 'Join the waitlist' : 'Sign up'}</button>}
        <p className="fs-footnote">You'll sign in or create a free ForeSome profile, then confirm your spot. Nothing to install.</p>
        {['live', 'completed'].includes(ev.status) && <><div className="fs-section-title">Leaderboard</div><Leaderboard eventId={eventId} /></>}
      </div>
    </div>
  );
}
