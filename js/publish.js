// Turning a game's parts into one full-game file in Drive, and uploading clips.
// Parts: { id, clock, size, duration, file? (on this PC), driveId? (already in Drive) }
import { folderPath, joinedFileName, replaceWithJoined, addFile, safeName } from './library.js';
import { ensureFolder, uploadFile, saveLibrary, trashFile } from './drive.js';
import { blobReader, readMp4, buildJoin } from './mp4.js';

// Read the parts between the cut and build the joined file (nothing is uploaded yet).
export async function prepareJoin(parts, cut, getBlob, onStatus = () => {}) {
  const used = parts.slice(cut.first, cut.last + 1);
  const loaded = [];
  for (let i = 0; i < used.length; i += 1) {
    const source = await getBlob(used[i], (got, size) => onStatus(`loading part ${cut.first + i + 1} from Drive`, got, size));
    onStatus(`reading part ${cut.first + i + 1}`);
    const reader = source && typeof source.read === 'function' ? source : blobReader(source);
    loaded.push({ reader, info: await readMp4(reader) });
  }
  const joined = buildJoin(loaded, { startPart: 0, startSec: cut.startSec, endPart: loaded.length - 1, endSec: cut.endSec });
  return { joined, used };
}

// Upload the joined file, record it, then move any Drive parts to the trash.
export async function publishJoined({ joined, used, parts, game, team, view, record, library, signal, onSent }) {
  const name = joinedFileName(game, view);
  const folderId = await ensureFolder(folderPath(game, team, 'full'));
  const file = await uploadFile(joined, folderId, name, onSent, signal);
  const first = used[0];
  const startSec = first && first.clock != null ? Math.round(first.clock + joined.startSec) : null;
  const driveIds = parts.filter((p) => p.driveId).map((p) => p.driveId);
  const originals = parts.filter((p) => p.file).map((p) => ({ name: p.file.name, size: p.file.size, lastModified: p.file.lastModified }));
  const nextRecord = replaceWithJoined(record, game.id, driveIds, {
    driveId: file.id, name, view, size: joined.size, duration: Math.round(joined.duration),
    start: startSec != null ? Math.floor(startSec / 60) : null, startSec, originals,
  });
  const nextLibrary = await saveLibrary({ ...library, record: nextRecord });
  let notTrashed = 0;
  for (const id of driveIds) { try { await trashFile(id); } catch { notTrashed += 1; } }
  return { record: nextRecord, library: nextLibrary, name, notTrashed };
}

// Upload one clip as it is.
export async function publishClip({ file, duration, game, team, record, library, signal, onSent, extra = {} }) {
  const folderId = await ensureFolder(folderPath(game, team, 'clip'));
  const name = safeName(file.name);
  const saved = await uploadFile(file, folderId, name, onSent, signal);
  const nextRecord = addFile(record, game.id, {
    driveId: saved.id, name, kind: 'clip', view: '', size: file.size, duration: duration ? Math.round(duration) : null,
    original: { name: file.name, size: file.size, lastModified: file.lastModified },
    ...extra,
  });
  const nextLibrary = await saveLibrary({ ...library, record: nextRecord });
  return { record: nextRecord, library: nextLibrary, name };
}

// ---------- for the upload queue ----------
// What to upload and what to record once it's in Drive. Pure, so it can be tested.
export function joinedQueueItem({ joined, used, parts, game, team, view }) {
  const name = joinedFileName(game, view);
  const first = used[0];
  const startSec = first && first.clock != null ? Math.round(first.clock + joined.startSec) : null;
  return {
    kind: 'full', gameId: game.id, view, name, size: joined.size,
    label: `${game.date} ${game.opponentLabel} · ${view} full game`,
    folderPath: folderPath(game, team, 'full'),
    trashIds: parts.filter((p) => p.driveId).map((p) => p.driveId),
    entry: {
      view, duration: Math.round(joined.duration),
      start: startSec != null ? Math.floor(startSec / 60) : null, startSec,
      originals: parts.filter((p) => p.file).map((p) => ({ name: p.file.name, size: p.file.size, lastModified: p.file.lastModified })),
    },
  };
}

export function clipQueueItem({ file, duration, game, team, extra = {} }) {
  const name = safeName(file.name);
  return {
    kind: 'clip', gameId: game.id, view: '', name, size: file.size, type: file.type || 'video/mp4',
    label: `${game.date} ${game.opponentLabel} · clip ${name}`,
    folderPath: folderPath(game, team, 'clip'),
    trashIds: [],
    entry: { duration: duration ? Math.round(duration) : null, original: { name: file.name, size: file.size, lastModified: file.lastModified }, ...extra },
  };
}

// Whether a file from this PC is already waiting in the upload queue.
export function queuedOriginal(items, file) {
  const same = (o) => o && o.name === file.name && o.size === file.size;
  return items.some((i) => i.entry && (same(i.entry.original) || (i.entry.originals || []).some(same)));
}
