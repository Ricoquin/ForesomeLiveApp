import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMATS, computeResults, scoreRows, validateSetup, fmtPar } from './scoring';
import HoleMapView from '../gps/HoleMapView.jsx';
import '../features.css';

const TEAM_KEYS = ['A', 'B', 'C', 'D'];
const uid = () => Math.random().toString(36).slice(2, 9);

export default function GameScreen({ session, profile, friends = [], groups = [], courses = [], getCourseData, onBack, active }) {
  const [view, setView] = useState('list');           // list | setup | play
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [game, setGame] = useState(null);
  const [error, setError] = useState('');

  const loadGames = async () => {
    if (!session?.user?.id) return;
    setLoading(true);
    const { data, error } = await supabase.from('games').select('*').order('updated_at', { ascending: false }).limit(30);
    if (error) setError(friendlyError(error)); else setGames(data || []);
    setLoading(false);
  };
  useEffect(() => { if (active) loadGames(); }, [active, session?.user?.id]);

  if (view === 'setup') {
    return <GameSetup {...{ session, profile, friends, groups, courses, getCourseData }}
      onCancel={() => setView('list')}
      onCreated={(g) => { setGame(g); setView('play'); }} />;
  }
  if (view === 'play' && game) {
    return <GamePlay session={session} initial={game} onBack={() => { setView('list'); loadGames(); }} />;
  }

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← BACK</button>
      </div>
      <h1 className="fs-h1">Games</h1>
      <p className="fs-sub">Best Ball, Scramble, Skins and more. ForeSome keeps the math.</p>
      <button className="fs-cta" onClick={() => setView('setup')}>+ Start a game</button>
      {error && <div className="fs-error">{error}</div>}
      <div className="fs-section-title">Your games</div>
      {loading && <div className="fs-empty">Loading…</div>}
      {!loading && games.length === 0 && <div className="fs-empty">No games yet. Start one before your next round.</div>}
      {games.map(g => {
        const r = safeResults(g);
        return (
          <button key={g.id} className="fs-card fs-card-btn" onClick={() => { setGame(g); setView('play'); }}>
            <div className="fs-card-row">
              <span className="fs-card-title">{FORMATS[g.format]?.label}</span>
              <span className={`fs-pill ${g.status === 'final' ? '' : 'live'}`}>{g.status === 'final' ? 'Final' : 'Live'}</span>
            </div>
            <div className="fs-card-meta">{g.course_name || 'Course not set'} · {g.players.length} players · {new Date(g.created_at).toLocaleDateString()}</div>
            <div className="fs-card-headline">{r.headline}</div>
          </button>
        );
      })}
    </div>
  );
}

function safeResults(g) {
  try { return computeResults(g); } catch { return { headline: '', standings: [] }; }
}

function friendlyError(e) {
  if (/relation .*games.* does not exist|Could not find the table/i.test(e?.message || '')) {
    return 'Games need a one-time database update. Run supabase/2026-11-golfer-features.sql in Supabase.';
  }
  return e?.message || 'Something went wrong.';
}

