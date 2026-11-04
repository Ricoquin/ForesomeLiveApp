import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { friendly, fmtPar } from './api';

const blankCard = () => Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, score: null, putts: null, fir: false, gir: false }));

// Hole-by-hole scoring for an event. A player scores themselves; the group's
// scorer (set in pairings) can also enter scores for everyone in the group.
export default function EventScorecard({ session, event, myReg, courseData, onClose }) {
  const me = session.user.id;
  const pars = courseData?.pars || Array(18).fill(4);
  const hcps = courseData?.hcps || [];
  const [players, setPlayers] = useState([]);       // [{registration_id, name, isMe}]
  const [cards, setCards] = useState({});           // regId -> holes[]
  const [hole, setHole] = useState(0);
  const [status, setStatus] = useState('');
  const dirty = useRef(new Set());
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      const list = [{ registration_id: myReg.id, name: 'You', isMe: true }];
      // Am I the scorer for a group? Then add my group.
      const { data: mine } = await supabase.from('pairing_players').select('pairing_id, is_scorer').eq('registration_id', myReg.id).maybeSingle();
      if (mine?.is_scorer) {
        const { data: group } = await supabase.from('pairing_players').select('registration_id').eq('pairing_id', mine.pairing_id);
        const { data: lb } = await supabase.rpc('event_leaderboard', { p_event_id: event.id });
        (group || []).filter(g => g.registration_id !== myReg.id).forEach(g => {
          const row = (lb || []).find(r => r.registration_id === g.registration_id);
          list.push({ registration_id: g.registration_id, name: row?.username || 'Player', isMe: false });
        });
      }
      setPlayers(list);
      const { data: res } = await supabase.from('event_results').select('registration_id, hole_scores, is_final')
        .in('registration_id', list.map(p => p.registration_id));
      const c = {};
      list.forEach(p => {
        const r = (res || []).find(x => x.registration_id === p.registration_id);
        const saved = Array.isArray(r?.hole_scores) && r.hole_scores.length ? r.hole_scores : null;
        c[p.registration_id] = saved ? blankCard().map((h, i) => ({ ...h, ...(saved[i] || {}) })) : blankCard();
      });
      setCards(c);
      const firstOpen = c[myReg.id].findIndex(h => h.score == null);
      setHole(firstOpen === -1 ? 17 : firstOpen);
      if ((res || []).some(r => r.is_final)) setStatus('Final — scores are locked');
    })();
    return () => clearTimeout(timer.current);
  }, [myReg.id, event.id]);

  const strokesOn = (h) => {
    const ph = Math.round(Number(myReg.handicap) || 0);
    if (!ph || !hcps[h]) return 0;
    return Math.floor(ph / 18) + (hcps[h] <= ph % 18 ? 1 : 0);
  };

  const totals = (card, withNet) => {
    const played = card.map((h, i) => ({ ...h, i })).filter(h => h.score != null);
    const gross = played.reduce((s, h) => s + h.score, 0);
    const par = played.reduce((s, h) => s + pars[h.i], 0);
    const net = withNet ? played.reduce((s, h) => s + h.score - strokesOn(h.i), 0) : null;
    return { gross: played.length ? gross : null, net: played.length && withNet ? net : null, toPar: played.length ? gross - par : null, thru: played.length };
  };

  const save = async () => {
    const ids = [...dirty.current]; dirty.current.clear();
    setStatus('Saving…');
    for (const id of ids) {
      const p = players.find(x => x.registration_id === id);
      const card = cardsRef.current[id];
      const t = totals(card, p?.isMe);
      const { error } = await supabase.rpc('save_event_score', {
        p_registration_id: id, p_hole_scores: card, p_gross: t.gross, p_net: t.net, p_to_par: t.toPar, p_thru: t.thru,
      });
      if (error) { setStatus(friendly(error)); dirty.current.add(id); return; }
    }
    setStatus('Saved');
  };
  const cardsRef = useRef(cards); cardsRef.current = cards;

  const update = (regId, patch) => {
    setCards(c => ({ ...c, [regId]: c[regId].map((h, i) => i === hole ? { ...h, ...patch } : h) }));
    dirty.current.add(regId);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  };

  const myTotals = useMemo(() => cards[myReg.id] ? totals(cards[myReg.id], true) : null, [cards]);
  if (!cards[myReg.id]) return <div className="fs-page"><div className="fs-empty">Loading scorecard…</div></div>;
  const par = pars[hole];

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onClose}>← EVENT</button>
        <span className="fs-save">{status}</span>
      </div>
      <div className="fs-eyebrow">{event.name}</div>
      <div className="fs-result-card">
        <div className="fs-card-row">
          <span className="fs-result-head">{fmtPar(myTotals.toPar)}</span>
          <span className="fs-card-meta">Thru {myTotals.thru} · Gross {myTotals.gross ?? '—'}{myTotals.net != null ? ` · Net ${myTotals.net}` : ''}</span>
        </div>
      </div>
      <div className="fs-holebar" role="tablist" aria-label="Hole">
        {pars.map((_, i) => (
          <button key={i} role="tab" aria-selected={i === hole}
            className={`${i === hole ? 'on' : ''} ${cards[myReg.id][i].score != null ? 'done' : ''}`} onClick={() => setHole(i)}>{i + 1}</button>
        ))}
      </div>
      <div className="fs-hole-info">Hole {hole + 1} · Par {par}{hcps[hole] ? ` · SI ${hcps[hole]}` : ''}</div>

      {players.map(p => {
        const h = cards[p.registration_id][hole];
        const v = h.score;
        return (
          <div key={p.registration_id} className="fs-score-row cm-score-row">
            <div className="fs-score-name">{p.name}{p.isMe && strokesOn(hole) > 0 && <span className="fs-dots">{'•'.repeat(strokesOn(hole))}</span>}</div>
            <div className="fs-stepper">
              <button aria-label={`One less for ${p.name}`} onClick={() => update(p.registration_id, { score: Math.max(1, (v ?? par) - 1) })}>−</button>
              <button className={`fs-score-val ${v == null ? 'empty' : ''}`} onClick={() => v == null && update(p.registration_id, { score: par })}>{v ?? 'Tap'}</button>
              <button aria-label={`One more for ${p.name}`} onClick={() => update(p.registration_id, { score: Math.min(15, (v ?? par) + 1) })}>+</button>
            </div>
            {p.isMe && (
              <div className="cm-stats">
                <span className="fs-hcp">Putts</span>
                {[0, 1, 2, 3].map(n => <button key={n} className={`cm-chipbtn ${h.putts === n ? 'on' : ''}`} onClick={() => update(p.registration_id, { putts: n })}>{n}</button>)}
                {par > 3 && <button className={`cm-chipbtn ${h.fir ? 'on' : ''}`} onClick={() => update(p.registration_id, { fir: !h.fir })}>FIR</button>}
                <button className={`cm-chipbtn ${h.gir ? 'on' : ''}`} onClick={() => update(p.registration_id, { gir: !h.gir })}>GIR</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="fs-nav-row">
        <button className="fs-small-btn" disabled={hole === 0} onClick={() => setHole(h => h - 1)}>← Prev</button>
        <button className="fs-small-btn" disabled={hole === 17} onClick={() => setHole(h => h + 1)}>Next →</button>
      </div>
      <p className="fs-footnote">Scores save as you go and update the live leaderboard. When the organizer finalizes the event, your round is added to your history.</p>
    </div>
  );
}
