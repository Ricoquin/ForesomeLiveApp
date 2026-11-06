import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, SPONSOR_BENEFIT_LABELS, money, when, rpc, friendly } from './api';
import Leaderboard from './Leaderboard';
import '../features.css';
import './community.css';

// Shareable event page: /e/:eventId (and standalone charity link /e/:eventId?donate=1).
// Anyone can view, donate to the fundraiser, or purchase a sponsor package; signing in is needed to register to play.
export default function PublicEvent({ eventId }) {
  const [info, setInfo] = useState(undefined);
  const params = new URLSearchParams(window.location.search);
  const [showDonate, setShowDonate] = useState(params.get('donate') === '1');
  const [donForm, setDonForm] = useState({ donor_name: '', amount: '25', message: '', is_anonymous: false });
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [sponForm, setSponForm] = useState({ sponsor_name: '', logo_url: '', website_url: '', hole_number: '', shout_out_text: '', contact_email: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    supabase.rpc('public_event', { p_event_id: eventId }).then(({ data }) => setInfo(data || null));
  };
  useEffect(() => { load(); }, [eventId]);

  const goRegister = () => {
    try { localStorage.setItem('fs_pending_event', eventId); } catch {}
    window.location.href = `/?event=${eventId}`;
  };

  const submitDonation = async () => {
    const centsVal = Math.round(Number(donForm.amount) * 100);
    if (!centsVal || centsVal < 100) return setErr('Minimum donation is $1.');
    setBusy(true); setErr('');
    try {
      await rpc('make_event_donation', {
        p_event_id: eventId,
        p_donor_name: donForm.donor_name || 'Anonymous Supporter',
        p_amount_cents: centsVal,
        p_message: donForm.message || null,
        p_is_anonymous: donForm.is_anonymous,
      });
      setMsg(`Thank you for your ${money(centsVal)} donation!`);
      setShowDonate(false);
      load();
    } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  };

  const submitSponsorship = async () => {
    if (!selectedPkg || !sponForm.sponsor_name.trim()) return setErr('Enter your business name.');
    setBusy(true); setErr('');
    try {
      await rpc('buy_sponsorship', {
        p_package_id: selectedPkg.id,
        p_sponsor_name: sponForm.sponsor_name,
        p_logo_url: sponForm.logo_url || null,
        p_website_url: sponForm.website_url || null,
        p_hole_number: sponForm.hole_number ? Number(sponForm.hole_number) : null,
        p_shout_out_text: sponForm.shout_out_text || null,
        p_contact_email: sponForm.contact_email || null,
      });
      setMsg(`${sponForm.sponsor_name} is now an official sponsor! Your logo is live on the TV leaderboard and cart signs.`);
      setSelectedPkg(null);
      load();
    } catch (e) { setErr(friendly(e)); }
    setBusy(false);
  };

  if (info === undefined) return <div className="cm-public"><div className="fs-empty">Loading…</div></div>;
  if (!info) return <div className="cm-public"><div className="fs-page"><h1 className="fs-h1">Event not found</h1><p className="fs-sub">It may be private or no longer available.</p><a className="fs-cta" href="/">Open ForeSome</a></div></div>;
  const ev = info.event;
  const t = info.tickets?.[0];
  const sponsors = info.sponsors || [];
  const packages = info.sponsor_packages || [];
  const raisedCents = info.donations_raised_cents || 0;
  const goalCents = ev.fundraising_goal_cents || 0;

  return (
    <div className="cm-public">
      <div className="fs-page">
        <div className="fs-eyebrow">
          ForeSome{info.community ? <> · <a href={`/c/${info.community.slug}`} style={{ color: 'inherit' }}>{info.community.name}</a></> : ''}
        </div>
        <h1 className="fs-h1">{ev.name}</h1>
        <div className="fs-card-meta">{when(ev.starts_at)}</div>
        <div className="fs-card-meta">{info.course.name}{info.course.address ? ` · ${info.course.address}` : ''}</div>
        <div className="cm-tags"><span className="fs-pill">{FORMAT_LABELS[ev.format]}</span>{ev.status === 'live' && <span className="fs-pill live">Live</span>}</div>
        {ev.description && <p className="fs-sub" style={{ whiteSpace: 'pre-line' }}>{ev.description}</p>}

        {msg && <div className="fs-note">{msg}</div>}
        {err && <div className="fs-error">{err}</div>}

        <div className="cm-facts">
          <div><b>{ev.capacity ? `${info.confirmed}/${ev.capacity}` : info.confirmed}</b><span>players</span></div>
          <div><b>{t ? money(t.price_cents) : 'Free'}</b><span>entry{t?.member_price_cents != null ? ` · members ${money(t.member_price_cents)}` : ''}</span></div>
        </div>

        {['published', 'live'].includes(ev.status) && (
          <button className="fs-cta" onClick={goRegister}>
            {ev.capacity && info.confirmed >= ev.capacity ? 'Join the waitlist' : 'Sign up & Checkout'}
          </button>
        )}
        <p className="fs-footnote">Pay with Card, Apple Pay, or Google Pay. Nothing to install.</p>

        {/* Standalone Charity Donation & Fundraising Progress */}
        {(ev.allow_donations || goalCents > 0 || raisedCents > 0) && (
          <div className="fs-card" style={{ marginTop: 14, borderColor: 'rgba(212, 184, 122, 0.35)' }}>
            <div className="fs-card-row">
              <div>
                <div className="fs-eyebrow">💝 Charity Fundraiser</div>
                <div className="fs-card-title">{ev.donation_title || 'Event Charity Fund'}</div>
              </div>
              <button className="fs-small-btn" onClick={() => setShowDonate(v => !v)}>{showDonate ? 'Close' : '💝 Donate'}</button>
            </div>
            <div style={{ margin: '8px 0 4px', fontSize: 13 }}>
              <b style={{ color: 'var(--gold-bright)' }}>{money(raisedCents)}</b> raised
              {goalCents > 0 ? ` of ${money(goalCents)} goal (${Math.min(100, Math.round((raisedCents / goalCents) * 100))}%)` : ''}
            </div>
            {goalCents > 0 && <div className="cm-bar"><div style={{ width: `${Math.min(100, (raisedCents / goalCents) * 100)}%` }} /></div>}
            {showDonate && (
              <div style={{ marginTop: 10 }}>
                <div className="cm-row2">
                  <input className="fs-input" type="number" min={1} placeholder="Amount ($)" value={donForm.amount} onChange={e => setDonForm({ ...donForm, amount: e.target.value })} />
                  <input className="fs-input" placeholder="Your name" value={donForm.donor_name} onChange={e => setDonForm({ ...donForm, donor_name: e.target.value })} />
                </div>
                <input className="fs-input" placeholder="Message of support (optional)" value={donForm.message} onChange={e => setDonForm({ ...donForm, message: e.target.value })} />
                <button className="fs-cta" disabled={busy} onClick={submitDonation}>{busy ? 'Processing…' : `Donate $${donForm.amount || 0}`}</button>
              </div>
            )}
          </div>
        )}

        {/* Sponsors & Sponsor Packages on Public Event Page */}
        {(sponsors.length > 0 || packages.length > 0) && (
          <>
            <div className="fs-section-title">Event Sponsors</div>
            {sponsors.map(s => (
              <div key={s.id} className="fs-card fs-card-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6 }} />}
                  <div>
                    <div className="fs-card-title">{s.sponsor_name}</div>
                    <div className="fs-card-meta">{s.hole_number ? `Hole #${s.hole_number} · ` : ''}{s.shout_out_text || 'Official Sponsor'}</div>
                  </div>
                </div>
                {s.website_url && <a className="fs-small-btn ghost" href={s.website_url} target="_blank" rel="noreferrer">Visit ↗</a>}
              </div>
            ))}
            {packages.map(pkg => (
              <div key={pkg.id} className="fs-card fs-card-row">
                <div>
                  <div className="fs-card-title">Become a Sponsor: {pkg.name} — {money(pkg.price_cents)}</div>
                  <div className="fs-card-meta">{(pkg.benefits || []).map(b => SPONSOR_BENEFIT_LABELS[b] || b).join(' · ')}</div>
                </div>
                <button className="fs-small-btn" onClick={() => setSelectedPkg(pkg)}>Buy Package</button>
              </div>
            ))}
            {selectedPkg && (
              <div className="fs-result-card">
                <div className="fs-card-title">Sponsor: {selectedPkg.name} ({money(selectedPkg.price_cents)})</div>
                <input className="fs-input" placeholder="Business / Sponsor Name *" value={sponForm.sponsor_name} onChange={e => setSponForm({ ...sponForm, sponsor_name: e.target.value })} />
                <input className="fs-input" placeholder="Logo Image URL (shown on TV & Cart Signs)" value={sponForm.logo_url} onChange={e => setSponForm({ ...sponForm, logo_url: e.target.value })} />
                <input className="fs-input" placeholder="Shout-out text" value={sponForm.shout_out_text} onChange={e => setSponForm({ ...sponForm, shout_out_text: e.target.value })} />
                <button className="fs-cta" disabled={busy} onClick={submitSponsorship}>{busy ? 'Processing…' : `Pay ${money(selectedPkg.price_cents)} & Activate`}</button>
              </div>
            )}
          </>
        )}

        {['live', 'completed'].includes(ev.status) && <><div className="fs-section-title">Leaderboard</div><Leaderboard eventId={eventId} /></>}
      </div>
    </div>
  );
}
