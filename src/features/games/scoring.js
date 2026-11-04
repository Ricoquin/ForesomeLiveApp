// ForeSome game scoring engine — pure functions, no React, no network.
// A game = { format, settings, players, scores }.
//   settings: { pars: number[18], strokeIndex: number[18], holes: 18|9, useHandicaps: bool,
//               allowance: 0..100, skinValue: number, carryover: bool, nassauStake: number }
//   players:  [{ id, name, handicap, team }]  team = 'A' | 'B' | ... (team formats)
//   scores:   { [playerId or teamId]: (number|null)[] }  scramble scores are keyed by team

export const FORMATS = {
  stroke:     { label: 'Stroke play', teams: false, blurb: 'Lowest total score wins.' },
  best_ball:  { label: 'Best Ball', teams: true, blurb: 'Teams count their best score on each hole.' },
  scramble:   { label: 'Scramble', teams: true, blurb: 'Everyone hits, the team plays the best shot. One score per team.' },
  skins:      { label: 'Skins', teams: false, blurb: 'Win a hole outright to win the skin. Ties carry over.' },
  nassau:     { label: 'Nassau', teams: 'optional', blurb: 'Three matches in one: front nine, back nine and overall.' },
  stableford: { label: 'Stableford', teams: false, blurb: 'Points for each hole. Most points wins.' },
  match:      { label: 'Match play', teams: 'optional', blurb: 'Win holes, not strokes. Two sides head to head.' },
};

const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Course handicap with allowance (default 100%), rounded.
export function playingHandicap(h, allowance = 100) {
  return Math.round((Number(h) || 0) * (allowance / 100));
}

// Strokes received on a hole with stroke index si (1 = hardest) for playing handicap ph.
export function strokesOnHole(ph, si, holes = 18) {
  if (!ph || ph <= 0 || !si) return 0;
  const base = Math.floor(ph / holes);
  return base + (si <= ph % holes ? 1 : 0);
}

// Handicap each player plays off. For head-to-head formats (match, nassau) strokes are
// given relative to the lowest handicap in the game; otherwise each plays their full handicap.
export function handicapMap(game) {
  const { players, format, settings = {} } = game;
  const out = {};
  if (!settings.useHandicaps) { players.forEach(p => { out[p.id] = 0; }); return out; }
  const allowance = settings.allowance ?? 100;
  players.forEach(p => { out[p.id] = playingHandicap(p.handicap, allowance); });
  if (format === 'match' || format === 'nassau') {
    const low = Math.min(...Object.values(out));
    Object.keys(out).forEach(k => { out[k] -= low; });
  }
  return out;
}

export function netScore(game, playerId, holeIdx) {
  const gross = game.scores?.[playerId]?.[holeIdx];
  if (!isNum(gross)) return null;
  const hc = handicapMap(game)[playerId] || 0;
  const si = game.settings?.strokeIndex?.[holeIdx];
  return gross - strokesOnHole(hc, si, 18);
}

export function teamsOf(game) {
  const teams = {};
  game.players.forEach(p => { (teams[p.team || p.id] ||= []).push(p); });
  return teams;
}

const holeCount = (game) => game.settings?.holes || 18;
const firstHole = (game) => game.settings?.startHole === 10 ? 9 : 0;
const holeRange = (game) => Array.from({ length: holeCount(game) }, (_, i) => firstHole(game) + i);

// Lowest net score among a team's players on a hole (null if nobody has a score).
function teamBall(game, members, h) {
  const nets = members.map(m => netScore(game, m.id, h)).filter(isNum);
  return nets.length ? Math.min(...nets) : null;
}

// "Sides" for head-to-head formats: two teams if teams are set, otherwise the first two players.
export function sidesOf(game) {
  const teams = teamsOf(game);
  const keys = Object.keys(teams);
  const useTeams = game.players.some(p => p.team) && keys.length === 2;
  if (useTeams) return keys.map(k => ({ id: k, name: teamLabel(k, teams[k]), members: teams[k] }));
  return game.players.slice(0, 2).map(p => ({ id: p.id, name: p.name, members: [p] }));
}

function teamLabel(key, members) {
  return members.length > 1 ? members.map(m => m.name.split(' ')[0]).join(' & ') : (members[0]?.name || `Team ${key}`);
}

function sideHole(game, side, h) {
  if (game.format === 'scramble') {
    const v = game.scores?.[side.id]?.[h];
    return isNum(v) ? v : null;
  }
  return teamBall(game, side.members, h);
}

