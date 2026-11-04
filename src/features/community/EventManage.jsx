import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { STATUS_LABELS, money, when, friendly, rpc, appUrl, downloadCsv, courseById } from './api';
import { autoPair, shotgunAssignments, teeTimes } from './pairing';
import Leaderboard from './Leaderboard';
import QrCode from './QrCode';

// Organizer / course staff view of one event.
export default function EventManage({ session, eventId, onBack, onEdit }) {
  const [ev, setEv] = useState(null);
  const [regs, setRegs] = useState([]);
  const [names, setNames] = useState({});
  const [tab, setTab] = useState('players');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');

  const load = async () => {
    const { data: e, error } = await supabase.from('events').select('*').eq('id', eventId).single();
    if (error) { setErr(friendly(error)); return; }
    setEv(e);
    const { data: r } = await supabase.from('registrations').select('*').eq('event_id', eventId).order('created_at');
    setRegs(r || []);
    const ids = [...new Set((r || []).map(x => x.profile_id))];
    if (ids.length) {
      const { data: p } = await supabase.from('profiles').select('id, username, initials, handicap').in('id', ids);
      setNames(Object.fromEntries((p || []).map(x => [x.id, x])));
    }
  };
  useEffect(() => { load(); }, [eventId]);
  useEffect(() => {
    const ch = supabase.channel(`manage-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${eventId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]);

  const act = async (fn, ok) => { setErr(''); try { await fn(); if (ok) setMsg(ok); await load(); } catch (e) { setErr(e.message || friendly(e)); } };
  const setStatus = (status) => act(async () => {
    const { error } = await supabase.from('events').update({ status }).eq('id', eventId); if (error) throw new Error(friendly(error));
  }, status === 'cancelled' ? 'Event cancelled' : status === 'published' ? 'Event is live for sign-ups' : 'Saved');

  if (err && !ev) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div><div className="fs-error">{err}</div></div>;
  if (!ev) return <div className="fs-page"><div className="fs-empty">Loading…</div></div>;

  const active = regs.filter(r => ['confirmed', 'checked_in', 'pending_payment'].includes(r.status));
  const wait = regs.filter(r => r.status === 'waitlisted').sort((a, b) => a.waitlist_position - b.waitlist_position);
  const name = (r) => names[r.profile_id]?.username || 'Player';

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← EVENT</button>
        <button className="fs-link" onClick={() => onEdit(eventId)}>Edit details</button>
      </div>
      <div className="fs-eyebrow">Manage · {ev.status}</div>
      <h1 className="fs-h1">{ev.name}</h1>
      <div className="fs-card-meta">{when(ev.starts_at)} · {courseById(ev.course_id)?.name}{ev.teequest_ref ? ` · TeeQuest #${ev.teequest_ref}` : ''}</div>
      <div className="cm-facts">
        <div><b>{active.length}{ev.capacity ? `/${ev.capacity}` : ''}</b><span>players</span></div>
        <div><b>{regs.filter(r => r.status === 'checked_in').length}</b><span>checked in</span></div>
        <div><b>{wait.length}</b><span>waitlist</span></div>
        <div><b>{money(active.filter(r => r.paid_at_course_at).reduce((s, r) => s + r.amount_due_cents, 0))}</b><span>collected</span></div>
      </div>
      {ev.status === 'draft' && <button className="fs-cta" onClick={() => setStatus('published')}>Publish — open sign-ups</button>}

      <div className="fs-seg wrap">
        {[['players', 'Players'], ['pairings', 'Pairings'], ['codes', 'Codes'], ['results', 'Results'], ['share', 'Share']].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(''); }}>{l}</button>)}
      </div>
      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      {tab === 'players' && (
        <>
          <div className="cm-actions">
            <button className="fs-small-btn ghost" onClick={() => downloadCsv(`${ev.name}-players.csv`, regs.map(r => ({
              player: name(r), status: STATUS_LABELS[r.status], waitlist: r.waitlist_position || '', handicap: r.handicap ?? '',
              flight: r.flight || '', fee: (r.amount_due_cents / 100).toFixed(2), paid: r.paid_at_course_at ? 'yes' : 'no',
              checked_in: r.checked_in_at || '', ...Object.fromEntries(Object.entries(r.answers || {})),
            })))}>Export CSV</button>
          </div>
          {[...active, ...wait].map(r => (
            <div key={r.id} className="fs-card cm-reg">
              <div className="fs-card-row">
                <div>
                  <div className="fs-board-name">{name(r)} <span className="fs-board-meta">HCP {r.handicap ?? '—'}</span></div>
                  <div className="fs-board-meta">{STATUS_LABELS[r.status]}{r.status === 'waitlisted' ? ` #${r.waitlist_position}` : ''}
                    {r.amount_due_cents ? ` · ${money(r.amount_due_cents)} ${r.paid_at_course_at ? 'paid' : 'due'}` : ''}
                    {Object.entries(r.answers || {}).filter(([k, v]) => v && k !== 'waiver').map(([k, v]) => ` · ${v}`).join('')}</div>
                </div>
                <input className="fs-input cm-flight" placeholder="Flight" defaultValue={r.flight || ''} aria-label="Flight"
                  onBlur={e => e.target.value !== (r.flight || '') && act(async () => { await supabase.from('registrations').update({ flight: e.target.value || null }).eq('id', r.id); })} />
              </div>
              <div className="cm-actions">
                {r.status === 'confirmed' && <button className="fs-small-btn" onClick={() => act(() => rpc('check_in', { p_registration_id: r.id }), `${name(r)} checked in`)}>Check in</button>}
                {r.amount_due_cents > 0 && r.status !== 'waitlisted' && (
                  <button className="fs-small-btn ghost" onClick={() => act(() => rpc('mark_paid_at_course', { p_registration_id: r.id, p_paid: !r.paid_at_course_at }))}>
                    {r.paid_at_course_at ? 'Undo paid' : 'Mark paid'}</button>)}
                <button className="fs-small-btn ghost" onClick={() => confirm(`Remove ${name(r)}?`) && act(() => rpc('cancel_registration', { p_registration_id: r.id }), 'Removed')}>Remove</button>
              </div>
            </div>
          ))}
          {!regs.length && <div className="fs-empty">No sign-ups yet. Share the event link.</div>}
        </>
      )}

      {tab === 'pairings' && <Pairings ev={ev} regs={active} names={names} onChanged={setMsg} onError={setErr} />}
      {tab === 'codes' && <Codes ev={ev} onError={setErr} />}

      {tab === 'results' && (
        <>
          <Leaderboard eventId={eventId} />
          {ev.status !== 'completed' ? (
            <button className="fs-cta" onClick={() => confirm('Finalize results? Scores lock, rounds are saved to each player\'s history and season points are awarded.')
              && act(async () => { const n = await rpc('finalize_event', { p_event_id: eventId }); setMsg(`Final. ${n} season point awards.`); })}>Finalize results</button>
          ) : <div className="fs-note">Final. Season points awarded.</div>}
          {ev.status !== 'cancelled' && ev.status !== 'completed' && <button className="fs-cta secondary" onClick={() => confirm('Cancel this event?') && setStatus('cancelled')}>Cancel event</button>}
        </>
      )}

      {tab === 'share' && (
        <>
          <div className="fs-card"><div className="fs-card-title">Sign-up link</div>
            <div className="cm-link">{appUrl(`/e/${eventId}`)}</div>
            <QrCode value={appUrl(`/e/${eventId}`)} label="Print this for the pro shop counter" />
            <button className="fs-small-btn" onClick={() => navigator.clipboard?.writeText(appUrl(`/e/${eventId}`)).then(() => setMsg('Link copied'))}>Copy link</button>
          </div>
          <div className="fs-card"><div className="fs-card-title">Pro shop TV</div>
            <p className="fs-footnote">Open this on any TV browser for a full-screen live leaderboard.</p>
            <div className="cm-link">{appUrl(`/tv/${eventId}`)}</div>
            <a className="fs-small-btn" href={`/tv/${eventId}`} target="_blank" rel="noreferrer">Open TV mode</a>
          </div>
        </>
      )}
    </div>
  );
}

