// Drive folder layout and the app's record of what's saved where.
export const ROOT_FOLDER = 'Family Hockey';
export const RECORD_NAME = 'family-watch-party-record.json';
export const CHUNK = 16 * 1024 * 1024; // upload in 16 MB pieces (a multiple of 256 KB, as Drive requires)

export function parseHHMMSafe(text) {
  const m = /^(\d{1,2}):(\d{2})/.exec(text || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function safeName(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim()
    .slice(0, 120) || 'Untitled';
}

export function shortTournament(name) {
  return String(name || '').replace(/^\d{4}\s+/, '').replace(/\s+tournament$/i, '').trim();
}

export function gameFolderName(game) {
  const t = shortTournament(game.tournament);
  return safeName(`${game.date} ${t ? `${t} – ` : ''}${game.opponentLabel}`);
}

// ['Family Hockey', 'Lucas', '2026-27 U10BB Bulldogs Blue', '2026-11-07 vs Woodstock Jr Navy Vets', 'full game']
export function folderPath(game, team, kind) {
  return [ROOT_FOLDER, safeName(game.kid), safeName(`${team.season} ${team.label}`), gameFolderName(game), kind === 'clip' ? 'clips' : 'full game'];
}

function hhmm(minutes) {
  if (!Number.isFinite(minutes)) return '';
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;
}

// "2026-11-07 vs Woodstock Jr Navy Vets part 1 (1314) PANO.mp4"
export function fullGameFileName(game, part, startMinutes, view, ext = 'mp4') {
  const time = hhmm(startMinutes);
  return safeName(`${game.date} ${game.opponentLabel} part ${part}${time ? ` (${time})` : ''}${view ? ` ${view}` : ''}.${ext}`);
}

export function extensionOf(name) {
  const m = /\.([a-z0-9]{2,4})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : 'mp4';
}

// ---------- the record ----------
export function emptyRecord() {
  return { version: 1, updatedAt: null, games: {} };
}

export function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object' || typeof rec.games !== 'object' || rec.games === null) return emptyRecord();
  const out = { version: 1, updatedAt: rec.updatedAt || null, games: rec.games };
  if (Array.isArray(rec.reels)) out.reels = rec.reels;
  return out;
}

// entry: { driveId, name, kind: 'full'|'clip', view, start, size, original: { name, size, lastModified } }
export function addFile(record, gameId, entry, now = new Date().toISOString()) {
  const games = { ...record.games };
  const g = games[gameId] ? { ...games[gameId], files: [...games[gameId].files] } : { files: [] };
  g.files.push({ ...entry, addedAt: now });
  games[gameId] = g;
  return { ...record, updatedAt: now, games };
}

export function downloadedIds(record) {
  return new Set(Object.entries(record.games).filter(([, g]) => g.files.some((f) => f.kind === 'full')).map(([id]) => id));
}

export function gameSummary(record, gameId) {
  const g = record.games[gameId];
  if (!g) return { full: 0, clips: 0, views: [], joined: false, toJoin: false };
  const full = g.files.filter((f) => f.kind === 'full');
  const views = [...new Set(full.map((f) => f.view || ''))];
  return {
    full: full.length,
    clips: g.files.length - full.length,
    views: views.filter(Boolean).sort().reverse(),
    joined: full.length > 0 && full.every((f) => f.joined),
    toJoin: full.some((f) => !f.joined),
  };
}

// Seconds after midnight when this file starts (falls back to whole minutes for older entries).
export function clockSec(entry) {
  if (Number.isFinite(entry.startSec)) return entry.startSec;
  if (Number.isFinite(entry.start)) return entry.start * 60;
  return null;
}

// Full-game parts (not yet joined) for each view, in time order: { PANO: [...], AUTO: [...] }
export function partsByView(record, gameId) {
  const g = record.games[gameId];
  const out = {};
  if (!g) return out;
  for (const f of g.files) {
    if (f.kind !== 'full' || f.joined) continue;
    const v = f.view || 'Video';
    (out[v] = out[v] || []).push(f);
  }
  for (const v of Object.keys(out)) out[v].sort((a, b) => (clockSec(a) ?? 0) - (clockSec(b) ?? 0) || String(a.name).localeCompare(String(b.name)));
  return out;
}

export function joinedFile(record, gameId, view) {
  const g = record.games[gameId];
  return g ? g.files.find((f) => f.kind === 'full' && f.joined && (f.view || 'Video') === view) || null : null;
}

// "2026-11-07 vs Woodstock Jr Navy Vets full game PANO.mp4"
export function joinedFileName(game, view) {
  return safeName(`${game.date} ${game.opponentLabel} full game${view && view !== 'Video' ? ` ${view}` : ''}.mp4`);
}

export function setMarks(record, gameId, view, marks, now = new Date().toISOString()) {
  const games = { ...record.games };
  const g = { ...(games[gameId] || { files: [] }) };
  g.marks = { ...(g.marks || {}), [view]: marks };
  games[gameId] = g;
  return { ...record, updatedAt: now, games };
}

// Swap the parts for the joined file. The parts' original names stay on the new entry so they're never imported twice.
export function replaceWithJoined(record, gameId, partIds, entry, now = new Date().toISOString()) {
  const games = { ...record.games };
  const g = games[gameId] || { files: [] };
  const ids = new Set(partIds);
  const parts = g.files.filter((f) => ids.has(f.driveId));
  const originals = [...parts.flatMap((f) => [f.original, ...(f.originals || [])]), ...(entry.originals || [])].filter(Boolean);
  const files = g.files.filter((f) => !ids.has(f.driveId));
  files.push({ ...entry, kind: 'full', joined: true, originals, addedAt: now });
  games[gameId] = { ...g, files };
  return { ...record, updatedAt: now, games };
}

export function nextPart(record, gameId, view) {
  const g = record.games[gameId];
  return 1 + (g ? g.files.filter((f) => f.kind === 'full' && (f.view || '') === (view || '')).length : 0);
}

// Whether this exact file from the computer was already uploaded.
export function alreadyImported(record, file) {
  const same = (o) => o && o.name === file.name && o.size === file.size;
  return Object.values(record.games).some((g) => g.files.some((f) => same(f.original) || (f.originals || []).some(same)));
}

// Byte range for the next upload piece: inclusive end, as Content-Range wants.
export function nextRange(offset, size, chunk = CHUNK) {
  const end = Math.min(offset + chunk, size) - 1;
  return { start: offset, end, header: `bytes ${offset}-${end}/${size}` };
}

export function totals(record) {
  let full = 0; let clips = 0; let bytes = 0;
  const games = downloadedIds(record).size;
  for (const g of Object.values(record.games)) for (const f of g.files) { if (f.kind === 'full') full += 1; else clips += 1; bytes += f.size || 0; }
  return { games, full, clips, bytes };
}

// All clips with their game, newest game first
export function clipList(record, games) {
  const out = [];
  for (const [gameId, g] of Object.entries(record.games || {})) {
    for (const f of g.files || []) {
      if (f.kind !== 'clip') continue;
      out.push({ ...f, gameId, game: games.get(gameId) || null });
    }
  }
  return out.sort((a, b) => ((b.game && b.game.startMs) || 0) - ((a.game && a.game.startMs) || 0)
    || String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}

// ---------- highlight reels ----------
export function reelFolderPath(team) {
  return [ROOT_FOLDER, safeName(team.kid), safeName(`${team.season} ${team.label}`), 'Highlight reels'];
}

export function addReel(record, entry, now = new Date().toISOString()) {
  return { ...record, updatedAt: now, reels: [...(record.reels || []), { ...entry, addedAt: now }] };
}

export function reelList(record, kid) {
  return (record.reels || []).filter((r) => !kid || r.kid === kid).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}
