// Pairings for an event: group players into foursomes (or team-sized groups),
// then give each group a starting hole (shotgun) or a tee time.

const shuffle = (a, rand = Math.random) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

// Split n players into groups of at most `size`, keeping groups even (no group of 1).
export function groupSizes(n, size = 4) {
  if (n <= 0) return [];
  const groups = Math.ceil(n / size);
  const base = Math.floor(n / groups), extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

// regs: [{id, handicap, team_id}] → [[regId,...], ...]
export function autoPair(regs, { method = 'handicap', size = 4, rand = Math.random } = {}) {
  if (method === 'teams') {
    const byTeam = new Map(); const solo = [];
    regs.forEach(r => r.team_id ? (byTeam.get(r.team_id) || byTeam.set(r.team_id, []).get(r.team_id)).push(r.id) : solo.push(r.id));
    const groups = [...byTeam.values()];
    // fill partial groups with players who have no team
    for (const g of groups) while (g.length < size && solo.length) g.push(solo.shift());
    const sizes = groupSizes(solo.length, size); let k = 0;
    sizes.forEach(s => { groups.push(solo.slice(k, k + s)); k += s; });
    return groups;
  }
  const ordered = method === 'random'
    ? shuffle(regs, rand)
    : [...regs].sort((a, b) => (Number(a.handicap) || 0) - (Number(b.handicap) || 0));
  const sizes = groupSizes(ordered.length, size); let k = 0;
  return sizes.map(s => { const g = ordered.slice(k, k + s).map(r => r.id); k += s; return g; });
}

// Starting holes for a shotgun: spread groups over the 18 holes (two groups per hole, A/B, when over 18).
export function shotgunAssignments(groupCount) {
  return Array.from({ length: groupCount }, (_, i) => {
    const hole = (i % 18) + 1;
    const wave = Math.floor(i / 18);
    return { starting_hole: hole, label: `${hole}${wave ? String.fromCharCode(65 + wave) : (groupCount > 18 ? 'A' : '')}` };
  });
}

export function teeTimes(startIso, groupCount, intervalMin = 10) {
  const start = new Date(startIso).getTime();
  return Array.from({ length: groupCount }, (_, i) => new Date(start + i * intervalMin * 60000).toISOString());
}