// Match between two sides over a list of hole indexes.
export function matchResult(game, holes, sides = sidesOf(game)) {
  if (sides.length < 2) return { status: 'Need two sides', leader: null, holesWon: [0, 0], thru: 0, done: false };
  let diff = 0, thru = 0; const won = [0, 0];
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const a = sideHole(game, sides[0], h), b = sideHole(game, sides[1], h);
    if (!isNum(a) || !isNum(b)) break;
    thru = i + 1;
    if (a < b) { diff++; won[0]++; } else if (b < a) { diff--; won[1]++; }
    const remaining = holes.length - thru;
    if (remaining > 0 && Math.abs(diff) > remaining) {
      const leader = diff > 0 ? sides[0] : sides[1];
      return { status: `${leader.name} wins ${Math.abs(diff)} & ${remaining}`, leader: leader.id, margin: Math.abs(diff), holesWon: won, thru, done: true };
    }
  }
  const done = thru === holes.length;
  if (diff === 0) return { status: done ? 'All square — halved' : (thru ? `All square thru ${thru}` : 'Not started'), leader: null, margin: 0, holesWon: won, thru, done };
  const leader = diff > 0 ? sides[0] : sides[1];
  const n = Math.abs(diff);
  const remaining = holes.length - thru;
  let status = done ? `${leader.name} wins ${n} up` : `${leader.name} ${n} up thru ${thru}`;
  if (!done && n === remaining) status += ' (dormie)';
  return { status, leader: leader.id, margin: n, holesWon: won, thru, done };
}

// Stableford points from net score vs par.
export function stablefordPoints(net, par) {
  if (!isNum(net) || !isNum(par)) return 0;
  return Math.max(0, 2 + (par - net));
}

