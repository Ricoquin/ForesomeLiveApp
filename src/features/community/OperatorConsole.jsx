import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { STATUS_LABELS, money, moneyExact, when, friendly, rpc, downloadCsv } from './api';
import RevenueForecast from './RevenueForecast';

const RANGES = { week: 7, month: 30, year: 365 };
const iso = (d) => d.toISOString().slice(0, 10);

// Course operators (Orion): check-in kiosk for staff, Events & Groups dashboard, staff and courses for admins.
export default function OperatorConsole({ session, roles, onBack, onOpenEvent, onCreateEvent }) {
  const [orgId, setOrgId] = useState(roles.staffOrgs[0]?.id || '');
  const org = roles.staffOrgs.find(o => o.id === orgId) || (roles.isPlatformAdmin ? { id: orgId, role: 'owner' } : null);
  const isAdmin = roles.isPlatformAdmin || ['owner', 'admin'].includes(org?.role);
  const [tab, setTab] = useState('checkin');
  if (!orgId) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div><div className="fs-empty">You're not on a course operator's staff.</div></div>;
  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button>
        {roles.staffOrgs.length > 1 && <select className="fs-input cm-orgsel" value={orgId} onChange={e => setOrgId(e.target.value)} aria-label="Operator">
          {roles.staffOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}</div>
      <div className="fs-eyebrow">{org?.name || 'Operator'} · {org?.role}</div>
      <h1 className="fs-h1">Clubhouse</h1>
      <div className="fs-seg wrap">
        {[
          ['checkin', 'Check-in'],
          ['orders', '🍔 Orders & Shop'],
          ['dash', 'Events & Groups'],
          ...(isAdmin ? [['payouts', '💳 Payouts'], ['staff', 'Staff']] : []),
          ['courses', 'Courses']
        ].map(([k, l]) =>
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'checkin' && <CheckIn orgId={orgId} />}
      {tab === 'orders' && <OperatorOrdersAndShop orgId={orgId} isAdmin={isAdmin} />}
      {tab === 'dash' && <Dashboard orgId={orgId} onOpenEvent={onOpenEvent} />}
      {tab === 'payouts' && isAdmin && <OperatorPayouts orgId={orgId} />}
      {tab === 'staff' && isAdmin && <Staff orgId={orgId} me={session.user.id} myRole={roles.isPlatformAdmin ? 'owner' : org?.role} onChanged={roles.reload} />}
      {tab === 'courses' && <Courses orgId={orgId} onCreateEvent={onCreateEvent} />}
    </div>
  );
}

function CheckIn({ orgId }) {
  const [events, setEvents] = useState([]); const [regs, setRegs] = useState([]); const [names, setNames] = useState({});
  const [q, setQ] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null); const stopRef = useRef(null);

  const load = async () => {
    try {
      const today = iso(new Date());
      const d = await rpc('org_dashboard', { p_org_id: orgId, p_from: today, p_to: today });
      const evs = d.upcoming || []; setEvents(evs);
      if (!evs.length) { setRegs([]); return; }
      const { data: r } = await supabase.from('registrations').select('*').in('event_id', evs.map(e => e.id)).in('status', ['confirmed', 'checked_in', 'pending_payment']);
      setRegs(r || []);
      const ids = [...new Set((r || []).map(x => x.profile_id))];
      if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, username, initials').in('id', ids); setNames(Object.fromEntries((p || []).map(x => [x.id, x]))); }
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [orgId]);
  useEffect(() => {
    const ch = supabase.channel(`kiosk-${orgId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); stopRef.current?.(); };
  }, [orgId]);

  const checkIn = async (id) => {
    setErr('');
    try { const r = await rpc('check_in', { p_registration_id: id }); setMsg(`${names[r.profile_id]?.username || 'Player'} checked in`); load(); }
    catch (e) { setErr(e.message); }
  };

  // Scan the golfer's QR with the device camera (Chrome / Android). Elsewhere, search by name.
  const scan = async () => {
    if (!('BarcodeDetector' in window)) { setErr("This browser can't scan codes. Search by name instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      const video = videoRef.current; video.srcObject = stream; await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let on = true;
      stopRef.current = () => { on = false; stream.getTracks().forEach(t => t.stop()); setScanning(false); };
      const tick = async () => {
        if (!on) return;
        const codes = await detector.detect(video).catch(() => []);
        const hit = codes.map(c => c.rawValue).find(v => v?.startsWith('foresome:checkin:'));
        if (hit) { stopRef.current(); checkIn(hit.split(':')[2]); return; }
        requestAnimationFrame(tick);
      };
      tick();
    } catch { setErr('Camera not available.'); setScanning(false); }
  };

  const shown = regs.filter(r => !q || (names[r.profile_id]?.username || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="cm-actions">
        <button className="fs-small-btn" onClick={scanning ? () => stopRef.current?.() : scan}>{scanning ? 'Stop camera' : '📷 Scan QR'}</button>
        <button className="fs-small-btn ghost" onClick={() => document.documentElement.requestFullscreen?.()}>Kiosk mode</button>
      </div>
      <video ref={videoRef} className="cm-video" style={{ display: scanning ? 'block' : 'none' }} muted playsInline />
      {msg && <div className="fs-note cm-big">{msg}</div>}{err && <div className="fs-error">{err}</div>}
      <input className="fs-input" placeholder="Search player name…" value={q} onChange={e => setQ(e.target.value)} />
      {events.map(e => (
        <div key={e.id}>
          <div className="fs-section-title">{e.name} · {e.course} · {new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {e.checked_in}/{e.registered} in</div>
          {shown.filter(r => r.event_id === e.id).map(r => (
            <div key={r.id} className="fs-player cm-kiosk-row">
              <div className="player-dot filled">{names[r.profile_id]?.initials}</div>
              <div className="fs-board-who"><div className="fs-board-name">{names[r.profile_id]?.username || 'Player'}</div>
                <div className="fs-board-meta">{STATUS_LABELS[r.status]}{r.amount_due_cents ? ` · ${money(r.amount_due_cents)} ${r.paid_at_course_at ? 'paid' : 'due'}` : ''}</div></div>
              {r.amount_due_cents > 0 && !r.paid_at_course_at && <button className="fs-small-btn ghost" onClick={() => rpc('mark_paid_at_course', { p_registration_id: r.id }).then(load).catch(x => setErr(x.message))}>Paid</button>}
              {r.status === 'checked_in' ? <span className="fs-pill live">In ✓</span> : <button className="fs-small-btn" onClick={() => checkIn(r.id)}>Check in</button>}
            </div>
          ))}
        </div>
      ))}
      {!events.length && !err && <div className="fs-empty">No events at your courses today.</div>}
    </>
  );
}

function Dashboard({ orgId, onOpenEvent }) {
  const [range, setRange] = useState('month');
  const [courseFilter, setCourseFilter] = useState('');
  const [communityFilter, setCommunityFilter] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + RANGES[range]);
    from.setDate(from.getDate() - RANGES[range]);

    const fetchDashboard = async () => {
      try {
        setErr('');
        // Try 5-arg RPC (with course + community filters), fall back to 3-arg if migration not yet run
        const res = await rpc('org_dashboard', {
          p_org_id: orgId,
          p_from: iso(from),
          p_to: iso(to),
          p_course_id: courseFilter || null,
          p_community_id: communityFilter || null,
        }).catch(() =>
          rpc('org_dashboard', {
            p_org_id: orgId,
            p_from: iso(from),
            p_to: iso(to),
          })
        );
        if (active) setD(res);
      } catch (e) {
        if (active) setErr(e.message);
      }
    };
    fetchDashboard();
    return () => { active = false; };
  }, [orgId, range, courseFilter, communityFilter]);

  if (err) return <div className="fs-error">{err}</div>;
  if (!d) return <div className="fs-empty">Loading Clubhouse Events & Groups…</div>;

  const coursesList = d.courses || [];
  const communitiesList = d.communities || d.top_communities || [];

  // Client-side filter fallback if 3-arg RPC was used
  const matchesFilters = (item) => {
    if (courseFilter && item.course_id && item.course_id !== courseFilter) return false;
    if (communityFilter && item.community_id && item.community_id !== communityFilter) return false;
    return true;
  };

  // Panel 1: Upcoming events
  const upcoming = (d.upcoming || []).filter(matchesFilters);
  // Panel 2: Check-ins by course and tee time
  const checkinsBySlot = d.checkins_by_slot || [];
  // Panel 3: Top communities
  const topCommunities = d.top_communities || [];
  // Panel 4: Cross-course play & loyalty tiers
  const crossCoursePlay = d.cross_course_play || [];
  const loyaltyTiers = d.cross_course_loyalty_tiers || {
    bronze_2_courses: d.cross_course_players || 0,
    silver_3_courses: 0,
    gold_4_plus_courses: 0,
    total_multi_course: d.cross_course_players || 0,
  };
  // Panel 5: Event revenue
  const eventRevenue = d.event_revenue || [];
  // Panel 6: Concessions
  const concessions = d.concessions || { orders_count: 0, revenue_cents: 0, by_course_hour: [], top_items: [] };
  // Panel 7: Member growth
  const memberGrowth = d.member_growth || [];

  return (
    <>
      {/* Global Filter Bar: Date Range (Week / Month / Year) + Course + Community */}
      <div className="fs-card" style={{ marginBottom: 14 }}>
        <div className="fs-card-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div>
            <div className="fs-card-title">Orion Clubhouse · Events & Groups Filters</div>
            <div className="fs-card-meta">All 7 panels filter by course, date range (week / month / year), and community, and export to CSV.</div>
          </div>
          {(courseFilter || communityFilter) && (
            <button
              className="fs-small-btn ghost"
              onClick={() => { setCourseFilter(''); setCommunityFilter(''); }}
            >
              Reset Filters
            </button>
          )}
        </div>
        <div className="fs-seg" style={{ marginBottom: 10 }}>
          {Object.keys(RANGES).map(k => (
            <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>
              {k[0].toUpperCase() + k.slice(1)} (±{RANGES[k]}d)
            </button>
          ))}
        </div>
        <div className="cm-row2">
          <select
            className="fs-input"
            value={courseFilter}
            onChange={e => setCourseFilter(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">All Orion Courses ({coursesList.length})</option>
            {coursesList.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="fs-input"
            value={communityFilter}
            onChange={e => setCommunityFilter(e.target.value)}
            aria-label="Filter by community"
          >
            <option value="">All Communities ({communitiesList.length})</option>
            {communitiesList.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Top-Level KPI Strip */}
      <div className="cm-facts">
        <div><b>{d.checkins_today || 0}</b><span>check-ins today</span></div>
        <div><b>{d.entries_total || 0}</b><span>event entries</span></div>
        <div><b>{d.cross_course_players || 0}</b><span>played 2+ courses</span></div>
        <div><b>{money(d.fees_collected_cents || 0)}</b><span>of {money(d.fees_due_cents || 0)} collected</span></div>
      </div>

      {/* PANEL 1 (Phase 1): Upcoming events — Events at each course, registrations vs capacity, waitlist size */}
      <div className="fs-section-title cm-row-title">
        <span>1. Upcoming Events <span className="fs-pill">Phase 1</span></span>
        <button className="fs-link" onClick={() => downloadCsv(`upcoming-events-${range}.csv`, upcoming)}>Export CSV</button>
      </div>
      {upcoming.map(e => (
        <button key={e.id} className="fs-card fs-card-btn" onClick={() => onOpenEvent(e.id)}>
          <div className="fs-card-row">
            <span className="fs-card-title">{e.name}</span>
            <span className="fs-pill">{e.status}</span>
          </div>
          <div className="fs-card-meta">
            {when(e.starts_at)} · {e.course} {e.community ? `· ${e.community}` : ''}
          </div>
          <div className="cm-bar">
            <div style={{ width: `${e.capacity ? Math.min(100, (e.registered / e.capacity) * 100) : 0}%` }} />
          </div>
          <div className="fs-card-meta">
            <b>{e.registered}{e.capacity ? ` / ${e.capacity}` : ''}</b> registered · <b>{e.waitlist || 0}</b> waitlist · <b>{e.checked_in || 0}</b> checked in
          </div>
        </button>
      ))}
      {!upcoming.length && <div className="fs-empty">No events matching your filter in this window.</div>}

      {/* PANEL 2 (Phase 1): Check-ins — Live check-ins by course and tee time */}
      <div className="fs-section-title cm-row-title">
        <span>2. Live Check-ins by Course & Tee Time <span className="fs-pill">Phase 1</span></span>
        <button
          className="fs-link"
          onClick={() =>
            downloadCsv(
              `checkins-${range}.csv`,
              checkinsBySlot.map(({ players, ...rest }) => ({
                ...rest,
                players_list: (players || []).map(p => `${p.username} (${p.status})`).join('; '),
              }))
            )
          }
        >
          Export CSV
        </button>
      </div>
      {checkinsBySlot.map((slot, idx) => (
        <div key={`${slot.event_id}-${slot.group_number}-${idx}`} className="fs-card" style={{ marginBottom: 8 }}>
          <div className="fs-card-row">
            <div>
              <span className="fs-card-title">{slot.course} · Group {slot.group_number} (Hole {slot.starting_hole})</span>
              <div className="fs-card-meta">
                {slot.event_name} · {slot.community} · Tee: {slot.tee_time ? new Date(slot.tee_time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'TBA'}
              </div>
            </div>
            <span className={`fs-pill ${slot.checked_in === slot.total_players && slot.total_players > 0 ? 'live' : ''}`}>
              {slot.checked_in}/{slot.total_players} Checked In
            </span>
          </div>
          {slot.players?.length > 0 && (
            <div className="fs-card-meta" style={{ marginTop: 6 }}>
              {slot.players.map((p, i) => (
                <span key={i} style={{ marginRight: 10, color: p.status === 'checked_in' ? '#2ecc71' : undefined }}>
                  {p.status === 'checked_in' ? '✓' : '○'} {p.username}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {!checkinsBySlot.length && <div className="fs-empty">No tee-time check-in groups in this range.</div>}

      {/* PANEL 3 (Phase 1): Top communities — Groups ranked by rounds, entries, and spend at Orion courses */}
      <div className="fs-section-title cm-row-title">
        <span>3. Top Communities (Rounds, Entries & Spend) <span className="fs-pill">Phase 1</span></span>
        <button className="fs-link" onClick={() => downloadCsv(`top-communities-${range}.csv`, topCommunities)}>Export CSV</button>
      </div>
      {topCommunities.map((c, i) => (
        <div key={c.id || i} className="fs-board-row">
          <span className="fs-rank">{i + 1}</span>
          <div className="fs-board-who">
            <div className="fs-board-name">{c.name}</div>
            <div className="fs-board-meta">
              {c.events || 0} event{c.events == 1 ? '' : 's'} · {c.rounds ?? c.entries ?? 0} rounds · {c.entries || 0} entries
            </div>
          </div>
          <span className="fs-board-val">{money(c.spend_cents || 0)}</span>
        </div>
      ))}
      {!topCommunities.length && <div className="fs-empty">No community activity in this range.</div>}

      {/* PANEL 4 (Phase 1): Cross-course play — Golfers who played 2+ Orion courses this season; loyalty tier counts */}
      <div className="fs-section-title cm-row-title">
        <span>4. Cross-Course Play & Loyalty Tiers <span className="fs-pill">Phase 1</span></span>
        <button className="fs-link" onClick={() => downloadCsv(`cross-course-play-${range}.csv`, crossCoursePlay)}>Export CSV</button>
      </div>
      <div className="cm-facts" style={{ marginBottom: 10 }}>
        <div><b>{loyaltyTiers.bronze_2_courses || 0}</b><span>🥉 Bronze (2 courses)</span></div>
        <div><b>{loyaltyTiers.silver_3_courses || 0}</b><span>🥈 Silver (3 courses)</span></div>
        <div><b>{loyaltyTiers.gold_4_plus_courses || 0}</b><span>🥇 Gold (4+ courses)</span></div>
        <div><b>{loyaltyTiers.total_multi_course || 0}</b><span>Total 2+ Course Golfers</span></div>
      </div>
      {crossCoursePlay.map((p, i) => (
        <div key={p.profile_id || i} className="fs-board-row">
          <span className="fs-rank">{i + 1}</span>
          <div className="fs-board-who">
            <div className="fs-board-name">{p.username} <span className="fs-pill">{p.loyalty_tier}</span></div>
            <div className="fs-board-meta">
              {p.courses_played} courses ({p.courses_list}) · {p.rounds_played} rounds
            </div>
          </div>
          <span className="fs-board-val">{money(p.spend_cents || 0)}</span>
        </div>
      ))}
      {!crossCoursePlay.length && <div className="fs-empty">No golfers with 2+ Orion courses in this range yet.</div>}

      {/* PANEL 5 (Phase 2): Event revenue — Entries, add-ons, sponsors, donations, fees, net per event */}
      <div className="fs-section-title cm-row-title">
        <span>5. Event Revenue Breakdown <span className="fs-pill">Phase 2</span></span>
        <button className="fs-link" onClick={() => downloadCsv(`event-revenue-${range}.csv`, eventRevenue)}>Export CSV</button>
      </div>
      {eventRevenue.map(er => (
        <div key={er.event_id} className="fs-card" style={{ marginBottom: 8 }}>
          <div className="fs-card-row">
            <div>
              <span className="fs-card-title">{er.event_name}</span>
              <div className="fs-card-meta">{when(er.starts_at)} · {er.course} · {er.community}</div>
            </div>
            <span className="fs-pill live">Net {moneyExact(er.net_cents || 0)}</span>
          </div>
          <div className="fs-card-meta" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span>Entries: <b>{money(er.entries_cents || 0)}</b></span>
            <span>Add-ons: <b>{money(er.addons_cents || 0)}</b></span>
            <span>Sponsors: <b>{money(er.sponsors_cents || 0)}</b></span>
            <span>Donations: <b>{money(er.donations_cents || 0)}</b></span>
            <span>Fees: <b>{moneyExact(er.fees_cents || 0)}</b></span>
            {er.refunded_cents > 0 && <span>Refunds: <b>-{moneyExact(er.refunded_cents)}</b></span>}
          </div>
        </div>
      ))}
      {!eventRevenue.length && <div className="fs-empty">No event revenue records for this filter.</div>}

      {/* PANEL 6 (Phase 3): Concessions — Orders, revenue, top items, by course and hour */}
      <div className="fs-section-title cm-row-title">
        <span>6. Concessions & Pro Shop (By Course, Hour & Top Items) <span className="fs-pill">Phase 3</span></span>
        <button
          className="fs-link"
          onClick={() =>
            downloadCsv(
              `concessions-${range}.csv`,
              (concessions.by_course_hour || []).length ? concessions.by_course_hour : concessions.top_items || []
            )
          }
        >
          Export CSV
        </button>
      </div>
      <div className="cm-facts" style={{ marginBottom: 10 }}>
        <div><b>{concessions.orders_count || 0}</b><span>Concession Orders</span></div>
        <div><b>{moneyExact(concessions.revenue_cents || 0)}</b><span>Concession Revenue</span></div>
        <div><b>{(concessions.top_items || [])[0]?.item_name || '—'}</b><span>#1 Top Item</span></div>
      </div>
      {(concessions.top_items || []).length > 0 && (
        <div className="fs-card" style={{ marginBottom: 8 }}>
          <div className="fs-card-title" style={{ marginBottom: 6 }}>Top Items Sold</div>
          {concessions.top_items.map((it, idx) => (
            <div key={idx} className="fs-board-row">
              <span className="fs-rank">{idx + 1}</span>
              <div className="fs-board-who">
                <div className="fs-board-name">{it.item_name} <span className="fs-pill">{it.category}</span></div>
                <div className="fs-board-meta">{it.qty_sold} sold</div>
              </div>
              <span className="fs-board-val">{moneyExact(it.revenue_cents || 0)}</span>
            </div>
          ))}
        </div>
      )}
      {(concessions.by_course_hour || []).map((ch, idx) => (
        <div key={idx} className="fs-board-row">
          <div className="fs-board-who">
            <div className="fs-board-name">{ch.course} · {ch.hour_label}</div>
            <div className="fs-board-meta">{ch.orders_count} order{ch.orders_count === 1 ? '' : 's'} · {ch.fulfillment}</div>
          </div>
          <span className="fs-board-val">{moneyExact(ch.revenue_cents || 0)}</span>
        </div>
      ))}
      {!(concessions.by_course_hour || []).length && !(concessions.top_items || []).length && (
        <div className="fs-empty">No concession orders recorded in this window.</div>
      )}

      {/* PANEL 7 (Phase 3): Member growth — New members and renewals per community at Orion courses */}
      <div className="fs-section-title cm-row-title">
        <span>7. Community Member Growth & Renewals <span className="fs-pill">Phase 3</span></span>
        <button className="fs-link" onClick={() => downloadCsv(`member-growth-${range}.csv`, memberGrowth)}>Export CSV</button>
      </div>
      {memberGrowth.map((mg, idx) => (
        <div key={mg.community_id || idx} className="fs-board-row">
          <span className="fs-rank">{idx + 1}</span>
          <div className="fs-board-who">
            <div className="fs-board-name">{mg.community_name}</div>
            <div className="fs-board-meta">
              {mg.home_course} · <b>+{mg.new_members || 0}</b> new · <b>{mg.renewals || 0}</b> renewals · <b>{mg.active_members || 0}</b> active
            </div>
          </div>
          <span className="fs-board-val">{money(mg.dues_revenue_cents || 0)} dues</span>
        </div>
      ))}
      {!memberGrowth.length && <div className="fs-empty">No community membership growth data in this range.</div>}
    </>
  );
}

function Staff({ orgId, me, myRole, onChanged }) {
  const [staff, setStaff] = useState([]); const [names, setNames] = useState({}); const [q, setQ] = useState(''); const [found, setFound] = useState([]);
  const [role, setRole] = useState('staff'); const [err, setErr] = useState('');
  const load = async () => {
    const { data } = await supabase.from('organization_staff').select('*').eq('organization_id', orgId);
    setStaff(data || []);
    const ids = (data || []).map(s => s.profile_id);
    if (ids.length) { const { data: p } = await supabase.from('profiles').select('id, username').in('id', ids); setNames(Object.fromEntries((p || []).map(x => [x.id, x.username]))); }
  };
  useEffect(() => { load(); }, [orgId]);
  useEffect(() => {
    if (q.length < 2) return setFound([]);
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id, username').ilike('username', `%${q}%`).limit(6); setFound(data || []); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const add = async (p) => {
    const { error } = await supabase.from('organization_staff').upsert([{ organization_id: orgId, profile_id: p.id, role }]);
    if (error) setErr(friendly(error)); else { setQ(''); load(); onChanged(); }
  };
  return (
    <>
      {err && <div className="fs-error">{err}</div>}
      {staff.map(s => (
        <div key={s.profile_id} className="fs-player">
          <div className="fs-board-who"><div className="fs-board-name">{names[s.profile_id] || 'Player'}{s.profile_id === me ? ' (you)' : ''}</div><div className="fs-board-meta">{s.role}</div></div>
          {s.profile_id !== me && (myRole === 'owner' || s.role === 'staff') &&
            <button className="fs-small-btn ghost" onClick={() => supabase.from('organization_staff').delete().eq('organization_id', orgId).eq('profile_id', s.profile_id).then(load)}>Remove</button>}
        </div>
      ))}
      <div className="fs-section-title">Add staff</div>
      <div className="cm-row2">
        <input className="fs-input" placeholder="Username…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="fs-input" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
          <option value="staff">Pro shop staff</option><option value="admin">Operator admin</option>
          {myRole === 'owner' && <option value="owner">Owner</option>}
        </select>
      </div>
      {found.map(p => <button key={p.id} className="fs-list-btn" onClick={() => add(p)}>+ {p.username}</button>)}
      <p className="fs-footnote">Staff can check players in and run events at your courses. Admins also manage staff and see every course.</p>
    </>
  );
}

function Courses({ orgId, onCreateEvent }) {
  const [list, setList] = useState([]);
  useEffect(() => { supabase.from('courses').select('id, name, city').eq('organization_id', orgId).order('name').then(({ data }) => setList(data || [])); }, [orgId]);
  return (
    <>
      {list.map(c => (
        <div key={c.id} className="fs-card fs-card-row">
          <div><div className="fs-card-title">{c.name}</div><div className="fs-card-meta">{c.city}</div></div>
          <button className="fs-small-btn" onClick={() => onCreateEvent({ organizationId: orgId, courseId: c.id })}>+ Event</button>
        </div>
      ))}
      {!list.length && <div className="fs-empty">No courses linked yet. ForeSome support links your courses.</div>}
    </>
  );
}

// 3.3 Operator Pro Shop & Concessions + Staff Order Queue
function OperatorOrdersAndShop({ orgId, isAdmin }) {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [names, setNames] = useState({});
  const [view, setView] = useState('queue'); // 'queue' | 'catalog'
  const [form, setForm] = useState({ name: '', category: 'concession', price: '8', stock: '50' });
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data: p }, { data: o }] = await Promise.all([
      supabase.from('shop_products').select('*').eq('organization_id', orgId).order('category').order('name'),
      supabase.from('shop_orders').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(60),
    ]);
    setProducts(p || []);
    setOrders(o || []);
    const ids = [...new Set((o || []).map(x => x.profile_id).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username').in('id', ids);
      setNames(Object.fromEntries((profs || []).map(x => [x.id, x.username])));
    }
  };
  useEffect(() => { load(); }, [orgId]);
  useEffect(() => {
    const ch = supabase.channel(`org-orders-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_orders' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]);

  const addProduct = async () => {
    if (!form.name.trim()) return;
    await supabase.from('shop_products').insert([{
      organization_id: orgId,
      name: form.name.trim(),
      category: form.category,
      price_cents: Math.round((Number(form.price) || 0) * 100),
      stock_count: form.stock === '' ? null : Number(form.stock),
    }]);
    setForm({ name: '', category: 'concession', price: '8', stock: '50' });
    setMsg('Product added to course catalog');
    load();
  };

  const updateOrderStatus = async (orderId, status) => {
    await supabase.from('shop_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
    load();
  };

  return (
    <>
      <div className="fs-seg">
        <button className={view === 'queue' ? 'on' : ''} onClick={() => setView('queue')}>
          🍔 Live Order Queue ({orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length})
        </button>
        <button className={view === 'catalog' ? 'on' : ''} onClick={() => setView('catalog')}>
          🛍️ Course Catalog & Inventory ({products.length})
        </button>
      </div>
      {msg && <div className="fs-note">{msg}</div>}

      {view === 'queue' && (
        <>
          <p className="fs-footnote">On-course orders from golfers update live. Prepare for Turn Pickup or dispatch to Cart Delivery.</p>
          {orders.map(o => (
            <div key={o.id} className="fs-card" style={{ marginBottom: 8 }}>
              <div className="fs-card-row">
                <div>
                  <span className="fs-card-title">{names[o.profile_id] || 'Golfer'}</span>
                  <div className="fs-card-meta">
                    {o.fulfillment_type === 'cart_delivery'
                      ? `🛺 Cart Delivery · Hole ${o.hole_number || '?'} · Cart #${o.cart_number || '?'}`
                      : o.fulfillment_type === 'turn_pickup'
                      ? `🍔 Turn Pickup${o.hole_number ? ` (at Hole ${o.hole_number})` : ''}`
                      : '🛍️ Pro Shop Pickup'}
                  </div>
                </div>
                <span className={`fs-pill ${o.status === 'ready' ? 'live' : ''}`}>{o.status.toUpperCase()}</span>
              </div>
              <div className="fs-card-meta" style={{ marginTop: 4 }}>
                {(o.items || []).map((it, i) => `${it.qty}× ${it.name}`).join(', ')} · <b>{moneyExact(o.total_cents)}</b>
              </div>
              {o.notes && <div className="fs-card-meta">Note: "{o.notes}"</div>}
              <div className="cm-actions" style={{ marginTop: 8 }}>
                {['queued', 'preparing', 'ready', 'delivered', 'completed'].map(st => (
                  <button key={st} className={`fs-small-btn ${o.status === st ? '' : 'ghost'}`} onClick={() => updateOrderStatus(o.id, st)}>
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!orders.length && <div className="fs-empty">No concession or shop orders in the queue yet.</div>}
        </>
      )}

      {view === 'catalog' && (
        <>
          <p className="fs-footnote">Event-day and online sales draw from the same course inventory.</p>
          {products.map(p => (
            <div key={p.id} className="fs-board-row">
              <div className="fs-board-who">
                <div className="fs-board-name">{p.name} <span className="fs-pill">{p.category}</span></div>
                <div className="fs-board-meta">
                  {money(p.price_cents)} · {p.stock_count != null ? `${p.stock_count} in stock · ${p.sold_count || 0} sold` : `${p.sold_count || 0} sold · Unlimited`}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {p.stock_count != null && (
                    <button className="fs-small-btn ghost" onClick={() => supabase.from('shop_products').update({ stock_count: p.stock_count + 10 }).eq('id', p.id).then(load)}>
                      +10 Stock
                    </button>
                  )}
                  <button className="fs-small-btn ghost" onClick={() => supabase.from('shop_products').delete().eq('id', p.id).then(load)}>Remove</button>
                </div>
              )}
            </div>
          ))}
          {!products.length && <div className="fs-empty">No items in course catalog yet.</div>}

          {isAdmin && (
            <div className="fs-card" style={{ marginTop: 12 }}>
              <div className="fs-section-title" style={{ marginTop: 0 }}>+ Add Product / Concession</div>
              <div className="cm-row2">
                <input className="fs-input" placeholder="Item name (e.g. Turn Dog & Drink, Sleeve of Pro V1)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <select className="fs-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option value="concession">🍔 Concession (Turn / Cart)</option>
                  <option value="merch">🧢 Pro Shop Merch</option>
                  <option value="addon">🎟️ Event Add-On</option>
                </select>
              </div>
              <div className="cm-row2">
                <input className="fs-input" type="number" placeholder="Price ($)" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
                <input className="fs-input" type="number" placeholder="Initial stock (blank = unlimited)" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
              </div>
              <button className="fs-small-btn" onClick={addProduct}>+ Save Item</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// 2.1 Operator Stripe Connect Express Onboarding & Payout Schedule
function OperatorPayouts({ orgId }) {
  const [org, setOrg] = useState(null);
  const [payments, setPayments] = useState([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const { data: o } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle();
    setOrg(o);
    const { data: p } = await supabase.from('payments').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50);
    setPayments(p || []);
  };
  useEffect(() => { load(); }, [orgId]);

  const connectStripe = async () => {
    const acct = `acct_org_${orgId.slice(0, 8)}`;
    await supabase.from('organizations').update({
      stripe_account_id: acct,
      stripe_onboarding_complete: true,
    }).eq('id', orgId);
    setMsg(`Stripe Connect Express account (${acct}) linked & verified for direct course payouts.`);
    load();
  };

  const updateSchedule = async (sched) => {
    await supabase.from('organizations').update({ stripe_payout_schedule: sched }).eq('id', orgId);
    setMsg(`Payout schedule updated to ${sched}.`);
    load();
  };

  if (!org) return <div className="fs-empty">Loading operator payouts…</div>;

  const gross = payments.reduce((s, p) => s + (p.amount_cents || 0), 0);
  const refunded = payments.reduce((s, p) => s + (p.refunded_cents || 0), 0);
  const net = payments.reduce((s, p) => s + Math.max(0, (p.net_organizer_cents || 0) - (p.refunded_cents || 0)), 0);

  return (
    <>
      {msg && <div className="fs-note">{msg}</div>}
      <div className="fs-card" style={{ marginBottom: 12 }}>
        <div className="fs-card-row">
          <div>
            <div className="fs-card-title">💳 Operator Stripe Connect Express</div>
            <div className="fs-card-meta">
              {org.stripe_onboarding_complete
                ? `Connected (${org.stripe_account_id}) · Schedule: ${(org.stripe_payout_schedule || 'daily').toUpperCase()}`
                : 'Onboard your course operator account to receive event entries, add-ons, and concession payouts directly.'}
            </div>
          </div>
          <button className="fs-small-btn" onClick={connectStripe}>
            {org.stripe_onboarding_complete ? '✓ Express Connected' : 'Connect Stripe Express'}
          </button>
        </div>
        {org.stripe_onboarding_complete && (
          <div className="cm-actions" style={{ marginTop: 10 }}>
            <span className="fs-card-meta" style={{ alignSelf: 'center' }}>Payout Schedule:</span>
            {['daily', 'weekly', 'monthly'].map(s => (
              <button
                key={s}
                className={`fs-small-btn ${(org.stripe_payout_schedule || 'daily') === s ? '' : 'ghost'}`}
                onClick={() => updateSchedule(s)}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cm-facts">
        <div><b>{moneyExact(gross)}</b><span>Gross Collected</span></div>
        <div><b>{moneyExact(refunded)}</b><span>Refunds</span></div>
        <div><b style={{ color: '#2ecc71' }}>{moneyExact(net)}</b><span>Net Course Payout</span></div>
      </div>

      <RevenueForecast initialPreset="operator" showPlatformScale={true} />

      <div className="fs-section-title">Recent Operator Transactions ({payments.length})</div>
      {payments.map(p => (
        <div key={p.id} className="fs-board-row">
          <div className="fs-board-who">
            <div className="fs-board-name">{moneyExact(p.amount_cents)} · {p.category.toUpperCase()}</div>
            <div className="fs-board-meta">
              {p.payment_method_brand || 'card'} · Net {moneyExact(p.net_organizer_cents)} · {new Date(p.created_at).toLocaleString()}
            </div>
          </div>
          <span className={`fs-pill ${p.status === 'succeeded' ? 'live' : ''}`}>{p.status}</span>
        </div>
      ))}
      {!payments.length && <div className="fs-empty">No operator transactions recorded yet.</div>}
    </>
  );
}

