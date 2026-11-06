import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  STATUS_LABELS, SPONSOR_BENEFIT_LABELS, ATTENDANCE_LABELS,
  money, moneyExact, when, friendly, rpc, appUrl, downloadCsv, courseById
} from './api';
import { autoPair, shotgunAssignments, teeTimes } from './pairing';
import Leaderboard from './Leaderboard';
import QrCode from './QrCode';

// Organizer / course staff view of one event:
// Players (with full/partial Refunds + Waitlist promotion), Pairings (with Sponsor logos on Cart Signs),
// Payouts & Reconciliation, Sponsorship Packages, Attendance Sheet, Announcements, Codes, Results, and Share.
export default function EventManage({ session, eventId, onBack, onEdit }) {
  const [ev, setEv] = useState(null);
  const [regs, setRegs] = useState([]);
  const [names, setNames] = useState({});
  const [sponsors, setSponsors] = useState([]);
  const [tab, setTab] = useState('players');
  const [refundTarget, setRefundTarget] = useState(null);
  const [refundAmt, setRefundAmt] = useState('');
  const [refundCancelSpot, setRefundCancelSpot] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

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
    const { data: sp } = await supabase.from('sponsorships').select('*').eq('event_id', eventId).eq('status', 'active');
    setSponsors(sp || []);
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

  const submitRefund = async () => {
    if (!refundTarget) return;
    const centsVal = refundAmt ? Math.round(Number(refundAmt) * 100) : null;
    await act(async () => {
      const res = await rpc('refund_payment', {
        p_registration_id: refundTarget.id,
        p_refund_cents: centsVal,
        p_cancel_spot: refundCancelSpot,
      });
      const promoted = res?.promoted_profile_id;
      setRefundTarget(null);
      setRefundAmt('');
      setMsg(`Refund processed.${promoted ? ' Waitlist #1 player was automatically promoted to confirmed!' : ''}`);
    });
  };

  if (err && !ev) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div><div className="fs-error">{err}</div></div>;
  if (!ev) return <div className="fs-page"><div className="fs-empty">Loading…</div></div>;

  const active = regs.filter(r => ['confirmed', 'checked_in', 'pending_payment'].includes(r.status));
  const wait = regs.filter(r => r.status === 'waitlisted').sort((a, b) => a.waitlist_position - b.waitlist_position);
  const name = (r) => names[r.profile_id]?.username || 'Player';
  const collectedCents = regs.reduce((s, r) => s + Math.max(0, (r.total_paid_cents || (r.paid_at_course_at ? r.amount_due_cents : 0)) - (r.refunded_cents || 0)), 0);

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
        <div><b>{money(collectedCents)}</b><span>net collected</span></div>
      </div>
      {ev.status === 'draft' && <button className="fs-cta" onClick={() => setStatus('published')}>Publish — open sign-ups</button>}

      <div className="fs-seg wrap">
        {[
          ['players', 'Players'],
          ['pairings', 'Pairings'],
          ['payouts', '💳 Payouts'],
          ['sponsors', '🤝 Sponsors'],
          ['attendance', '📋 Attendance'],
          ['announce', '📣 Announce'],
          ['codes', 'Codes'],
          ['results', 'Results'],
          ['share', 'Share'],
        ].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(''); }}>{l}</button>)}
      </div>
      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      {tab === 'players' && (
        <>
          <div className="cm-actions">
            <button className="fs-small-btn ghost" onClick={() => downloadCsv(`${ev.name}-players.csv`, regs.map(r => ({
              player: name(r), status: STATUS_LABELS[r.status], waitlist: r.waitlist_position || '', handicap: r.handicap ?? '',
              flight: r.flight || '', fee: ((r.total_paid_cents || r.amount_due_cents) / 100).toFixed(2),
              refunded: ((r.refunded_cents || 0) / 100).toFixed(2),
              paid: r.paid_at_course_at ? 'yes' : 'no',
              attendance: r.attendance_status || '',
              checked_in: r.checked_in_at || '', ...Object.fromEntries(Object.entries(r.answers || {})),
            })))}>Export CSV</button>
          </div>

          {refundTarget && (
            <div className="fs-result-card" style={{ borderColor: 'rgba(232,138,138,0.4)' }}>
              <div className="fs-card-row">
                <span className="fs-card-title">Refund {name(refundTarget)}</span>
                <button className="fs-x" onClick={() => setRefundTarget(null)}>✕</button>
              </div>
              <div className="fs-card-meta" style={{ marginBottom: 8 }}>
                Paid: {moneyExact(refundTarget.total_paid_cents || refundTarget.amount_due_cents)}
                {refundTarget.refunded_cents ? ` · Already refunded: ${moneyExact(refundTarget.refunded_cents)}` : ''}
              </div>
              <label className="fs-field">Refund Amount ($, leave blank for full refund)
                <input className="fs-input" type="number" min={0.5} step="0.5" placeholder={(( (refundTarget.total_paid_cents || refundTarget.amount_due_cents) - (refundTarget.refunded_cents || 0) ) / 100).toFixed(2)} value={refundAmt} onChange={e => setRefundAmt(e.target.value)} />
              </label>
              <label className="fs-toggle">
                <input type="checkbox" checked={refundCancelSpot} onChange={e => setRefundCancelSpot(e.target.checked)} />
                Cancel player's spot & automatically promote #1 from waitlist ({wait.length} waiting)
              </label>
              <button className="fs-cta" onClick={submitRefund}>Issue Stripe Refund</button>
            </div>
          )}

          {[...active, ...wait].map(r => (
            <div key={r.id} className="fs-card cm-reg">
              <div className="fs-card-row">
                <div>
                  <div className="fs-board-name">{name(r)} <span className="fs-board-meta">HCP {r.handicap ?? '—'}</span></div>
                  <div className="fs-board-meta">{STATUS_LABELS[r.status]}{r.status === 'waitlisted' ? ` #${r.waitlist_position}` : ''}
                    {r.amount_due_cents ? ` · ${moneyExact(r.total_paid_cents || r.amount_due_cents)} ${r.paid_at_course_at ? 'paid' : 'due'}` : ''}
                    {r.refunded_cents > 0 ? ` (${moneyExact(r.refunded_cents)} refunded)` : ''}
                    {Array.isArray(r.addons) && r.addons.length ? ` · Add-ons: ${r.addons.map(a => `${a.name}×${a.qty}`).join(', ')}` : ''}
                    {Object.entries(r.answers || {}).filter(([k, v]) => v && k !== 'waiver').map(([k, v]) => ` · ${v}`).join('')}</div>
                </div>
                <input className="fs-input cm-flight" placeholder="Flight" defaultValue={r.flight || ''} aria-label="Flight"
                  onBlur={e => e.target.value !== (r.flight || '') && act(async () => { await supabase.from('registrations').update({ flight: e.target.value || null }).eq('id', r.id); })} />
              </div>
              <div className="cm-actions">
                {r.status === 'confirmed' && <button className="fs-small-btn" onClick={() => act(() => rpc('check_in', { p_registration_id: r.id }), `${name(r)} checked in`)}>Check in</button>}
                {r.amount_due_cents > 0 && r.status !== 'waitlisted' && (
                  <button className="fs-small-btn ghost" onClick={() => act(() => rpc('mark_paid_at_course', { p_registration_id: r.id, p_paid: !r.paid_at_course_at }))}>
                    {r.paid_at_course_at ? 'Undo paid' : 'Mark paid'}</button>
                )}
                {(r.paid_at_course_at || r.total_paid_cents > 0) && (
                  <button className="fs-small-btn ghost" onClick={() => { setRefundTarget(r); setRefundAmt(''); setRefundCancelSpot(true); }}>
                    Refund
                  </button>
                )}
                <button className="fs-small-btn ghost" onClick={() => confirm(`Remove ${name(r)}?`) && act(() => rpc('refund_payment', { p_registration_id: r.id, p_refund_cents: 0, p_cancel_spot: true }), 'Removed & waitlist updated')}>Remove</button>
              </div>
            </div>
          ))}
          {!regs.length && <div className="fs-empty">No sign-ups yet. Share the event link.</div>}
        </>
      )}

      {tab === 'pairings' && <Pairings ev={ev} regs={active} names={names} sponsors={sponsors} onChanged={setMsg} onError={setErr} />}
      {tab === 'payouts' && <PayoutReconciliation ev={ev} onError={setErr} />}
      {tab === 'sponsors' && <SponsorsManage ev={ev} onChanged={() => { load(); setMsg('Sponsor packages updated'); }} onError={setErr} />}
      {tab === 'attendance' && <AttendanceSheet ev={ev} regs={active} names={names} onChanged={load} onError={setErr} />}
      {tab === 'announce' && <EventAnnouncements session={session} ev={ev} onSent={setMsg} onError={setErr} />}
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
          <div className="fs-card"><div className="fs-card-title">Sign-up & Sponsor Link</div>
            <div className="cm-link">{appUrl(`/e/${eventId}`)}</div>
            <QrCode value={appUrl(`/e/${eventId}`)} label="Print this for the pro shop counter" />
            <button className="fs-small-btn" onClick={() => navigator.clipboard?.writeText(appUrl(`/e/${eventId}`)).then(() => setMsg('Link copied'))}>Copy link</button>
          </div>
          {ev.allow_donations && (
            <div className="fs-card"><div className="fs-card-title">Standalone Charity Donation Link</div>
              <p className="fs-footnote">Share with non-golfers and supporters to donate directly toward your fundraising goal.</p>
              <div className="cm-link">{appUrl(`/e/${eventId}?donate=1`)}</div>
              <button className="fs-small-btn" onClick={() => navigator.clipboard?.writeText(appUrl(`/e/${eventId}?donate=1`)).then(() => setMsg('Donation link copied'))}>Copy donation link</button>
            </div>
          )}
          <div className="fs-card"><div className="fs-card-title">Pro shop TV Leaderboard (with Sponsor Logos)</div>
            <p className="fs-footnote">Open this on any TV browser for a full-screen live leaderboard with automatic sponsor rotation.</p>
            <div className="cm-link">{appUrl(`/tv/${eventId}`)}</div>
            <a className="fs-small-btn" href={`/tv/${eventId}`} target="_blank" rel="noreferrer">Open TV mode</a>
          </div>
        </>
      )}
    </div>
  );
}

