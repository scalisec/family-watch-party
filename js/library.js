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
  return { version: 1, updatedAt: rec.updatedAt || null, games: rec.games };
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
  if (!g) return { full: 0, clips: 0, views: [] };
  const full = g.files.filter((f) => f.kind === 'full');
  return { full: full.length, clips: g.files.length - full.length, views: [...new Set(full.map((f) => f.view).filter(Boolean))].sort().reverse() };
}

export function nextPart(record, gameId, view) {
  const g = record.games[gameId];
  return 1 + (g ? g.files.filter((f) => f.kind === 'full' && (f.view || '') === (view || '')).length : 0);
}

// Whether this exact file from the computer was already uploaded.
export function alreadyImported(record, file) {
  return Object.values(record.games).some((g) => g.files.some((f) => f.original && f.original.name === file.name && f.original.size === file.size));
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
