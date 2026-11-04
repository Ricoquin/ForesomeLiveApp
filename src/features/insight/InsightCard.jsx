import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';

// Real AI insight from the player-insight Edge Function (Claude), cached per new round.
// If the function isn't deployed yet, falls back to a plain observation computed from the
// player's own rounds — never a made-up number.
export default function InsightCard({ session, rounds = [] }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const latest = rounds[0]?.created_at || null;

  useEffect(() => {
    if (!session?.user?.id) return;
    if (rounds.length === 0) { setText(''); setSource(''); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.functions.invoke('player-insight', { body: {} });
      if (cancelled) return;
      if (!error && data?.insight) { setText(data.insight); setSource('ai'); }
      else { setText(localInsight(rounds)); setSource('local'); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id, latest, rounds.length]);

  return (
    <div className="insight-card">
      <div className="insight-eyebrow">▸ FORESOME INSIGHT{source === 'ai' ? ' · AI' : ''}</div>
      <div className="insight-text" style={{ whiteSpace: 'pre-line' }}>
        {rounds.length === 0 ? 'Log a round and ForeSome will tell you what is costing you strokes.'
          : loading && !text ? 'Reading your last rounds…' : text}
      </div>
    </div>
  );
}

function localInsight(rounds) {
  const full = rounds.filter(r => r.completed_holes === 18 && r.summary);
  if (full.length === 0) return 'Finish an 18-hole round to unlock insight.';
  const avg = (k) => full.reduce((s, r) => s + (Number(r.summary[k]) || 0), 0) / full.length;
  const putts = avg('putts'), gir = avg('gir'), fir = avg('fir'), score = avg('score');
  const n = full.length;
  const lines = [`Across your last ${n} round${n > 1 ? 's' : ''} you average ${score.toFixed(1)}.`];
  if (putts >= 34) lines.push(`Putting is the quickest win: ${putts.toFixed(1)} putts a round. Two fewer three-putts saves two strokes.`);
  else if (gir < 6) lines.push(`You hit ${gir.toFixed(1)} greens a round. Better approach shots would take pressure off your short game.`);
  else if (fir < 6) lines.push(`You find ${fir.toFixed(1)} fairways a round. More fairways usually means more greens.`);
  else lines.push(`Solid ball striking: ${gir.toFixed(1)} greens and ${fir.toFixed(1)} fairways a round.`);
  return lines.join(' ');
}
