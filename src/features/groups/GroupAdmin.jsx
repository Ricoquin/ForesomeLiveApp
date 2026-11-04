import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import '../features.css';

const PRIVACY = [
  ['secret', 'Secret', 'Hidden. Members join by invite only.'],
  ['closed', 'Closed', 'Anyone can find it and ask to join. Admins approve.'],
  ['public', 'Public', 'Anyone can find it and join.'],
];

// Admin tools for a group: privacy, who can invite, join requests and co-admins.
export function GroupAdminPanel({ session, group, members = [], onChanged }) {
  const me = session?.user?.id;
  const isOwner = group?.admin_id === me;
  const [privacy, setPrivacy] = useState(group?.privacy || 'secret');
  const [membersCanInvite, setMembersCanInvite] = useState(!!group?.members_can_invite);
  const [requests, setRequests] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => { setPrivacy(group?.privacy || 'secret'); setMembersCanInvite(!!group?.members_can_invite); }, [group?.id, group?.privacy, group?.members_can_invite]);

  const loadRequests = async () => {
    if (!group?.id) return;
    const { data } = await supabase.from('group_members').select('*').eq('group_id', group.id).eq('status', 'requested');
    if (!data?.length) { setRequests([]); return; }
    const { data: profiles } = await supabase.from('profiles').select('id, username, initials, handicap').in('id', data.map(r => r.user_id));
    setRequests(data.map(r => ({ ...r, profile: (profiles || []).find(p => p.id === r.user_id) })));
  };
  useEffect(() => { loadRequests(); }, [group?.id]);

  const saveSettings = async (patch) => {
    const { error } = await supabase.from('groups').update(patch).eq('id', group.id);
    setMsg(error ? explain(error) : 'Saved');
    if (!error) onChanged?.({ ...group, ...patch });
  };
  const decide = async (row, approve) => {
    const { error } = approve
      ? await supabase.from('group_members').update({ status: 'active' }).eq('id', row.id)
      : await supabase.from('group_members').delete().eq('id', row.id);
    setMsg(error ? explain(error) : approve ? `${row.profile?.username || 'Player'} added` : 'Request declined');
    loadRequests(); onChanged?.();
  };
  const setRole = async (m, role) => {
    const { error } = await supabase.from('group_members').update({ role }).eq('id', m.id);
    setMsg(error ? explain(error) : role === 'co_admin' ? `${m.profile?.username} is now a co-admin` : `${m.profile?.username} is a member again`);
    onChanged?.();
  };

  return (
    <div className="fs-admin">
      <button className="fs-admin-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>⚙ Admin controls</span>
        {requests.length > 0 && <span className="fs-badge">{requests.length}</span>}
        <span className="fs-admin-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="fs-admin-body">
          {requests.length > 0 && (
            <>
              <div className="fs-section-title">Join requests</div>
              {requests.map(r => (
                <div key={r.id} className="fs-player">
                  <div className="player-dot filled">{r.profile?.initials || '?'}</div>
                  <div className="fs-board-who"><div className="fs-board-name">{r.profile?.username}</div><div className="fs-board-meta">HCP {r.profile?.handicap ?? '—'}</div></div>
                  <button className="fs-small-btn" onClick={() => decide(r, true)}>Approve</button>
                  <button className="fs-x" onClick={() => decide(r, false)} aria-label="Decline">✕</button>
                </div>
              ))}
            </>
          )}

          <div className="fs-section-title">Who can find this group</div>
          {PRIVACY.map(([k, l, d]) => (
            <label key={k} className={`fs-radio ${privacy === k ? 'on' : ''}`}>
              <input type="radio" name="privacy" checked={privacy === k} onChange={() => { setPrivacy(k); saveSettings({ privacy: k }); }} />
              <span><b>{l}</b> — {d}</span>
            </label>
          ))}
          <label className="fs-toggle">
            <input type="checkbox" checked={membersCanInvite} onChange={e => { setMembersCanInvite(e.target.checked); saveSettings({ members_can_invite: e.target.checked }); }} />
            Members can invite friends
          </label>

          {isOwner && (
            <>
              <div className="fs-section-title">Co-admins</div>
              <p className="fs-footnote">Co-admins can approve requests, invite and remove members, and change these settings. Only you can add or remove co-admins.</p>
              {members.filter(m => m.status === 'active' && m.user_id !== me).map(m => (
                <div key={m.id} className="fs-player">
                  <div className="player-dot filled">{m.profile?.initials || '?'}</div>
                  <div className="fs-board-who"><div className="fs-board-name">{m.profile?.username}</div><div className="fs-board-meta">{m.role === 'co_admin' ? 'Co-admin' : 'Member'}</div></div>
                  {m.role === 'co_admin'
                    ? <button className="fs-small-btn ghost" onClick={() => setRole(m, 'member')}>Remove co-admin</button>
                    : <button className="fs-small-btn" onClick={() => setRole(m, 'co_admin')}>Make co-admin</button>}
                </div>
              ))}
            </>
          )}
          {msg && <div className="fs-note">{msg}</div>}
        </div>
      )}
    </div>
  );
}

