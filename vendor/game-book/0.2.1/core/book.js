// The Game Book: one file per team per season holding every game's data in four layers, kept side by side:
//   schedule    what the league, club site or TeamSnap says (date, opponent, rink, final score)
//   official    the GameSheet facts exactly as imported (never edited)
//   tracked     what coaches marked while watching (goals, penalties, shots, goalies); no video times
//   corrections changes people made on top, each with who, when and why; can be undone
// What every screen shows is worked out from those layers by effectiveGame(): the game sheet wins, and corrections
// go on top. Every function here returns a new book and leaves the one passed in unchanged.
import { clockElapsed } from './sheet.js';

export const SCHEMA = 1;
export const APP = 'game-book';
export const GAME_TYPES = ['league', 'tournament', 'playoff', 'exhibition'];

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const now = () => new Date().toISOString();
const str = (v, max = 80) => String(v == null ? '' : v).trim().slice(0, max);
const jersey = (v) => (/^\d{1,2}$/.test(String(v == null ? '' : v).trim()) ? String(Number(String(v).trim())) : '');
const jerseys = (list, max = 2) => [...new Set((list || []).map(jersey).filter(Boolean))].slice(0, max);

export function newId(prefix = 'id') {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + '_' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
}

// ---------- game keys: every app finds a game by where it came from ----------
export function gameKey(source, id, club) {
  const s = String(source || '');
  const v = String(id == null ? '' : id).trim();
  if (!v) throw new Error('A game key needs an id');
  if (s === 'alliance' || s === 'teamsnap' || s === 'own') return `${s}:${v}`;
  if (s === 'club') { if (!club) throw new Error('A club game key needs the club'); return `club:${club}:${v}`; }
  throw new Error('Unknown game source: ' + s);
}
export function parseGameKey(key) {
  const m = /^(alliance|teamsnap|own):(.+)$/.exec(key || '') || /^(club):([^:]+):(.+)$/.exec(key || '');
  if (!m) return null;
  return m[1] === 'club' ? { source: 'club', club: m[2], id: m[3] } : { source: m[1], id: m[2] };
}

// ---------- the book ----------
export function newBook({ team, season, roster } = {}) {
  return normalizeBook({ team: { name: team, season }, roster: roster || [], games: {} });
}

export function normalizePlayer(p) {
  return { number: jersey(p && p.number), name: str(p && p.name, 40), pos: /^(F|D|G|C|LW|RW)$/.test((p && p.pos) || '') ? p.pos : '' };
}

export function normalizeBook(b) {
  const x = b || {};
  const roster = (x.roster || []).map(normalizePlayer).filter((p) => p.number);
  const games = {};
  for (const [k, g] of Object.entries(x.games || {})) games[k] = normalizeGame(k, g);
  return {
    app: APP, schema: SCHEMA,
    team: { name: str(x.team && x.team.name), season: str(x.team && x.team.season, 20) },
    roster: roster.filter((p, i) => roster.findIndex((q) => q.number === p.number) === i).sort((a, b) => Number(a.number) - Number(b.number)),
    games,
    updatedAt: x.updatedAt || '', updatedBy: x.updatedBy || ''
  };
}

function normalizeGame(key, g) {
  const x = g || {};
  const s = x.schedule || {};
  return {
    key,
    schedule: {
      date: str(s.date, 10), time: str(s.time, 5), opponent: str(s.opponent), rink: str(s.rink),
      homeAway: s.homeAway === 'home' || s.homeAway === 'away' ? s.homeAway : '',
      type: GAME_TYPES.includes(s.type) ? s.type : 'league',
      score: s.score && Number.isFinite(Number(s.score.for)) && Number.isFinite(Number(s.score.against)) ? { for: Number(s.score.for), against: Number(s.score.against) } : null,
      links: s.links && typeof s.links === 'object' ? clone(s.links) : {}
    },
    lineup: Array.isArray(x.lineup) ? [...new Set(x.lineup.map(jersey).filter(Boolean))] : null,
    official: x.official ? clone(x.official) : null,
    tracked: x.tracked ? normalizeTracked(x.tracked) : null,
    corrections: (x.corrections || []).map(clone),
    history: (x.history || []).map(clone)
  };
}

