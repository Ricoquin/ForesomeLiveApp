import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useLeaderboard } from './Leaderboard';
import { fmtPar } from './api';
import './community.css';

// Full-screen leaderboard for the pro shop TV: /tv/:eventId. No sign-in needed for public events.
export default function TvMode({ eventId }) {
  const [info, setInfo] = useState(null);
  const { rows, error } = useLeaderboard(eventId);
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { supabase.rpc('public_event', { p_event_id: eventId }).then(({ data }) => setInfo(data)); }, [eventId]);

  // Auto-cycle flights / pages of 12 every 12 seconds
  const flights = [...new Set(rows.map(r => r.flight || ''))];
  const pages = flights.flatMap(f => {
    const list = rows.filter(r => (r.flight || '') === f);
    return Array.from({ length: Math.max(1, Math.ceil(list.length / 12)) }, (_, i) => ({ flight: f, list: list.slice(i * 12, i * 12 + 12) }));
  });
  useEffect(() => { const t = setInterval(() => { setPage(p => p + 1); setClock(new Date()); }, 12000); return () => clearInterval(t); }, []);
  const cur = pages.length ? pages[page % pages.length] : { flight: '', list: [] };

  return (
    <div className="tv">
      <header className="tv-head">
        <div>
          <div className="tv-eyebrow">{info?.community?.name || 'ForeSome'} · {info?.course?.name}</div>
          <h1 className="tv-title">{info?.event?.name || 'Leaderboard'}</h1>
        </div>
        <div className="tv-right">
          {info?.event?.status === 'live' && <span className="tv-live">● LIVE</span>}
          <div className="tv-clock">{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
      </header>
      {cur.flight && <div className="tv-flight">Flight {cur.flight}</div>}
      {error ? <div className="tv-empty">{error}</div> : !rows.length ? <div className="tv-empty">Scores will appear here as players post them.</div> : (
        <div className="tv-table">
          <div className="tv-row tv-th"><span>Pos</span><span>Player</span><span>Thru</span><span>Total</span><span>To par</span></div>
          {cur.list.map(r => (
            <div key={r.registration_id} className="tv-row">
              <span className="tv-pos">{r.thru ? r.place : '–'}</span>
              <span className="tv-name">{r.username}{r.team_name ? <small> · {r.team_name}</small> : null}</span>
              <span>{r.is_final ? 'F' : r.thru || '–'}</span>
              <span>{r.gross ?? '–'}</span>
              <span className={`tv-par ${r.to_par < 0 ? 'under' : ''}`}>{r.thru ? fmtPar(r.to_par) : '–'}</span>
            </div>
          ))}
        </div>
      )}
      <footer className="tv-foot">foresomekc.com · Live scoring by ForeSome{pages.length > 1 ? ` · ${(page % pages.length) + 1}/${pages.length}` : ''}</footer>
    </div>
  );
}
