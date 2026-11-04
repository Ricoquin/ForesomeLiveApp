import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { friendly, slugify, courseList } from './api';

// ForeSome (QMS) platform admin: create operators, link courses, assign operator admins, add platform admins.
export default function PlatformAdmin({ session, onBack, onChanged }) {
  const [orgs, setOrgs] = useState([]); const [sel, setSel] = useState(null);
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [linked, setLinked] = useState([]); const [cq, setCq] = useState('');
  const [uq, setUq] = useState(''); const [found, setFound] = useState([]); const [admins, setAdmins] = useState([]);

  const load = async () => {
    const { data, error } = await supabase.from('organizations').select('*').order('name');
    if (error) return setErr(friendly(error));
    setOrgs(data || []);
    const { data: pa } = await supabase.from('platform_admins').select('profile_id');
    const ids = (pa || []).map(x => x.profile_id);
    const { data: p } = ids.length ? await supabase.from('profiles').select('id, username').in('id', ids) : { data: [] };
    setAdmins(p || []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (sel) supabase.from('courses').select('id, name').eq('organization_id', sel.id).then(({ data }) => setLinked(data || [])); }, [sel]);
  useEffect(() => {
    if (uq.length < 2) return setFound([]);
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id, username').ilike('username', `%${uq}%`).limit(6); setFound(data || []); }, 300);
    return () => clearTimeout(t);
  }, [uq]);

  const done = (error, ok) => { if (error) setErr(friendly(error)); else { setErr(''); setMsg(ok); load(); onChanged?.(); } };
  const create = async () => {
    if (!name.trim()) return;
    const { data, error } = await supabase.from('organizations').insert([{ name: name.trim(), slug: slugify(name) }]).select().single();
    done(error, `${name} created`); if (data) { setSel(data); setName(''); }
  };
  const link = async (c, on) => {
    const { error } = await supabase.from('courses').update({ organization_id: on ? sel.id : null }).eq('id', c.id);
    done(error, on ? `${c.name} linked` : `${c.name} unlinked`);
    const { data } = await supabase.from('courses').select('id, name').eq('organization_id', sel.id); setLinked(data || []);
  };
  const matches = cq.length > 1 ? courseList.filter(c => c.name.toLowerCase().includes(cq.toLowerCase())).slice(0, 6) : [];

  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div>
      <div className="fs-eyebrow">ForeSome platform admin</div>
      <h1 className="fs-h1">Operators</h1>
      {msg && <div className="fs-note">{msg}</div>}{err && <div className="fs-error">{err}</div>}
      {orgs.map(o => <button key={o.id} className={`fs-card fs-card-btn ${sel?.id === o.id ? 'cm-selected' : ''}`} onClick={() => setSel(o)}><span className="fs-card-title">{o.name}</span></button>)}
      <div className="fs-guest"><input className="fs-input" placeholder="New operator, e.g. Orion Golf" value={name} onChange={e => setName(e.target.value)} /><button className="fs-small-btn" onClick={create}>Create</button></div>

      {sel && (
        <>
          <div className="fs-section-title">{sel.name} · courses</div>
          {linked.map(c => <div key={c.id} className="fs-card fs-card-row"><span>{c.name}</span><button className="fs-x" aria-label={`Unlink ${c.name}`} onClick={() => link(c, false)}>✕</button></div>)}
          <input className="fs-input" placeholder="Link a course…" value={cq} onChange={e => setCq(e.target.value)} />
          {matches.map(c => <button key={c.id} className="fs-list-btn" onClick={() => { link(c, true); setCq(''); }}>+ {c.name}</button>)}

          <div className="fs-section-title">{sel.name} · first admin</div>
          <input className="fs-input" placeholder="Username…" value={uq} onChange={e => setUq(e.target.value)} />
          {found.map(p => (
            <div key={p.id} className="fs-player"><span className="fs-board-name" style={{ flex: 1 }}>{p.username}</span>
              <button className="fs-small-btn" onClick={() => supabase.from('organization_staff').upsert([{ organization_id: sel.id, profile_id: p.id, role: 'owner' }]).then(({ error }) => done(error, `${p.username} owns ${sel.name}`))}>Owner</button>
              <button className="fs-small-btn ghost" onClick={() => supabase.from('organization_staff').upsert([{ organization_id: sel.id, profile_id: p.id, role: 'admin' }]).then(({ error }) => done(error, `${p.username} is an admin`))}>Admin</button></div>
          ))}
        </>
      )}

      <div className="fs-section-title">Platform admins</div>
      {admins.map(a => <div key={a.id} className="fs-card">{a.username}{a.id === session.user.id ? ' (you)' : ''}</div>)}
      {!sel && found.map(p => <button key={p.id} className="fs-list-btn" onClick={() => supabase.from('platform_admins').insert([{ profile_id: p.id }]).then(({ error }) => done(error, `${p.username} is a platform admin`))}>+ Make {p.username} a platform admin</button>)}
      {!sel && <input className="fs-input" placeholder="Search a user to make platform admin…" value={uq} onChange={e => setUq(e.target.value)} />}
    </div>
  );
}
