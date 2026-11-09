// Google Drive: the Family Hockey folders, the app's record file, uploads and storage.
// With the drive.file permission the app only ever sees files and folders it created.
import { gfetch, gjson } from './google.js';
import { ROOT_FOLDER, RECORD_NAME, emptyRecord, normalizeRecord, nextRange } from './library.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

let folderIds = new Map();
try { folderIds = new Map(JSON.parse(localStorage.getItem('fwp.folders') || '[]')); } catch { /* fine */ }
function saveFolders() {
  try { localStorage.setItem('fwp.folders', JSON.stringify([...folderIds])); } catch { /* fine */ }
}

export async function about() {
  return gjson(`${API}/about?fields=user(emailAddress,displayName),storageQuota`);
}

async function findChild(parentId, name, mimeType) {
  const q = [`name = ${quote(name)}`, `${quote(parentId)} in parents`, 'trashed = false'];
  if (mimeType) q.push(`mimeType = ${quote(mimeType)}`);
  const res = await gjson(`${API}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name)&spaces=drive&pageSize=10`);
  return res.files && res.files[0] ? res.files[0] : null;
}

async function createFolder(parentId, name) {
  return gjson(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  });
}

async function folderStillThere(id) {
  try {
    const f = await gjson(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed`);
    return f && !f.trashed;
  } catch { return false; }
}

// Finds or creates each folder along the path and returns the last one's id.
export async function ensureFolder(path) {
  let parent = 'root';
  let key = '';
  for (const name of path) {
    key += `/${name}`;
    let id = folderIds.get(key);
    if (id && key === `/${path[0]}` && !(await folderStillThere(id))) id = null;
    if (!id) {
      const found = await findChild(parent, name, FOLDER);
      id = found ? found.id : (await createFolder(parent, name)).id;
      folderIds.set(key, id);
      saveFolders();
    }
    parent = id;
  }
  return parent;
}

export function forgetFolders() {
  folderIds = new Map();
  saveFolders();
}

// ---------- the record file ----------
export async function loadLibrary() {
  const rootId = await ensureFolder([ROOT_FOLDER]);
  const file = await findChild(rootId, RECORD_NAME);
  if (!file) return { rootId, fileId: null, record: emptyRecord() };
  const res = await gfetch(`${API}/files/${encodeURIComponent(file.id)}?alt=media`);
  if (!res.ok) throw new Error(`Couldn't read the Family Watch Party record in Drive (${res.status}).`);
  let record;
  try { record = normalizeRecord(await res.json()); } catch { record = emptyRecord(); }
  return { rootId, fileId: file.id, record };
}

export async function saveLibrary(lib) {
  const body = JSON.stringify(lib.record, null, 1);
  let fileId = lib.fileId;
  if (!fileId) {
    const created = await gjson(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: RECORD_NAME, mimeType: 'application/json', parents: [lib.rootId] }),
    });
    fileId = created.id;
  }
  await gjson(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body,
  });
  return { ...lib, fileId };
}

// ---------- uploads ----------
async function uploadedSoFar(session, size) {
  const res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
  if (res.ok) return { done: true, file: await res.json() };
  if (res.status === 308) {
    const range = res.headers.get('Range');
    return { done: false, offset: range ? Number(range.split('-')[1]) + 1 : 0 };
  }
  throw new Error(`Drive upload check failed (${res.status}).`);
}

// Uploads one file in pieces; onProgress(bytesSent). Retries a piece up to 5 times on network trouble.
export async function uploadFile(file, folderId, name, onProgress = () => {}, signal) {
  const start = await gfetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'video/mp4',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!start.ok) throw new Error(`Drive wouldn't start the upload (${start.status}).`);
  const session = start.headers.get('Location');
  if (!session) throw new Error("Drive didn't give an upload address. Try again in a minute.");

  let offset = 0;
  let failures = 0;
  while (offset < file.size || file.size === 0) {
    if (signal && signal.aborted) throw new DOMException('Upload stopped', 'AbortError');
    const range = file.size === 0 ? { start: 0, end: -1, header: 'bytes */0' } : nextRange(offset, file.size);
    let res;
    try {
      res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': range.header }, body: file.slice(range.start, range.end + 1), signal });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      res = null;
    }
    if (res && (res.status === 200 || res.status === 201)) { onProgress(file.size); return res.json(); }
    if (res && res.status === 308) {
      const r = res.headers.get('Range');
      offset = r ? Number(r.split('-')[1]) + 1 : range.end + 1;
      failures = 0;
      onProgress(offset);
      continue;
    }
    if (res && res.status < 500 && res.status !== 429 && res.status !== 408) {
      throw new Error(`Drive stopped the upload (${res.status}).`);
    }
    failures += 1;
    if (failures > 5) throw new Error('The connection kept dropping. Try this file again.');
    await sleep(1000 * 2 ** failures);
    const state = await uploadedSoFar(session, file.size);
    if (state.done) { onProgress(file.size); return state.file; }
    offset = state.offset;
    onProgress(offset);
  }
  throw new Error('Upload ended without a file.');
}

