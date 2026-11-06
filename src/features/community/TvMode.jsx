import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useLeaderboard } from './Leaderboard';
import { fmtPar, money } from './api';
import './community.css';

// Full-screen leaderboard for the pro shop TV: /tv/:eventId. No sign-in needed for public events.
// Automatically displays Sponsor Logos, Hole Signs, and Shout-Outs!
export default function TvMode({ eventId }) {
  const [info, setInfo] = useState(null);
  const { rows, error } = useLeaderboard(eventId);
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(new Date());

  const loadInfo = () => {
    supabase.rpc('public_event', { p_event_id: eventId }).then(({ data }) => setInfo(data));
  };
  useEffect(() => { loadInfo(); }, [eventId]);

  // Auto-cycle flights / pages of 12 every 12 seconds
  const flights = [...new Set(rows.map(r => r.flight || ''))];
  const pages = flights.flatMap(f => {
    const list = rows.filter(r => (r.flight || '') === f);
    return Array.from({ length: Math.max(1, Math.ceil(list.length / 12)) }, (_, i) => ({ flight: f, list: list.slice(i * 12, i * 12 + 12) }));
  });
  useEffect(() => {
    const t = setInterval(() => {
      setPage(p => p + 1);
      setClock(new Date());
      loadInfo();
    }, 12000);
    return () => clearInterval(t);
  }, [eventId]);

  const cur = pages.length ? pages[page % pages.length] : { flight: '', list: [] };
  const sponsors = (info?.sponsors || []).filter(s => !s.benefits || s.benefits.includes('tv_logo') || s.benefits.includes('shout_out'));
  const activeSponsor = sponsors.length ? sponsors[page % sponsors.length] : null;
  const raised = info?.donations_raised_cents || 0;
  const goal = info?.event?.fundraising_goal_cents || 0;

  return (
    <div className="tv">
      <header className="tv-head">
        <div>
          <div className="tv-eyebrow">{info?.community?.name || 'ForeSome'} · {info?.course?.name}</div>
          <h1 className="tv-title">{info?.event?.name || 'Leaderboard'}</h1>
        </div>
        <div className="tv-right" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {goal > 0 && (
            <div style={{ textAlign: 'right', background: 'rgba(212,184,122,0.12)', padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(212,184,122,0.3)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#d4b87a' }}>
                {info?.event?.donation_title || 'Charity Goal'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#f1ead9' }}>
                {money(raised)} <span style={{ fontSize: 12, opacity: 0.7 }}>/ {money(goal)}</span>
              </div>
            </div>
          )}
          <div>
            {info?.event?.status === 'live' && <span className="tv-live">● LIVE</span>}
            <div className="tv-clock">{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
          </div>
        </div>
      </header>

      {/* Sponsor Banner on TV Leaderboard */}
      {sponsors.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.28)',
          borderRadius: 12, padding: '10px 18px', marginBottom: 14
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#d4b87a', fontWeight: 700 }}>
              Presented By
            </span>
            {sponsors.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.25)' }}>
                {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ height: 28, width: 'auto', objectFit: 'contain' }} />}
                <span style={{ fontWeight: 700, fontSize: 14, color: '#f1ead9' }}>{s.sponsor_name}</span>
                {s.hole_number && <span style={{ fontSize: 11, color: '#d4b87a' }}>· Hole {s.hole_number}</span>}
              </div>
            ))}
          </div>
          {activeSponsor?.shout_out_text && (
            <div style={{ fontSize: 13, color: '#c9bf9f', fontStyle: 'italic' }}>
              📣 "{activeSponsor.shout_out_text}" — <b>{activeSponsor.sponsor_name}</b>
            </div>
          )}
        </div>
      )}

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