function normalizeTracked(t) {
  const per = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const clock = (v) => (/^\d{1,2}:\d{2}$/.test(v || '') ? v : null);
  const id = (v, p) => (v ? String(v) : newId(p));
  return {
    goals: (t.goals || []).map((g) => ({ id: id(g.id, 'tg'), side: g.side === 'against' ? 'against' : 'for', per: per(g.per), clock: clock(g.clock), scorer: jersey(g.scorer), assists: jerseys(g.assists), onIce: jerseys(g.onIce, 6) })),
    penalties: (t.penalties || []).map((p) => ({ id: id(p.id, 'tp'), team: p.team === 'them' ? 'them' : 'us', per: per(p.per), clock: clock(p.clock), player: jersey(p.player), minutes: Number(p.minutes) || 2, type: str(p.type, 30) || 'other' })),
    shots: (t.shots || []).map((s) => ({ id: id(s.id, 'ts'), side: s.side === 'against' ? 'against' : 'for', per: per(s.per), shooter: jersey(s.shooter), result: ['on', 'missed', 'blocked'].includes(s.result) ? s.result : 'on' })),
    goalies: (t.goalies || []).map((g) => ({ id: id(g.id, 'tk'), per: per(g.per), clock: clock(g.clock), number: jersey(g.number) })).filter((g) => g.number),
    by: str(t.by), at: t.at || ''
  };
}

const emptyGame = (key) => normalizeGame(key, {});
function withGame(book, key, fn) {
  const b = normalizeBook(clone(book));
  const g = b.games[key] ? b.games[key] : emptyGame(key);
  b.games[key] = normalizeGame(key, fn(g) || g);
  return b;
}
function log(g, by, at, what) {
  g.history.push({ id: newId('h'), at, by: str(by, 120), what: str(what, 240) });
}

export function setRoster(book, roster) {
  const b = normalizeBook(clone(book));
  b.roster = normalizeBook({ roster }).roster;
  return b;
}

/** Add a game, or refresh its schedule layer (league scores change; nothing else is touched). */
export function upsertGame(book, key, schedule) {
  if (!parseGameKey(key)) throw new Error('Not a game key: ' + key);
  return withGame(book, key, (g) => { g.schedule = Object.assign({}, g.schedule, clone(schedule) || {}); });
}

export function setLineup(book, key, numbers, { by, at = now() } = {}) {
  return withGame(book, key, (g) => { g.lineup = numbers ? jerseys(numbers, 40) : null; log(g, by, at, numbers ? `Set the lineup (${g.lineup.length} players)` : 'Cleared the lineup'); });
}

// ---------- official: the game sheet ----------
/** Stable ids for the sheet's goals and penalties, so a correction still finds its goal after the sheet is imported again. */
function officialIds(facts) {
  const seen = {};
  const tag = (s) => { seen[s] = (seen[s] || 0) + 1; return seen[s] > 1 ? `${s}-${seen[s]}` : s; };
  return {
    goals: (facts.goals || []).map((g) => Object.assign({ id: tag(`og-${g.per}-${g.time}-${g.side}`) }, g)),
    penalties: (facts.penalties || []).map((p) => Object.assign({ id: tag(`op-${p.per}-${p.time || ''}-${p.team}-${p.player || 'bench'}`) }, p))
  };
}

/** Import (or replace) the game sheet. facts: from sheetFacts(). Corrections stay on top. */
export function importSheet(book, key, facts, { by, at = now(), file = '' } = {}) {
  if (!facts || !Array.isArray(facts.goals)) throw new Error('That isn’t a read game sheet');
  return withGame(book, key, (g) => {
    const ids = officialIds(facts);
    const replaced = !!g.official;
    g.official = { number: str(facts.number, 20), date: str(facts.date, 10), location: str(facts.location), periods: clone(facts.periods) || {},
      side: facts.side, us: str(facts.us), them: str(facts.them), score: clone(facts.score), goals: ids.goals, penalties: ids.penalties,
      importedBy: str(by, 120), importedAt: at, file: str(file, 120) };
    log(g, by, at, `${replaced ? 'Replaced' : 'Imported'} game sheet ${g.official.number || ''} (${ids.goals.length} goals, ${ids.penalties.length} penalties)`.replace('  ', ' '));
  });
}

export function removeSheet(book, key, { by, at = now() } = {}) {
  return withGame(book, key, (g) => { if (g.official) { log(g, by, at, `Removed game sheet ${g.official.number || ''}`.trim()); g.official = null; } });
}