function Pairings({ ev, regs, names, onChanged, onError }) {
  const [groups, setGroups] = useState([]);     // [{id, group_number, starting_hole, tee_time, cart_sign_label, players:[{registration_id,is_scorer}]}]
  const [method, setMethod] = useState('handicap');
  const [busy, setBusy] = useState(false);
  const size = Math.max(ev.team_size === 1 ? 4 : ev.team_size, 2);
  const regById = useMemo(() => Object.fromEntries(regs.map(r => [r.id, r])), [regs]);

  const load = async () => {
    const { data: ps } = await supabase.from('pairings').select('*, pairing_players(registration_id, is_scorer)').eq('event_id', ev.id).order('group_number');
    setGroups((ps || []).map(p => ({ ...p, players: p.pairing_players || [] })));
  };
  useEffect(() => { load(); }, [ev.id]);

  const generate = async () => {
    if (groups.length && !confirm('Replace the current pairings?')) return;
    setBusy(true);
    try {
      await supabase.from('pairings').delete().eq('event_id', ev.id);
      const plan = autoPair(regs.map(r => ({ id: r.id, handicap: r.handicap, team_id: r.team_id })), { method, size: ev.team_size > 1 ? 4 : size });
      const holes = ev.shotgun_start ? shotgunAssignments(plan.length) : null;
      const times = ev.shotgun_start ? null : teeTimes(ev.starts_at, plan.length, ev.tee_interval_minutes || 10);
      const { data: rows, error } = await supabase.from('pairings').insert(plan.map((_, i) => ({
        event_id: ev.id, group_number: i + 1, starting_hole: holes ? holes[i].starting_hole : 1,
        tee_time: times ? times[i] : ev.starts_at, cart_sign_label: holes ? `Hole ${holes[i].label}` : null,
      }))).select();
      if (error) throw error;
      const byNum = Object.fromEntries(rows.map(r => [r.group_number, r.id]));
      const pp = plan.flatMap((g, i) => g.map((rid, j) => ({ pairing_id: byNum[i + 1], registration_id: rid, is_scorer: j === 0 })));
      if (pp.length) { const { error: e2 } = await supabase.from('pairing_players').insert(pp); if (e2) throw e2; }
      onChanged(`${plan.length} groups created. First player in each group keeps score.`);
      await load();
    } catch (e) { onError(friendly(e)); }
    setBusy(false);
  };

  const move = async (regId, toPairing) => {
    await supabase.from('pairing_players').update({ pairing_id: toPairing, is_scorer: false }).eq('registration_id', regId);
    load();
  };
  const scorer = async (pairingId, regId) => {
    await supabase.from('pairing_players').update({ is_scorer: false }).eq('pairing_id', pairingId);
    await supabase.from('pairing_players').update({ is_scorer: true }).eq('registration_id', regId);
    load();
  };
  const unpaired = regs.filter(r => !groups.some(g => g.players.some(p => p.registration_id === r.id)));

  return (
    <>
      <div className="cm-row2">
        <select className="fs-input" value={method} onChange={e => setMethod(e.target.value)} aria-label="Pairing method">
          <option value="handicap">Group by handicap</option>
          <option value="random">Random</option>
          <option value="teams">Keep teams together</option>
        </select>
        <button className="fs-small-btn" disabled={busy || !regs.length} onClick={generate}>{groups.length ? 'Re-pair' : 'Auto-pair'}</button>
      </div>
      {groups.length > 0 && <button className="fs-small-btn ghost" onClick={() => window.print()}>Print cart signs</button>}
      {unpaired.length > 0 && groups.length > 0 && <div className="fs-note">{unpaired.length} new player(s) not in a group yet — move them in below or re-pair.</div>}
      <div className="cm-print">
        {groups.map(g => (
          <div key={g.id} className="fs-card cm-group">
            <div className="fs-card-row">
              <span className="fs-card-title">Group {g.group_number}</span>
              <span className="fs-pill">{ev.shotgun_start || !g.tee_time ? (g.cart_sign_label || `Hole ${g.starting_hole}`) : new Date(g.tee_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            {g.players.map(p => {
              const r = regById[p.registration_id];
              return (
                <div key={p.registration_id} className="cm-group-row">
                  <span>{names[r?.profile_id]?.username || 'Player'} <small>HCP {r?.handicap ?? '—'}</small></span>
                  <span className="cm-noprint">
                    <button className={`cm-chipbtn ${p.is_scorer ? 'on' : ''}`} onClick={() => scorer(g.id, p.registration_id)} title="Keeps score for the group">✎ Scorer</button>
                    <select className="cm-move" value={g.id} onChange={e => move(p.registration_id, e.target.value)} aria-label="Move to group">
                      {groups.map(o => <option key={o.id} value={o.id}>Group {o.group_number}</option>)}
                    </select>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {unpaired.map(r => (
          <div key={r.id} className="cm-group-row cm-noprint">
            <span>{names[r.profile_id]?.username}</span>
            {groups.length > 0 && <select className="cm-move" value="" onChange={e => supabase.from('pairing_players').insert([{ pairing_id: e.target.value, registration_id: r.id }]).then(load)} aria-label="Add to group">
              <option value="">Add to…</option>{groups.map(o => <option key={o.id} value={o.id}>Group {o.group_number}</option>)}
            </select>}
          </div>
        ))}
      </div>
      {!regs.length && <div className="fs-empty">Pairings appear once players sign up.</div>}
    </>
  );
}

function Codes({ ev, onError }) {
  const [codes, setCodes] = useState([]);
  const [f, setF] = useState({ code: '', kind: 'percent', amount: '', max_uses: '', expires_at: '' });
  const load = async () => { const { data } = await supabase.from('discount_codes').select('*').eq('event_id', ev.id); setCodes(data || []); };
  useEffect(() => { load(); }, [ev.id]);
  const add = async () => {
    if (!f.code.trim() || !f.amount) return onError('Enter a code and an amount.');
    const row = { event_id: ev.id, code: f.code.trim().toUpperCase(), max_uses: f.max_uses ? Number(f.max_uses) : null,
      expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : null,
      percent_off: f.kind === 'percent' ? Number(f.amount) : null, amount_off_cents: f.kind === 'amount' ? Math.round(Number(f.amount) * 100) : null };
    const { error } = await supabase.from('discount_codes').insert([row]);
    if (error) return onError(friendly(error));
    setF({ code: '', kind: 'percent', amount: '', max_uses: '', expires_at: '' }); load();
  };
  return (
    <>
      {codes.map(c => (
        <div key={c.id} className="fs-card fs-card-row">
          <div><div className="fs-board-name">{c.code}</div>
            <div className="fs-board-meta">{c.percent_off ? `${c.percent_off}% off` : `${money(c.amount_off_cents)} off`} · used {c.used_count}{c.max_uses ? `/${c.max_uses}` : ''}{c.expires_at ? ` · until ${when(c.expires_at)}` : ''}</div></div>
          <button className="fs-x" aria-label="Delete code" onClick={() => supabase.from('discount_codes').delete().eq('id', c.id).then(load)}>✕</button>
        </div>
      ))}
      <div className="fs-card">
        <div className="fs-card-title">New code</div>
        <div className="cm-row2">
          <input className="fs-input" placeholder="CODE" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
          <select className="fs-input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="percent">% off</option><option value="amount">$ off</option></select>
        </div>
        <div className="cm-row2">
          <input className="fs-input" type="number" placeholder={f.kind === 'percent' ? 'Percent' : 'Dollars'} value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
          <input className="fs-input" type="number" placeholder="Max uses" value={f.max_uses} onChange={e => setF({ ...f, max_uses: e.target.value })} />
        </div>
        <label className="fs-field">Expires (optional)<input className="fs-input" type="datetime-local" value={f.expires_at} onChange={e => setF({ ...f, expires_at: e.target.value })} /></label>
        <button className="fs-small-btn" onClick={add}>Add code</button>
      </div>
    </>
  );
}
