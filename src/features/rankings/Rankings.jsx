import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import '../features.css';

const METRICS = [
  ['score', 'Low round', (v) => v],
  ['putts', 'Fewest putts', (v) => `${v} putts`],
  ['gir', 'Most GIR', (v) => `${v} greens`],
  ['fir', 'Most FIR', (v) => `${v} fairways`],
];

export default function Rankings({ session, active, onBack, initialCourse }) {
  const [mine, setMine] = useState([]);
  const [course, setCourse] = useState(initialCourse || null);
  const [metric, setMetric] = useState('score');
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active || !session?.user?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('my_course_ranks');
      if (error) setError(friendly(error)); else { setMine(data || []); setError(''); }
      setLoading(false);
    })();
  }, [active, session?.user?.id]);

  useEffect(() => {
    if (!course) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('course_leaderboard', { p_course: course, p_metric: metric, p_limit: 50 });
      if (error) setError(friendly(error)); else { setBoard(data || []); setError(''); }
      setLoading(false);
    })();
  }, [course, metric]);

  const fmt = METRICS.find(m => m[0] === metric)[2];

  if (course) {
    return (
      <div className="fs-page">
        <div className="fs-topbar"><button className="back-btn" onClick={() => setCourse(null)}>← MY RANKS</button></div>
        <div className="fs-eyebrow">Leaderboard</div>
        <h1 className="fs-h1">{course}</h1>
        <div className="fs-seg wrap">
          {METRICS.map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}
        </div>
        {error && <div className="fs-error">{error}</div>}
        {loading && <div className="fs-empty">Loading…</div>}
        {!loading && board.length === 0 && <div className="fs-empty">No full rounds logged here yet.</div>}
        {board.map(r => (
          <div key={r.user_id} className={`fs-board-row ${r.user_id === session.user.id ? 'me' : ''}`}>
            <span className="fs-rank">{r.rank}</span>
            <div className="player-dot filled">{r.initials || '?'}</div>
            <div className="fs-board-who">
              <div className="fs-board-name">{r.username}{r.user_id === session.user.id ? ' (you)' : ''}</div>
              <div className="fs-board-meta">HCP {r.handicap ?? '—'} · {r.rounds_played} round{r.rounds_played === 1 ? '' : 's'} · avg {r.avg_score ?? '—'}</div>
            </div>
            <span className="fs-board-val">{fmt(r.best_value)}</span>
          </div>
        ))}
        <p className="fs-footnote">Full 18-hole rounds logged in ForeSome. Players can hide themselves from rankings in their profile.</p>
      </div>
    );
  }

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div>
      <h1 className="fs-h1">Rankings</h1>
      <p className="fs-sub">Where you stand against other ForeSome golfers at every course you've played.</p>
      {error && <div className="fs-error">{error}</div>}
      {loading && <div className="fs-empty">Loading…</div>}
      {!loading && !error && mine.length === 0 && <div className="fs-empty">Log a full 18-hole round to get ranked.</div>}
      {mine.map(m => (
        <button key={m.course_name} className="fs-card fs-card-btn" onClick={() => setCourse(m.course_name)}>
          <div className="fs-card-row">
            <span className="fs-card-title">{m.course_name}</span>
            <span className="fs-rank-big">#{m.rank}<small> of {m.field_size}</small></span>
          </div>
          <div className="fs-card-meta">Best {m.best_score} · {m.rounds_played} round{m.rounds_played === 1 ? '' : 's'} · tap for leaderboard</div>
        </button>
      ))}
    </div>
  );
}

function friendly(e) {
  if (/function .* does not exist|Could not find the function/i.test(e?.message || '')) {
    return 'Rankings need a one-time database update. Run supabase/2026-11-golfer-features.sql in Supabase.';
  }
  return e?.message || 'Could not load rankings.';
}
