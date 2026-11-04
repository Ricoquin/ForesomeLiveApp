import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, STATUS_LABELS, money, when, isToday, friendly, rpc, appUrl, courseById } from './api';
import Leaderboard from './Leaderboard';
import QrCode from './QrCode';
import EventScorecard from './EventScorecard';

// One event, from the golfer's side: details, sign up, waitlist, check-in QR, scoring, leaderboard.
export default function EventView({ session, eventId, getCourseData, onBack, onManage }) {
  const me = session.user.id;
  const [info, setInfo] = useState(null);     // public_event payload
  const [reg, setReg] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [ticket, setTicket] = useState('');
  const [answers, setAnswers] = useState({});
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [scoring, setScoring] = useState(false);
  const [tab, setTab] = useState('info');

  const load = async () => {
    const { data, error } = await supabase.rpc('public_event', { p_event_id: eventId });
    if (error) { setErr(friendly(error)); return; }
    if (!data) { setErr("This event isn't available."); return; }
    setInfo(data);
    if (!ticket && data.tickets?.length) setTicket(data.tickets[0].id);
    const { data: r } = await supabase.from('registrations').select('*').eq('event_id', eventId).eq('profile_id', me)
      .neq('status', 'cancelled').maybeSingle();
    setReg(r || null);
    const { data: m } = await supabase.rpc('can_manage_event', { e: eventId });
    setCanManage(!!m);
  };
  useEffect(() => { load(); }, [eventId]);

  // Live updates to my own registration (waitlist promotion, check-in at the counter)
  useEffect(() => {
    const ch = supabase.channel(`myreg-${eventId}-${me}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `profile_id=eq.${me}` },
        (p) => { if (p.new?.event_id === eventId) setReg(p.new.status === 'cancelled' ? null : p.new); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]);

  if (err) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← EVENTS</button></div><div className="fs-error">{err}</div></div>;
  if (!info) return <div className="fs-page"><div className="fs-empty">Loading…</div></div>;

  const ev = info.event;
  const course = courseById(ev.course_id);
  const courseData = course ? getCourseData(course) : null;
  if (scoring && reg) return <EventScorecard session={session} event={ev} myReg={reg} courseData={courseData} onClose={() => setScoring(false)} />;

  const full = ev.capacity && info.confirmed >= ev.capacity;
  const open = ['published', 'live'].includes(ev.status)
    && (!ev.registration_opens_at || new Date(ev.registration_opens_at) <= new Date())
    && (!ev.registration_closes_at || new Date(ev.registration_closes_at) >= new Date());
  const t = (info.tickets || []).find(x => x.id === ticket);
  const questions = Array.isArray(ev.questions) ? ev.questions : [];

  const register = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await rpc('register_for_event', {
        p_event_id: eventId, p_ticket_type_id: ticket || null, p_team_id: null, p_answers: answers, p_discount_code: code || null,
      });
      setReg(r);
      setMsg(r.status === 'waitlisted' ? `You're #${r.waitlist_position} on the waitlist. We'll tell you if a spot opens.` : "You're in!");
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const cancel = async () => {
    if (!confirm('Cancel your spot? If there is a waitlist, the next player gets it.')) return;
    try { await rpc('cancel_registration', { p_registration_id: reg.id }); setReg(null); setMsg('Your spot was cancelled.'); load(); }
    catch (e) { setErr(e.message); }
  };
  const selfCheckIn = async () => {
    try { const r = await rpc('check_in', { p_registration_id: reg.id }); setReg(r); setMsg('Checked in. Have a great round!'); }
    catch (e) { setErr(e.message); }
  };
  const share = async () => {
    const url = appUrl(`/e/${eventId}`);
    try { if (navigator.share) await navigator.share({ title: ev.name, url }); else { await navigator.clipboard.writeText(url); setMsg('Link copied'); } } catch {}
  };

  const playing = reg && ['confirmed', 'checked_in'].includes(reg.status);
  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← EVENTS</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="fs-link" onClick={share}>Share</button>
          {canManage && <button className="fs-small-btn" onClick={() => onManage(eventId)}>Manage</button>}
        </div>
      </div>
      {info.community && <div className="fs-eyebrow">{info.community.name}</div>}
      <h1 className="fs-h1">{ev.name}</h1>
      <div className="fs-card-meta">{when(ev.starts_at)} · {info.course.name}{ev.shotgun_start ? ' · Shotgun start' : ''}</div>
      <div className="cm-tags">
        <span className="fs-pill">{FORMAT_LABELS[ev.format]}{ev.team_size > 1 ? ` · teams of ${ev.team_size}` : ''}</span>
        {ev.status === 'live' && <span className="fs-pill live">Live</span>}
        {ev.status === 'completed' && <span className="fs-pill">Final</span>}
        {ev.status === 'cancelled' && <span className="fs-pill">Cancelled</span>}
        {ev.visibility === 'members_only' && <span className="fs-pill">Members only</span>}
        {ev.invite_only_top_n && <span className="fs-pill">Top {ev.invite_only_top_n} invite</span>}
      </div>

      <div className="fs-seg">
        {[['info', 'Details'], ['board', 'Leaderboard']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'board' && <Leaderboard eventId={eventId} me={me} />}

      {tab === 'info' && (
        <>
          {ev.description && <p className="fs-sub" style={{ whiteSpace: 'pre-line' }}>{ev.description}</p>}
          <div className="cm-facts">
            <div><b>{ev.capacity ? `${info.confirmed} / ${ev.capacity}` : info.confirmed}</b><span>players</span></div>
            <div><b>{info.waitlisted}</b><span>waitlist</span></div>
            <div><b>{t ? money(t.price_cents) : 'Free'}</b><span>entry{t?.member_price_cents != null ? ` · members ${money(t.member_price_cents)}` : ''}</span></div>
          </div>

          {msg && <div className="fs-note">{msg}</div>}
          {err && <div className="fs-error">{err}</div>}

          {reg ? (
            <div className="fs-result-card">
              <div className="fs-card-row">
                <span className="fs-card-title">{STATUS_LABELS[reg.status]}{reg.status === 'waitlisted' ? ` · #${reg.waitlist_position}` : ''}</span>
                {reg.amount_due_cents > 0 && <span className="fs-pill">{reg.paid_at_course_at ? 'Paid' : `${money(reg.amount_due_cents)} at course`}</span>}
              </div>
              {playing && (
                <>
                  <QrCode value={`foresome:checkin:${reg.id}`} label="Show this at the pro shop to check in" />
                  {reg.status === 'confirmed' && isToday(ev.starts_at) && <button className="fs-cta" onClick={selfCheckIn}>I'm here — check me in</button>}
                  {['published', 'live'].includes(ev.status) && <button className="fs-cta" onClick={() => setScoring(true)}>Enter scores</button>}
                </>
              )}
              {ev.status !== 'completed' && <button className="fs-cta secondary" onClick={cancel}>Cancel my spot</button>}
            </div>
          ) : open ? (
            <div className="fs-result-card">
              <div className="fs-card-title">{full ? (ev.allow_waitlist ? 'Join the waitlist' : 'Event is full') : 'Sign up'}</div>
              {(info.tickets || []).length > 1 && (
                <label className="fs-field">Entry
                  <select className="fs-input" value={ticket} onChange={e => setTicket(e.target.value)}>
                    {info.tickets.map(x => <option key={x.id} value={x.id}>{x.name} — {money(x.price_cents)}{x.members_only ? ' (members)' : ''}</option>)}
                  </select>
                </label>
              )}
              {questions.map(q => (
                q.type === 'checkbox' ? (
                  <label key={q.id} className="fs-toggle"><input type="checkbox" checked={!!answers[q.id]} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.checked }))} /> {q.label}{q.required ? ' *' : ''}</label>
                ) : q.type === 'select' ? (
                  <label key={q.id} className="fs-field">{q.label}{q.required ? ' *' : ''}
                    <select className="fs-input" value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}>
                      <option value="">Choose…</option>
                      {(q.options || []).map(o => <option key={o}>{o}</option>)}
                    </select>
                  </label>
                ) : (
                  <label key={q.id} className="fs-field">{q.label}{q.required ? ' *' : ''}
                    <input className="fs-input" value={answers[q.id] || ''} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
                  </label>
                )
              ))}
              {t?.price_cents > 0 && <input className="fs-input" placeholder="Discount code (optional)" value={code} onChange={e => setCode(e.target.value)} />}
              {t?.price_cents > 0 && <p className="fs-footnote">Entry is paid at the course when you check in.</p>}
              <button className="fs-cta" disabled={busy || (full && !ev.allow_waitlist)} onClick={register}>
                {busy ? 'Signing up…' : full ? 'Join waitlist' : 'Sign up'}
              </button>
            </div>
          ) : (
            <div className="fs-empty">{ev.status === 'completed' ? 'This event is finished. See the leaderboard.' : 'Registration is closed.'}</div>
          )}
        </>
      )}
    </div>
  );
}
