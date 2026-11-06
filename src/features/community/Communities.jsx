import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import {
  when, money, moneyExact, friendly, rpc, slugify, appUrl, parseCsv, courseById, courseList
} from './api';
import RevenueForecast from './RevenueForecast';

const PRIVACY = {
  public: 'Public — anyone can join',
  closed: 'Closed — request to join',
  secret: 'Secret — invite only',
};

// Phase 3 Communities: Branded pages (/c/:slug), Directory searchable by course & city,
// Calendar & List event views, Membership Tiers & Stripe Recurring Dues, CSV Member Import,
// Pro Shop & Concessions + Live Order Queue, Community Board (Posts, Polls, Photo Albums, Scheduled Posts),
// Multi-channel Announcements (Email, SMS, Push), and Stripe Connect Express onboarding.
export default function Communities({ session, roles, active, initialView = { name: 'list' }, onBack, onOpenEvent, onCreateEvent }) {
  const [view, setView] = useState(initialView);
  if (view.name === 'create') {
    return (
      <CreateCommunity
        session={session}
        onCancel={() => (initialView.name === 'create' ? onBack() : setView({ name: 'list' }))}
        onCreated={(id) => { roles.reload(); setView({ name: 'page', id }); }}
      />
    );
  }
  if (view.name === 'page') {
    return (
      <CommunityPage
        session={session}
        roles={roles}
        id={view.id}
        onBack={() => (initialView.name === 'page' ? onBack() : setView({ name: 'list' }))}
        onOpenEvent={onOpenEvent}
        onCreateEvent={onCreateEvent}
      />
    );
  }
  return (
    <Directory
      session={session}
      roles={roles}
      active={active}
      onBack={onBack}
      onOpen={(id) => setView({ name: 'page', id })}
      onCreate={() => setView({ name: 'create' })}
    />
  );
}

function Directory({ roles, active, onBack, onOpen, onCreate }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!active) return;
    supabase.from('communities').select('*').order('name').limit(200)
      .then(({ data, error }) => error ? setErr(friendly(error)) : setList(data || []));
  }, [active]);

  const cities = [...new Set(list.map(c => c.city || courseById(c.home_course_id)?.city).filter(Boolean))].sort();

  const shown = list.filter(c => {
    const s = q.toLowerCase();
    const course = courseById(c.home_course_id);
    const city = c.city || course?.city || '';
    if (cityFilter && city !== cityFilter) return false;
    return !s
      || c.name.toLowerCase().includes(s)
      || (c.slug || '').toLowerCase().includes(s)
      || (course?.name || '').toLowerCase().includes(s)
      || city.toLowerCase().includes(s);
  });

  const mineIds = new Set([
    ...roles.adminCommunities.map(c => c.id),
    ...(roles.memberships || []).filter(m => m.status === 'active').map(m => m.community_id),
  ]);

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← EVENTS</button>
        <button className="fs-small-btn" onClick={onCreate}>+ Start one</button>
      </div>
      <h1 className="fs-h1">Communities</h1>
      <p className="fs-sub">Leagues, clubs and standing groups. Search by community name, home course, or city.</p>
      {err && <div className="fs-error">{err}</div>}
      <input className="fs-input" placeholder="Search by name, course, or city…" value={q} onChange={e => setQ(e.target.value)} />
      {cities.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" className={`fs-small-btn ${!cityFilter ? '' : 'ghost'}`} onClick={() => setCityFilter('')}>All Cities</button>
          {cities.map(city => (
            <button key={city} type="button" className={`fs-small-btn ${cityFilter === city ? '' : 'ghost'}`} onClick={() => setCityFilter(city)}>
              📍 {city}
            </button>
          ))}
        </div>
      )}
      {shown.map(c => {
        const course = courseById(c.home_course_id);
        const role = roles.adminCommunities.find(a => a.id === c.id)?.role;
        return (
          <button key={c.id} className="fs-card fs-card-btn" onClick={() => onOpen(c.id)} style={c.brand_color ? { borderLeft: `4px solid ${c.brand_color}` } : undefined}>
            <div className="fs-card-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {c.logo_url && <img src={c.logo_url} alt={c.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />}
                <span className="fs-card-title">{c.name}</span>
              </div>
              {role ? <span className="fs-pill live">{role.replace('_', '-')}</span> : mineIds.has(c.id) ? <span className="fs-pill">Member</span> : <span className="fs-pill">{c.privacy}</span>}
            </div>
            <div className="fs-card-meta">
              {course ? `${course.name} · ${c.city || course.city}` : (c.city || 'KC Metro')}
              {c.slug ? ` · foresomekc.com/c/${c.slug}` : ''}
              {c.description ? ` · ${c.description}` : ''}
            </div>
          </button>
        );
      })}
      {!err && shown.length === 0 && <div className="fs-empty">No communities found.</div>}
    </div>
  );
}

