// The Game Book in Family Watch Party: each kid's team has one Game Book file in Drive, the single record of every
// game's scorers, assists and penalties (from the game sheets, with corrections on top).
//   Grace's Barracudas: our own file in the Family Hockey folder, made by this app.
//   Lucas's Bulldogs: the coaches' file in the Bulldogs team folder, made by Bulldogs Watch Party. This app can only
//   open it after it's picked once in Google's file picker (drive.file), once a season.
// A copy of each book is kept in this browser, so the pages open at the rink; changes go up when connected, merged
// with anyone else's (Game Book's three-way merge).
import * as GB from '../vendor/game-book/0.2.1/core/index.js';
import { TEAMS, GOOGLE_API_KEY, GOOGLE_APP_ID, GOOGLE_CLIENT_ID } from './config.js';
import { gfetch, gjson, isConnected, currentToken, accountEmail } from './google.js';
import { ensureFolder } from './drive.js';
import { ROOT_FOLDER } from './library.js';
import { readJson, saveJson } from './ui.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const META = 'id,name,version,trashed,modifiedTime';
const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export { GB };
export const teamFor = (teamKey) => TEAMS.find((t) => t.key === teamKey) || null;
export const hasBook = (team) => !!(team && team.gameBook);

/** "2026-27" from the team's season. */
export function seasonOf(team) { return String(team.season || ''); }
export function bookName(team) { return GB.bookFileName({ team: { name: team.gameBook.team, season: seasonOf(team) } }); }

// ---------- what this browser keeps ----------
const KEY = (teamKey) => `fwp.gamebook.${teamKey}`;
const empty = () => ({ fileId: '', name: '', version: '', base: null, book: null, dirty: false, readOnly: false, err: '', syncedAt: 0 });
export function cached(teamKey) { return Object.assign(empty(), readJson(KEY(teamKey), {})); }
function keep(teamKey, st) { saveJson(KEY(teamKey), st); emit(teamKey); }

const listeners = new Set();
export function onBookChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(teamKey) { for (const fn of listeners) { try { fn(teamKey); } catch { /* a page's problem */ } } }

/** The book to show: the copy kept here (null when there's none yet). */
export function bookOf(teamKey) { const st = cached(teamKey); return st.book ? GB.normalizeBook(st.book) : null; }

/** 'ready' | 'pick' (the Bulldogs book needs picking) | 'connect' (never synced and not connected) */
export function bookState(teamKey) {
  const st = cached(teamKey);
  if (st.book) return 'ready';
  const team = teamFor(teamKey);
  if (!isConnected()) return 'connect';
  return team.gameBook.shared && !st.fileId ? 'pick' : 'ready';
}

// ---------- the kids' jersey numbers (this browser, and the Drive record so the other devices get them) ----------
export function kidNumber(teamKey, record) {
  const fromRecord = record && record.kids && record.kids[teamKey] && record.kids[teamKey].number;
  return String(fromRecord || readJson('fwp.kidNumbers', {})[teamKey] || '');
}
export function rememberKidNumber(teamKey, number) {
  const all = readJson('fwp.kidNumbers', {});
  all[teamKey] = String(number || '').replace(/\D/g, '').slice(0, 3);
  saveJson('fwp.kidNumbers', all);
  return all[teamKey];
}
export function kidFor(team, record) {
  const number = kidNumber(team.key, record);
  return number ? { number, name: team.kid } : null;
}

// ---------- the schedule layer ----------
const TYPE = { regular: 'league', league: 'league', playoff: 'playoff', playoffs: 'playoff', tournament: 'tournament', exhibition: 'exhibition' };

/** The Game Book key of an app game (older cached TeamSnap games have none yet). */
export function keyOf(game) {
  if (game.bookKey) return game.bookKey;
  const ts = /-ts-(.+)$/.exec(game.id || '');
  return ts ? `teamsnap:${ts[1]}` : '';
}

export function scheduleFor(game) {
  return {
    date: game.date, time: game.time, opponent: game.opponent || '', rink: game.rink || game.venue || '',
    homeAway: game.isHome ? 'home' : 'away', type: TYPE[game.type] || (game.tournament ? 'tournament' : 'exhibition'),
    score: game.result ? { for: game.result.us, against: game.result.them } : null,
    links: game.gamesheet ? { gamesheet: String(game.gamesheet) } : {},
  };
}

