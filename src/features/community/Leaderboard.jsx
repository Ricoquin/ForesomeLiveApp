import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { fmtPar, friendly } from './api';

// Live event leaderboard. Updates whenever any score in the event changes.
export function useLeaderboard(eventId) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const t = useRef(null);
  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('event_leaderboard', { p_event_id: eventId });
      if (!alive) return;
      if (error) setError(friendly(error)); else { setRows(data || []); setError(''); }
    };
    load();
    const ch = supabase.channel(`lb-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_results', filter: `event_id=eq.${eventId}` },
        () => { clearTimeout(t.current); t.current = setTimeout(load, 400); })
      .subscribe();
    const poll = setInterval(load, 60000);   // safety net if realtime drops
    return () => { alive = false; clearTimeout(t.current); clearInterval(poll); supabase.removeChannel(ch); };
  }, [eventId]);
  return { rows, error };
}

export default function Leaderboard({ eventId, me, limit }) {
  const { rows, error } = useLeaderboard(eventId);
  const flights = [...new Set(rows.map(r => r.flight || ''))];
  if (error) return <div className="fs-error">{error}</div>;
  if (!rows.length) return <div className="fs-empty">No players yet.</div>;
  return (
    <div className="cm-board">
      {flights.map(f => (
        <div key={f || 'all'}>
          {flights.length > 1 && <div className="fs-section-title">{f ? `Flight ${f}` : 'No flight'}</div>}
          {rows.filter(r => (r.flight || '') === f).slice(0, limit || 999).map(r => (
            <div key={r.registration_id} className={`fs-board-row ${r.profile_id === me ? 'me' : ''}`}>
              <span className="fs-rank">{r.thru ? r.place : '–'}</span>
              <div className="player-dot filled">{r.initials || '?'}</div>
              <div className="fs-board-who">
                <div className="fs-board-name">{r.username}{r.profile_id === me ? ' (you)' : ''}</div>
                <div className="fs-board-meta">
                  {r.team_name ? `${r.team_name} · ` : ''}{r.is_final ? 'Final' : r.thru ? `Thru ${r.thru}` : 'Not started'}{r.gross ? ` · ${r.gross}` : ''}
                </div>
              </div>
              <span className="fs-board-val">{r.thru ? fmtPar(r.to_par) : ''}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