// Find closed and public groups to join.
export function GroupDiscover({ session, myGroupIds = [], active, onJoined }) {
  const [groups, setGroups] = useState([]);
  const [requested, setRequested] = useState({});
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('groups').select('id, name, description, avatar_emoji, privacy')
      .in('privacy', ['closed', 'public']).order('created_at', { ascending: false }).limit(50);
    if (error) { if (!/privacy/.test(error.message)) setMsg(error.message); return; }
    setGroups(data || []);
    const { data: mine } = await supabase.from('group_members').select('group_id, status').eq('user_id', session.user.id).eq('status', 'requested');
    setRequested(Object.fromEntries((mine || []).map(m => [m.group_id, true])));
  };
  useEffect(() => { if (active && session?.user?.id) load(); }, [active, session?.user?.id]);

  const join = async (g) => {
    const status = g.privacy === 'public' ? 'active' : 'requested';
    const { error } = await supabase.from('group_members').insert([{ group_id: g.id, user_id: session.user.id, role: 'member', status }]);
    if (error) { setMsg(explain(error)); return; }
    if (status === 'active') { setMsg(`You joined ${g.name}`); onJoined?.(); }
    else { setRequested(r => ({ ...r, [g.id]: true })); setMsg(`Request sent to ${g.name}'s admins`); }
  };

  const list = groups.filter(g => !myGroupIds.includes(g.id) && g.name.toLowerCase().includes(q.toLowerCase()));
  if (groups.length === 0) return null;
  return (
    <div className="fs-discover">
      <div className="section-head"><span className="section-title">▸ Find groups</span></div>
      <input className="fs-input" placeholder="Search groups…" value={q} onChange={e => setQ(e.target.value)} />
      {list.slice(0, 12).map(g => (
        <div key={g.id} className="fs-card fs-card-row">
          <div className="group-emoji-avatar">{g.avatar_emoji || '⛳'}</div>
          <div className="fs-dm-text">
            <div className="fs-card-title">{g.name}</div>
            <div className="fs-card-meta">{g.privacy === 'public' ? 'Public' : 'Closed'}{g.description ? ` · ${g.description}` : ''}</div>
          </div>
          {requested[g.id]
            ? <span className="fs-pill">Requested</span>
            : <button className="fs-small-btn" onClick={() => join(g)}>{g.privacy === 'public' ? 'Join' : 'Ask to join'}</button>}
        </div>
      ))}
      {list.length === 0 && <div className="fs-empty">No other groups to join right now.</div>}
      {msg && <div className="fs-note">{msg}</div>}
    </div>
  );
}

function explain(e) {
  const m = e?.message || '';
  if (/column .*privacy|members_can_invite|does not exist/i.test(m)) return 'Run supabase/2026-11-golfer-features.sql in Supabase to turn on group controls.';
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong.';
}
