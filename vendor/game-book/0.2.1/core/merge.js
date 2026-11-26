// Saving and clashes: read the latest file, merge, write it back. A three-way merge (base = the copy this device last
// synced, mine = this device now, theirs = what's in Drive now), the same approach as Bulldogs Watch Party's team data.
// Changes are per goal, per penalty and per correction, so two people rarely touch the same thing; when they do, the
// version already in Drive is kept and the clash is reported.
import { normalizeBook } from './book.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function pick(b, m, t, label, conflicts) {
  if (same(m, b)) return t;
  if (same(t, b) || same(m, t)) return m;
  conflicts.push(label);
  return t;
}

function mergeKeyed(base, mine, theirs, key, label, conflicts) {
  const b = new Map((base || []).map((x) => [key(x), x]));
  const m = new Map((mine || []).map((x) => [key(x), x]));
  const t = new Map((theirs || []).map((x) => [key(x), x]));
  const out = [];
  const order = [...(theirs || []).map(key), ...(mine || []).map(key), ...(base || []).map(key)].filter((k, i, a) => a.indexOf(k) === i);
  for (const k of order) {
    const vb = b.get(k), vm = m.get(k), vt = t.get(k);
    let v;
    if (same(vm, vb)) v = vt;
    else if (same(vt, vb) || same(vm, vt)) v = vm;
    else { v = vt; conflicts.push(label(vm || vt || vb)); }
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** Corrections and history only grow: keep every one from either side; an undo on either side wins. */
function union(mine, theirs) {
  const map = new Map();
  for (const x of [...(theirs || []), ...(mine || [])]) {
    const had = map.get(x.id);
    map.set(x.id, had && had.undone ? had : x);
  }
  return [...map.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function mergeTracked(b, m, t, key, conflicts) {
  if (!m || !t) return pick(b, m, t, `marks for ${key}`, conflicts);
  const B = b || { goals: [], penalties: [], shots: [], goalies: [] };
  const out = {};
  for (const list of ['goals', 'penalties', 'shots', 'goalies']) out[list] = mergeKeyed(B[list], m[list], t[list], (x) => x.id, () => `a marked ${list.replace(/s$/, '')} in ${key}`, conflicts);
  out.by = t.by; out.at = String(m.at) > String(t.at) ? m.at : t.at;
  if (String(m.at) > String(t.at)) out.by = m.by;
  return out;
}

function mergeGame(key, b, m, t, conflicts) {
  if (!m) return b ? undefined : t;          // deleted here (never happens today) or only theirs
  if (!t) return b ? undefined : m;          // only mine
  const B = b || {};
  const schedule = {};
  for (const f of new Set([...Object.keys(m.schedule || {}), ...Object.keys(t.schedule || {})])) {
    schedule[f] = pick((B.schedule || {})[f], (m.schedule || {})[f], (t.schedule || {})[f], `${f} of ${key}`, conflicts);
  }
  return {
    key, schedule,
    lineup: pick(B.lineup, m.lineup, t.lineup, `lineup of ${key}`, conflicts),
    official: pick(B.official, m.official, t.official, `game sheet of ${key}`, conflicts),
    tracked: mergeTracked(B.tracked, m.tracked, t.tracked, key, conflicts),
    corrections: union(m.corrections, t.corrections),
    history: union(m.history, t.history)
  };
}

export function mergeBooks(base, mine, theirs) {
  const B = base ? normalizeBook(base) : null;
  const M = normalizeBook(mine);
  const T = normalizeBook(theirs);
  const conflicts = [];
  const team = {};
  for (const f of ['name', 'season']) team[f] = pick(B ? B.team[f] : T.team[f], M.team[f], T.team[f], f === 'name' ? 'team name' : 'season', conflicts);
  const roster = mergeKeyed(B ? B.roster : T.roster, M.roster, T.roster, (p) => p.number, (p) => 'player #' + p.number, conflicts);
  const games = {};
  const keys = new Set([...Object.keys(M.games), ...Object.keys(T.games), ...Object.keys(B ? B.games : {})]);
  for (const k of keys) {
    const g = mergeGame(k, B && B.games[k], M.games[k], T.games[k], conflicts);
    if (g) games[k] = g;
  }
  return { merged: normalizeBook({ team, roster, games, updatedAt: T.updatedAt, updatedBy: T.updatedBy }), conflicts };
}

/**
 * One sync decision. dirty = this device has changes not yet in Drive. Returns the book to keep, whether to write it
 * to Drive, and any clashes (Drive's version was kept for those).
 */
export function syncStep({ base, mine, theirs, dirty }) {
  const T = normalizeBook(theirs);
  if (!dirty) return { book: T, push: false, conflicts: [] };
  const M = normalizeBook(mine);
  if (!base) {
    const { merged, conflicts } = mergeBooks(null, M, T);
    return { book: merged, push: !same(stripStamp(merged), stripStamp(T)), conflicts };
  }
  const { merged, conflicts } = mergeBooks(base, M, T);
  return { book: merged, push: !same(stripStamp(merged), stripStamp(T)), conflicts };
}

const stripStamp = (b) => Object.assign({}, b, { updatedAt: '', updatedBy: '' });
