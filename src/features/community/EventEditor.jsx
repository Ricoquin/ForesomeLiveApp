import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, friendly, courseList, courseById } from './api';

const PRESET_QUESTIONS = [
  { id: 'waiver', label: 'I accept the event waiver and rules', type: 'checkbox', required: true },
  { id: 'shirt', label: 'Shirt size', type: 'select', options: ['S', 'M', 'L', 'XL', 'XXL'] },
  { id: 'guests', label: 'Guest names (if any)', type: 'text' },
];

const PRESET_ADDONS = [
  { name: 'Mulligan Pack (2)', price: '10', max_per_player: 2, stock_count: '' },
  { name: 'Warm-up Range Balls', price: '8', max_per_player: 2, stock_count: '' },
  { name: 'Box Lunch & Drink Ticket', price: '18', max_per_player: 4, stock_count: '60' },
  { name: 'Gross & Net Skins Pot', price: '20', max_per_player: 1, stock_count: '' },
];

const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => v ? new Date(v).toISOString() : null;
const dollars = (c) => c == null ? '' : String(c / 100);
const cents = (v) => v === '' || v == null ? null : Math.round(Number(v) * 100);

// Create or edit an event. Hosts can be a community the user runs, an operator they staff, or just themselves.
export default function EventEditor({ session, roles, eventId, preset = {}, onSaved, onCancel }) {
  const me = session.user.id;
  const [f, setF] = useState({
    name: '', description: '', course_id: preset.courseId || '', starts_at: '', format: 'stroke', team_size: 1, capacity: '',
    shotgun_start: false, tee_interval_minutes: 10, visibility: 'public', allow_waitlist: true,
    registration_opens_at: '', registration_closes_at: '', teequest_ref: '', community_id: preset.communityId || '',
    organization_id: preset.organizationId || '', season_id: '', invite_only_top_n: '', questions: [PRESET_QUESTIONS[0]], status: 'draft',
    pass_processing_fee: false, allow_donations: false, fundraising_goal: '', donation_title: '',
  });
  const [fee, setFee] = useState(''); const [memberFee, setMemberFee] = useState('');
  const [ticketId, setTicketId] = useState(null);
  const [addons, setAddons] = useState([]);
  const [newAddon, setNewAddon] = useState({ name: '', price: '', max_per_player: '4', stock_count: '' });
  const [courseQ, setCourseQ] = useState('');
  const [seasons, setSeasons] = useState([]);
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (patch) => setF(x => ({ ...x, ...patch }));

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
      if (error) { setErr(friendly(error)); return; }
      setF({
        ...ev,
        capacity: ev.capacity ?? '',
        invite_only_top_n: ev.invite_only_top_n ?? '',
        community_id: ev.community_id || '',
        organization_id: ev.organization_id || '',
        season_id: ev.season_id || '',
        teequest_ref: ev.teequest_ref || '',
        starts_at: toLocalInput(ev.starts_at),
        registration_opens_at: toLocalInput(ev.registration_opens_at),
        registration_closes_at: toLocalInput(ev.registration_closes_at),
        questions: ev.questions || [],
        pass_processing_fee: !!ev.pass_processing_fee,
        allow_donations: !!ev.allow_donations,
        fundraising_goal: ev.fundraising_goal_cents ? dollars(ev.fundraising_goal_cents) : '',
        donation_title: ev.donation_title || '',
      });
      const { data: t } = await supabase.from('event_ticket_types').select('*').eq('event_id', eventId).order('sort_order').limit(1);
      if (t?.[0]) { setTicketId(t[0].id); setFee(dollars(t[0].price_cents)); setMemberFee(dollars(t[0].member_price_cents)); }
      const { data: ads } = await supabase.from('event_addons').select('*').eq('event_id', eventId).order('sort_order');
      if (ads) setAddons(ads.map(a => ({
        id: a.id, name: a.name, price: dollars(a.price_cents),
        max_per_player: String(a.max_per_player || 4), stock_count: a.stock_count != null ? String(a.stock_count) : '',
      })));
    })();
  }, [eventId]);

  useEffect(() => {
    (async () => {
      if (!f.community_id && !f.organization_id) { setSeasons([]); return; }
      const col = f.community_id ? 'community_id' : 'organization_id';
      const { data } = await supabase.from('seasons').select('*').eq(col, f.community_id || f.organization_id).order('starts_on', { ascending: false });
      setSeasons(data || []);
    })();
  }, [f.community_id, f.organization_id]);

  const toggleQ = (q) => set({ questions: f.questions.some(x => x.id === q.id) ? f.questions.filter(x => x.id !== q.id) : [...f.questions, q] });
  const addCustom = () => { if (!custom.trim()) return; set({ questions: [...f.questions, { id: `q${Date.now()}`, label: custom.trim(), type: 'text' }] }); setCustom(''); };

  const addAddonItem = (item) => {
    if (!item.name.trim() || item.price === '') return;
    setAddons(prev => [...prev, { ...item, tempId: `tmp_${Date.now()}_${Math.random()}` }]);
    setNewAddon({ name: '', price: '', max_per_player: '4', stock_count: '' });
  };
  const removeAddon = async (idx) => {
    const target = addons[idx];
    if (target?.id) await supabase.from('event_addons').delete().eq('id', target.id);
    setAddons(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async (status) => {
    if (!f.name.trim()) return setErr('Give the event a name.');
    if (!f.course_id) return setErr('Pick the course.');
    if (!f.starts_at) return setErr('Set the date and start time.');
    if (f.invite_only_top_n && !f.season_id) return setErr('Invite-only by standings needs a season.');
    setBusy(true); setErr('');
    const row = {
      name: f.name.trim(), description: f.description || null, course_id: f.course_id, starts_at: fromLocalInput(f.starts_at),
      format: f.format, team_size: Number(f.team_size) || 1, capacity: f.capacity ? Number(f.capacity) : null,
      shotgun_start: !!f.shotgun_start, tee_interval_minutes: Number(f.tee_interval_minutes) || 10,
      visibility: f.visibility === 'members_only' && !f.community_id ? 'public' : f.visibility,
      allow_waitlist: !!f.allow_waitlist, registration_opens_at: fromLocalInput(f.registration_opens_at),
      registration_closes_at: fromLocalInput(f.registration_closes_at), teequest_ref: f.teequest_ref || null,
      community_id: f.community_id || null, organization_id: f.organization_id || null, season_id: f.season_id || null,
      invite_only_top_n: f.invite_only_top_n ? Number(f.invite_only_top_n) : null, questions: f.questions, status,
      pass_processing_fee: !!f.pass_processing_fee,
      allow_donations: !!f.allow_donations,
      fundraising_goal_cents: f.fundraising_goal ? cents(f.fundraising_goal) : null,
      donation_title: f.donation_title?.trim() || null,
    };
    let id = eventId;
    if (id) {
      const { error } = await supabase.from('events').update(row).eq('id', id);
      if (error) { setBusy(false); return setErr(friendly(error)); }
    } else {
      const { data, error } = await supabase.from('events').insert([{ ...row, created_by: me }]).select('id').single();
      if (error) { setBusy(false); return setErr(friendly(error)); }
      id = data.id;
    }
    const price = cents(fee) || 0, member = cents(memberFee);
    if (ticketId) await supabase.from('event_ticket_types').update({ price_cents: price, member_price_cents: member }).eq('id', ticketId);
    else if (price || member != null) await supabase.from('event_ticket_types').insert([{ event_id: id, name: 'Entry', price_cents: price, member_price_cents: member }]);

    // Save new add-ons
    const unsavedAddons = addons.filter(a => !a.id);
    if (unsavedAddons.length) {
      await supabase.from('event_addons').insert(unsavedAddons.map((a, idx) => ({
        event_id: id,
        name: a.name.trim(),
        price_cents: cents(a.price) || 0,
        max_per_player: Number(a.max_per_player) || 4,
        stock_count: a.stock_count !== '' ? Number(a.stock_count) : null,
        sort_order: idx,
      })));
    }
    setBusy(false);
    onSaved(id);
  };

  const matches = courseQ.length > 1 ? courseList.filter(c => `${c.name} ${c.city}`.toLowerCase().includes(courseQ.toLowerCase())).slice(0, 6) : [];
  const course = courseById(f.course_id);

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onCancel}>← BACK</button></div>
      <h1 className="fs-h1">{eventId ? 'Edit event' : 'Host an event'}</h1>

      <label className="fs-field">Event name<input className="fs-input" value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Saturday Skins League" /></label>
      <label className="fs-field">Description<textarea className="fs-input" rows={3} value={f.description || ''} onChange={e => set({ description: e.target.value })} /></label>

      <div className="fs-section-title">Host</div>
      <select className="fs-input" value={f.community_id ? `c:${f.community_id}` : f.organization_id ? `o:${f.organization_id}` : ''}
        onChange={e => { const [k, v] = e.target.value.split(':'); set({ community_id: k === 'c' ? v : '', organization_id: k === 'o' ? v : '', season_id: '' }); }}>
        <option value="">Just me (standalone outing)</option>
        {roles.adminCommunities.map(c => <option key={c.id} value={`c:${c.id}`}>{c.name} (community)</option>)}
        {roles.staffOrgs.map(o => <option key={o.id} value={`o:${o.id}`}>{o.name} (course operator)</option>)}
      </select>

      <div className="fs-section-title">Where and when</div>
      {course ? (
        <div className="fs-card fs-card-row"><span className="fs-card-title">{course.name}</span><button className="fs-link" onClick={() => set({ course_id: '' })}>Change</button></div>
      ) : (
        <>
          <input className="fs-input" placeholder="Search courses…" value={courseQ} onChange={e => setCourseQ(e.target.value)} />
          {matches.map(c => <button key={c.id} className="fs-list-btn" onClick={() => { set({ course_id: c.id }); setCourseQ(''); }}>{c.name} · {c.city}</button>)}
        </>
      )}
      <label className="fs-field">Start<input className="fs-input" type="datetime-local" value={f.starts_at} onChange={e => set({ starts_at: e.target.value })} /></label>
      <label className="fs-toggle"><input type="checkbox" checked={f.shotgun_start} onChange={e => set({ shotgun_start: e.target.checked })} /> Shotgun start</label>
      {!f.shotgun_start && (
        <label className="fs-field">Minutes between tee times<input className="fs-input" type="number" min={5} max={30} value={f.tee_interval_minutes} onChange={e => set({ tee_interval_minutes: e.target.value })} /></label>
      )}
      <label className="fs-field">TeeQuest confirmation # (optional)<input className="fs-input" value={f.teequest_ref} onChange={e => set({ teequest_ref: e.target.value })} placeholder="Book the tee block in TeeQuest, paste the number here" /></label>

      <div className="fs-section-title">Format</div>
      <div className="cm-row2">
        <select className="fs-input" value={f.format} onChange={e => set({ format: e.target.value })}>
          {Object.entries(FORMAT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="fs-input" value={f.team_size} onChange={e => set({ team_size: e.target.value })}>
          {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? 'Individuals' : `Teams of ${n}`}</option>)}
        </select>
      </div>

      <div className="fs-section-title">Spots, Entry & Stripe Checkout</div>
      <div className="cm-row2">
        <label className="fs-field">Max players<input className="fs-input" type="number" min={1} value={f.capacity} onChange={e => set({ capacity: e.target.value })} placeholder="No limit" /></label>
        <label className="fs-field">Entry fee ($)<input className="fs-input" type="number" min={0} value={fee} onChange={e => setFee(e.target.value)} placeholder="0" /></label>
      </div>
      {f.community_id && <label className="fs-field">Member price ($, optional)<input className="fs-input" type="number" min={0} value={memberFee} onChange={e => setMemberFee(e.target.value)} placeholder="Discounted member entry" /></label>}
      <label className="fs-toggle">
        <input type="checkbox" checked={f.pass_processing_fee} onChange={e => set({ pass_processing_fee: e.target.checked })} />
        Pass processing fee (2.9% + 30¢) to player as a visible line item (uncheck to absorb fee)
      </label>
      <label className="fs-toggle"><input type="checkbox" checked={f.allow_waitlist} onChange={e => set({ allow_waitlist: e.target.checked })} /> Waitlist when full (refunds or cancellations promote #1 automatically)</label>
      <div className="cm-stack">
        <label className="fs-field">Sign-up opens<input className="fs-input" type="datetime-local" value={f.registration_opens_at} onChange={e => set({ registration_opens_at: e.target.value })} /></label>
        <label className="fs-field">Sign-up closes<input className="fs-input" type="datetime-local" value={f.registration_closes_at} onChange={e => set({ registration_closes_at: e.target.value })} /></label>
      </div>

      <div className="fs-section-title">Checkout Add-Ons (Mulligans, Range Balls, Lunch)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {PRESET_ADDONS.map(p => (
          <button key={p.name} type="button" className="fs-small-btn ghost" onClick={() => addAddonItem(p)}>
            + {p.name} (${p.price})
          </button>
        ))}
      </div>
      {addons.map((a, idx) => (
        <div key={a.id || a.tempId || idx} className="fs-card fs-card-row">
          <div>
            <div className="fs-card-title">{a.name} — ${a.price}</div>
            <div className="fs-card-meta">Max {a.max_per_player}/player{a.stock_count ? ` · Stock: ${a.stock_count}` : ' · Unlimited'}</div>
          </div>
          <button type="button" className="fs-x" onClick={() => removeAddon(idx)} aria-label="Remove add-on">✕</button>
        </div>
      ))}
      <div className="fs-card">
        <div className="cm-row2">
          <input className="fs-input" placeholder="Add-on name (e.g. Mulligan)" value={newAddon.name} onChange={e => setNewAddon({ ...newAddon, name: e.target.value })} />
          <input className="fs-input" type="number" min={0} placeholder="Price ($)" value={newAddon.price} onChange={e => setNewAddon({ ...newAddon, price: e.target.value })} />
        </div>
        <div className="cm-row2">
          <input className="fs-input" type="number" min={1} placeholder="Max per player (4)" value={newAddon.max_per_player} onChange={e => setNewAddon({ ...newAddon, max_per_player: e.target.value })} />
          <input className="fs-input" type="number" min={1} placeholder="Total stock (optional)" value={newAddon.stock_count} onChange={e => setNewAddon({ ...newAddon, stock_count: e.target.value })} />
        </div>
        <button type="button" className="fs-small-btn" onClick={() => addAddonItem(newAddon)}>+ Add item to checkout</button>
      </div>

      <div className="fs-section-title">Charity & Donations</div>
      <label className="fs-toggle">
        <input type="checkbox" checked={f.allow_donations} onChange={e => set({ allow_donations: e.target.checked })} />
        Accept optional donations at checkout & enable standalone charity donation link
      </label>
      {f.allow_donations && (
        <div className="cm-row2">
          <label className="fs-field">Beneficiary / Cause Title<input className="fs-input" placeholder="First Tee of Greater KC" value={f.donation_title} onChange={e => set({ donation_title: e.target.value })} /></label>
          <label className="fs-field">Fundraising Goal ($)<input className="fs-input" type="number" min={0} placeholder="5000" value={f.fundraising_goal} onChange={e => set({ fundraising_goal: e.target.value })} /></label>
        </div>
      )}

      <div className="fs-section-title">Who can see and join</div>
      <select className="fs-input" value={f.visibility} onChange={e => set({ visibility: e.target.value })}>
        <option value="public">Public — listed in Events</option>
        <option value="unlisted">Unlisted — only people with the link</option>
        {f.community_id && <option value="members_only">Members only</option>}
      </select>
      {seasons.length > 0 && (
        <>
          <label className="fs-field">Counts toward season
            <select className="fs-input" value={f.season_id} onChange={e => set({ season_id: e.target.value })}>
              <option value="">No season</option>
              {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {f.season_id && <label className="fs-field">Invite only: top N in standings (optional)<input className="fs-input" type="number" min={1} value={f.invite_only_top_n} onChange={e => set({ invite_only_top_n: e.target.value })} /></label>}
        </>
      )}

      <div className="fs-section-title">Questions at sign-up</div>
      {PRESET_QUESTIONS.map(q => <label key={q.id} className="fs-toggle"><input type="checkbox" checked={f.questions.some(x => x.id === q.id)} onChange={() => toggleQ(q)} /> {q.label}{q.required ? ' (required)' : ''}</label>)}
      {f.questions.filter(q => !PRESET_QUESTIONS.some(p => p.id === q.id)).map(q => (
        <div key={q.id} className="fs-card fs-card-row"><span>{q.label}</span><button className="fs-x" onClick={() => toggleQ(q)} aria-label="Remove question">✕</button></div>
      ))}
      <div className="fs-guest"><input className="fs-input" placeholder="Add your own question" value={custom} onChange={e => setCustom(e.target.value)} /><button className="fs-small-btn" onClick={addCustom}>Add</button></div>

      {err && <div className="fs-error">{err}</div>}
      <button className="fs-cta" disabled={busy} onClick={() => save(f.status === 'draft' ? 'published' : f.status)}>{busy ? 'Saving…' : f.status === 'draft' ? 'Publish event' : 'Save changes'}</button>
      {(!eventId || f.status === 'draft') && <button className="fs-cta secondary" disabled={busy} onClick={() => save('draft')}>Save as draft</button>}
    </div>
  );
}
