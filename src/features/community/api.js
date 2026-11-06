import { supabase } from '../../supabaseClient';
import courses from '../../data/courses.json';

export const FORMAT_LABELS = {
  stroke: 'Stroke play', scramble: 'Scramble', best_ball: 'Best Ball', skins: 'Skins',
  stableford: 'Stableford', match_play: 'Match play', other: 'Other',
};
export const STATUS_LABELS = {
  pending_payment: 'Awaiting payment', confirmed: 'Confirmed', waitlisted: 'Waitlist',
  cancelled: 'Cancelled', checked_in: 'Checked in',
};
export const SPONSOR_BENEFIT_LABELS = {
  hole_sign: '🪧 Hole Sign',
  tv_logo: '📺 TV Leaderboard Logo',
  cart_sign: '🛺 Cart Sign Logo',
  shout_out: '📣 Announcer Shout-Out',
};
export const ATTENDANCE_LABELS = {
  present: '✅ Present',
  late: '⏰ Late',
  left_early: '🏃 Left early',
  absent: '❌ Absent',
};

export const courseById = (id) => courses.find(c => c.id === id) || null;
export const courseList = courses;

export function money(cents) {
  if (!cents) return 'Free';
  return `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}
export function moneyExact(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}
export function calcProcessingFee(subtotalCents) {
  if (!subtotalCents || subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * 0.029) + 30;
}
export function calcPlatformFee(subtotalCents, bps = 250) {
  if (!subtotalCents || subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * (bps / 10000));
}

export function when(ts, opts = {}) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts });
}
export const isToday = (ts) => ts && new Date(ts).toDateString() === new Date().toDateString();
export const fmtPar = (n) => n == null ? '—' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;

// Turn database errors into something a golfer can read.
export function friendly(e) {
  const m = e?.message || String(e || '');
  if (/does not exist|Could not find the (function|table)/i.test(m)) {
    return 'Database update needed: run supabase/2026-11-community-phase2-3.sql in Supabase SQL Editor.';
  }
  if (/row-level security/i.test(m)) return "You don't have permission to do that.";
  if (/duplicate key/i.test(m)) return 'That already exists.';
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong.';
}

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendly(error));
  return data;
}

export const appUrl = (path) => `${window.location.origin}${path}`;
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}
export function downloadCsv(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Parse CSV text for member import: supports header row (name,email,handicap,tier) or plain rows
export function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitRow = (row) => row.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
  const first = splitRow(lines[0]).map(h => h.toLowerCase());
  const hasHeader = first.some(h => ['name', 'username', 'email', 'handicap', 'hcp', 'tier'].includes(h));
  const startIdx = hasHeader ? 1 : 0;
  return lines.slice(startIdx).map(line => {
    const cols = splitRow(line);
    if (hasHeader) {
      const obj = {};
      first.forEach((k, i) => { obj[k] = cols[i] || ''; });
      return {
        name: obj.name || obj.username || obj.player || cols[0] || '',
        email: obj.email || cols[1] || '',
        handicap: obj.handicap || obj.hcp || cols[2] || '12',
        tier: obj.tier || cols[3] || '',
      };
    }
    return {
      name: cols[0] || '',
      email: cols[1] || '',
      handicap: cols[2] || '12',
      tier: cols[3] || '',
    };
  }).filter(r => r.name || r.email);
}
