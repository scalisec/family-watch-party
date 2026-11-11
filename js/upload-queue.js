// The upload queue. Saving a game writes the trimmed file to this PC first (the browser's private storage,
// which takes seconds), then it goes to Google Drive in the background, one file at a time.
// Uploads carry on while any page of the app is open and Google is connected, and resume where they
// stopped after closing the app or restarting (Google keeps an unfinished upload for about a week).
import { isConnected, NotConnectedError } from './google.js';
import { ensureFolder, startUpload, uploadStatus, continueUpload, loadLibrary, saveLibrary, trashFile } from './drive.js';
import { replaceWithJoined, addFile } from './library.js';
import { cacheRecord } from './data.js';

const DB = 'fwp-uploads';
const STORE = 'queue';
const PIECE = 16 * 1024 * 1024;

// ---------- the list (IndexedDB) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
const allItems = () => run('readonly', (s) => s.getAll());
const putItem = (item) => run('readwrite', (s) => s.put(item));
const deleteItem = (id) => run('readwrite', (s) => s.delete(id));

// ---------- copies on this PC (the browser's private file storage) ----------
async function folder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('uploads', { create: true });
}
async function localFile(name) {
  const h = await (await folder()).getFileHandle(name);
  return h.getFile();
}
async function removeLocal(name) {
  try { await (await folder()).removeEntry(name); } catch { /* already gone */ }
}