// ---------- tracked: what the coaches marked while watching ----------
/** Replace the tracked layer for a game (the video app owns it and sends it whole). */
export function setTracked(book, key, tracked, { by, at = now() } = {}) {
  return withGame(book, key, (g) => { g.tracked = tracked ? normalizeTracked(Object.assign({}, tracked, { by, at })) : null; });
}

// ---------- corrections ----------
export const CORRECTION_KINDS = ['edit-goal', 'add-goal', 'remove-goal', 'confirm-goal', 'edit-penalty', 'add-penalty', 'remove-penalty'];

/**
 * Add a correction. c: { kind, target (an event id; not for add-*), set ({ scorer, assists, side, per, clock } for goals;
 * { player, minutes, type, team, per, clock } for penalties), note }. Returns { book, id }.
 */
export function addCorrection(book, key, c, { by, at = now(), id = newId('c') } = {}) {
  if (!c || !CORRECTION_KINDS.includes(c.kind)) throw new Error('Unknown correction');
  if (!/^add-/.test(c.kind) && !c.target) throw new Error('Which goal or penalty?');
  const set = {};
  const s = c.set || {};
  if ('scorer' in s) set.scorer = jersey(s.scorer);
  if ('assists' in s) set.assists = jerseys(s.assists);
  if ('side' in s) set.side = s.side === 'against' ? 'against' : 'for';
  if ('team' in s) set.team = s.team === 'them' ? 'them' : 'us';
  if ('per' in s) set.per = Number(s.per) || 1;
  if ('clock' in s) set.clock = /^\d{1,2}:\d{2}$/.test(s.clock || '') ? s.clock : null;
  if ('player' in s) set.player = jersey(s.player);
  if ('minutes' in s) set.minutes = Number(s.minutes) || 2;
  if ('type' in s) set.type = str(s.type, 30);
  const out = withGame(book, key, (g) => {
    g.corrections.push({ id, kind: c.kind, target: c.target || null, set, note: str(c.note, 200), by: str(by, 120), at, undone: null });
    log(g, by, at, describeCorrection(c.kind, set, c.note));
  });
  return { book: out, id };
}

function describeCorrection(kind, set, note) {
  const who = set.scorer ? `#${set.scorer}` : '';
  const as = set.assists ? (set.assists.length ? 'assists ' + set.assists.map((a) => '#' + a).join(', ') : 'no assists') : '';
  const what = {
    'edit-goal': ['Corrected a goal', [who && 'scorer ' + who, as].filter(Boolean).join(', ')],
    'add-goal': ['Added a goal the sheet missed', who], 'remove-goal': ['Removed a goal', ''], 'confirm-goal': ['Confirmed a marked goal', ''],
    'edit-penalty': ['Corrected a penalty', set.player ? '#' + set.player : ''], 'add-penalty': ['Added a penalty', set.player ? '#' + set.player : ''], 'remove-penalty': ['Removed a penalty', '']
  }[kind];
  return what[0] + (what[1] ? ': ' + what[1] : '') + (note ? ` ("${note}")` : '');
}

export function undoCorrection(book, key, correctionId, { by, at = now() } = {}) {
  return withGame(book, key, (g) => {
    const c = g.corrections.find((x) => x.id === correctionId);
    if (!c || c.undone) return;
    c.undone = { by: str(by, 120), at };
    log(g, by, at, 'Undid: ' + describeCorrection(c.kind, c.set || {}, c.note));
  });
}

// ---------- what everyone sees ----------
const periodLength = (official, per) => (official && official.periods && Number(official.periods[per])) || 15;
const sortKey = (official) => (e) => [e.per || 99, e.clock ? clockElapsed(e.clock, periodLength(official, e.per)) : null];
function byGameOrder(official) {
  const k = sortKey(official);
  return (a, b) => {
    const [pa, ca] = k(a), [pb, cb] = k(b);
    if (pa !== pb) return pa - pb;
    if (ca == null || cb == null) return 0;
    return ca - cb;
  };
}