// 2.1 Payout & Reconciliation View
function PayoutReconciliation({ ev, onError }) {
  const [rec, setRec] = useState(null);
  const [hostAcct, setHostAcct] = useState(null);

  useEffect(() => {
    rpc('event_payout_reconciliation', { p_event_id: ev.id }).then(setRec).catch(e => onError(e.message));
    if (ev.community_id) {
      supabase.from('communities').select('name, stripe_account_id, stripe_onboarding_complete, stripe_payout_schedule, platform_fee_bps').eq('id', ev.community_id).maybeSingle().then(({ data }) => setHostAcct(data));
    } else if (ev.organization_id) {
      supabase.from('organizations').select('name, stripe_account_id, stripe_onboarding_complete, stripe_payout_schedule, platform_fee_bps').eq('id', ev.organization_id).maybeSingle().then(({ data }) => setHostAcct(data));
    }
  }, [ev.id]);

  if (!rec) return <div className="fs-empty">Loading payout reconciliation…</div>;

  return (
    <>
      <div className="fs-card" style={{ borderColor: 'rgba(212,184,122,0.35)' }}>
        <div className="fs-card-row">
          <div>
            <div className="fs-eyebrow">Stripe Connect Express Payouts</div>
            <div className="fs-card-title">{hostAcct?.name || 'Direct Organizer Payout'}</div>
          </div>
          <span className="fs-pill live">
            {hostAcct?.stripe_onboarding_complete ? `Connected (${hostAcct.stripe_account_id || 'acct_live'})` : 'Express Ready'}
          </span>
        </div>
        <div className="fs-card-meta" style={{ marginTop: 4 }}>
          Payout Schedule: <b>{(hostAcct?.stripe_payout_schedule || 'daily').toUpperCase()} AUTOMATIC</b> · ForeSome Platform Fee: <b>{((hostAcct?.platform_fee_bps || 250) / 100).toFixed(2)}%</b> · Fee Mode: <b>{ev.pass_processing_fee ? 'Passed to Player' : 'Absorbed by Organizer'}</b>
        </div>
      </div>

      <div className="cm-facts">
        <div><b>{moneyExact(rec.gross_collected_cents)}</b><span>gross collected</span></div>
        <div><b>{moneyExact(rec.processing_fees_cents + rec.platform_fees_cents)}</b><span>stripe + platform fees</span></div>
        <div><b>{moneyExact(rec.refunds_cents)}</b><span>refunds</span></div>
        <div><b style={{ color: 'var(--gold-bright)' }}>{moneyExact(rec.net_payout_cents)}</b><span>net payout</span></div>
      </div>

      <div className="fs-card">
        <div className="fs-section-title" style={{ marginTop: 0 }}>Revenue Breakdown by Category</div>
        <div className="fs-card-row"><span>Entries & Checkout Add-Ons</span><b>{moneyExact(rec.entry_and_addons_cents)}</b></div>
        <div className="fs-card-row"><span>Sponsorship Packages</span><b>{moneyExact(rec.sponsorships_cents)}</b></div>
        <div className="fs-card-row"><span>Charity Donations</span><b>{moneyExact(rec.donations_cents)}</b></div>
        <div className="fs-card-row" style={{ color: 'var(--text-dim)' }}><span>Stripe Processing (2.9% + 30¢)</span><span>-{moneyExact(rec.processing_fees_cents)}</span></div>
        <div className="fs-card-row" style={{ color: 'var(--text-dim)' }}><span>ForeSome Platform Fee</span><span>-{moneyExact(rec.platform_fees_cents)}</span></div>
        <div className="fs-card-row" style={{ color: '#e88a8a' }}><span>Refunded to Players</span><span>-{moneyExact(rec.refunds_cents)}</span></div>
        <div className="fs-card-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 6, fontSize: 15 }}>
          <b>Net Transferred to Bank</b>
          <b style={{ color: 'var(--gold-bright)' }}>{moneyExact(rec.net_payout_cents)}</b>
        </div>
      </div>

      <div className="fs-section-title cm-row-title">
        Transaction Ledger ({(rec.payments || []).length})
        {(rec.payments || []).length > 0 && (
          <button className="fs-link" onClick={() => downloadCsv(`${ev.name}-payouts.csv`, rec.payments)}>Export CSV</button>
        )}
      </div>
      {(rec.payments || []).map(p => (
        <div key={p.id} className="fs-card fs-card-row">
          <div>
            <div className="fs-board-name">{p.username || 'Supporter'} · <span className="fs-pill">{p.kind.replace('_', ' ')}</span></div>
            <div className="fs-board-meta">{when(p.created_at)} · {p.payment_method} · Status: {p.status}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700 }}>{moneyExact(p.total_cents)}</div>
            <div className="fs-board-meta">Net {moneyExact(p.net_organizer_cents)}</div>
          </div>
        </div>
      ))}
      {!(rec.payments || []).length && <div className="fs-empty">No Stripe transactions recorded for this event yet.</div>}
    </>
  );
}

