import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import '../features.css';

const QUICK = ['On my way ⛳', 'Running 10 min late', 'Grab a cart?', 'Nice round 👏'];

export default function DirectMessages({ session, friends = [], active, onBack, onUnread }) {
  const me = session?.user?.id;
  const buddies = friends.filter(f => f.status === 'accepted' && f.profile).map(f => f.profile);
  const [threads, setThreads] = useState({});    // friendId -> {last, unread}
  const [open, setOpen] = useState(null);         // friend profile
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const openRef = useRef(null);
  openRef.current = open;

  const loadThreads = async () => {
    if (!me) return;
    const { data, error } = await supabase.from('direct_messages')
      .select('id, sender_id, recipient_id, text, created_at, read_at')
      .order('created_at', { ascending: false }).limit(300);
    if (error) { setError(friendly(error)); return; }
    const t = {};
    (data || []).forEach(m => {
      const other = m.sender_id === me ? m.recipient_id : m.sender_id;
      t[other] ||= { last: m, unread: 0 };
      if (m.recipient_id === me && !m.read_at) t[other].unread++;
    });
    setThreads(t);
    onUnread?.(Object.values(t).reduce((s, x) => s + x.unread, 0));
  };

  // One realtime channel for anything sent to me.
  useEffect(() => {
    if (!me) return;
    loadThreads();
    const ch = supabase.channel(`dm-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${me}` }, (p) => {
        const m = p.new;
        if (openRef.current?.id === m.sender_id) {
          setMsgs(prev => [...prev, m]);
          supabase.from('direct_messages').update({ read_at: new Date().toISOString() }).eq('id', m.id).then(() => {});
        }
        loadThreads();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me]);

  useEffect(() => { if (active) loadThreads(); }, [active]);

  const openThread = async (friend) => {
    setOpen(friend); setMsgs([]);
    const { data } = await supabase.from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${me},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${me})`)
      .order('created_at', { ascending: true }).limit(200);
    setMsgs(data || []);
    await supabase.from('direct_messages').update({ read_at: new Date().toISOString() })
      .eq('recipient_id', me).eq('sender_id', friend.id).is('read_at', null);
    loadThreads();
  };

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs.length]);

  const send = async (body) => {
    const t = (body ?? text).trim();
    if (!t || !open) return;
    setText('');
    const { data, error } = await supabase.from('direct_messages').insert([{ sender_id: me, recipient_id: open.id, text: t }]).select().single();
    if (error) { setError(friendly(error)); setText(t); return; }
    setError('');
    setMsgs(prev => [...prev, data]);
    loadThreads();
  };

  if (open) {
    return (
      <div className="fs-page fs-chat">
        <div className="fs-topbar">
          <button className="back-btn" onClick={() => setOpen(null)}>← MESSAGES</button>
          <span className="fs-chat-with">{open.username}</span>
        </div>
        <div className="fs-thread" ref={listRef}>
          {msgs.length === 0 && <div className="fs-empty">Say hi to {open.username}.</div>}
          {msgs.map(m => (
            <div key={m.id} className={`msg ${m.sender_id === me ? 'me' : 'them'}`}>
              <div className="msg-stack"><div className="bubble">{m.text}</div>
                <div className="fs-time">{new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
        </div>
        {error && <div className="fs-error">{error}</div>}
        <div className="fs-chips">{QUICK.map(q => <button key={q} className="fs-chip" onClick={() => send(q)}>{q}</button>)}</div>
        <div className="banter-input-area">
          <input className="banter-input" placeholder={`Message ${open.username}…`} value={text}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} maxLength={2000} />
          <button className="banter-send" onClick={() => send()}>SEND</button>
        </div>
      </div>
    );
  }

  const sorted = [...buddies].sort((a, b) => (threads[b.id]?.last?.created_at || '').localeCompare(threads[a.id]?.last?.created_at || ''));
  return (
    <div className="fs-page">
      <div className="fs-topbar"><button className="back-btn" onClick={onBack}>← BACK</button></div>
      <h1 className="fs-h1">Messages</h1>
      <p className="fs-sub">Private chats with your friends. For group chat, open a group.</p>
      {error && <div className="fs-error">{error}</div>}
      {buddies.length === 0 && <div className="fs-empty">Add friends from the home screen to start chatting.</div>}
      {sorted.map(f => {
        const t = threads[f.id];
        return (
          <button key={f.id} className="fs-card fs-card-btn fs-dm-row" onClick={() => openThread(f)}>
            <div className="player-dot filled">{f.initials || '?'}</div>
            <div className="fs-dm-text">
              <div className="fs-card-title">{f.username}</div>
              <div className="fs-card-meta">{t ? (t.last.sender_id === me ? 'You: ' : '') + t.last.text : 'No messages yet'}</div>
            </div>
            {t?.unread > 0 && <span className="fs-badge">{t.unread}</span>}
          </button>
        );
      })}
    </div>
  );
}

function friendly(e) {
  if (/direct_messages/i.test(e?.message || '') && /does not exist|Could not find/i.test(e.message)) {
    return 'Messages need a one-time database update. Run supabase/2026-11-golfer-features.sql in Supabase.';
  }
  if (/row-level security/i.test(e?.message || '')) return 'You can only message accepted friends.';
  return e?.message || 'Something went wrong.';
}