/** Pair tracked goals with sheet goals: same side, same period, in order. */
export function pairGoals(sheetGoals, trackedGoals) {
  const pairs = [], sheetOnly = [], trackedOnly = [];
  for (const side of ['for', 'against']) {
    const S = sheetGoals.filter((g) => g.side === side);
    const T = trackedGoals.filter((g) => g.side === side);
    const byPeriod = T.length > 0 && T.every((g) => g.per != null);
    const groups = byPeriod ? [...new Set(T.map((g) => g.per).concat(S.map((g) => g.per)))].map((n) => [T.filter((g) => g.per === n), S.filter((g) => g.per === n)]) : [[T, S]];
    for (const [t, s] of groups) {
      const k = Math.min(t.length, s.length);
      for (let i = 0; i < k; i++) pairs.push({ tracked: t[i], sheet: s[i] });
      trackedOnly.push(...t.slice(k));
      sheetOnly.push(...s.slice(k));
    }
  }
  return { pairs, sheetOnly, trackedOnly };
}

const sameList = (a, b) => [...(a || [])].sort().join() === [...(b || [])].sort().join();

/**
 * The game as every screen shows it. Returns { key, schedule, status: 'official'|'tracked'|'score'|'none', score, periods,
 * goals: [{ id, side, per, clock, scorer, assists, source: 'official'|'tracked'|'corrected'|'added', counted, trackedId,
 *   mark (the coach's mark when it differs from the sheet), onIce, corrections }], penalties, shots, goalies, lineup, corrections, history }.
 * The rule: the game sheet wins; corrections go on top; a marked goal that isn't on the sheet isn't counted until confirmed.
 */
export function effectiveGame(book, key) {
  const g = (book.games || {})[key] ? normalizeGame(key, book.games[key]) : emptyGame(key);
  const off = g.official;
  const tr = g.tracked || { goals: [], penalties: [], shots: [], goalies: [] };
  let goals;
  let penalties;
  if (off) {
    const { pairs, trackedOnly } = pairGoals(off.goals, tr.goals);
    const pairOf = new Map(pairs.map((p) => [p.sheet.id, p.tracked]));
    goals = off.goals.map((s) => {
      const t = pairOf.get(s.id);
      const e = { id: s.id, side: s.side, per: s.per, clock: s.time, scorer: s.scorer, assists: s.assists.slice(), source: 'official', counted: true, trackedId: t ? t.id : null, mark: null, onIce: t ? t.onIce : [], corrections: [] };
      if (t && (t.scorer || t.assists.length) && (t.scorer !== s.scorer || !sameList(t.assists, s.assists))) e.mark = { scorer: t.scorer, assists: t.assists };
      return e;
    }).concat(trackedOnly.map((t) => ({ id: t.id, side: t.side, per: t.per, clock: t.clock, scorer: t.scorer, assists: t.assists.slice(), source: 'tracked', counted: false, trackedId: t.id, mark: null, onIce: t.onIce, corrections: [], notOnSheet: true })));
    penalties = off.penalties.map((p) => ({ id: p.id, team: p.team, per: p.per, clock: p.time || null, player: p.player, minutes: p.minutes, type: p.type, code: p.code || '', source: 'official', counted: true, corrections: [] }));
  } else {
    goals = tr.goals.map((t) => ({ id: t.id, side: t.side, per: t.per, clock: t.clock, scorer: t.scorer, assists: t.assists.slice(), source: 'tracked', counted: true, trackedId: t.id, mark: null, onIce: t.onIce, corrections: [] }));
    penalties = tr.penalties.map((p) => ({ id: p.id, team: p.team, per: p.per, clock: p.clock, player: p.player, minutes: p.minutes, type: p.type, code: '', source: 'tracked', counted: true, corrections: [] }));
  }
  const active = g.corrections.filter((c) => !c.undone);
  for (const c of active) {
    const meta = { id: c.id, by: c.by, at: c.at, note: c.note };
    const isGoal = /goal$/.test(c.kind);
    const list = isGoal ? goals : penalties;
    if (c.kind === 'add-goal') { goals.push(Object.assign({ id: 'cg-' + c.id, side: 'for', per: 1, clock: null, scorer: '', assists: [] }, c.set, { source: 'added', counted: true, trackedId: null, mark: null, onIce: [], corrections: [meta] })); continue; }
    if (c.kind === 'add-penalty') { penalties.push(Object.assign({ id: 'cp-' + c.id, team: 'us', per: 1, clock: null, player: '', minutes: 2, type: 'other', code: '' }, c.set, { source: 'added', counted: true, corrections: [meta] })); continue; }
    const e = list.find((x) => x.id === c.target || (isGoal && x.trackedId && x.trackedId === c.target));
    if (!e) continue;   // its goal or penalty is gone (a replaced sheet): the correction waits, shown in History
    e.corrections.push(meta);
    if (c.kind === 'remove-goal' || c.kind === 'remove-penalty') { e.removed = true; e.counted = false; continue; }
    if (c.kind === 'confirm-goal') { e.counted = true; e.notOnSheet = false; e.source = 'corrected'; continue; }
    Object.assign(e, c.set);
    e.source = e.source === 'added' ? 'added' : 'corrected';
    if (e.mark && e.scorer === e.mark.scorer && sameList(e.assists, e.mark.assists)) e.mark = null;
  }
  goals = goals.filter((x) => !x.removed).sort(byGameOrder(off));
  penalties = penalties.filter((x) => !x.removed).sort(byGameOrder(off));
  // running score
  let f = 0, a = 0;
  for (const e of goals) { if (e.counted) { if (e.side === 'for') f++; else a++; } e.scoreAfter = { for: f, against: a }; }
  const tracked = !!(g.tracked && (tr.goals.length || tr.shots.length || tr.penalties.length));
  const status = off ? 'official' : tracked ? 'tracked' : g.schedule.score ? 'score' : 'none';
  const score = status === 'official' || status === 'tracked' ? { for: f, against: a } : g.schedule.score;
  const periods = off && off.periods ? Object.keys(off.periods).map(Number).sort((x, y) => x - y) : [...new Set(goals.map((e) => e.per).filter(Boolean))].sort((x, y) => x - y);
  return {
    key, schedule: g.schedule, status, score, periods: periods.length ? periods : [1, 2, 3], periodLengths: off ? off.periods : null,
    official: off ? { number: off.number, importedBy: off.importedBy, importedAt: off.importedAt } : null,
    goals, penalties, shots: tr.shots, goalies: tr.goalies, shotsTracked: tr.shots.length > 0,
    lineup: g.lineup, corrections: g.corrections, history: g.history.slice().reverse().sort((x, y) => String(y.at).localeCompare(String(x.at))),   // newest first; same time: the later one first
    differs: goals.filter((e) => e.mark).length, notOnSheet: goals.filter((e) => e.notOnSheet).length
  };
}