// Main entry: returns { headline, standings: [{id, name, value, detail}], holes?, extra }
export function computeResults(game) {
  const { format, settings = {}, players } = game;
  const pars = settings.pars || Array(18).fill(4);
  const holes = holeRange(game);
  const parFor = (idxs) => sum(idxs.map(h => pars[h]));

  if (format === 'stroke' || format === 'stableford') {
    const rows = players.map(p => {
      const played = holes.filter(h => isNum(game.scores?.[p.id]?.[h]));
      const gross = sum(played.map(h => game.scores[p.id][h]));
      const net = sum(played.map(h => netScore(game, p.id, h)));
      const pts = sum(played.map(h => stablefordPoints(netScore(game, p.id, h), pars[h])));
      const toPar = (settings.useHandicaps ? net : gross) - parFor(played);
      return { id: p.id, name: p.name, thru: played.length, gross, net, pts, toPar };
    });
    if (format === 'stableford') {
      rows.sort((a, b) => b.pts - a.pts);
      return { headline: rows[0]?.thru ? `${rows[0].name} leads with ${rows[0].pts} pts` : 'Not started',
        standings: rows.map(r => ({ id: r.id, name: r.name, value: `${r.pts} pts`, detail: `thru ${r.thru}` })) };
    }
    const key = settings.useHandicaps ? 'net' : 'gross';
    rows.sort((a, b) => (a.thru === 0) - (b.thru === 0) || a.toPar - b.toPar || a[key] - b[key]);
    return { headline: rows[0]?.thru ? `${rows[0].name} leads at ${fmtPar(rows[0].toPar)}` : 'Not started',
      standings: rows.map(r => ({ id: r.id, name: r.name, value: fmtPar(r.toPar), detail: `${r.gross} gross${settings.useHandicaps ? ` · ${r.net} net` : ''} · thru ${r.thru}` })) };
  }

  if (format === 'best_ball' || format === 'scramble') {
    const teams = teamsOf(game);
    const rows = Object.entries(teams).map(([id, members]) => {
      const side = { id, members };
      const played = holes.filter(h => isNum(sideHole(game, side, h)));
      const total = sum(played.map(h => sideHole(game, side, h)));
      return { id, name: teamLabel(id, members), thru: played.length, total, toPar: total - parFor(played) };
    });
    rows.sort((a, b) => (a.thru === 0) - (b.thru === 0) || a.toPar - b.toPar);
    const extra = Object.keys(teams).length === 2 ? matchResult(game, holes) : null;
    return { headline: rows[0]?.thru ? `${rows[0].name} lead at ${fmtPar(rows[0].toPar)}` : 'Not started',
      standings: rows.map(r => ({ id: r.id, name: r.name, value: fmtPar(r.toPar), detail: `${r.total} · thru ${r.thru}` })),
      extra: extra && { label: 'Head to head', status: extra.status } };
  }

  if (format === 'skins') {
    const value = Number(settings.skinValue) || 0;
    const carry = settings.carryover !== false;
    let pot = 0; const won = {}; const log = [];
    players.forEach(p => { won[p.id] = 0; });
    for (const h of holes) {
      const nets = players.map(p => ({ id: p.id, v: netScore(game, p.id, h) }));
      if (nets.some(n => !isNum(n.v))) break;            // skins need everyone's score
      pot += 1;
      const low = Math.min(...nets.map(n => n.v));
      const winners = nets.filter(n => n.v === low);
      if (winners.length === 1) {
        won[winners[0].id] += pot;
        log.push({ hole: h + 1, winner: winners[0].id, skins: pot });
        pot = 0;
      } else {
        log.push({ hole: h + 1, winner: null, skins: 0 });
        if (!carry) pot = 0;
      }
    }
    const rows = players.map(p => ({ id: p.id, name: p.name, skins: won[p.id] })).sort((a, b) => b.skins - a.skins);
    const nameOf = (id) => players.find(p => p.id === id)?.name;
    return {
      headline: pot > 1 ? `${pot} skins carrying over` : (rows[0]?.skins ? `${rows[0].name} has ${rows[0].skins} skin${rows[0].skins > 1 ? 's' : ''}` : 'No skins won yet'),
      standings: rows.map(r => ({ id: r.id, name: r.name, value: `${r.skins} skin${r.skins === 1 ? '' : 's'}`, detail: value ? `$${(r.skins * value).toFixed(0)}` : '' })),
      holes: log.map(l => ({ hole: l.hole, text: l.winner ? `${nameOf(l.winner)} +${l.skins}` : 'Tie — carries' })),
    };
  }

  if (format === 'match') {
    const m = matchResult(game, holes);
    const sides = sidesOf(game);
    return { headline: m.status,
      standings: sides.map((s, i) => ({ id: s.id, name: s.name, value: `${m.holesWon[i] || 0} holes won`, detail: '' })) };
  }

  if (format === 'nassau') {
    const front = matchResult(game, [0,1,2,3,4,5,6,7,8]);
    const back = matchResult(game, [9,10,11,12,13,14,15,16,17]);
    const total = matchResult(game, holes);
    const stake = Number(settings.nassauStake) || 0;
    const sides = sidesOf(game);
    const points = {}; sides.forEach(s => { points[s.id] = 0; });
    [front, back, total].forEach(m => { if (m.done && m.leader) points[m.leader] += 1; });
    return {
      headline: `Front: ${front.status} · Back: ${back.status}`,
      standings: [
        { id: 'front', name: 'Front 9', value: front.status, detail: '' },
        { id: 'back', name: 'Back 9', value: back.status, detail: '' },
        { id: 'overall', name: 'Overall', value: total.status, detail: '' },
      ],
      extra: stake ? { label: 'Settled bets', status: sides.map(s => `${s.name}: ${points[s.id]} × $${stake}`).join(' · ') } : null,
    };
  }
  return { headline: 'Unknown format', standings: [] };
}

export function fmtPar(n) { return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`; }

// Who enters scores: each player, or each team for scramble.
export function scoreRows(game) {
  if (game.format === 'scramble') {
    return Object.entries(teamsOf(game)).map(([id, members]) => ({ id, name: teamLabel(id, members) }));
  }
  return game.players.map(p => ({ id: p.id, name: p.name, strokes: (h) => strokesOnHole(handicapMap(game)[p.id], game.settings?.strokeIndex?.[h]) }));
}

export function validateSetup(format, players) {
  const f = FORMATS[format];
  if (!f) return 'Pick a game format.';
  if (players.length < 2) return 'Add at least two players.';
  if (players.some(p => !p.name?.trim())) return 'Every player needs a name.';
  if (f.teams === true) {
    const teams = new Set(players.map(p => p.team).filter(Boolean));
    if (players.some(p => !p.team)) return 'Put every player on a team.';
    if (teams.size < 2) return 'Make at least two teams.';
  }
  if ((format === 'match' || format === 'nassau')) {
    const teams = new Set(players.map(p => p.team).filter(Boolean));
    const usesTeams = players.some(p => p.team);
    if (usesTeams && (teams.size !== 2 || players.some(p => !p.team))) return 'Match play needs exactly two sides.';
    if (!usesTeams && players.length !== 2) return 'Match play is two players, or two teams.';
  }
  return null;
}
