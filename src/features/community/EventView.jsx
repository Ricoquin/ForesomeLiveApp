import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  FORMAT_LABELS, STATUS_LABELS, SPONSOR_BENEFIT_LABELS,
  money, moneyExact, calcProcessingFee, when, isToday, friendly, rpc, appUrl, courseById
} from './api';
import Leaderboard from './Leaderboard';
import QrCode from './QrCode';
import EventScorecard from './EventScorecard';

// One event, from the golfer's side: details, Stripe Connect checkout (entry + add-ons + team + donation),
// sponsorships, fundraising progress + standalone donation, on-course concessions ordering, event chat, and leaderboard.
export default function EventView({ session, eventId, getCourseData, onBack, onManage }) {
  const me = session.user.id;
  const [info, setInfo] = useState(null);     // public_event payload
  const [reg, setReg] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [isMember, setIsMember] = useState(false);
  const [canManage, setCanManage] = useState(false);

  // Registration & Checkout states
  const [ticket, setTicket] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamCount, setTeamCount] = useState(1);
  const [addonQtys, setAddonQtys] = useState({});
  const [checkoutDonation, setCheckoutDonation] = useState('');
  const [answers, setAnswers] = useState({});
  const [code, setCode] = useState('');
  const [payMethod, setPayMethod] = useState('card'); // 'saved_card' | 'card' | 'apple_pay' | 'google_pay' | 'course'
  const [cardLast4, setCardLast4] = useState('4242');
  const [cardBrand, setCardBrand] = useState('Visa');
  const [saveCard, setSaveCard] = useState(true);

  // Standalone Donation modal/form states
  const [showDonateBox, setShowDonateBox] = useState(false);
  const [donForm, setDonForm] = useState({ donor_name: '', amount: '25', message: '', is_anonymous: false });

  // Sponsor purchase states
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [sponForm, setSponForm] = useState({ sponsor_name: '', logo_url: '', website_url: '', hole_number: '', shout_out_text: '', contact_email: '' });

  // On-course Concessions & Shop states
  const [shopItems, setShopItems] = useState([]);
  const [cartQtys, setCartQtys] = useState({});
  const [fulfillment, setFulfillment] = useState('turn_pickup');
  const [holeNum, setHoleNum] = useState('9');
  const [cartNum, setCartNum] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [myOrders, setMyOrders] = useState([]);

  // Event Chat states
  const [chatPosts, setChatPosts] = useState([]);
  const [chatNames, setChatNames] = useState({});
  const [chatText, setChatText] = useState('');

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

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', me).maybeSingle();
    if (prof) {
      setMyProfile(prof);
      if (prof.saved_pm_last4) setPayMethod('saved_card');
      setDonForm(f => ({ ...f, donor_name: f.donor_name || prof.username || '' }));
    }

    if (data.event?.community_id) {
      const { data: mem } = await supabase.from('memberships')
        .select('status')
        .eq('community_id', data.event.community_id)
        .eq('profile_id', me)
        .eq('status', 'active')
        .maybeSingle();
      setIsMember(!!mem);
    }

    const { data: m } = await supabase.rpc('can_manage_event', { e: eventId });
    setCanManage(!!m);

    // Load shop products for community or operator
    const ev = data.event;
    if (ev.community_id || ev.organization_id) {
      const col = ev.community_id ? 'community_id' : 'organization_id';
      const val = ev.community_id || ev.organization_id;
      const { data: prods } = await supabase.from('shop_products').select('*').eq(col, val).eq('is_active', true).order('category');
      setShopItems(prods || []);
    }
    const { data: ords } = await supabase.from('shop_orders').select('*').eq('event_id', eventId).eq('profile_id', me).order('created_at', { ascending: false });
    setMyOrders(ords || []);
  };

  const loadChat = async () => {
    const { data: posts } = await supabase.from('community_posts').select('*').eq('event_id', eventId).order('created_at', { ascending: true }).limit(100);
    setChatPosts(posts || []);
    const ids = [...new Set((posts || []).map(p => p.author_id))];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username, initials').in('id', ids);
      setChatNames(Object.fromEntries((profs || []).map(p => [p.id, p])));
    }
  };

  useEffect(() => { load(); loadChat(); }, [eventId]);

  useEffect(() => {
    const ch = supabase.channel(`myreg-${eventId}-${me}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `profile_id=eq.${me}` },
        (p) => { if (p.new?.event_id === eventId) setReg(p.new.status === 'cancelled' ? null : p.new); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_posts', filter: `event_id=eq.${eventId}` },
        () => loadChat())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_orders', filter: `profile_id=eq.${me}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]);

  if (err && !info) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← EVENTS</button></div><div className="fs-error">{err}</div></div>;
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
  const addons = Array.isArray(info.addons) ? info.addons : [];
  const sponsorPackages = Array.isArray(info.sponsor_packages) ? info.sponsor_packages : [];
  const sponsors = Array.isArray(info.sponsors) ? info.sponsors : [];

  // Calculate live checkout totals
  const unitEntryCents = t
    ? (isMember && t.member_price_cents != null ? t.member_price_cents : t.price_cents)
    : 0;
  const mult = ev.team_size > 1 ? Math.max(1, Math.min(4, Number(teamCount) || 1)) : 1;
  const entryTotalCents = unitEntryCents * mult;
  const addonsTotalCents = addons.reduce((sum, a) => sum + (a.price_cents * (Number(addonQtys[a.id]) || 0)), 0);
  const donationCents = checkoutDonation ? Math.max(0, Math.round(Number(checkoutDonation) * 100)) : 0;
  const subtotalCents = entryTotalCents + addonsTotalCents + donationCents;
  const procFeeCents = subtotalCents > 0 && payMethod !== 'course' ? calcProcessingFee(subtotalCents) : 0;
  const grandTotalCents = ev.pass_processing_fee ? subtotalCents + procFeeCents : subtotalCents;

  const register = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const addonPayload = Object.entries(addonQtys)
        .filter(([, q]) => Number(q) > 0)
        .map(([addon_id, qty]) => ({ addon_id, qty: Number(qty) }));

      let res;
      try {
        res = await rpc('checkout_event_registration', {
          p_event_id: eventId,
          p_ticket_type_id: ticket || null,
          p_team_name: teamName || null,
          p_team_count: mult,
          p_addons: addonPayload,
          p_donation_cents: donationCents,
          p_answers: answers,
          p_discount_code: code || null,
          p_payment_method: payMethod,
          p_save_card: saveCard,
          p_card_brand: myProfile?.saved_pm_brand || cardBrand,
          p_card_last4: myProfile?.saved_pm_last4 || cardLast4,
        });
        setReg(res.registration);
        const r = res.registration;
        setMsg(r.status === 'waitlisted'
          ? `You're #${r.waitlist_position} on the waitlist. We'll notify you if a spot opens.`
          : `You're in! ${r.total_paid_cents > 0 ? `Paid ${moneyExact(r.total_paid_cents)} via Stripe.` : ''}`);
      } catch {
        // Fallback if Phase 2 SQL hasn't been run yet
        const r = await rpc('register_for_event', {
          p_event_id: eventId, p_ticket_type_id: ticket || null, p_team_id: null, p_answers: answers, p_discount_code: code || null,
        });
        setReg(r);
        setMsg(r.status === 'waitlisted' ? `You're #${r.waitlist_position} on the waitlist.` : "You're in!");
      }
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const submitDonation = async () => {
    const centsVal = Math.round(Number(donForm.amount) * 100);
    if (!centsVal || centsVal < 100) return setErr('Enter a donation of at least $1.');
    setBusy(true); setErr('');
    try {
      await rpc('make_event_donation', {
        p_event_id: eventId,
        p_donor_name: donForm.donor_name || myProfile?.username || 'Anonymous Golfer',
        p_amount_cents: centsVal,
        p_message: donForm.message || null,
        p_is_anonymous: donForm.is_anonymous,
      });
      setMsg(`Thank you for your ${money(centsVal)} donation!`);
      setShowDonateBox(false);
      setDonForm(f => ({ ...f, amount: '25', message: '' }));
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const submitSponsorship = async () => {
    if (!selectedPkg) return;
    if (!sponForm.sponsor_name.trim()) return setErr('Enter your business or sponsor name.');
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
      setMsg(`${sponForm.sponsor_name} is now an official sponsor! Your logo is live on the event page, TV leaderboard, and cart signs.`);
      setSelectedPkg(null);
      setSponForm({ sponsor_name: '', logo_url: '', website_url: '', hole_number: '', shout_out_text: '', contact_email: '' });
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const placeOrder = async () => {
    const items = Object.entries(cartQtys)
      .filter(([, q]) => Number(q) > 0)
      .map(([product_id, qty]) => ({ product_id, qty: Number(qty) }));
    if (!items.length) return setErr('Select at least one item to order.');
    setBusy(true); setErr('');
    try {
      await rpc('place_shop_order', {
        p_community_id: ev.community_id || null,
        p_organization_id: ev.organization_id || null,
        p_course_id: ev.course_id || null,
        p_event_id: eventId,
        p_channel: 'on_course',
        p_fulfillment: fulfillment,
        p_hole_number: fulfillment === 'cart_delivery' ? Number(holeNum) || 9 : null,
        p_cart_number: cartNum || null,
        p_items: items,
        p_notes: orderNotes || null,
      });
      setCartQtys({});
      setOrderNotes('');
      setMsg(fulfillment === 'turn_pickup'
        ? 'Order sent to the kitchen! Ready for pickup at the turn.'
        : fulfillment === 'cart_delivery'
          ? `Order queued for beverage/food cart delivery to Hole ${holeNum}!`
          : 'Order sent to the Pro Shop!');
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const postChat = async () => {
    if (!chatText.trim()) return;
    const { error } = await supabase.from('community_posts').insert([{
      event_id: eventId,
      community_id: ev.community_id || null,
      author_id: me,
      kind: 'chat',
      body: chatText.trim(),
    }]);
    if (error) return setErr(friendly(error));
    setChatText('');
    loadChat();
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
  const raisedCents = info.donations_raised_cents || 0;
  const goalCents = ev.fundraising_goal_cents || 0;
  const showFundraiser = ev.allow_donations || goalCents > 0 || raisedCents > 0;

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
        {isMember && <span className="fs-pill live">✓ Member pricing active</span>}
        {ev.invite_only_top_n && <span className="fs-pill">Top {ev.invite_only_top_n} invite</span>}
      </div>

      <div className="fs-seg wrap">
        {[
          ['info', 'Details'],
          ['board', 'Leaderboard'],
          ['sponsors', `Sponsors${sponsors.length ? ` (${sponsors.length})` : ''}`],
          ['shop', '🍔 Turn / Shop'],
          ['chat', '💬 Chat'],
        ].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      {tab === 'board' && <Leaderboard eventId={eventId} me={me} />}

      {tab === 'info' && (
        <>
          {ev.description && <p className="fs-sub" style={{ whiteSpace: 'pre-line' }}>{ev.description}</p>}
          <div className="cm-facts">
            <div><b>{ev.capacity ? `${info.confirmed} / ${ev.capacity}` : info.confirmed}</b><span>players</span></div>
            <div><b>{info.waitlisted}</b><span>waitlist</span></div>
            <div><b>{t ? money(unitEntryCents) : 'Free'}</b><span>entry{t?.member_price_cents != null && !isMember ? ` · members ${money(t.member_price_cents)}` : ''}</span></div>
          </div>

          {/* 2.3 Charity Fundraising Progress Bar & Standalone Donation */}
          {showFundraiser && (
            <div className="fs-card" style={{ borderColor: 'rgba(212, 184, 122, 0.35)' }}>
              <div className="fs-card-row">
                <div>
                  <div className="fs-eyebrow">💝 Charity Fundraiser</div>
                  <div className="fs-card-title">{ev.donation_title || 'Event Charity Fund'}</div>
                </div>
                <button className="fs-small-btn" onClick={() => setShowDonateBox(v => !v)}>
                  {showDonateBox ? 'Close' : '💝 Donate'}
                </button>
              </div>
              <div style={{ margin: '8px 0 4px', fontSize: 13 }}>
                <b style={{ color: 'var(--gold-bright)' }}>{money(raisedCents)}</b> raised
                {goalCents > 0 ? ` of ${money(goalCents)} goal (${Math.min(100, Math.round((raisedCents / goalCents) * 100))}%)` : ''}
                {info.donations_count ? ` · ${info.donations_count} donor${info.donations_count === 1 ? '' : 's'}` : ''}
              </div>
              {goalCents > 0 && (
                <div className="cm-bar"><div style={{ width: `${Math.min(100, (raisedCents / goalCents) * 100)}%` }} /></div>
              )}
              {showDonateBox && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {['10', '25', '50', '100'].map(amt => (
                      <button key={amt} type="button" className={`fs-small-btn ${donForm.amount === amt ? '' : 'ghost'}`} onClick={() => setDonForm({ ...donForm, amount: amt })}>
                        ${amt}
                      </button>
                    ))}
                  </div>
                  <div className="cm-row2">
                    <input className="fs-input" type="number" min={1} placeholder="Amount ($)" value={donForm.amount} onChange={e => setDonForm({ ...donForm, amount: e.target.value })} />
                    <input className="fs-input" placeholder="Your name" value={donForm.donor_name} onChange={e => setDonForm({ ...donForm, donor_name: e.target.value })} />
                  </div>
                  <input className="fs-input" placeholder="Message of support (optional)" value={donForm.message} onChange={e => setDonForm({ ...donForm, message: e.target.value })} />
                  <label className="fs-toggle"><input type="checkbox" checked={donForm.is_anonymous} onChange={e => setDonForm({ ...donForm, is_anonymous: e.target.checked })} /> Make my donation anonymous</label>
                  <button className="fs-cta" disabled={busy} onClick={submitDonation}>{busy ? 'Processing…' : `Donate $${donForm.amount || 0} via Stripe`}</button>
                </div>
              )}
              {(info.recent_donations || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {(info.recent_donations || []).slice(0, 3).map(d => (
                    <div key={d.id} className="fs-card-meta" style={{ marginTop: 3 }}>
                      💚 <b>{d.donor_name}</b> donated {money(d.amount_cents)}{d.message ? ` — "${d.message}"` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active Sponsor Strip on Details tab */}
          {sponsors.length > 0 && (
            <div className="fs-card">
              <div className="fs-card-row">
                <span className="fs-section-title" style={{ margin: 0 }}>Official Event Sponsors</span>
                <button className="fs-link" onClick={() => setTab('sponsors')}>View all / Sponsor →</button>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                {sponsors.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 4 }} />}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cream)' }}>{s.sponsor_name}</div>
                      {s.hole_number && <div style={{ fontSize: 10, color: 'var(--gold-bright)' }}>Hole {s.hole_number} Sponsor</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reg ? (
            <div className="fs-result-card">
              <div className="fs-card-row">
                <span className="fs-card-title">{STATUS_LABELS[reg.status]}{reg.status === 'waitlisted' ? ` · #${reg.waitlist_position}` : ''}</span>
                {reg.amount_due_cents > 0 && (
                  <span className={`fs-pill ${reg.paid_at_course_at ? 'live' : ''}`}>
                    {reg.paid_at_course_at ? `Paid ${moneyExact(reg.total_paid_cents || reg.amount_due_cents)}` : `${moneyExact(reg.amount_due_cents)} due at course`}
                  </span>
                )}
              </div>
              {Array.isArray(reg.addons) && reg.addons.length > 0 && (
                <div className="fs-card-meta" style={{ marginTop: 4 }}>
                  Add-ons: {reg.addons.map(a => `${a.name} ×${a.qty}`).join(' · ')}
                </div>
              )}
              {playing && (
                <>
                  <QrCode value={`foresome:checkin:${reg.id}`} label="Show this at the pro shop to check in" />
                  {reg.status === 'confirmed' && isToday(ev.starts_at) && <button className="fs-cta" onClick={selfCheckIn}>I'm here — check me in</button>}
                  {['published', 'live'].includes(ev.status) && <button className="fs-cta" onClick={() => setScoring(true)}>Enter scores</button>}
                  <button className="fs-small-btn ghost" style={{ marginTop: 8, width: '100%' }} onClick={() => setTab('shop')}>
                    🍔 Order Turn Food / Drinks to Your Cart
                  </button>
                </>
              )}
              {ev.status !== 'completed' && <button className="fs-cta secondary" onClick={cancel}>Cancel my spot</button>}
            </div>
          ) : open ? (
            <div className="fs-result-card">
              <div className="fs-card-title">{full ? (ev.allow_waitlist ? 'Join the waitlist' : 'Event is full') : 'Sign up & Checkout'}</div>

              {(info.tickets || []).length > 1 && (
                <label className="fs-field">Entry Ticket
                  <select className="fs-input" value={ticket} onChange={e => setTicket(e.target.value)}>
                    {info.tickets.map(x => (
                      <option key={x.id} value={x.id}>
                        {x.name} — {money(isMember && x.member_price_cents != null ? x.member_price_cents : x.price_cents)}
                        {x.members_only ? ' (members only)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Team Entry support in one checkout */}
              {ev.team_size > 1 && (
                <div className="cm-row2">
                  <label className="fs-field">Team Name
                    <input className="fs-input" placeholder="Fairway Legends" value={teamName} onChange={e => setTeamName(e.target.value)} />
                  </label>
                  <label className="fs-field">Players to Pay For
                    <select className="fs-input" value={teamCount} onChange={e => setTeamCount(Number(e.target.value))}>
                      {Array.from({ length: ev.team_size }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n === 1 ? 'Just me (1)' : `${n} players (${money(unitEntryCents * n)})`}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {/* 2.1 Add-ons (Mulligans, Range Balls, Box Lunch, etc.) */}
              {addons.length > 0 && (
                <>
                  <div className="fs-section-title">Optional Add-Ons</div>
                  {addons.map(a => {
                    const left = a.stock_count != null ? Math.max(0, a.stock_count - (a.sold_count || 0)) : null;
                    const maxQty = left != null ? Math.min(a.max_per_player || 4, left) : (a.max_per_player || 4);
                    return (
                      <div key={a.id} className="fs-card fs-card-row" style={{ marginBottom: 6 }}>
                        <div>
                          <div className="fs-board-name">{a.name} · {money(a.price_cents)}</div>
                          <div className="fs-board-meta">{left != null ? `${left} left` : `Up to ${a.max_per_player || 4}`}</div>
                        </div>
                        <select
                          className="fs-input"
                          style={{ width: 78, margin: 0 }}
                          value={addonQtys[a.id] || 0}
                          onChange={e => setAddonQtys({ ...addonQtys, [a.id]: Number(e.target.value) })}
                        >
                          {Array.from({ length: maxQty + 1 }, (_, i) => (
                            <option key={i} value={i}>{i === 0 ? '0' : `${i}×`}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Optional Charity Donation at Checkout */}
              {ev.allow_donations && (
                <label className="fs-field">Optional Donation to {ev.donation_title || 'Event Charity'} ($)
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    {['0', '10', '25', '50'].map(v => (
                      <button key={v} type="button" className={`fs-small-btn ${(checkoutDonation || '0') === v ? '' : 'ghost'}`} onClick={() => setCheckoutDonation(v === '0' ? '' : v)}>
                        {v === '0' ? 'None' : `+$${v}`}
                      </button>
                    ))}
                  </div>
                  <input className="fs-input" type="number" min={0} placeholder="Custom donation ($)" value={checkoutDonation} onChange={e => setCheckoutDonation(e.target.value)} />
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

              {subtotalCents > 0 && !full && (
                <>
                  <input className="fs-input" placeholder="Discount code (optional)" value={code} onChange={e => setCode(e.target.value)} />

                  {/* Payment Method Selection (Stripe Connect: Card, Apple/Google Pay, Saved Card, or Course) */}
                  <div className="fs-section-title">Payment Method (Stripe Connect)</div>
                  <div className="fs-seg wrap">
                    {myProfile?.saved_pm_last4 && (
                      <button type="button" className={payMethod === 'saved_card' ? 'on' : ''} onClick={() => setPayMethod('saved_card')}>
                        💳 {myProfile.saved_pm_brand || 'Card'} ••{myProfile.saved_pm_last4}
                      </button>
                    )}
                    <button type="button" className={payMethod === 'card' ? 'on' : ''} onClick={() => setPayMethod('card')}>💳 Card</button>
                    <button type="button" className={payMethod === 'apple_pay' ? 'on' : ''} onClick={() => setPayMethod('apple_pay')}> Apple Pay</button>
                    <button type="button" className={payMethod === 'google_pay' ? 'on' : ''} onClick={() => setPayMethod('google_pay')}>G Pay</button>
                    <button type="button" className={payMethod === 'course' ? 'on' : ''} onClick={() => setPayMethod('course')}>🏢 At Course</button>
                  </div>

                  {payMethod === 'card' && (
                    <div className="cm-row2" style={{ marginTop: 8 }}>
                      <select className="fs-input" value={cardBrand} onChange={e => setCardBrand(e.target.value)}>
                        <option value="Visa">Visa</option>
                        <option value="Mastercard">Mastercard</option>
                        <option value="Amex">Amex</option>
                      </select>
                      <input className="fs-input" maxLength={4} placeholder="Last 4 digits (4242)" value={cardLast4} onChange={e => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                    </div>
                  )}

                  {payMethod !== 'course' && (
                    <label className="fs-toggle">
                      <input type="checkbox" checked={saveCard} onChange={e => setSaveCard(e.target.checked)} />
                      Save payment method on my profile for 1-tap turn concessions & future events
                    </label>
                  )}

                  {/* Transparent Line-Item Breakdown */}
                  <div className="fs-card" style={{ marginTop: 8, fontSize: 12 }}>
                    <div className="fs-card-row"><span>Entry ({mult} player{mult > 1 ? 's' : ''})</span><span>{moneyExact(entryTotalCents)}</span></div>
                    {addonsTotalCents > 0 && <div className="fs-card-row"><span>Add-ons</span><span>{moneyExact(addonsTotalCents)}</span></div>}
                    {donationCents > 0 && <div className="fs-card-row"><span>Charity Donation</span><span>{moneyExact(donationCents)}</span></div>}
                    {payMethod !== 'course' && (
                      ev.pass_processing_fee ? (
                        <div className="fs-card-row" style={{ color: 'var(--text-dim)' }}>
                          <span>Stripe Processing Fee (2.9% + 30¢)</span>
                          <span>{moneyExact(procFeeCents)}</span>
                        </div>
                      ) : (
                        <div className="fs-card-row" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                          <span>Processing fee</span>
                          <span>Absorbed by organizer ($0.00)</span>
                        </div>
                      )
                    )}
                    <div className="fs-card-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 6, fontWeight: 700, fontSize: 14 }}>
                      <span>Total {payMethod === 'course' ? 'Due at Course' : 'Charged Now'}</span>
                      <span style={{ color: 'var(--gold-bright)' }}>{moneyExact(grandTotalCents)}</span>
                    </div>
                  </div>
                </>
              )}

              <button className="fs-cta" disabled={busy || (full && !ev.allow_waitlist)} onClick={register}>
                {busy ? 'Processing…' : full ? 'Join waitlist' : grandTotalCents > 0 && payMethod !== 'course' ? `Pay ${moneyExact(grandTotalCents)} & Confirm Spot` : 'Sign up'}
              </button>
            </div>
          ) : (
            <div className="fs-empty">{ev.status === 'completed' ? 'This event is finished. See the leaderboard.' : 'Registration is closed.'}</div>
          )}
        </>
      )}

      {/* 2.2 SPONSORSHIPS TAB */}
      {tab === 'sponsors' && (
        <>
          <div className="fs-section-title">Active Event & Season Sponsors</div>
          {sponsors.map(s => (
            <div key={s.id} className="fs-card">
              <div className="fs-card-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {s.logo_url && <img src={s.logo_url} alt={s.sponsor_name} style={{ width: 42, height: 42, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.06)', padding: 4 }} />}
                  <div>
                    <div className="fs-card-title">{s.sponsor_name}</div>
                    <div className="fs-card-meta">
                      {s.hole_number ? `Hole #${s.hole_number} Sponsor · ` : ''}
                      {(s.benefits || []).map(b => SPONSOR_BENEFIT_LABELS[b] || b).join(' · ')}
                    </div>
                  </div>
                </div>
                {s.website_url && <a className="fs-small-btn ghost" href={s.website_url} target="_blank" rel="noreferrer">Visit ↗</a>}
              </div>
              {s.shout_out_text && <p className="fs-sub" style={{ marginTop: 6, marginBottom: 0 }}>"{s.shout_out_text}"</p>}
            </div>
          ))}
          {!sponsors.length && <div className="fs-empty">No sponsors yet. Be the first to sponsor this event!</div>}

          <div className="fs-section-title">Available Sponsor Packages</div>
          {sponsorPackages.map(pkg => {
            const left = pkg.quantity != null ? Math.max(0, pkg.quantity - (pkg.sold_count || 0)) : null;
            return (
              <div key={pkg.id} className="fs-card">
                <div className="fs-card-row">
                  <div>
                    <div className="fs-card-title">{pkg.name} — {money(pkg.price_cents)}</div>
                    <div className="fs-card-meta">
                      {pkg.season_id && !pkg.event_id ? '🌟 Season-Long Package (All Season Events) · ' : ''}
                      {left != null ? `${left} of ${pkg.quantity} remaining` : 'Available'}
                    </div>
                  </div>
                  <button className="fs-small-btn" disabled={left === 0} onClick={() => setSelectedPkg(pkg)}>
                    {left === 0 ? 'Sold out' : 'Sponsor →'}
                  </button>
                </div>
                <div className="cm-tags" style={{ marginTop: 6 }}>
                  {(pkg.benefits || []).map(b => <span key={b} className="fs-pill">{SPONSOR_BENEFIT_LABELS[b] || b}</span>)}
                </div>
              </div>
            );
          })}
          {!sponsorPackages.length && <div className="fs-empty">Organizer hasn't posted sponsor packages yet.</div>}

          {selectedPkg && (
            <div className="fs-result-card">
              <div className="fs-card-row">
                <span className="fs-card-title">Sponsor Checkout: {selectedPkg.name} ({money(selectedPkg.price_cents)})</span>
                <button className="fs-x" onClick={() => setSelectedPkg(null)}>✕</button>
              </div>
              <label className="fs-field">Business / Sponsor Name *
                <input className="fs-input" placeholder="KC Golf Co." value={sponForm.sponsor_name} onChange={e => setSponForm({ ...sponForm, sponsor_name: e.target.value })} />
              </label>
              <div className="cm-row2">
                <label className="fs-field">Logo Image URL (shown on TV & Cart Signs)
                  <input className="fs-input" placeholder="https://…/logo.png" value={sponForm.logo_url} onChange={e => setSponForm({ ...sponForm, logo_url: e.target.value })} />
                </label>
                <label className="fs-field">Preferred Hole # (1–18)
                  <input className="fs-input" type="number" min={1} max={18} placeholder="1" value={sponForm.hole_number} onChange={e => setSponForm({ ...sponForm, hole_number: e.target.value })} />
                </label>
              </div>
              <div className="cm-row2">
                <label className="fs-field">Website URL
                  <input className="fs-input" placeholder="https://…" value={sponForm.website_url} onChange={e => setSponForm({ ...sponForm, website_url: e.target.value })} />
                </label>
                <label className="fs-field">Contact Email
                  <input className="fs-input" type="email" placeholder="sponsor@company.com" value={sponForm.contact_email} onChange={e => setSponForm({ ...sponForm, contact_email: e.target.value })} />
                </label>
              </div>
              <label className="fs-field">Leaderboard & Announcer Shout-Out
                <input className="fs-input" placeholder="Proud supporter of KC golf! Stop by for 15% off." value={sponForm.shout_out_text} onChange={e => setSponForm({ ...sponForm, shout_out_text: e.target.value })} />
              </label>
              <button className="fs-cta" disabled={busy} onClick={submitSponsorship}>
                {busy ? 'Processing…' : `Pay ${money(selectedPkg.price_cents)} & Activate Sponsorship`}
              </button>
            </div>
          )}
        </>
      )}

      {/* 3.3 ON-COURSE CONCESSIONS & PRO SHOP ORDERING TAB */}
      {tab === 'shop' && (
        <>
          <div className="fs-eyebrow">1-Tap On-Course Ordering · Shared Live Inventory</div>
          <p className="fs-sub">Order food, cold drinks, or pro shop merch from the fairway. Pick up at the turn or have it delivered to your cart.</p>

          <div className="fs-seg">
            <button type="button" className={fulfillment === 'turn_pickup' ? 'on' : ''} onClick={() => setFulfillment('turn_pickup')}>🍔 Pickup at the Turn</button>
            <button type="button" className={fulfillment === 'cart_delivery' ? 'on' : ''} onClick={() => setFulfillment('cart_delivery')}>🛺 Cart Delivery</button>
            <button type="button" className={fulfillment === 'pro_shop' ? 'on' : ''} onClick={() => setFulfillment('pro_shop')}>🛍️ Pro Shop</button>
          </div>

          {fulfillment === 'cart_delivery' && (
            <div className="cm-row2" style={{ marginTop: 8 }}>
              <label className="fs-field">Your Current Hole #
                <input className="fs-input" type="number" min={1} max={18} value={holeNum} onChange={e => setHoleNum(e.target.value)} />
              </label>
              <label className="fs-field">Cart # / Group #
                <input className="fs-input" placeholder="Cart 14 / Group 3" value={cartNum} onChange={e => setCartNum(e.target.value)} />
              </label>
            </div>
          )}

          <div className="fs-section-title">Menu & Pro Shop Catalog</div>
          {shopItems.map(item => {
            const price = isMember && item.member_price_cents != null ? item.member_price_cents : item.price_cents;
            return (
              <div key={item.id} className="fs-card fs-card-row">
                <div>
                  <div className="fs-card-title">{item.name} — {money(price)}</div>
                  <div className="fs-card-meta">
                    {item.category.toUpperCase()} · {item.stock_count} in stock
                    {item.description ? ` · ${item.description}` : ''}
                  </div>
                </div>
                <select
                  className="fs-input"
                  style={{ width: 78, margin: 0 }}
                  disabled={item.stock_count <= 0}
                  value={cartQtys[item.id] || 0}
                  onChange={e => setCartQtys({ ...cartQtys, [item.id]: Number(e.target.value) })}
                >
                  {Array.from({ length: Math.min(10, item.stock_count) + 1 }, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '0' : `${i}×`}</option>
                  ))}
                </select>
              </div>
            );
          })}
          {!shopItems.length && <div className="fs-empty">No pro shop or concession items posted for this host yet.</div>}

          {Object.values(cartQtys).some(q => Number(q) > 0) && (
            <div className="fs-result-card">
              <input className="fs-input" placeholder="Special instructions (e.g. no onions, extra ice)" value={orderNotes} onChange={e => setOrderNotes(e.target.value)} />
              <button className="fs-cta" disabled={busy} onClick={placeOrder}>
                {busy ? 'Sending order…' : `Pay with ${myProfile?.saved_pm_last4 ? `${myProfile.saved_pm_brand || 'Card'} ••${myProfile.saved_pm_last4}` : 'Stripe'} & Send Order`}
              </button>
            </div>
          )}

          {myOrders.length > 0 && (
            <>
              <div className="fs-section-title">My Active Orders</div>
              {myOrders.map(o => (
                <div key={o.id} className="fs-card">
                  <div className="fs-card-row">
                    <span className="fs-card-title">{o.fulfillment === 'cart_delivery' ? `🛺 Cart Delivery (Hole ${o.hole_number || '—'})` : o.fulfillment === 'turn_pickup' ? '🍔 Turn Pickup' : '🛍️ Pro Shop'}</span>
                    <span className={`fs-pill ${o.status === 'ready' || o.status === 'delivered' ? 'live' : ''}`}>{o.status.toUpperCase()}</span>
                  </div>
                  <div className="fs-card-meta">
                    {(o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ')} · {moneyExact(o.total_cents)}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* 3.4 EVENT CHAT TAB */}
      {tab === 'chat' && (
        <>
          <div className="fs-section-title">Live Event Banter & Updates</div>
          <div className="fs-card" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {chatPosts.map(p => (
              <div key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 11, color: 'var(--gold-bright)', fontWeight: 700 }}>
                  {chatNames[p.author_id]?.username || 'Golfer'} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {when(p.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--cream)', marginTop: 2 }}>{p.body}</div>
              </div>
            ))}
            {!chatPosts.length && <div className="fs-empty">No messages yet. Start the event chat!</div>}
          </div>
          <div className="fs-guest">
            <input className="fs-input" placeholder="Message players in this event…" value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => e.key === 'Enter' && postChat()} />
            <button className="fs-small-btn" onClick={postChat}>Send</button>
          </div>
        </>
      )}
    </div>
  );
}