// Writes a joined game (anything with size + read(start, end)) or a File to this PC.
export async function saveCopy(source, onProgress = () => {}) {
  if (!navigator.storage || !navigator.storage.getDirectory) throw new Error("This browser can't keep files for uploading later. Use Chrome or Edge on your PC.");
  const size = source.size;
  try { if (navigator.storage.persist) await navigator.storage.persist(); } catch { /* fine */ }
  const { quota = Infinity, usage = 0 } = navigator.storage.estimate ? await navigator.storage.estimate() : {};
  if (quota - usage < size * 1.05) throw new Error(`Not enough free space on this PC to hold the file before uploading (needs ${Math.ceil(size / 1e9 * 10) / 10} GB). Free some space or wait for the uploads already queued.`);
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.bin`;
  const handle = await (await folder()).getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  try {
    if (typeof source.read === 'function') {
      for (let o = 0; o < size; o += PIECE) {
        await w.write(await source.read(o, Math.min(size, o + PIECE)));
        onProgress(Math.min(size, o + PIECE), size);
      }
    } else {
      await w.write(source);
      onProgress(size, size);
    }
    await w.close();
  } catch (err) {
    try { await w.abort(); } catch { /* fine */ }
    await removeLocal(name);
    throw err;
  }
  return name;
}

// ---------- telling pages what's happening ----------
let snapshot = [];
const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fwp-uploads') : null;

function emit(event = { type: 'change' }) {
  for (const fn of listeners) { try { fn(event, snapshot); } catch { /* a page's problem */ } }
}
async function refresh(event, { broadcast = true } = {}) {
  try { snapshot = (await allItems()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); } catch { snapshot = []; }
  emit(event);
  if (broadcast && channel) channel.postMessage(event && event.type === 'done' ? { type: 'done', record: event.record } : { type: 'change' });
}
if (channel) channel.onmessage = (e) => refresh(e.data, { broadcast: false });

// fn(event, items): event.type is 'change', 'progress' or 'done' (with the updated record)
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const queueItems = () => snapshot;
export const queuedFor = (gameId) => snapshot.filter((i) => i.gameId === gameId);

// ---------- adding, retrying, removing ----------
export async function enqueue(item) {
  const full = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), state: 'waiting', sent: 0, session: null, error: '', trashIds: [], ...item };
  await putItem(full);
  await refresh();
  kick();
  return full;
}
export async function retry(id) {
  const item = snapshot.find((i) => i.id === id);
  if (!item) return;
  await putItem({ ...item, state: 'waiting', error: '' });
  await refresh();
  kick();
}
export async function remove(id) {
  const item = snapshot.find((i) => i.id === id);
  if (!item) return;
  removed.add(id);
  if (activeId === id && abort) abort.abort();
  await removeLocal(item.localName);
  await deleteItem(id);
  await refresh();
}

// ---------- uploading ----------
let running = false;
const removed = new Set();
let activeId = null;
let abort = null;

export async function kick() {
  await refresh(undefined, { broadcast: false });
  if (running || !isConnected() || !snapshot.some((i) => i.state === 'waiting' || i.state === 'uploading' || i.state === 'paused')) return;
  const go = async () => {
    running = true;
    try { await work(); } finally { running = false; activeId = null; abort = null; refresh(); }
  };
  // Only one tab uploads at a time; the others just show progress.
  if (navigator.locks) await navigator.locks.request('fwp-uploader', { ifAvailable: true }, async (lock) => { if (lock) await go(); });
  else await go();
}

async function work() {
  for (;;) {
    const items = (await allItems()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const item = items.find((i) => !removed.has(i.id) && (i.state === 'waiting' || i.state === 'uploading' || i.state === 'paused'));
    if (!item || !isConnected()) return;
    try {
      await uploadOne(item);
    } catch (err) {
      if (err instanceof NotConnectedError || (err && err.code === 'not-connected')) {
        await putItem({ ...item, state: 'paused', error: 'Waiting for Google: press Connect Google at the top.' });
        await refresh();
        return;
      }
      if (err && err.name === 'AbortError') { await refresh(); continue; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await putItem({ ...(await freshItem(item.id) || item), state: 'paused', error: "No internet right now. It carries on when you're back online." });
        await refresh();
        return;
      }
      await putItem({ ...(await freshItem(item.id) || item), state: 'error', error: String((err && err.message) || err) });
      await refresh();
    }
  }
}

async function freshItem(id) { return (await allItems()).find((i) => i.id === id); }

async function uploadOne(item) {
  let file;
  try { file = await localFile(item.localName); } catch {
    throw new Error("The copy on this PC is gone (maybe the browser's data was cleared). Save the game again.");
  }
  activeId = item.id;
  abort = new AbortController();
  let current = { ...item, state: 'uploading', error: '' };
  if (current.session) {
    const st = await uploadStatus(current.session, file.size);
    if (st.done) return finish(current, st.file, file.size);
    if (st.expired) current = { ...current, session: null, sent: 0 };
    else current.sent = st.offset;
  }
  if (!current.session) {
    const folderId = await ensureFolder(current.folderPath);
    current = { ...current, session: await startUpload(folderId, current.name, file.size, current.type || 'video/mp4'), sent: 0 };
  }
  await putItem(current);
  await refresh();
  let lastSave = 0;
  const send = () => continueUpload(current.session, file, current.sent, (sent) => {
    current.sent = sent;
    const i = snapshot.findIndex((x) => x.id === current.id);
    if (i >= 0) snapshot[i] = { ...current };
    emit({ type: 'progress', id: current.id });
    if (channel) channel.postMessage({ type: 'progress' });
    if (Date.now() - lastSave > 3000) { lastSave = Date.now(); putItem({ ...current }).catch(() => {}); }
  }, abort.signal);
  let driveFile;
  try { driveFile = await send(); } catch (err) {
    if (!err || err.code !== 'expired') throw err;
    // Drive forgot the upload (it keeps them about a week): start it again from the beginning.
    const folderId = await ensureFolder(current.folderPath);
    current = { ...current, session: await startUpload(folderId, current.name, file.size, current.type || 'video/mp4'), sent: 0 };
    await putItem(current);
    driveFile = await send();
  }
  return finish(current, driveFile, file.size);
}

// The file is in Drive: add it to the record (read fresh, so nothing saved meanwhile is lost),
// move any old parts to Drive's trash, and delete the copy on this PC.
async function finish(item, driveFile, size) {
  const lib = await loadLibrary();
  const entry = { ...item.entry, driveId: driveFile.id, name: item.name, size };
  const record = item.kind === 'full'
    ? replaceWithJoined(lib.record, item.gameId, item.trashIds || [], entry)
    : addFile(lib.record, item.gameId, { kind: 'clip', view: '', ...entry });
  await saveLibrary({ ...lib, record });
  cacheRecord(record);
  for (const id of item.trashIds || []) { try { await trashFile(id); } catch { /* left in Drive */ } }
  await removeLocal(item.localName);
  await deleteItem(item.id);
  await refresh({ type: 'done', record, item });
}

// Start (or resume) whenever the app opens, Google connects, or the internet comes back.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => kick());
}