/** Adds or refreshes these games' schedule in the book. Returns the same book when nothing changed. */
export function withSchedule(book, games) {
  let b = book;
  for (const g of games) {
    const key = keyOf(g);
    if (!key || !GB.parseGameKey(key)) continue;
    const before = b.games[key] ? JSON.stringify(b.games[key].schedule) : '';
    const next = GB.upsertGame(b, key, scheduleFor(g));
    if (JSON.stringify(next.games[key].schedule) !== before) b = next;
  }
  return b;
}

// ---------- Drive ----------
async function metaOf(id) { return gjson(`${API}/files/${encodeURIComponent(id)}?fields=${META}`); }
async function readText(id) {
  const res = await gfetch(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw new Error(`Couldn't read the Game Book in Drive (${res.status}).`);
  return res.text();
}
async function writeText(id, text) {
  return gjson(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${META}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: text });
}
async function createIn(parentId, name, text) {
  const boundary = 'fwp' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  return gjson(`${UPLOAD}/files?uploadType=multipart&fields=${META}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}
async function findIn(parentId, name) {
  const q = [`name = ${quote(name)}`, parentId ? `${quote(parentId)} in parents` : '', 'trashed = false'].filter(Boolean);
  const res = await gjson(`${API}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(${META})&spaces=drive&pageSize=5`);
  return (res.files || [])[0] || null;
}

export const who = () => readJson('fwp.googleName', '') || accountEmail() || 'Family Watch Party';
const running = new Map();

/** Bring this team's book up to date with Drive, sending this browser's changes. Returns { conflicts } or null. */
export function syncBook(teamKey, games = []) {
  if (running.has(teamKey)) return running.get(teamKey).then(() => syncBook(teamKey, games));
  const p = doSync(teamKey, games).finally(() => running.delete(teamKey));
  running.set(teamKey, p);
  return p;
}

async function doSync(teamKey, games) {
  const team = teamFor(teamKey);
  if (!hasBook(team) || !isConnected()) return null;
  const st = cached(teamKey);
  try {
    if (!st.fileId) {
      if (team.gameBook.shared) {
        // picked on another device with this Google account? Then this app can already see it.
        const seen = await findIn(null, bookName(team));
        if (!seen) return null;                        // waits for the pick
        Object.assign(st, { fileId: seen.id, name: seen.name, version: '', base: null });
      }
    }
    if (!st.fileId) {
      const rootId = await ensureFolder([ROOT_FOLDER]);
      const name = bookName(team);
      const found = await findIn(rootId, name);
      if (found) Object.assign(st, { fileId: found.id, name, version: '', base: null });
      else {
        const start = st.book ? GB.normalizeBook(st.book) : GB.newBook({ team: team.gameBook.team, season: seasonOf(team) });   // keeps changes made here before the first sync
        const fresh = withSchedule(start, games.filter((g) => g.teamKey === teamKey));
        const made = await createIn(rootId, name, GB.bookFileText(fresh, { by: who() }));
        Object.assign(st, { fileId: made.id, name, version: String(made.version), base: fresh, book: fresh, dirty: false, err: '', syncedAt: Date.now() });
        keep(teamKey, st);
        return { conflicts: [] };
      }
    }
    const meta = await metaOf(st.fileId);
    if (meta.trashed) throw new Error(`The Game Book (${meta.name}) is in the Drive trash.`);
    let theirs;
    let readOnly = st.readOnly;
    if (String(meta.version) === String(st.version) && st.base) theirs = GB.normalizeBook(st.base);
    else {
      const parsed = GB.parseBookFile(await readText(st.fileId));
      theirs = parsed.book;
      readOnly = parsed.readOnly;
    }
    let mine = st.book ? GB.normalizeBook(st.book) : theirs;
    let dirty = st.dirty;
    const scheduled = withSchedule(mine, games.filter((g) => g.teamKey === teamKey));
    if (scheduled !== mine && !readOnly) { mine = scheduled; dirty = true; }
    if (readOnly) {
      Object.assign(st, { book: theirs, base: theirs, version: String(meta.version), dirty: false, readOnly: true, err: '', syncedAt: Date.now(), name: meta.name });
      keep(teamKey, st);
      return { conflicts: [], readOnly: true };
    }
    const step = GB.syncStep({ base: st.base, mine, theirs, dirty });
    let version = String(meta.version);
    if (step.push) version = String((await writeText(st.fileId, GB.bookFileText(step.book, { by: who() }))).version);
    Object.assign(st, { book: step.book, base: step.book, version, dirty: false, readOnly: false, err: '', syncedAt: Date.now(), name: meta.name });
    keep(teamKey, st);
    return { conflicts: step.conflicts };
  } catch (e) {
    st.err = e.message || String(e);
    keep(teamKey, st);
    throw e;
  }
}

/** A change made on a page: kept here at once, sent to Drive when connected. */
export async function changeBook(teamKey, book) {
  const st = cached(teamKey);
  if (st.readOnly) throw new Error('This Game Book was saved by a newer version of the Game Book. Update Family Watch Party (Settings › Check for updates) to change it.');
  Object.assign(st, { book, dirty: true });
  keep(teamKey, st);
  if (isConnected()) return syncBook(teamKey);
  return null;
}

/** Start from the schedule when there's no book here yet (a family-only team before its first sync). */
export function ensureLocalBook(teamKey, games) {
  const team = teamFor(teamKey);
  const st = cached(teamKey);
  if (st.book || team.gameBook.shared) return st.book ? GB.normalizeBook(st.book) : null;
  st.book = withSchedule(GB.newBook({ team: team.gameBook.team, season: seasonOf(team) }), games.filter((g) => g.teamKey === teamKey));
  st.dirty = true;
  keep(teamKey, st);
  return st.book;
}

// ---------- picking the Bulldogs Game Book ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Couldn’t load Google’s file picker. Check the connection.'));
    document.head.append(s);
  });
}

export const pickerReady = () => !!GOOGLE_API_KEY;

/** Opens Google's file picker on Game Book files; returns the picked file's { id, name } or null. */
export async function pickBook(teamKey) {
  const team = teamFor(teamKey);
  if (!GOOGLE_API_KEY) throw new Error('The file picker isn’t set up yet (the picker key is missing in Family Watch Party’s settings file).');
  const token = currentToken();
  if (!token) throw new Error('Connect Google first.');
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((res, rej) => window.gapi.load('picker', { callback: res, onerror: () => rej(new Error('Couldn’t open Google’s file picker.')) }));
  const P = window.google.picker;
  const name = bookName(team);
  const docs = await new Promise((resolve, reject) => {
    const view = new P.DocsView(P.ViewId.DOCS).setMimeTypes('application/json').setQuery('Game Book').setIncludeFolders(true);
    new P.PickerBuilder()
      .setTitle(`Pick “${name}” (in the Bulldogs team folder)`)
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_APP_ID || GOOGLE_CLIENT_ID.split('-')[0])
      .setCallback((d) => {
        if (d.action === P.Action.PICKED) resolve(d.docs || []);
        else if (d.action === P.Action.CANCEL) resolve(null);
        else if (d.action === 'error' || (P.Action.ERROR && d.action === P.Action.ERROR)) reject(new Error(String(d.message || 'Google’s file picker reported an error')));
      })
      .build()
      .setVisible(true);
  });
  if (!docs || !docs.length) return null;
  const doc = docs[0];
  const parsed = GB.parseBookFile(await readText(doc.id));     // checks it really is a Game Book
  if (parsed.book.team.name && parsed.book.team.name !== team.gameBook.team) throw new Error(`That’s the Game Book for ${parsed.book.team.name}. Pick “${name}”.`);
  if (parsed.book.team.season && parsed.book.team.season !== seasonOf(team)) throw new Error(`That’s the ${parsed.book.team.season} Game Book. Pick “${name}”.`);
  const st = cached(teamKey);
  Object.assign(st, { fileId: doc.id, name: doc.name || name, version: '', base: null, err: '' });
  if (!st.book) st.dirty = false;
  keep(teamKey, st);
  return { id: doc.id, name: doc.name || name };
}

/** Forget the picked file (e.g. a new season, or the wrong file). */
export function forgetBook(teamKey) { keep(teamKey, empty()); }

// ---------- pdf.js for importing a sheet (loaded the first time) ----------
let pdfReady = null;
export function readPdf(file) {
  if (!pdfReady) {
    pdfReady = loadScript('vendor/pdf.worker.min.js').then(() => loadScript('vendor/pdf.min.js')).then(() => window.pdfjsLib)
      .catch((e) => { pdfReady = null; throw e; });
  }
  return pdfReady.then(async (lib) => (await import('../vendor/game-book/0.2.1/ui/pdf.js')).pdfItems(file, lib));
}
