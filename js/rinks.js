// LiveBarn rinks: the ones the league schedules already know, the ones you pick, and the link
// that opens a game at its time. Pure functions except loadRinkDirectory (reads the league data).
import { rinkLabel } from './games.js';

const KEEP_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'fwp.rinkDirectory';

// "Clearwater (Blue)" and " clearwater  (blue)" are the same rink
export const rinkKey = (venue) => String(venue || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Accepts a LiveBarn rink number, a watch/livebarn.com video link, or a join.livebarn.com referral link.
export function parseRinkInput(text) {
  const t = String(text || '').trim();
  if (/^\d{3,6}$/.test(t)) return t;
  let target = t;
  try {
    const u = new URL(t);
    const landing = u.searchParams.get('rsLandingPage');
    if (landing) target = landing;
    if (!/(^|\.)livebarn\.com$/i.test(new URL(target).hostname)) return null;
  } catch { return null; }
  const m = /\/video\/(\d{3,6})(?:[/?#]|$)/.exec(target) || /[?&]surfaceId=(\d{3,6})/.exec(target);
  return m ? m[1] : null;
}

// LiveBarn's video windows start on the hour and half hour.
export function windowStart(time) {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${m >= 30 ? '30' : '00'}`;
}

export function watchUrl(game) {
  if (!game || !game.liveBarn) return '';
  return `https://watch.livebarn.com/en/video/${encodeURIComponent(game.liveBarn.surfaceId)}/${game.date}/${game.liveBarn.time || windowStart(game.time)}`;
}

// From league rows (any division): one entry per arena/rink with its LiveBarn number.
export function buildDirectory(rows, parseLiveBarn) {
  const seen = new Map();
  for (const r of rows) {
    const lb = parseLiveBarn(r.liveBarn);
    if (!lb || !r.venue) continue;
    const key = rinkKey(r.venue);
    const e = seen.get(key) || { key, venue: r.venue.trim(), name: rinkLabel(r.venue.trim()), counts: new Map() };
    e.counts.set(lb.surfaceId, (e.counts.get(lb.surfaceId) || 0) + 1);
    seen.set(key, e);
  }
  return [...seen.values()].map((e) => {
    const [surfaceId] = [...e.counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { key: e.key, venue: e.venue, name: e.name, surfaceId };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Words that say little about which arena it is
const STOP = new Set(['rink', 'arena', 'arenas', 'centre', 'center', 'community', 'cc', 'the', 'and', 'of', 'ice', 'pad', 'sports', 'complex', 'recreation', 'rec', 'memorial']);
const words = (s) => rinkKey(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w && !STOP.has(w));


// Best guesses first: same rink, then same arena name.
export function suggest(directory, venue) {
  const key = rinkKey(venue);
  const mine = words(venue);
  return directory
    .map((d) => {
      if (d.key === key) return { d, score: 100 };
      const theirs = words(d.venue);
      // a shared arena name is needed; a shared rink number alone ("4") isn't a match
      const named = mine.filter((w) => !/^\d+$/.test(w) && theirs.includes(w)).length;
      if (!named) return { d, score: 0 };
      const numbers = mine.filter((w) => /^\d+$/.test(w) && theirs.includes(w)).length;
      return { d, score: (named / Math.max(mine.length, 1)) * 50 + numbers * 5 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name))
    .map((x) => x.d);
}

// ---------- picks in the record ----------
export function setRink(record, gameIds, pick, now = new Date().toISOString()) {
  const rinks = { ...(record.rinks || {}) };
  for (const id of gameIds) rinks[id] = { surfaceId: String(pick.surfaceId), name: pick.name || '', pickedAt: now };
  return { ...record, updatedAt: now, rinks };
}

export function clearRink(record, gameId, now = new Date().toISOString()) {
  const rinks = { ...(record.rinks || {}) };
  delete rinks[gameId];
  return { ...record, updatedAt: now, rinks };
}

// Games with a picked rink get a LiveBarn link (the schedule's own link always wins).
export function withRinks(games, record) {
  const rinks = (record && record.rinks) || {};
  return games.map((g) => {
    const pick = rinks[g.id];
    if (g.liveBarn || !pick) return g;
    return { ...g, liveBarn: { surfaceId: pick.surfaceId, date: g.date, time: windowStart(g.time), picked: true, name: pick.name } };
  });
}

// Other games at the same arena/rink that have no LiveBarn link in their schedule.
export function sameRinkGames(games, game) {
  const key = rinkKey(game.venue);
  if (!key) return [];
  return games.filter((g) => g.id !== game.id && rinkKey(g.venue) === key && (!g.liveBarn || g.liveBarn.picked));
}

// ---------- loading the directory ----------
export async function loadRinkDirectory(base, parseLiveBarn) {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (saved && Date.now() - saved.at < KEEP_MS && Array.isArray(saved.list) && saved.list.length) return saved.list;
  } catch { /* fine */ }
  const meta = await (await fetch(`${base}data/meta.json`)).json();
  const ids = (meta.divisions || []).map((d) => d.id);
  const feeds = await Promise.all(ids.map((id) => fetch(`${base}data/games/${id}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])));
  const extra = await fetch(`${base}data/games/bghc-2066.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const rows = [...feeds, extra].flatMap((f) => (Array.isArray(f) ? f : f.games || []));
  const list = buildDirectory(rows, parseLiveBarn);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), list })); } catch { /* fine */ }
  return list;
}