// 2.2 Sponsor Packages & Sponsors Admin
function SponsorsManage({ ev, onChanged, onError }) {
  const [packages, setPackages] = useState([]);
  const [sponsors, setSponsors] = useState([]);
  const [f, setF] = useState({
    name: '', price: '', quantity: '', scope: 'event',
    benefits: ['hole_sign', 'tv_logo', 'cart_sign', 'shout_out']
  });

  const load = async () => {
    const { data: pkgs } = await supabase.from('sponsor_packages').select('*').or(`event_id.eq.${ev.id}${ev.season_id ? `,season_id.eq.${ev.season_id}` : ''}`).order('price_cents', { ascending: false });
    setPackages(pkgs || []);
    const { data: sps } = await supabase.from('sponsorships').select('*').or(`event_id.eq.${ev.id}${ev.season_id ? `,season_id.eq.${ev.season_id}` : ''}`).order('created_at', { ascending: false });
    setSponsors(sps || []);
  };
  useEffect(() => { load(); }, [ev.id]);

  const toggleBenefit = (b) => {
    setF(prev => ({
      ...prev,
      benefits: prev.benefits.includes(b) ? prev.benefits.filter(x => x !== b) : [...prev.benefits, b]
    }));
  };

  const createPkg = async () => {
    if (!f.name.trim() || f.price === '') return onError('Enter package name and price.');
    const row = {
      name: f.name.trim(),
      price_cents: Math.round(Number(f.price) * 100),
      quantity: f.quantity ? Number(f.quantity) : null,
      benefits: f.benefits,
      community_id: ev.community_id || null,
      event_id: f.scope === 'season' && ev.season_id ? null : ev.id,
      season_id: f.scope === 'season' && ev.season_id ? ev.season_id : ev.season_id || null,
    };
    const { error } = await supabase.from('sponsor_packages').insert([row]);
    if (error) return onError(friendly(error));
    setF({ name: '', price: '', quantity: '', scope: 'event', benefits: ['hole_sign', 'tv_logo', 'cart_sign', 'shout_out'] });
    load();
    onChanged();
  };

  return (
    <>
      <div className="fs-section-title">Create Sponsor Package</div>
      <div className="fs-card">
        <input className="fs-input" placeholder="Package name (e.g. Title Sponsor, Hole Sponsor)" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <div className="cm-row2">
          <input className="fs-input" type="number" min={0} placeholder="Price ($)" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
          <input className="fs-input" type="number" min={1} placeholder="Max quantity (optional)" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} />
        </div>
        {ev.season_id && (
          <label className="fs-field">Package Scope
            <select className="fs-input" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value })}>
              <option value="event">Single Event Only ({ev.name})</option>
              <option value="season">🌟 Season-Long Sponsor (All Events in Season)</option>
            </select>
          </label>
        )}
        <div className="fs-section-title" style={{ marginTop: 6 }}>Included Sponsor Benefits</div>
        {Object.entries(SPONSOR_BENEFIT_LABELS).map(([k, label]) => (
          <label key={k} className="fs-toggle">
            <input type="checkbox" checked={f.benefits.includes(k)} onChange={() => toggleBenefit(k)} /> {label}
          </label>
        ))}
        <button className="fs-small-btn" onClick={createPkg}>+ Add Sponsor Package</button>
      </div>

      <div className="fs-section-title">Sponsor Packages ({packages.length})</div>
      {packages.map(p => (
        <div key={p.id} className="fs-card fs-card-row">
          <div>
            <div className="fs-card-title">{p.name} — {money(p.price_cents)}</div>
            <div className="fs-card-meta">
              {p.season_id && !p.event_id ? '🌟 Season-Long · ' : ''}
              Sold: {p.sold_count}{p.quantity ? ` / ${p.quantity}` : ''} · {(p.benefits || []).map(b => SPONSOR_BENEFIT_LABELS[b] || b).join(' · ')}
            </div>
          </div>
          <button className="fs-x" onClick={() => supabase.from('sponsor_packages').delete().eq('id', p.id).then(load)}>✕</button>
        </div>
      ))}

      <div className="fs-section-title">Active Sponsors ({sponsors.length})</div>
      {sponsors.map(s => (
        <div key={s.id} className="fs-card fs-card-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6 }} />}
            <div>
              <div className="fs-card-title">{s.sponsor_name} · {money(s.amount_paid_cents)}</div>
              <div className="fs-card-meta">{s.hole_number ? `Hole #${s.hole_number} · ` : ''}{s.shout_out_text || s.contact_email || 'Active on TV & Cart Signs'}</div>
            </div>
          </div>
          <button className="fs-x" onClick={() => supabase.from('sponsorships').delete().eq('id', s.id).then(load)}>✕</button>
        </div>
      ))}
    </>
  );
}