function CreateCommunity({ session, onCancel, onCreated }) {
  const [f, setF] = useState({
    name: '', slug: '', description: '', privacy: 'public',
    home_course_id: '', city: 'Kansas City, MO',
    logo_url: '', cover_url: '', brand_color: '#1a3a28', accent_color: '#b89a5c',
    timezone: 'America/Chicago',
  });
  const [cq, setCq] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) return setErr('Name your community.');
    setBusy(true);
    const cleanSlug = slugify(f.slug || f.name) || `${slugify(f.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const row = {
      name: f.name.trim(),
      slug: cleanSlug,
      description: f.description || null,
      privacy: f.privacy,
      home_course_id: f.home_course_id || null,
      city: f.city || null,
      logo_url: f.logo_url || null,
      cover_url: f.cover_url || null,
      brand_color: f.brand_color || '#1a3a28',
      timezone: f.timezone || 'America/Chicago',
      created_by: session.user.id,
    };
    const { data, error } = await supabase.from('communities').insert([row]).select('id').single();
    setBusy(false);
    if (error) return setErr(friendly(error));
    onCreated(data.id);
  };

  const matches = cq.length > 1 ? courseList.filter(c => `${c.name} ${c.city}`.toLowerCase().includes(cq.toLowerCase())).slice(0, 5) : [];

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onCancel}>← BACK</button></div>
      <h1 className="fs-h1">Start a branded community</h1>
      <label className="fs-field">Community Name
        <input className="fs-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) })} placeholder="Swope Saturday League" />
      </label>
      <label className="fs-field">Vanity URL Slug (foresomekc.com/c/{f.slug || 'swope-league'})
        <input className="fs-input" value={f.slug} onChange={e => setF({ ...f, slug: slugify(e.target.value) })} placeholder="swope-saturday-league" />
      </label>
      <label className="fs-field">About
        <textarea className="fs-input" rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Weekly Saturday skins, season points cup, and club merch." />
      </label>

      <div className="cm-row2">
        <label className="fs-field">Logo URL (optional)
          <input className="fs-input" placeholder="https://…/logo.png" value={f.logo_url} onChange={e => setF({ ...f, logo_url: e.target.value })} />
        </label>
        <label className="fs-field">Cover Banner URL (optional)
          <input className="fs-input" placeholder="https://…/cover.jpg" value={f.cover_url} onChange={e => setF({ ...f, cover_url: e.target.value })} />
        </label>
      </div>

      <div className="cm-row2">
        <label className="fs-field">Brand Color
          <input className="fs-input" type="color" style={{ height: 42, padding: 4 }} value={f.brand_color} onChange={e => setF({ ...f, brand_color: e.target.value })} />
        </label>
        <label className="fs-field">Time Zone
          <select className="fs-input" value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })}>
            <option value="America/Chicago">Central (America/Chicago)</option>
            <option value="America/New_York">Eastern (America/New_York)</option>
            <option value="America/Denver">Mountain (America/Denver)</option>
            <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
          </select>
        </label>
      </div>

      <div className="fs-section-title">Home Course & City</div>
      {f.home_course_id ? (
        <div className="fs-card fs-card-row">
          <span>{courseById(f.home_course_id)?.name} · {courseById(f.home_course_id)?.city}</span>
          <button className="fs-link" onClick={() => setF({ ...f, home_course_id: '' })}>Change</button>
        </div>
      ) : (
        <>
          <input className="fs-input" placeholder="Search courses…" value={cq} onChange={e => setCq(e.target.value)} />
          {matches.map(c => (
            <button key={c.id} className="fs-list-btn" onClick={() => { setF({ ...f, home_course_id: c.id, city: c.city }); setCq(''); }}>
              {c.name} · {c.city}
            </button>
          ))}
        </>
      )}
      <label className="fs-field">City
        <input className="fs-input" value={f.city} onChange={e => setF({ ...f, city: e.target.value })} placeholder="Kansas City, MO" />
      </label>

      <div className="fs-section-title">Privacy Level</div>
      {Object.entries(PRIVACY).map(([k, l]) => (
        <label key={k} className={`fs-radio ${f.privacy === k ? 'on' : ''}`}>
          <input type="radio" checked={f.privacy === k} onChange={() => setF({ ...f, privacy: k })} />
          <span>{l}</span>
        </label>
      ))}
      {err && <div className="fs-error">{err}</div>}
      <button className="fs-cta" disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create community'}</button>
      <p className="fs-footnote">You'll be the owner. Add membership tiers, pro shop items, and admins next.</p>
    </div>
  );
}

function CommunityPage({ session, roles, id, onBack, onOpenEvent, onCreateEvent }) {
  const me = session.user.id;
  const [c, setC] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventViewMode, setEventViewMode] = useState('list'); // 'list' | 'calendar'
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [seasons, setSeasons] = useState([]);
  const [standings, setStandings] = useState({});
  const [tiers, setTiers] = useState([]);
  const [myMembership, setMyMembership] = useState(null);
  const [tab, setTab] = useState('events');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const myRole = roles.adminCommunities.find(a => a.id === id)?.role || (roles.isPlatformAdmin ? 'admin' : null);
  const membership = roles.memberOf(id);

  const load = async () => {
    const { data, error } = await supabase.from('communities').select('*').eq('id', id).single();
    if (error) return setErr(friendly(error));
    setC(data);

    const { data: ev } = await supabase.from('events').select('*').eq('community_id', id).order('starts_at', { ascending: false }).limit(60);
    setEvents(ev || []);

    const { data: ss } = await supabase.from('seasons').select('*').eq('community_id', id).order('starts_on', { ascending: false });
    setSeasons(ss || []);
    const st = {};
    for (const s of ss || []) {
      const { data: rows } = await supabase.rpc('season_standings', { p_season_id: s.id });
      st[s.id] = rows || [];
    }
    setStandings(st);

    const { data: ts } = await supabase.from('membership_tiers').select('*').eq('community_id', id).eq('is_active', true).order('sort_order');
    setTiers(ts || []);

    const { data: mm } = await supabase.from('memberships').select('*').eq('community_id', id).eq('profile_id', me).maybeSingle();
    setMyMembership(mm || null);
  };
  useEffect(() => { load(); }, [id]);

  const join = async () => {
    try {
      const m = await rpc('join_community', { p_community_id: id });
      setMsg(m.status === 'active' ? "You're a member!" : 'Request sent. An admin will approve it.');
      roles.reload();
      load();
    } catch (e) { setErr(e.message); }
  };

  const subscribeTier = async (tier) => {
    try {
      await rpc('subscribe_membership_tier', { p_community_id: id, p_tier_id: tier.id, p_payment_method: 'card' });
      setMsg(`Subscribed to ${tier.name} (${money(tier.price_cents)}/${tier.billing_interval}) via Stripe!`);
      roles.reload();
      load();
    } catch (e) { setErr(e.message); }
  };

  const leave = async () => {
    if (!confirm('Leave this community?')) return;
    await supabase.from('memberships').delete().eq('community_id', id).eq('profile_id', me);
    roles.reload();
    load();
    setMsg('You left.');
  };

  if (err && !c) return <div className="fs-page"><div className="fs-topbar"><button className="back-btn" onClick={onBack}>← COMMUNITIES</button></div><div className="fs-error">{err}</div></div>;
  if (!c) return <div className="fs-page"><div className="fs-empty">Loading…</div></div>;

  const now = Date.now();
  const upcoming = events.filter(e => new Date(e.starts_at).getTime() > now - 86400000 && e.status !== 'cancelled').reverse();
  const past = events.filter(e => new Date(e.starts_at).getTime() <= now - 86400000 || e.status === 'completed');
  const vanityUrl = appUrl(`/c/${c.slug}`);

  return (
    <div className="fs-page">
      <div className="fs-topbar">
        <button className="back-btn" onClick={onBack}>← COMMUNITIES</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="fs-link" onClick={() => navigator.clipboard?.writeText(vanityUrl).then(() => setMsg(`Copied ${vanityUrl}`))}>
            🔗 /c/{c.slug}
          </button>
          {myRole && <button className="fs-small-btn" onClick={() => onCreateEvent({ communityId: id })}>+ Event</button>}
        </div>
      </div>

      {/* 3.1 Branded Community Banner */}
      <div className="fs-card" style={{
        background: c.cover_url
          ? `linear-gradient(180deg, rgba(16,32,22,0.55), rgba(16,32,22,0.92)), url(${c.cover_url}) center/cover`
          : `linear-gradient(135deg, ${c.brand_color || '#1f3b2b'} 0%, #14261b 100%)`,
        borderColor: 'rgba(212,184,122,0.35)',
        padding: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {c.logo_url ? (
            <img src={c.logo_url} alt={c.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--gold-bright)' }} />
          ) : (
            <div className="player-dot filled" style={{ width: 52, height: 52, fontSize: 18 }}>{c.name.slice(0, 2).toUpperCase()}</div>
          )}
          <div style={{ flex: 1 }}>
            <div className="fs-eyebrow">{c.privacy} community · {c.timezone || 'America/Chicago'}{myRole ? ` · ${myRole.replace('_', '-')}` : ''}</div>
            <h1 className="fs-h1" style={{ margin: '2px 0' }}>{c.name}</h1>
            <div className="fs-card-meta">
              {courseById(c.home_course_id) ? `⛳ ${courseById(c.home_course_id).name}` : (c.city || 'KC Metro')}
              {` · foresomekc.com/c/${c.slug}`}
            </div>
          </div>
        </div>
        {c.description && <p className="fs-sub" style={{ marginTop: 10, marginBottom: 0 }}>{c.description}</p>}
      </div>

      {!myRole && (
        membership === 'active' ? (
          <div className="fs-card-row" style={{ marginBottom: 8 }}>
            <span className="fs-pill live">
              ✓ Active Member{myMembership?.tier_id ? ` · ${tiers.find(t => t.id === myMembership.tier_id)?.name || 'Tier'}` : ''}
            </span>
            <button className="fs-small-btn ghost" onClick={leave}>Leave</button>
          </div>
        ) : membership === 'pending' ? (
          <span className="fs-pill">Request pending approval</span>
        ) : (
          <button className="fs-cta" onClick={join}>{c.privacy === 'public' ? 'Join Community' : 'Request to Join'}</button>
        )
      )}

      {msg && <div className="fs-note">{msg}</div>}
      {err && <div className="fs-error">{err}</div>}

      <div className="fs-seg wrap">
        {[
          ['events', 'Events & Cal'],
          ['board', '📣 Board & Polls'],
          ['dues', '🪪 Dues & Tiers'],
          ['shop', '🛍️ Shop & Turn'],
          ['standings', 'Standings'],
          ...(myRole ? [['admin', '⚙ Admin']] : []),
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {/* 3.1 & 3.4 EVENTS TAB (LIST + CALENDAR VIEW) */}
      {tab === 'events' && (
        <>
          <div className="fs-card-row" style={{ marginBottom: 8 }}>
            <span className="fs-section-title" style={{ margin: 0 }}>Community Schedule ({c.timezone || 'America/Chicago'})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={`fs-small-btn ${eventViewMode === 'list' ? '' : 'ghost'}`} onClick={() => setEventViewMode('list')}>📋 List</button>
              <button type="button" className={`fs-small-btn ${eventViewMode === 'calendar' ? '' : 'ghost'}`} onClick={() => setEventViewMode('calendar')}>📅 Calendar</button>
            </div>
          </div>

          {eventViewMode === 'calendar' ? (
            <EventCalendarView events={events} calMonth={calMonth} setCalMonth={setCalMonth} onOpenEvent={onOpenEvent} />
          ) : (
            <>
              {upcoming.map(e => <EventRow key={e.id} e={e} onOpen={onOpenEvent} />)}
              {!upcoming.length && <div className="fs-empty">No upcoming events.</div>}
              {past.length > 0 && <div className="fs-section-title">Past</div>}
              {past.slice(0, 10).map(e => <EventRow key={e.id} e={e} onOpen={onOpenEvent} />)}
            </>
          )}
        </>
      )}

      {/* 3.4 COMMUNITY BOARD, POLLS, PHOTO ALBUMS & SCHEDULED POSTS */}
      {tab === 'board' && <CommunityBoard session={session} community={c} myRole={myRole} onError={setErr} onMsg={setMsg} />}

      {/* 3.2 MEMBERSHIP TIERS & RECURRING DUES */}
      {tab === 'dues' && (
        <>
          <div className="fs-eyebrow">Stripe Recurring Membership Billing</div>
          <p className="fs-sub">Join a membership tier for member-only events, automatic entry fee discounts, and season cup eligibility.</p>
          {myMembership?.tier_id && (
            <div className="fs-card" style={{ borderColor: 'rgba(212,184,122,0.4)' }}>
              <div className="fs-card-row">
                <span className="fs-card-title">Your Active Tier: {tiers.find(t => t.id === myMembership.tier_id)?.name || 'Member'}</span>
                <span className="fs-pill live">{myMembership.payment_status || 'active'}</span>
              </div>
              {myMembership.current_period_end && (
                <div className="fs-card-meta">Renews automatically on {new Date(myMembership.current_period_end).toLocaleDateString()}</div>
              )}
            </div>
          )}
          {tiers.map(t => {
            const isMine = myMembership?.tier_id === t.id;
            return (
              <div key={t.id} className="fs-card">
                <div className="fs-card-row">
                  <div>
                    <div className="fs-card-title">{t.name} — {money(t.price_cents)} / {t.billing_interval}</div>
                    <div className="fs-card-meta">
                      {t.member_discount_pct > 0 ? `${t.member_discount_pct}% off event entry fees · ` : ''}
                      {t.description || 'Full community access & member events'}
                    </div>
                  </div>
                  <button className="fs-small-btn" disabled={isMine} onClick={() => subscribeTier(t)}>
                    {isMine ? '✓ Active' : 'Subscribe →'}
                  </button>
                </div>
                {Array.isArray(t.benefits) && t.benefits.length > 0 && (
                  <div className="cm-tags" style={{ marginTop: 6 }}>
                    {t.benefits.map((b, i) => <span key={i} className="fs-pill">{b}</span>)}
                  </div>
                )}
              </div>
            );
          })}
          {!tiers.length && <div className="fs-empty">No paid membership tiers configured yet.{myRole ? ' Add tiers in the Admin tab.' : ''}</div>}
        </>
      )}

      {/* 3.3 PRO SHOP & CONCESSIONS */}
      {tab === 'shop' && <CommunityShop session={session} community={c} isAdmin={!!myRole} isMember={membership === 'active'} onMsg={setMsg} onError={setErr} />}

      {/* STANDINGS */}
      {tab === 'standings' && (
        <>
          {!seasons.length && <div className="fs-empty">No seasons yet.</div>}
          {seasons.map(s => (
            <div key={s.id} className="fs-card">
              <div className="fs-card-row"><span className="fs-card-title">{s.name}</span><span className="fs-card-meta">{s.starts_on} → {s.ends_on}</span></div>
              {s.invite_top_n && <div className="fs-board-meta">Top {s.invite_top_n} earn invite-only outings</div>}
              {(standings[s.id] || []).map(r => (
                <div key={r.profile_id} className={`fs-board-row ${r.profile_id === me ? 'me' : ''}`}>
                  <span className="fs-rank">{r.place}</span><div className="player-dot filled">{r.initials}</div>
                  <div className="fs-board-who"><div className="fs-board-name">{r.username}</div><div className="fs-board-meta">{r.events_played} events · {r.courses_played} courses</div></div>
                  <span className="fs-board-val">{r.points} pts</span>
                </div>
              ))}
              {!(standings[s.id] || []).length && <div className="fs-empty">No points yet.</div>}
            </div>
          ))}
        </>
      )}

      {tab === 'admin' && myRole && (
        <CommunityAdmin
          session={session}
          c={c}
          myRole={myRole}
          seasons={seasons}
          tiers={tiers}
          onChanged={() => { load(); roles.reload(); }}
        />
      )}
    </div>
  );
}

// 3.4 Calendar View of Community Events
function EventCalendarView({ events, calMonth, setCalMonth, onOpenEvent }) {
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const eventsByDay = {};
  events.forEach(ev => {
    const dt = new Date(ev.starts_at);
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      const day = dt.getDate();
      eventsByDay[day] = eventsByDay[day] || [];
      eventsByDay[day].push(ev);
    }
  });

  return (
    <div className="fs-card">
      <div className="fs-card-row" style={{ marginBottom: 10 }}>
        <button type="button" className="fs-small-btn ghost" onClick={() => setCalMonth(new Date(year, month - 1, 1))}>← Prev</button>
        <span className="fs-card-title">{calMonth.toLocaleString([], { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="fs-small-btn ghost" onClick={() => setCalMonth(new Date(year, month + 1, 1))}>Next →</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)', marginBottom: 6 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((day, idx) => {
          const dayEvs = day ? (eventsByDay[day] || []) : [];
          return (
            <div key={idx} style={{
              minHeight: 54, padding: 4, borderRadius: 8,
              background: day ? 'rgba(255,255,255,0.03)' : 'transparent',
              border: dayEvs.length ? '1px solid var(--gold-bright)' : '1px solid rgba(255,255,255,0.05)'
            }}>
              {day && <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right' }}>{day}</div>}
              {dayEvs.map(e => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpenEvent(e.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', marginTop: 2,
                    padding: '2px 4px', borderRadius: 4, border: 'none',
                    background: 'rgba(184,154,92,0.22)', color: 'var(--cream)',
                    fontSize: 9, fontWeight: 700, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}
                >
                  ⛳ {e.name}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 3.4 Community Board: Posts, Polls, Photo Albums & Scheduled Posts
function CommunityBoard({ session, community, myRole, onError, onMsg }) {
  const me = session.user.id;
  const [posts, setPosts] = useState([]);
  const [votes, setVotes] = useState([]);
  const [names, setNames] = useState({});
  const [mode, setMode] = useState('post'); // 'post' | 'poll' | 'photo'
  const [body, setBody] = useState('');
  const [photoUrls, setPhotoUrls] = useState('');
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState('Saturday 8:00 AM, Sunday 9:00 AM');
  const [scheduledFor, setScheduledFor] = useState('');

  const load = async () => {
    const { data: ps } = await supabase.from('community_posts').select('*').eq('community_id', community.id).neq('kind', 'chat').order('created_at', { ascending: false }).limit(50);
    const list = ps || [];
    setPosts(list);
    const postIds = list.filter(p => p.kind === 'poll').map(p => p.id);
    if (postIds.length) {
      const { data: vs } = await supabase.from('community_poll_votes').select('*').in('post_id', postIds);
      setVotes(vs || []);
    }
    const uids = [...new Set(list.map(p => p.author_id))];
    if (uids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username, initials').in('id', uids);
      setNames(Object.fromEntries((profs || []).map(p => [p.id, p])));
    }
  };
  useEffect(() => { load(); }, [community.id]);

  const createPost = async () => {
    if (mode === 'poll' && !pollQ.trim()) return onError('Enter a poll question.');
    if (mode !== 'poll' && !body.trim() && !photoUrls.trim()) return onError('Write a post or add photo URLs.');
    const row = {
      community_id: community.id,
      author_id: me,
      kind: mode,
      body: body.trim() || null,
      media_urls: mode === 'photo' ? photoUrls.split(',').map(s => s.trim()).filter(Boolean) : [],
      poll_question: mode === 'poll' ? pollQ.trim() : null,
      poll_options: mode === 'poll' ? pollOpts.split(',').map(s => s.trim()).filter(Boolean) : [],
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
    };
    const { error } = await supabase.from('community_posts').insert([row]);
    if (error) return onError(friendly(error));
    setBody(''); setPhotoUrls(''); setPollQ(''); setScheduledFor('');
    onMsg(scheduledFor ? `Scheduled post for ${when(scheduledFor)} (${community.timezone})` : 'Posted to community board!');
    load();
  };

  const votePoll = async (postId, optionIndex) => {
    const { error } = await supabase.from('community_poll_votes').upsert([{ post_id: postId, profile_id: me, option_index: optionIndex }]);
    if (error) onError(friendly(error));
    else load();
  };

  const visiblePosts = posts.filter(p => !p.scheduled_for || new Date(p.scheduled_for) <= new Date() || myRole);

  return (
    <>
      <div className="fs-card">
        <div className="fs-seg">
          <button type="button" className={mode === 'post' ? 'on' : ''} onClick={() => setMode('post')}>📝 Post</button>
          <button type="button" className={mode === 'poll' ? 'on' : ''} onClick={() => setMode('poll')}>📊 Poll</button>
          <button type="button" className={mode === 'photo' ? 'on' : ''} onClick={() => setMode('photo')}>📸 Photo Album</button>
        </div>
        {mode === 'poll' ? (
          <>
            <input className="fs-input" placeholder="Poll question (e.g. Which course for the June Major?)" value={pollQ} onChange={e => setPollQ(e.target.value)} />
            <input className="fs-input" placeholder="Comma-separated options (Swope Memorial, Shoal Creek, Tiffany Greens)" value={pollOpts} onChange={e => setPollOpts(e.target.value)} />
          </>
        ) : (
          <textarea className="fs-input" rows={2} placeholder={mode === 'photo' ? 'Album caption…' : 'Share news, pairings, or banter with the community…'} value={body} onChange={e => setBody(e.target.value)} />
        )}
        {mode === 'photo' && (
          <input className="fs-input" placeholder="Photo URLs (comma-separated https://…)" value={photoUrls} onChange={e => setPhotoUrls(e.target.value)} />
        )}
        {myRole && (
          <label className="fs-field">Schedule post in {community.timezone || 'America/Chicago'} (optional)
            <input className="fs-input" type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
          </label>
        )}
        <button className="fs-small-btn" onClick={createPost}>{scheduledFor ? 'Schedule Post' : 'Post to Board'}</button>
      </div>

      {visiblePosts.map(p => {
        const postVotes = votes.filter(v => v.post_id === p.id);
        const myVote = postVotes.find(v => v.profile_id === me)?.option_index;
        return (
          <div key={p.id} className="fs-card">
            <div className="fs-card-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="player-dot filled">{names[p.author_id]?.initials || 'FS'}</div>
                <div>
                  <div className="fs-board-name">{names[p.author_id]?.username || 'Member'}</div>
                  <div className="fs-board-meta">
                    {when(p.created_at)}
                    {p.scheduled_for && new Date(p.scheduled_for) > new Date() ? ` · Scheduled for ${when(p.scheduled_for)}` : ''}
                  </div>
                </div>
              </div>
              <span className="fs-pill">{p.kind}</span>
            </div>
            {p.body && <p className="fs-sub" style={{ margin: '8px 0 4px', whiteSpace: 'pre-line' }}>{p.body}</p>}
            {p.kind === 'photo' && Array.isArray(p.media_urls) && p.media_urls.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 8 }}>
                {p.media_urls.map((u, i) => (
                  <img key={i} src={u} alt="Community album" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ))}
              </div>
            )}
            {p.kind === 'poll' && (
              <div style={{ marginTop: 8 }}>
                <div className="fs-card-title" style={{ marginBottom: 6 }}>📊 {p.poll_question}</div>
                {(p.poll_options || []).map((opt, idx) => {
                  const cnt = postVotes.filter(v => v.option_index === idx).length;
                  const pct = postVotes.length ? Math.round((cnt / postVotes.length) * 100) : 0;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => votePoll(p.id, idx)}
                      className="fs-card"
                      style={{
                        width: '100%', textAlign: 'left', marginBottom: 6, padding: '8px 10px', cursor: 'pointer',
                        borderColor: myVote === idx ? 'var(--gold-bright)' : 'var(--border)'
                      }}
                    >
                      <div className="fs-card-row">
                        <span>{myVote === idx ? '✓ ' : ''}{opt}</span>
                        <span className="fs-card-meta">{cnt} vote{cnt === 1 ? '' : 's'} ({pct}%)</span>
                      </div>
                      <div className="cm-bar"><div style={{ width: `${pct}%` }} /></div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!visiblePosts.length && <div className="fs-empty">No board posts yet. Start a conversation, poll, or photo album!</div>}
    </>
  );
}

// 3.3 Community Pro Shop & Concessions (Shared Inventory + Order Queue)
function CommunityShop({ community, isAdmin, isMember, onMsg, onError }) {
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [qtys, setQtys] = useState({});
  const [fulfillment, setFulfillment] = useState('pro_shop');
  const [holeNum, setHoleNum] = useState('9');
  const [cartNum, setCartNum] = useState('');
  const [newProd, setNewProd] = useState({ name: '', category: 'merch', price: '', member_price: '', stock_count: '25', description: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: p } = await supabase.from('shop_products').select('*').eq('community_id', community.id).order('category');
    setProducts(p || []);
    if (isAdmin) {
      const { data: o } = await supabase.from('shop_orders').select('*').eq('community_id', community.id).order('created_at', { ascending: false }).limit(40);
      setOrders(o || []);
    }
  };
  useEffect(() => { load(); }, [community.id, isAdmin]);

  const addProduct = async () => {
    if (!newProd.name.trim() || newProd.price === '') return onError('Enter product name and price.');
    const { error } = await supabase.from('shop_products').insert([{
      community_id: community.id,
      name: newProd.name.trim(),
      category: newProd.category,
      description: newProd.description || null,
      price_cents: Math.round(Number(newProd.price) * 100),
      member_price_cents: newProd.member_price !== '' ? Math.round(Number(newProd.member_price) * 100) : null,
      stock_count: Number(newProd.stock_count) || 25,
    }]);
    if (error) return onError(friendly(error));
    setNewProd({ name: '', category: 'merch', price: '', member_price: '', stock_count: '25', description: '' });
    onMsg('Product added to catalog!');
    load();
  };

  const checkoutShop = async () => {
    const items = Object.entries(qtys).filter(([, q]) => Number(q) > 0).map(([product_id, qty]) => ({ product_id, qty: Number(qty) }));
    if (!items.length) return onError('Select at least one item.');
    setBusy(true);
    try {
      await rpc('place_shop_order', {
        p_community_id: community.id,
        p_channel: fulfillment === 'pro_shop' ? 'online' : 'on_course',
        p_fulfillment: fulfillment,
        p_hole_number: fulfillment === 'cart_delivery' ? Number(holeNum) || 9 : null,
        p_cart_number: cartNum || null,
        p_items: items,
      });
      setQtys({});
      onMsg('Order placed! Inventory updated and staff notified.');
      load();
    } catch (e) { onError(e.message); }
    setBusy(false);
  };

  const updateOrderStatus = async (orderId, status) => {
    await supabase.from('shop_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
    load();
  };

  return (
    <>
      <div className="fs-seg">
        <button type="button" className={fulfillment === 'pro_shop' ? 'on' : ''} onClick={() => setFulfillment('pro_shop')}>🛍️ Merch / Event Pickup</button>
        <button type="button" className={fulfillment === 'turn_pickup' ? 'on' : ''} onClick={() => setFulfillment('turn_pickup')}>🍔 Turn Pickup</button>
        <button type="button" className={fulfillment === 'cart_delivery' ? 'on' : ''} onClick={() => setFulfillment('cart_delivery')}>🛺 Cart Delivery</button>
      </div>
      {fulfillment === 'cart_delivery' && (
        <div className="cm-row2" style={{ marginTop: 8 }}>
          <input className="fs-input" type="number" min={1} max={18} placeholder="Hole # (1-18)" value={holeNum} onChange={e => setHoleNum(e.target.value)} />
          <input className="fs-input" placeholder="Cart # / Group #" value={cartNum} onChange={e => setCartNum(e.target.value)} />
        </div>
      )}

      <div className="fs-section-title">Catalog (Online & Event-Day Shared Inventory)</div>
      {products.map(p => {
        const price = isMember && p.member_price_cents != null ? p.member_price_cents : p.price_cents;
        return (
          <div key={p.id} className="fs-card fs-card-row">
            <div>
              <div className="fs-card-title">{p.name} — {money(price)}</div>
              <div className="fs-card-meta">
                {p.category.toUpperCase()} · {p.stock_count} in stock
                {p.member_price_cents != null && !isMember ? ` · Members ${money(p.member_price_cents)}` : ''}
              </div>
            </div>
            <select
              className="fs-input"
              style={{ width: 78, margin: 0 }}
              disabled={p.stock_count <= 0}
              value={qtys[p.id] || 0}
              onChange={e => setQtys({ ...qtys, [p.id]: Number(e.target.value) })}
            >
              {Array.from({ length: Math.min(10, p.stock_count) + 1 }, (_, i) => (
                <option key={i} value={i}>{i === 0 ? '0' : `${i}×`}</option>
              ))}
            </select>
          </div>
        );
      })}
      {!products.length && <div className="fs-empty">No merch or concession items in catalog yet.</div>}

      {Object.values(qtys).some(q => Number(q) > 0) && (
        <button className="fs-cta" disabled={busy} onClick={checkoutShop}>
          {busy ? 'Ordering…' : 'Checkout with Saved Payment Method'}
        </button>
      )}

      {isAdmin && (
        <>
          <div className="fs-section-title">Staff Order Queue ({orders.filter(o => o.status !== 'delivered').length} active)</div>
          {orders.map(o => (
            <div key={o.id} className="fs-card">
              <div className="fs-card-row">
                <span className="fs-card-title">
                  {o.fulfillment === 'cart_delivery' ? `🛺 Cart Delivery (Hole ${o.hole_number || '—'} · ${o.cart_number || 'Cart'})` : o.fulfillment === 'turn_pickup' ? '🍔 Turn Pickup' : '🛍️ Pro Shop'}
                </span>
                <span className={`fs-pill ${o.status === 'ready' ? 'live' : ''}`}>{o.status.toUpperCase()}</span>
              </div>
              <div className="fs-card-meta">{(o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ')} · {moneyExact(o.total_cents)}</div>
              <div className="cm-actions" style={{ marginTop: 6 }}>
                {['queued', 'preparing', 'ready', 'delivered'].map(st => (
                  <button key={st} type="button" className={`fs-small-btn ${o.status === st ? '' : 'ghost'}`} onClick={() => updateOrderStatus(o.id, st)}>
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="fs-section-title">Add Product to Shared Inventory</div>
          <div className="fs-card">
            <div className="cm-row2">
              <input className="fs-input" placeholder="Item name (e.g. Club Polo, Turn Burger)" value={newProd.name} onChange={e => setNewProd({ ...newProd, name: e.target.value })} />
              <select className="fs-input" value={newProd.category} onChange={e => setNewProd({ ...newProd, category: e.target.value })}>
                <option value="merch">Merch</option>
                <option value="concessions">Concessions (Food/Drink)</option>
                <option value="addon">Event Add-On</option>
              </select>
            </div>
            <div className="cm-row2">
              <input className="fs-input" type="number" min={0} placeholder="Price ($)" value={newProd.price} onChange={e => setNewProd({ ...newProd, price: e.target.value })} />
              <input className="fs-input" type="number" min={0} placeholder="Member Price ($, optional)" value={newProd.member_price} onChange={e => setNewProd({ ...newProd, member_price: e.target.value })} />
            </div>
            <input className="fs-input" type="number" min={0} placeholder="Initial Stock Count (25)" value={newProd.stock_count} onChange={e => setNewProd({ ...newProd, stock_count: e.target.value })} />
            <button className="fs-small-btn" onClick={addProduct}>+ Add Product</button>
          </div>
        </>
      )}
    </>
  );
}

const EventRow = ({ e, onOpen }) => (
  <button className="fs-card fs-card-btn" onClick={() => onOpen(e.id)}>
    <div className="fs-card-row"><span className="fs-card-title">{e.name}</span><span className={`fs-pill ${e.status === 'live' ? 'live' : ''}`}>{e.status}</span></div>
    <div className="fs-card-meta">{when(e.starts_at)} · {courseById(e.course_id)?.name}</div>
  </button>
);

function CommunityAdmin({ session, c, myRole, tiers, onChanged }) {
  const [pending, setPending] = useState([]);
  const [members, setMembers] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [names, setNames] = useState({});
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [season, setSeason] = useState({ name: '', starts_on: '', ends_on: '', invite_top_n: '', finish: '50,30,20,10,5', participation: '10', course_bonus: '5' });
  const [tierForm, setTierForm] = useState({ name: '', price: '', billing_interval: 'annual', member_discount_pct: '15', description: '' });
  const [csvText, setCsvText] = useState('');
  const [announceForm, setAnnounceForm] = useState({ title: '', body: '', channels: ['email', 'sms', 'push'] });
  const [privacy, setPrivacy] = useState(c.privacy);
  const [payoutSchedule, setPayoutSchedule] = useState(c.stripe_payout_schedule || 'daily');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const isOwner = myRole === 'owner';

  const load = async () => {
    const { data: m } = await supabase.from('memberships').select('*').eq('community_id', c.id);
    const { data: a } = await supabase.from('community_admins').select('*').eq('community_id', c.id);
    const ids = [...new Set([...(m || []), ...(a || [])].map(x => x.profile_id))];
    const { data: p } = ids.length ? await supabase.from('profiles').select('id, username, initials, handicap').in('id', ids) : { data: [] };
    setNames(Object.fromEntries((p || []).map(x => [x.id, x])));
    setPending((m || []).filter(x => x.status === 'pending'));
    setMembers((m || []).filter(x => x.status === 'active'));
    setAdmins(a || []);
  };
  useEffect(() => { load(); }, [c.id]);
  useEffect(() => {
    if (q.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id, username, initials').ilike('username', `%${q}%`).limit(6); setFound(data || []); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (p, ok) => { setErr(''); const { error } = await p; if (error) setErr(friendly(error)); else { setMsg(ok); load(); onChanged(); } };
  const nm = (id) => names[id]?.username || 'Player';

  const connectStripe = async () => {
    const acctId = c.stripe_account_id || `acct_${c.id.replace(/-/g, '').slice(0, 14)}`;
    await run(
      supabase.from('communities').update({
        stripe_account_id: acctId,
        stripe_onboarding_complete: true,
        stripe_payout_schedule: payoutSchedule,
      }).eq('id', c.id),
      `Stripe Connect Express account (${acctId}) active! Payouts set to ${payoutSchedule}.`
    );
  };

  const createTier = async () => {
    if (!tierForm.name.trim() || tierForm.price === '') return setErr('Enter tier name and price.');
    await run(
      supabase.from('membership_tiers').insert([{
        community_id: c.id,
        name: tierForm.name.trim(),
        price_cents: Math.round(Number(tierForm.price) * 100),
        billing_interval: tierForm.billing_interval,
        member_discount_pct: Number(tierForm.member_discount_pct) || 0,
        description: tierForm.description || null,
      }]),
      `Membership tier "${tierForm.name}" created!`
    );
    setTierForm({ name: '', price: '', billing_interval: 'annual', member_discount_pct: '15', description: '' });
  };

  // 3.2 CSV Member Import (supports file upload or pasted CSV)
  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const importCsvMembers = async () => {
    const rows = parseCsv(csvText);
    if (!rows.length) return setErr('Paste CSV rows or upload a CSV file (Name,Email,Handicap,Tier).');
    setErr('');
    let matched = 0;
    for (const r of rows) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('id')
        .ilike('username', r.name || r.email.split('@')[0])
        .limit(1)
        .maybeSingle();
      const tierObj = tiers.find(t => t.name.toLowerCase() === (r.tier || '').toLowerCase());
      if (prof?.id) {
        await supabase.from('memberships').upsert([{
          community_id: c.id,
          profile_id: prof.id,
          status: 'active',
          tier_id: tierObj?.id || null,
          imported_name: r.name,
          imported_email: r.email,
        }], { onConflict: 'community_id,profile_id' });
        matched++;
      }
    }
    setCsvText('');
    setMsg(`Processed ${rows.length} CSV row(s) (${matched} existing ForeSome profile(s) linked immediately).`);
    load();
    onChanged();
  };

  const sendRenewalReminders = async () => {
    await supabase.from('memberships')
      .update({ last_reminder_at: new Date().toISOString() })
      .eq('community_id', c.id)
      .eq('status', 'active');
    setMsg(`Renewal reminders & failed-payment retry links sent to ${members.length} member(s)!`);
  };

  const sendCommunityAnnouncement = async () => {
    if (!announceForm.title.trim() || !announceForm.body.trim()) return setErr('Enter title and message.');
    const { data, error } = await supabase.from('community_announcements').insert([{
      community_id: c.id,
      title: announceForm.title.trim(),
      body: announceForm.body.trim(),
      channels: announceForm.channels,
      sent_at: new Date().toISOString(),
      recipient_cnt: members.length,
      created_by: session.user.id,
    }]).select().single();
    if (error) return setErr(friendly(error));
    await supabase.functions.invoke('notify', {
      body: { announcementId: data.id, communityId: c.id, title: announceForm.title, body: announceForm.body, channels: announceForm.channels }
    }).catch(() => null);
    setAnnounceForm({ title: '', body: '', channels: ['email', 'sms', 'push'] });
    setMsg(`Announcement broadcast to ${members.length} members via ${announceForm.channels.join(', ').toUpperCase()}!`);
  };

  const createSeason = async () => {
    if (!season.name || !season.starts_on || !season.ends_on) return setErr('Season needs a name, start and end.');
    const { data, error } = await supabase.from('seasons').insert([{ name: season.name, community_id: c.id, starts_on: season.starts_on, ends_on: season.ends_on, invite_top_n: season.invite_top_n ? Number(season.invite_top_n) : null }]).select('id').single();
    if (error) return setErr(friendly(error));
    const rules = [
      ...season.finish.split(',').map(s => Number(s.trim())).filter(n => n >= 0).map((pts, i) => ({ season_id: data.id, rule_type: 'finish', position: i + 1, points: pts })),
      ...(season.participation ? [{ season_id: data.id, rule_type: 'participation', position: null, points: Number(season.participation) }] : []),
      ...(season.course_bonus ? [{ season_id: data.id, rule_type: 'course_bonus', position: null, points: Number(season.course_bonus) }] : []),
    ];
    await run(supabase.from('season_point_rules').insert(rules), `${season.name} created`);
    setSeason({ ...season, name: '' });
  };

  return (
    <>
      {msg && <div className="fs-note">{msg}</div>}{err && <div className="fs-error">{err}</div>}

      {/* ForeSome Pricing & Revenue Model + 2.1 Stripe Connect Express Onboarding */}
      <div className="fs-section-title">ForeSome Plan & Stripe Connect Express</div>
      <div className="fs-card" style={{ borderColor: 'rgba(212,184,122,0.35)' }}>
        <div className="fs-card-row" style={{ marginBottom: 10 }}>
          <div>
            <div className="fs-card-title">
              Plan: {c.plan_tier === 'pro' ? '🌟 Community Pro ($59/mo)' : '⛳ Community Free ($0 at Partner Courses)'}
            </div>
            <div className="fs-card-meta">
              {c.plan_tier === 'pro'
                ? 'Includes: Seasons, recurring dues, sponsors, pro shop & concessions, multi-channel messaging, CSV imports · 5.5% all-in transaction fee (covers Stripe; passable to player).'
                : 'Includes: Unlimited events, registration, waitlists, live scoring, TV mode · 6.5% all-in transaction fee (covers Stripe; passable to player). Upgrade to Pro ($49–79/mo) for seasons, dues, sponsors, shop & messaging anywhere.'}
            </div>
          </div>
          <button
            className="fs-small-btn ghost"
            onClick={() =>
              run(
                supabase
                  .from('communities')
                  .update({
                    plan_tier: c.plan_tier === 'pro' ? 'free' : 'pro',
                    plan_monthly_cents: c.plan_tier === 'pro' ? 0 : 5900,
                    all_in_fee_bps: c.plan_tier === 'pro' ? 650 : 550,
                  })
                  .eq('id', c.id),
                c.plan_tier === 'pro' ? 'Switched to Community Free ($0)' : 'Upgraded to Community Pro ($59/mo · 5.5% all-in fee)!'
              )
            }
          >
            {c.plan_tier === 'pro' ? 'Switch to Free' : 'Upgrade to Pro ($59/mo)'}
          </button>
        </div>

        <div className="fs-card-row" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
          <div>
            <div className="fs-card-title">{c.stripe_onboarding_complete ? `Connected (${c.stripe_account_id})` : 'Connect Bank Account with Stripe Express'}</div>
            <div className="fs-card-meta">
              Receive event entries, membership dues, sponsorships, and pro shop sales directly. All-in transaction fee: {((c.all_in_fee_bps || (c.plan_tier === 'pro' ? 550 : 650)) / 100).toFixed(1)}% (covers Stripe; can be passed to player at event checkout).
            </div>
          </div>
          <span className={`fs-pill ${c.stripe_onboarding_complete ? 'live' : ''}`}>{c.stripe_onboarding_complete ? 'Active ✓' : 'Setup'}</span>
        </div>
        <div className="cm-row2" style={{ marginTop: 8 }}>
          <select className="fs-input" value={payoutSchedule} onChange={e => setPayoutSchedule(e.target.value)}>
            <option value="daily">Daily Automatic Payouts</option>
            <option value="weekly">Weekly Automatic Payouts</option>
            <option value="monthly">Monthly Automatic Payouts</option>
          </select>
          <button className="fs-small-btn" onClick={connectStripe}>
            {c.stripe_onboarding_complete ? 'Update Payout Schedule' : '⚡ Onboard Stripe Express'}
          </button>
        </div>
      </div>

      {/* Season Revenue & Software Cost Forecaster for this Community */}
      <RevenueForecast initialPreset={c.plan_tier === 'pro' ? 'tour' : 'league'} showPlatformScale={false} />

      {/* 3.2 Membership Tiers & Recurring Dues Admin */}
      <div className="fs-section-title">Membership Tiers & Recurring Dues</div>
      <div className="fs-card">
        <div className="cm-row2">
          <input className="fs-input" placeholder="Tier Name (Full, Social, Junior)" value={tierForm.name} onChange={e => setTierForm({ ...tierForm, name: e.target.value })} />
          <input className="fs-input" type="number" min={0} placeholder="Price ($)" value={tierForm.price} onChange={e => setTierForm({ ...tierForm, price: e.target.value })} />
        </div>
        <div className="cm-row2">
          <select className="fs-input" value={tierForm.billing_interval} onChange={e => setTierForm({ ...tierForm, billing_interval: e.target.value })}>
            <option value="annual">Annual Billing</option>
            <option value="season">Per Season Billing</option>
            <option value="monthly">Monthly Billing</option>
          </select>
          <input className="fs-input" type="number" min={0} max={100} placeholder="Member Event Discount % (15)" value={tierForm.member_discount_pct} onChange={e => setTierForm({ ...tierForm, member_discount_pct: e.target.value })} />
        </div>
        <input className="fs-input" placeholder="Benefits description (e.g. Member-only majors + 15% off entry fees)" value={tierForm.description} onChange={e => setTierForm({ ...tierForm, description: e.target.value })} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="fs-small-btn" onClick={createTier}>+ Add Membership Tier</button>
          <button className="fs-small-btn ghost" onClick={sendRenewalReminders}>🔔 Send Renewal Reminders & Retry Failed Dues</button>
        </div>
      </div>

      {/* 3.2 CSV Member Import */}
      <div className="fs-section-title">Import Members from CSV</div>
      <div className="fs-card">
        <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} style={{ marginBottom: 8, fontSize: 12 }} />
        <textarea
          className="fs-input"
          rows={3}
          placeholder={"name,email,handicap,tier\nKeith M.,keith@example.com,8,Full\nRico Q.,rico@example.com,11,Full"}
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
        />
        <button className="fs-small-btn" onClick={importCsvMembers}>📥 Import CSV Members</button>
      </div>

      {/* 3.4 Broadcast Announcement (Email, SMS, Push) */}
      <div className="fs-section-title">Broadcast Community Announcement (Email · SMS · Push)</div>
      <div className="fs-card">
        <input className="fs-input" placeholder="Announcement Title" value={announceForm.title} onChange={e => setAnnounceForm({ ...announceForm, title: e.target.value })} />
        <textarea className="fs-input" rows={2} placeholder="Message to all community members…" value={announceForm.body} onChange={e => setAnnounceForm({ ...announceForm, body: e.target.value })} />
        <button className="fs-small-btn" onClick={sendCommunityAnnouncement}>📣 Send via Email, SMS & Push</button>
      </div>

      <div className="fs-section-title">Join requests</div>
      {pending.map(m => (
        <div key={m.id} className="fs-player"><div className="player-dot filled">{names[m.profile_id]?.initials}</div>
          <div className="fs-board-who"><div className="fs-board-name">{nm(m.profile_id)}</div></div>
          <button className="fs-small-btn" onClick={() => run(supabase.from('memberships').update({ status: 'active' }).eq('id', m.id), `${nm(m.profile_id)} approved`)}>Approve</button>
          <button className="fs-x" aria-label="Decline" onClick={() => run(supabase.from('memberships').delete().eq('id', m.id), 'Declined')}>✕</button></div>
      ))}
      {!pending.length && <div className="fs-empty">No requests.</div>}

      <div className="fs-section-title">Admins</div>
      {admins.map(a => (
        <div key={a.profile_id} className="fs-player"><div className="player-dot filled">{names[a.profile_id]?.initials}</div>
          <div className="fs-board-who"><div className="fs-board-name">{nm(a.profile_id)}</div><div className="fs-board-meta">{a.role.replace('_', '-')}</div></div>
          {a.role !== 'owner' && (isOwner || a.role === 'co_admin') && <button className="fs-small-btn ghost" onClick={() => run(supabase.from('community_admins').delete().eq('community_id', c.id).eq('profile_id', a.profile_id), 'Removed')}>Remove</button>}</div>
      ))}
      <input className="fs-input" placeholder="Add an admin by username…" value={q} onChange={e => setQ(e.target.value)} />
      {found.map(p => (
        <div key={p.id} className="fs-player"><span className="fs-board-name" style={{ flex: 1 }}>{p.username}</span>
          {isOwner && <button className="fs-small-btn" onClick={() => run(supabase.from('community_admins').insert([{ community_id: c.id, profile_id: p.id, role: 'admin' }]), `${p.username} is an admin`)}>Admin</button>}
          <button className="fs-small-btn ghost" onClick={() => run(supabase.from('community_admins').insert([{ community_id: c.id, profile_id: p.id, role: 'co_admin' }]), `${p.username} is a co-admin`)}>Co-admin</button>
          <button className="fs-small-btn ghost" onClick={() => run(supabase.from('memberships').insert([{ community_id: c.id, profile_id: p.id, status: 'active' }]), `${p.username} added as a member`)}>Member</button></div>
      ))}

      <div className="fs-section-title">Members ({members.length})</div>
      {members.map(m => (
        <div key={m.id} className="fs-player"><div className="player-dot filled">{names[m.profile_id]?.initials}</div>
          <div className="fs-board-who">
            <div className="fs-board-name">{nm(m.profile_id)}</div>
            <div className="fs-board-meta">
              HCP {names[m.profile_id]?.handicap ?? '—'}
              {m.tier_id ? ` · ${tiers.find(t => t.id === m.tier_id)?.name || 'Tier'}` : ''}
              {m.payment_status ? ` · Dues: ${m.payment_status}` : ''}
            </div>
          </div>
          {m.profile_id !== c.created_by && <button className="fs-x" aria-label="Remove member" onClick={() => confirm(`Remove ${nm(m.profile_id)}?`) && run(supabase.from('memberships').delete().eq('id', m.id), 'Removed')}>✕</button>}</div>
      ))}

      <div className="fs-section-title">New season</div>
      <div className="fs-card">
        <input className="fs-input" placeholder="2027 Season" value={season.name} onChange={e => setSeason({ ...season, name: e.target.value })} />
        <div className="cm-row2">
          <label className="fs-field">Starts<input className="fs-input" type="date" value={season.starts_on} onChange={e => setSeason({ ...season, starts_on: e.target.value })} /></label>
          <label className="fs-field">Ends<input className="fs-input" type="date" value={season.ends_on} onChange={e => setSeason({ ...season, ends_on: e.target.value })} /></label>
        </div>
        <label className="fs-field">Finish points (1st, 2nd, 3rd…)<input className="fs-input" value={season.finish} onChange={e => setSeason({ ...season, finish: e.target.value })} /></label>
        <div className="cm-row2">
          <label className="fs-field">Playing an event<input className="fs-input" type="number" value={season.participation} onChange={e => setSeason({ ...season, participation: e.target.value })} /></label>
          <label className="fs-field">New course bonus<input className="fs-input" type="number" value={season.course_bonus} onChange={e => setSeason({ ...season, course_bonus: e.target.value })} /></label>
        </div>
        <label className="fs-field">Top N unlock invite-only outings (optional)<input className="fs-input" type="number" value={season.invite_top_n} onChange={e => setSeason({ ...season, invite_top_n: e.target.value })} /></label>
        <button className="fs-small-btn" onClick={createSeason}>Create season</button>
      </div>

      {isOwner && (
        <>
          <div className="fs-section-title">Who can join</div>
          {Object.entries(PRIVACY).map(([k, l]) => <label key={k} className={`fs-radio ${privacy === k ? 'on' : ''}`}><input type="radio" checked={privacy === k} onChange={() => { setPrivacy(k); run(supabase.from('communities').update({ privacy: k }).eq('id', c.id), 'Saved'); }} /><span>{l}</span></label>)}
        </>
      )}
    </>
  );
}