// ───────────────────────── Setup ─────────────────────────
function GameSetup({ session, profile, friends, groups, courses, getCourseData, onCancel, onCreated }) {
  const me = { id: uid(), user_id: session.user.id, name: profile?.username || 'You', handicap: profile?.handicap ?? 0, team: '' };
  const [format, setFormat] = useState('skins');
  const [players, setPlayers] = useState([me]);
  const [courseQuery, setCourseQuery] = useState('');
  const [course, setCourse] = useState(null);
  const [useHandicaps, setUseHandicaps] = useState(true);
  const [allowance, setAllowance] = useState(100);
  const [holes, setHoles] = useState('18');
  const [skinValue, setSkinValue] = useState('');
  const [carryover, setCarryover] = useState(true);
  const [nassauStake, setNassauStake] = useState('');
  const [groupId, setGroupId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestHcp, setGuestHcp] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const f = FORMATS[format];
  const teamMode = f.teams === true || (f.teams === 'optional' && players.length > 2);
  const accepted = friends.filter(fr => fr.status === 'accepted' && fr.profile && !players.some(p => p.user_id === fr.profile.id));
  const courseMatches = courseQuery.length > 1 ? courses.filter(c => c.name.toLowerCase().includes(courseQuery.toLowerCase())).slice(0, 6) : [];

  // Auto-assign teams A/B alternating when a team format is picked.
  useEffect(() => {
    if (teamMode) setPlayers(ps => ps.map((p, i) => ({ ...p, team: p.team || TEAM_KEYS[i % 2] })));
    else setPlayers(ps => ps.map(p => ({ ...p, team: '' })));
  }, [teamMode]);
  useEffect(() => { if (format === 'nassau') setHoles('18'); }, [format]);

  const addFriend = (fr) => setPlayers(ps => [...ps, { id: uid(), user_id: fr.profile.id, name: fr.profile.username, handicap: fr.profile.handicap ?? 0, team: teamMode ? TEAM_KEYS[ps.length % 2] : '' }]);
  const addGuest = () => {
    if (!guestName.trim()) return;
    setPlayers(ps => [...ps, { id: uid(), name: guestName.trim(), handicap: Number(guestHcp) || 0, team: teamMode ? TEAM_KEYS[ps.length % 2] : '' }]);
    setGuestName(''); setGuestHcp('');
  };
  const update = (id, patch) => setPlayers(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
  const remove = (id) => setPlayers(ps => ps.filter(p => p.id !== id));

  const start = async () => {
    const problem = validateSetup(format, players) || (!course && 'Pick the course you are playing.');
    if (problem) { setError(problem); return; }
    setSaving(true); setError('');
    const cd = getCourseData(course);
    const settings = {
      pars: cd.pars, strokeIndex: cd.hcps,
      holes: holes === '18' ? 18 : 9, startHole: holes === 'back' ? 10 : 1,
      useHandicaps, allowance: Number(allowance),
      skinValue: Number(skinValue) || 0, carryover, nassauStake: Number(nassauStake) || 0,
    };
    const row = {
      created_by: session.user.id,
      group_id: groupId || null,
      course_name: course.name,
      format,
      settings,
      players: players.map(({ id, user_id, name, handicap, team }) => ({ id, user_id: user_id || null, name, handicap: Number(handicap) || 0, team: team || null })),
      scores: {},
      participant_ids: [...new Set(players.map(p => p.user_id).filter(Boolean))],
    };
    const { data, error } = await supabase.from('games').insert([row]).select().single();
    setSaving(false);
    if (error) { setError(friendlyError(error)); return; }
    onCreated(data);
  };

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onCancel}>← GAMES</button></div>
      <h1 className="fs-h1">New game</h1>

      <div className="fs-section-title">Format</div>
      <div className="fs-format-grid">
        {Object.entries(FORMATS).map(([key, v]) => (
          <button key={key} className={`fs-format ${format === key ? 'on' : ''}`} onClick={() => setFormat(key)}>
            <span className="fs-format-name">{v.label}</span>
            <span className="fs-format-blurb">{v.blurb}</span>
          </button>
        ))}
      </div>

      <div className="fs-section-title">Course</div>
      {course ? (
        <div className="fs-card fs-card-row">
          <span className="fs-card-title">{course.name}</span>
          <button className="fs-link" onClick={() => setCourse(null)}>Change</button>
        </div>
      ) : (
        <>
          <input className="fs-input" placeholder="Search courses…" value={courseQuery} onChange={e => setCourseQuery(e.target.value)} />
          {courseMatches.map(c => (
            <button key={c.id} className="fs-list-btn" onClick={() => { setCourse(c); setCourseQuery(''); }}>{c.name}</button>
          ))}
        </>
      )}
      <div className="fs-seg" role="group" aria-label="Holes">
        {[['18', '18 holes'], ['front', 'Front 9'], ['back', 'Back 9']].map(([k, l]) => (
          <button key={k} disabled={format === 'nassau' && k !== '18'} className={holes === k ? 'on' : ''} onClick={() => setHoles(k)}>{l}</button>
        ))}
      </div>

      <div className="fs-section-title">Players {teamMode && <span className="fs-hint">· tap a letter to set teams</span>}</div>
      {players.map(p => (
        <div key={p.id} className="fs-player">
          <div className="player-dot filled">{initials(p.name)}</div>
          <input className="fs-input fs-input-name" value={p.name} onChange={e => update(p.id, { name: e.target.value })} disabled={!!p.user_id} aria-label="Player name" />
          <label className="fs-hcp">HCP
            <input type="number" inputMode="numeric" className="fs-input fs-input-hcp" value={p.handicap} onChange={e => update(p.id, { handicap: e.target.value })} />
          </label>
          {p.user_id !== session.user.id && <button className="fs-x" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}>✕</button>}
          {teamMode && (
            <div className="fs-teams"><span className="fs-teams-label">Team</span>
              {TEAM_KEYS.slice(0, format === 'match' || format === 'nassau' ? 2 : 4).map(t => (
                <button key={t} className={p.team === t ? 'on' : ''} onClick={() => update(p.id, { team: t })}>{t}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      {accepted.length > 0 && (
        <div className="fs-chips">
          {accepted.map(fr => <button key={fr.id} className="fs-chip" onClick={() => addFriend(fr)}>+ {fr.profile.username}</button>)}
        </div>
      )}
      <div className="fs-guest">
        <input className="fs-input" placeholder="Guest name" value={guestName} onChange={e => setGuestName(e.target.value)} />
        <input className="fs-input fs-input-hcp" type="number" inputMode="numeric" placeholder="HCP" value={guestHcp} aria-label="Guest handicap" onChange={e => setGuestHcp(e.target.value)} />
        <button className="fs-small-btn" onClick={addGuest}>Add</button>
      </div>

      <div className="fs-section-title">Options</div>
      <label className="fs-toggle"><input type="checkbox" checked={useHandicaps} onChange={e => setUseHandicaps(e.target.checked)} /> Use handicaps</label>
      {useHandicaps && (
        <label className="fs-field">Handicap allowance
          <select className="fs-input" value={allowance} onChange={e => setAllowance(e.target.value)}>
            {[100, 95, 90, 85, 80, 75].map(a => <option key={a} value={a}>{a}%</option>)}
          </select>
        </label>
      )}
      {format === 'skins' && (
        <>
          <label className="fs-field">Value per skin ($, optional)
            <input className="fs-input" type="number" inputMode="decimal" value={skinValue} onChange={e => setSkinValue(e.target.value)} />
          </label>
          <label className="fs-toggle"><input type="checkbox" checked={carryover} onChange={e => setCarryover(e.target.checked)} /> Ties carry over</label>
        </>
      )}
      {format === 'nassau' && (
        <label className="fs-field">Bet per match ($, optional)
          <input className="fs-input" type="number" inputMode="decimal" value={nassauStake} onChange={e => setNassauStake(e.target.value)} />
        </label>
      )}
      {groups.length > 0 && (
        <label className="fs-field">Share with a group (optional)
          <select className="fs-input" value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">Just the players</option>
            {groups.filter(g => g.myStatus === 'active').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      )}

      {error && <div className="fs-error">{error}</div>}
      <button className="fs-cta" disabled={saving} onClick={start}>{saving ? 'Starting…' : 'Start game'}</button>
    </div>
  );
}

const initials = (n = '') => n.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

// ───────────────────────── Live scoring ─────────────────────────
function GamePlay({ session, initial, onBack }) {
  const [game, setGame] = useState(initial);
  const first = initial.settings?.startHole === 10 ? 9 : 0;
  const count = initial.settings?.holes || 18;
  const firstOpen = useMemo(() => {
    const rows = scoreRows(initial);
    for (let h = first; h < first + count; h++) if (rows.some(r => initial.scores?.[r.id]?.[h] == null)) return h;
    return first + count - 1;
  }, []);
  const [hole, setHole] = useState(firstOpen);
  const [saveState, setSaveState] = useState('');
  const dirty = useRef({});        // { rowId: { holeIdx: value } } not yet saved
  const timer = useRef(null);
  const canEdit = game.created_by === session.user.id || (game.participant_ids || []).includes(session.user.id);
  const pars = game.settings?.pars || [];
  const rows = scoreRows(game);
  const results = useMemo(() => computeResults(game), [game]);

  // Live updates from other players.
  useEffect(() => {
    const ch = supabase.channel(`game-${game.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${game.id}` },
        (payload) => setGame(g => ({ ...payload.new, scores: mergeScores(payload.new.scores, dirty.current) })))
      .subscribe();
    return () => { supabase.removeChannel(ch); clearTimeout(timer.current); };
  }, [game.id]);

  const setScore = (rowId, value) => {
    if (!canEdit || game.status === 'final') return;
    dirty.current = { ...dirty.current, [rowId]: { ...(dirty.current[rowId] || {}), [hole]: value } };
    setGame(g => ({ ...g, scores: mergeScores(g.scores, { [rowId]: { [hole]: value } }) }));
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  };

  // Save only the cells this phone changed, on top of the latest saved scores.
  const save = async (extra = {}) => {
    setSaveState('Saving…');
    const changes = dirty.current; dirty.current = {};
    const { data: latest, error: readErr } = await supabase.from('games').select('scores').eq('id', game.id).single();
    if (readErr) { dirty.current = mergeDirty(changes, dirty.current); setSaveState('Offline — will retry'); timer.current = setTimeout(save, 4000); return; }
    const scores = mergeScores(latest.scores, changes);
    const { error } = await supabase.from('games').update({ scores, ...extra }).eq('id', game.id);
    if (error) { dirty.current = mergeDirty(changes, dirty.current); setSaveState('Not saved — retrying'); timer.current = setTimeout(save, 4000); }
    else setSaveState('Saved');
  };

  const finish = async () => {
    if (!confirm('Finish this game? Scores will be locked.')) return;
    clearTimeout(timer.current);
    await save({ status: 'final' });
    setGame(g => ({ ...g, status: 'final' }));
  };

  const holeIdxs = Array.from({ length: count }, (_, i) => first + i);
  const holebarRef = useRef(null);
  useEffect(() => {
    holebarRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [hole]);
  const locked = !canEdit || game.status === 'final';
  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← GAMES</button>
        <span className="fs-save">{saveState}</span>
      </div>
      <div className="fs-eyebrow">{FORMATS[game.format]?.label} · {game.course_name}</div>
      <div className="fs-result-card">
        <div className="fs-result-head">{results.headline}</div>
        {results.standings.map((s, i) => (
          <div key={s.id} className="fs-standing">
            <span className="fs-rank">{i + 1}</span>
            <span className="fs-standing-name">{s.name}</span>
            <span className="fs-standing-val">{s.value}</span>
            {s.detail && <span className="fs-standing-detail">{s.detail}</span>}
          </div>
        ))}
        {results.extra && <div className="fs-result-extra"><b>{results.extra.label}:</b> {results.extra.status}</div>}
      </div>

      <div style={{ margin: '10px 0 14px' }}>
        <HoleMapView
          courseName={game.course_name || 'Course'}
          currentHole={hole + 1}
          onSelectHole={(hNum) => setHole(hNum - 1)}
          par={pars[hole] || 4}
          yards={(pars[hole] === 3 ? 175 : pars[hole] === 5 ? 525 : 385)}
          hcp={game.settings?.strokeIndex?.[hole] || (hole + 1)}
          compact
        />
      </div>

      {rows.map(r => {
        const v = game.scores?.[r.id]?.[hole];
        const strokes = r.strokes ? r.strokes(hole) : 0;
        const par = pars[hole] || 4;
        return (
          <div key={r.id} className="fs-score-row">
            <div className="fs-score-name">{r.name}{strokes > 0 && <span className="fs-dots" title={`Gets ${strokes} stroke${strokes > 1 ? 's' : ''}`}>{'•'.repeat(strokes)}</span>}</div>
            <div className="fs-stepper">
              <button disabled={locked} aria-label={`One less for ${r.name}`} onClick={() => setScore(r.id, Math.max(1, (v ?? par) - 1))}>−</button>
              <button disabled={locked} className={`fs-score-val ${v == null ? 'empty' : diffClass(v - par)}`} onClick={() => v == null && setScore(r.id, par)}>{v ?? (locked ? '—' : 'Tap')}</button>
              <button disabled={locked} aria-label={`One more for ${r.name}`} onClick={() => setScore(r.id, Math.min(15, (v ?? par) + 1))}>+</button>
            </div>
          </div>
        );
      })}
      <div className="fs-nav-row">
        <button className="fs-small-btn" disabled={hole === first} onClick={() => setHole(h => h - 1)}>← Prev</button>
        <button className="fs-small-btn" disabled={hole === first + count - 1} onClick={() => setHole(h => h + 1)}>Next →</button>
      </div>

      {results.holes && (
        <>
          <div className="fs-section-title">Skins by hole</div>
          <div className="fs-skins-log">{results.holes.map(l => <div key={l.hole}><b>{l.hole}</b> {l.text}</div>)}</div>
        </>
      )}

      {game.status === 'final' && <div className="fs-empty">Final scores — this game is locked.</div>}
      {!canEdit && <div className="fs-empty">You can watch this game. Only players can enter scores.</div>}
      {game.status !== 'final' && game.created_by === session.user.id && (
        <button className="fs-cta secondary" onClick={finish}>Finish game</button>
      )}
    </div>
  );
}

function diffClass(d) { return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double'; }

function mergeScores(base = {}, changes = {}) {
  const out = { ...(base || {}) };
  Object.entries(changes).forEach(([rowId, cells]) => {
    const arr = [...(out[rowId] || Array(18).fill(null))];
    while (arr.length < 18) arr.push(null);
    Object.entries(cells).forEach(([h, v]) => { arr[Number(h)] = v; });
    out[rowId] = arr;
  });
  return out;
}
function mergeDirty(a, b) {
  const out = { ...a };
  Object.entries(b).forEach(([k, cells]) => { out[k] = { ...(out[k] || {}), ...cells }; });
  return out;
}

export { fmtPar };