export function result(score) {
  if (!score) return null;
  return score.for > score.against ? 'W' : score.for < score.against ? 'L' : 'T';
}

// ---------- strength: power play / short-handed goals from penalty times ----------
const MAN_ADVANTAGE_MINUTES = [2, 4, 5];
function gameSecond(e, eff) {
  if (!e.per || !e.clock) return null;
  const len = (n) => (eff.periodLengths && Number(eff.periodLengths[n])) || 15;
  let s = 0;
  for (let n = 1; n < e.per; n++) s += len(n) * 60;
  return s + clockElapsed(e.clock, len(e.per));
}

/** Strength for each counted goal: 'pp', 'sh' or 'even' ('' when times are missing). Minors end early on a goal against. */
export function goalStrengths(eff) {
  const pens = eff.penalties.filter((p) => p.counted !== false && MAN_ADVANTAGE_MINUTES.includes(p.minutes) && gameSecond(p, eff) != null)
    .map((p) => ({ team: p.team, start: gameSecond(p, eff), end: gameSecond(p, eff) + p.minutes * 60, minor: p.minutes !== 5 }));
  const out = new Map();
  for (const gl of eff.goals.filter((x) => x.counted)) {
    const t = gameSecond(gl, eff);
    if (t == null) { out.set(gl.id, ''); continue; }
    const inBox = (team) => pens.filter((p) => p.team === team && p.start <= t && t < p.end);
    const us = inBox('us'), them = inBox('them');
    const s = us.length === them.length ? 'even' : (gl.side === 'for') === (them.length > us.length) ? 'pp' : 'sh';
    out.set(gl.id, s);
    // the team that scored on the power play frees one minor of the other side
    if (s === 'pp') {
      const freed = (gl.side === 'for' ? them : us).filter((p) => p.minor).sort((a, b) => a.start - b.start)[0];
      if (freed) freed.end = t;
    }
  }
  return out;
}

// ---------- one game's summary ----------
/**
 * Points and the rest for one game. Returns { players: Map number -> { g, a, pim, ppg, shg, sog }, shots: { for, against } | null,
 * pim: { us, them }, byPeriod: { for: {n: goals}, against: {...} }, goalies: [{ number, ga, sa, decision }] }.
 */
