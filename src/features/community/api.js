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

export const courseById = (id) => courses.find(c => c.id === id) || null;
export const courseList = courses;

export function money(cents) {
  if (!cents) return 'Free';
  return `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
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
    return 'Events need a one-time database update. Run supabase/2026-11-community-phase1.sql in Supabase.';
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