// 3.4 Event Attendance Sheet (Present, Late, Left Early, Absent)
function AttendanceSheet({ ev, regs, names, onChanged, onError }) {
  const setAttendance = async (regId, status, notes) => {
    const { error } = await supabase.from('registrations').update({
      attendance_status: status,
      attendance_notes: notes,
    }).eq('id', regId);
    if (error) onError(friendly(error));
    else onChanged();
  };

  return (
    <>
      <div className="cm-actions">
        <button className="fs-small-btn ghost" onClick={() => downloadCsv(`${ev.name}-attendance.csv`, regs.map(r => ({
          player: names[r.profile_id]?.username || 'Player',
          attendance: r.attendance_status || (r.status === 'checked_in' ? 'present' : 'unmarked'),
          notes: r.attendance_notes || '',
          checked_in_at: r.checked_in_at || '',
        })))}>Export Attendance CSV</button>
      </div>
      {regs.map(r => {
        const cur = r.attendance_status || (r.status === 'checked_in' ? 'present' : '');
        return (
          <div key={r.id} className="fs-card">
            <div className="fs-card-row">
              <div className="fs-board-name">{names[r.profile_id]?.username || 'Player'}</div>
              <span className="fs-pill">{cur ? ATTENDANCE_LABELS[cur] : 'Unmarked'}</span>
            </div>
            <div className="fs-seg wrap" style={{ marginTop: 8 }}>
              {Object.entries(ATTENDANCE_LABELS).map(([k, label]) => (
                <button key={k} type="button" className={cur === k ? 'on' : ''} onClick={() => setAttendance(r.id, k, r.attendance_notes)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="fs-input"
              style={{ marginTop: 6, marginBottom: 0 }}
              placeholder="Attendance note (e.g. arrived hole 3, left after 9)"
              defaultValue={r.attendance_notes || ''}
              onBlur={e => e.target.value !== (r.attendance_notes || '') && setAttendance(r.id, cur || 'present', e.target.value)}
            />
          </div>
        );
      })}
      {!regs.length && <div className="fs-empty">No registered players yet.</div>}
    </>
  );
}

// 3.4 Multi-Channel Announcements (Email, SMS, Push)
function EventAnnouncements({ session, ev, onSent, onError }) {
  const [list, setList] = useState([]);
  const [f, setF] = useState({ title: '', body: '', channels: ['email', 'sms', 'push'], scheduled_for: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('community_announcements').select('*').eq('event_id', ev.id).order('created_at', { ascending: false });
    setList(data || []);
  };
  useEffect(() => { load(); }, [ev.id]);

  const toggleCh = (ch) => {
    setF(prev => ({
      ...prev,
      channels: prev.channels.includes(ch) ? prev.channels.filter(x => x !== ch) : [...prev.channels, ch]
    }));
  };

  const send = async () => {
    if (!f.title.trim() || !f.body.trim()) return onError('Enter a headline and message.');
    setBusy(true);
    const isScheduled = !!f.scheduled_for && new Date(f.scheduled_for) > new Date();
    const { data, error } = await supabase.from('community_announcements').insert([{
      community_id: ev.community_id || null,
      event_id: ev.id,
      title: f.title.trim(),
      body: f.body.trim(),
      channels: f.channels,
      scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null,
      sent_at: isScheduled ? null : new Date().toISOString(),
      created_by: session.user.id,
    }]).select().single();
    if (error) { setBusy(false); return onError(friendly(error)); }

    if (!isScheduled) {
      await supabase.functions.invoke('notify', {
        body: { announcementId: data.id, communityId: ev.community_id, eventId: ev.id, title: f.title, body: f.body, channels: f.channels }
      }).catch(() => null);
    }
    setBusy(false);
    setF({ title: '', body: '', channels: ['email', 'sms', 'push'], scheduled_for: '' });
    load();
    onSent(isScheduled ? 'Announcement scheduled!' : `Announcement sent via ${f.channels.join(', ').toUpperCase()}!`);
  };

  return (
    <>
      <div className="fs-card">
        <div className="fs-card-title">Send Event Announcement / Reminder</div>
        <input className="fs-input" placeholder="Subject (e.g. Frost Delay — Shotgun Moved to 9:30 AM)" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <textarea className="fs-input" rows={3} placeholder="Message to all registered & waitlisted players…" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
        <div style={{ display: 'flex', gap: 12, margin: '6px 0' }}>
          {[['email', '✉️ Email'], ['sms', '📱 SMS'], ['push', '🔔 Push']].map(([k, l]) => (
            <label key={k} className="fs-toggle" style={{ margin: 0 }}>
              <input type="checkbox" checked={f.channels.includes(k)} onChange={() => toggleCh(k)} /> {l}
            </label>
          ))}
        </div>
        <label className="fs-field">Schedule for later (optional, in community timezone)
          <input className="fs-input" type="datetime-local" value={f.scheduled_for} onChange={e => setF({ ...f, scheduled_for: e.target.value })} />
        </label>
        <button className="fs-cta" disabled={busy} onClick={send}>{busy ? 'Sending…' : f.scheduled_for ? 'Schedule Announcement' : 'Send Now'}</button>
      </div>

      <div className="fs-section-title">Sent & Scheduled ({list.length})</div>
      {list.map(a => (
        <div key={a.id} className="fs-card">
          <div className="fs-card-row">
            <span className="fs-card-title">{a.title}</span>
            <span className="fs-pill">{a.sent_at ? 'Sent' : `Scheduled ${when(a.scheduled_for)}`}</span>
          </div>
          <p className="fs-sub" style={{ margin: '4px 0' }}>{a.body}</p>
          <div className="fs-card-meta">Channels: {(a.channels || []).join(', ').toUpperCase()}</div>
        </div>
      ))}
    </>
  );
}

function Pairings({ ev, regs, names, sponsors = [], onChanged, onError }) {
  const [groups, setGroups] = useState([]);
  const [method, setMethod] = useState('handicap');
  const [busy, setBusy] = useState(false);
  const size = Math.max(ev.team_size === 1 ? 4 : ev.team_size, 2);
  const regById = useMemo(() => Object.fromEntries(regs.map(r => [r.id, r])), [regs]);
  const cartSponsors = sponsors.filter(s => !s.benefits || s.benefits.includes('cart_sign'));

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
      {groups.length > 0 && <button className="fs-small-btn ghost" onClick={() => window.print()}>Print cart signs (includes Sponsor Logos)</button>}
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
            {cartSponsors.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed rgba(212,184,122,0.25)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--gold-bright)' }}>
                <span>Sponsored by:</span>
                {cartSponsors.map(s => (
                  <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                    {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ height: 18, width: 'auto' }} />}
                    {s.sponsor_name}
                  </span>
                ))}
              </div>
            )}
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
          <div><div className="fs-card-title">{c.code}</div>
            <div className="fs-card-meta">{c.percent_off ? `${c.percent_off}% off` : money(c.amount_off_cents) + ' off'} · {c.used_count}{c.max_uses ? `/${c.max_uses}` : ''} used</div></div>
          <button className="fs-x" aria-label="Delete code" onClick={() => supabase.from('discount_codes').delete().eq('id', c.id).then(load)}>✕</button>
        </div>
      ))}
      <div className="fs-card">
        <div className="cm-row2">
          <input className="fs-input" placeholder="CODE" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
          <select className="fs-input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
            <option value="percent">% off</option><option value="amount">$ off</option>
          </select>
        </div>
        <div className="cm-row2">
          <input className="fs-input" type="number" min={1} placeholder={f.kind === 'percent' ? 'Percent (10)' : 'Dollars (15)'} value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
          <input className="fs-input" type="number" min={1} placeholder="Max uses (optional)" value={f.max_uses} onChange={e => setF({ ...f, max_uses: e.target.value })} />
        </div>
        <button className="fs-small-btn" onClick={add}>Add discount code</button>
      </div>
    </>
  );
}