export function gameSummary(eff, roster = []) {
  const players = new Map();
  const P = (n) => { if (!players.has(n)) players.set(n, { g: 0, a: 0, pim: 0, ppg: 0, shg: 0, sog: 0 }); return players.get(n); };
  const strength = goalStrengths(eff);
  const byPeriod = { for: {}, against: {} };
  for (const gl of eff.goals.filter((x) => x.counted)) {
    byPeriod[gl.side][gl.per || 0] = (byPeriod[gl.side][gl.per || 0] || 0) + 1;
    if (gl.side !== 'for') continue;
    if (gl.scorer) { const p = P(gl.scorer); p.g++; if (strength.get(gl.id) === 'pp') p.ppg++; if (strength.get(gl.id) === 'sh') p.shg++; if (eff.shotsTracked) p.sog++; }
    for (const a of gl.assists) P(a).a++;
  }
  const pim = { us: 0, them: 0 };
  for (const p of eff.penalties.filter((x) => x.counted !== false)) { pim[p.team] += p.minutes; if (p.team === 'us' && p.player) P(p.player).pim += p.minutes; }
  let shots = null;
  if (eff.shotsTracked) {
    const gf = eff.goals.filter((x) => x.counted && x.side === 'for').length, ga = eff.goals.filter((x) => x.counted && x.side === 'against').length;
    shots = { for: eff.shots.filter((s) => s.side === 'for' && s.result === 'on').length + gf, against: eff.shots.filter((s) => s.side === 'against' && s.result === 'on').length + ga };
    for (const s of eff.shots.filter((x) => x.side === 'for' && x.result === 'on' && x.shooter)) P(s.shooter).sog++;
  }
  // goalies: the tracked changes, else the roster's goalie; the decision goes to whoever finished the game
  const starter = (roster.find((p) => p.pos === 'G') || {}).number || '';
  const order = eff.goalies.length ? eff.goalies : starter ? [{ number: starter, per: 1, clock: null }] : [];
  const goalies = order.map((k) => ({ number: k.number, ga: 0, sa: shots ? 0 : null, decision: '' }));
  if (goalies.length) {
    const at = (e) => { const t = gameSecond(e, eff); if (t == null) return goalies.length - 1; let i = 0; order.forEach((k, j) => { const s = gameSecond(k, eff); if (s == null || s <= t) i = j; }); return i; };
    for (const gl of eff.goals.filter((x) => x.counted && x.side === 'against')) { goalies[at(gl)].ga++; if (shots) goalies[at(gl)].sa++; }
    if (shots) for (const s of eff.shots.filter((x) => x.side === 'against' && x.result === 'on')) goalies[goalies.length - 1].sa++;
    goalies[goalies.length - 1].decision = result(eff.score) || '';
  }
  return { players, shots, pim, byPeriod, goalies, strength };
}

// ---------- the season ----------
/**
 * Season stats. type: 'league' | 'tournament' | 'playoff' | 'exhibition' | 'all'. Returns { record: { w, l, t }, gf, ga, pim,
 * shots: { for, against, games } , sources: { official, tracked, scoreOnly }, players: [{ number, name, gp, g, a, pts, pim, ppg, shg, sog }],
 * goalies: [{ number, name, gp, w, l, t, ga, sa, gaa, svPct }] }. Players sorted by points, then goals.
 */
