import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FORMAT_LABELS, money, when } from './api';
import '../features.css';
import './community.css';

// Public shareable community page at /c/:slug (foresomekc.com/c/:slug) — works without signing in.
export default function PublicCommunity({ slug }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase
      .rpc('public_community_by_slug', { p_slug: slug })
      .then(({ data: d, error }) => {
        if (error) setErr(error.message);
        else setData(d);
      });
  }, [slug]);

  if (err) {
    return (
      <div className="fs-page cm-public">
        <div className="fs-error">{err}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="fs-page cm-public">
        <div className="fs-empty">Loading community…</div>
      </div>
    );
  }

  const c = data.community;
  const brandColor = c.brand_color || '#2ecc71';
  const events = data.upcoming_events || [];
  const standings = data.standings || [];
  const tiers = data.tiers || [];

  return (
    <div className="fs-page cm-public">
      {/* Branded Cover & Header */}
      <div
        className="fs-card"
        style={{
          marginBottom: 14,
          padding: 0,
          overflow: 'hidden',
          borderColor: `${brandColor}66`,
        }}
      >
        <div
          style={{
            height: c.cover_url ? 150 : 84,
            background: c.cover_url
              ? `url(${c.cover_url}) center/cover no-repeat`
              : `linear-gradient(135deg, ${brandColor}44, #07140c)`,
            position: 'relative',
          }}
        >
          {c.logo_url && (
            <img
              src={c.logo_url}
              alt=""
              style={{
                width: 64,
                height: 64,
                borderRadius: 14,
                objectFit: 'cover',
                border: `2px solid ${brandColor}`,
                position: 'absolute',
                bottom: -22,
                left: 16,
                background: '#08140d',
              }}
            />
          )}
        </div>
        <div style={{ padding: c.logo_url ? '28px 16px 16px' : '16px' }}>
          <div className="fs-eyebrow" style={{ color: brandColor }}>
            FORESOME COMMUNITY · {c.visibility?.toUpperCase()}
            {c.city ? ` · ${c.city.toUpperCase()}` : ''}
          </div>
          <h1 className="fs-h1" style={{ marginTop: 4 }}>
            {c.name}
          </h1>
          {c.description && <p className="fs-body">{c.description}</p>}
          <div className="fs-card-meta" style={{ marginTop: 6 }}>
            {data.member_count || 0} member{data.member_count === 1 ? '' : 's'} ·{' '}
            <span style={{ color: brandColor }}>foresomekc.com/c/{c.slug}</span>
          </div>
          <div className="cm-actions" style={{ marginTop: 12 }}>
            <a
              className="primary-btn"
              style={{
                textAlign: 'center',
                textDecoration: 'none',
                background: brandColor,
              }}
              href={`/?community=${c.id}`}
            >
              {c.visibility === 'closed' ? 'Request to Join in App' : 'Join Community in ForeSome'}
            </a>
          </div>
        </div>
      </div>

      {/* Membership Tiers & Dues */}
      {tiers.length > 0 && (
        <div className="fs-card" style={{ marginBottom: 14 }}>
          <div className="fs-section-title" style={{ marginTop: 0 }}>
            🪪 Membership Tiers & Dues
          </div>
          {tiers.map((t) => (
            <div key={t.id} className="fs-board-row" style={{ alignItems: 'center' }}>
              <div className="fs-board-who">
                <div className="fs-board-name">{t.name}</div>
                <div className="fs-board-meta">
                  {money(t.price_cents)} / {t.interval}
                  {t.member_discount_pct > 0 ? ` · ${t.member_discount_pct}% off event entries` : ''}
                </div>
                {t.benefits?.length > 0 && (
                  <div className="fs-card-meta">{t.benefits.join(' · ')}</div>
                )}
              </div>
              <a
                className="fs-small-btn"
                style={{ textDecoration: 'none' }}
                href={`/?community=${c.id}`}
              >
                Join Tier
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming Community Events */}
      <div className="fs-section-title">Upcoming Events ({events.length})</div>
      {events.map((e) => (
        <a
          key={e.id}
          href={`/e/${e.id}`}
          className="fs-card fs-card-btn"
          style={{ textDecoration: 'none', display: 'block' }}
        >
          <div className="fs-card-row">
            <span className="fs-card-title">{e.name}</span>
            <span className="fs-pill">{money(e.entry_fee_cents)}</span>
          </div>
          <div className="fs-card-meta">
            {when(e.starts_at)} · {e.course_name}
          </div>
          <div className="fs-card-meta">
            {FORMAT_LABELS[e.format] || e.format} · {e.holes} holes
            {e.members_only ? ' · 🔒 Members Only' : ''}
            {e.member_entry_fee_cents != null
              ? ` · Member rate: ${money(e.member_entry_fee_cents)}`
              : ''}
          </div>
        </a>
      ))}
      {!events.length && <div className="fs-empty">No upcoming events scheduled yet.</div>}

      {/* Season Standings */}
      {standings.length > 0 && (
        <>
          <div className="fs-section-title">Season Standings</div>
          {standings.map((r, i) => (
            <div key={r.profile_id || i} className="fs-board-row">
              <span className="fs-rank">{i + 1}</span>
              <div className="fs-board-who">
                <div className="fs-board-name">{r.username}</div>
                <div className="fs-board-meta">
                  {r.events_played} event{r.events_played === 1 ? '' : 's'} · {r.wins} win
                  {r.wins === 1 ? '' : 's'}
                </div>
              </div>
              <span className="fs-board-val">{r.points} pts</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