export function seasonStats(book, type = 'all') {
  const roster = book.roster || [];
  const name = (n) => (roster.find((p) => p.number === n) || {}).name || '';
  const rec = { w: 0, l: 0, t: 0 };
  let gf = 0, ga = 0, pimUs = 0;
  const shots = { for: 0, against: 0, games: 0 };
  const sources = { official: 0, tracked: 0, scoreOnly: 0 };
  const players = new Map();
  const goalies = new Map();
  const P = (n) => { if (!players.has(n)) players.set(n, { number: n, name: name(n), gp: 0, g: 0, a: 0, pts: 0, pim: 0, ppg: 0, shg: 0, sog: 0 }); return players.get(n); };
  for (const key of Object.keys(book.games || {})) {
    const eff = effectiveGame(book, key);
    if (type !== 'all' && eff.schedule.type !== type) continue;
    if (!eff.score) continue;
    const r = result(eff.score);
    rec[r.toLowerCase()]++;
    gf += eff.score.for; ga += eff.score.against;
    if (eff.status === 'score') { sources.scoreOnly++; continue; }
    sources[eff.status]++;
    const s = gameSummary(eff, roster);
    pimUs += s.pim.us;
    if (s.shots) { shots.for += s.shots.for; shots.against += s.shots.against; shots.games++; }
    const dressed = eff.lineup || roster.filter((p) => p.pos !== 'G').map((p) => p.number);
    for (const n of dressed) if ((roster.find((p) => p.number === n) || {}).pos !== 'G') P(n).gp++;
    for (const [n, v] of s.players) { const p = P(n); p.g += v.g; p.a += v.a; p.pim += v.pim; p.ppg += v.ppg; p.shg += v.shg; p.sog += v.sog; }
    for (const k of s.goalies) {
      if (!goalies.has(k.number)) goalies.set(k.number, { number: k.number, name: name(k.number), gp: 0, w: 0, l: 0, t: 0, ga: 0, sa: 0, saGames: 0 });
      const G = goalies.get(k.number);
      G.gp++; G.ga += k.ga;
      if (k.sa != null) { G.sa += k.sa; G.saGames++; }
      if (k.decision) G[k.decision.toLowerCase()]++;
    }
  }
  const list = [...players.values()].map((p) => Object.assign(p, { pts: p.g + p.a }))
    .sort((a, b) => b.pts - a.pts || b.g - a.g || Number(a.number) - Number(b.number));
  const gl = [...goalies.values()].map((G) => ({ number: G.number, name: G.name, gp: G.gp, w: G.w, l: G.l, t: G.t, ga: G.ga, sa: G.saGames ? G.sa : null,
    gaa: G.gp ? Math.round((G.ga / G.gp) * 100) / 100 : 0, svPct: G.saGames && G.sa ? Math.round(((G.sa - G.ga) / G.sa) * 1000) / 1000 : null }));
  return { record: rec, gf, ga, pim: pimUs, shots: shots.games ? shots : null, sources, players: list, goalies: gl };
}

/** One player's line game by game (the family view). */
export function playerGames(book, number, type = 'all') {
  const n = jersey(number);
  const out = [];
  for (const key of Object.keys(book.games || {})) {
    const eff = effectiveGame(book, key);
    if (type !== 'all' && eff.schedule.type !== type) continue;
    if (eff.status !== 'official' && eff.status !== 'tracked') continue;
    const s = gameSummary(eff, book.roster || []);
    const v = s.players.get(n) || { g: 0, a: 0, pim: 0 };
    out.push({ key, date: eff.schedule.date, opponent: eff.schedule.opponent, homeAway: eff.schedule.homeAway, score: eff.score, result: result(eff.score), status: eff.status,
      g: v.g, a: v.a, pts: v.g + v.a, pim: v.pim, goalIds: eff.goals.filter((x) => x.counted && x.side === 'for' && x.scorer === n).map((x) => x.id) });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * What importing this sheet would do, before saving (the import screen's step 3). Returns { matches, differs: [{ sheet, tracked }],
 * sheetOnly: { goals, penalties }, trackedOnly: [tracked goal], replacing: bool }.
 */
export function compareSheet(book, key, facts) {
  const g = (book.games || {})[key] ? normalizeGame(key, book.games[key]) : emptyGame(key);
  const sheetGoals = officialIds(facts).goals;
  const tr = g.tracked || { goals: [], penalties: [] };
  const { pairs, sheetOnly, trackedOnly } = pairGoals(sheetGoals, tr.goals);
  const differs = pairs.filter((p) => (p.tracked.scorer || p.tracked.assists.length) && (p.tracked.scorer !== p.sheet.scorer || !sameList(p.tracked.assists, p.sheet.assists)));
  return {
    matches: pairs.length - differs.length, differs, trackedOnly,
    sheetOnly: { goals: sheetOnly.length, penalties: Math.max(0, (facts.penalties || []).length - tr.penalties.length) },
    replacing: !!g.official
  };
}

/** Undo every active correction on one goal: back to the game sheet's (or the marks') version. */
export function revertGoal(book, key, goalId, opts = {}) {
  const g = (book.games || {})[key];
  if (!g) return book;
  let b = book;
  const eff = effectiveGame(book, key);
  const e = eff.goals.find((x) => x.id === goalId);
  for (const c of (e ? e.corrections : [])) if (!/^add-/.test((g.corrections.find((x) => x.id === c.id) || {}).kind || '')) b = undoCorrection(b, key, c.id, opts);
  return b;
}
