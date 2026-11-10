// The little bit of Google Drive the helper needs: find or make the game's folders, upload one file
// as it streams in from LiveBarn, and leave a small note for the app. Only Google's Drive API is used.
(function (root) {
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'application/vnd.google-apps.folder';
  const CHUNK = 16 * 1024 * 1024; // a multiple of 256 KB, as Drive requires
  const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function client(getToken, fetchImpl = fetch) {
    async function call(url, opts = {}, retry = true) {
      const token = await getToken(false);
      if (!token) throw Object.assign(new Error('The helper is not connected to Google.'), { code: 'google' });
      const res = await fetchImpl(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
      if (res.status === 401 && retry) { await getToken(true); return call(url, opts, false); }
      return res;
    }
    async function json(url, opts) {
      const res = await call(url, opts);
      if (!res.ok) throw new Error(`Google Drive said ${res.status}.`);
      return res.json();
    }
    async function findChild(parent, name) {
      const q = [`name = ${quote(name)}`, `${quote(parent)} in parents`, 'trashed = false', `mimeType = ${quote(FOLDER)}`].join(' and ');
      const r = await json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=5`);
      return r.files && r.files[0] ? r.files[0].id : null;
    }
    async function ensureFolder(path) {
      let parent = 'root';
      for (const name of path) {
        let id = await findChild(parent, name);
        if (!id) {
          const r = await json(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
          id = r.id;
        }
        parent = id;
      }
      return parent;
    }
    async function startUpload(folderId, name, total, type = 'video/mp4') {
      const headers = { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type };
      if (total) headers['X-Upload-Content-Length'] = String(total);
      const res = await call(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, { method: 'POST', headers, body: JSON.stringify({ name, parents: [folderId] }) });
      if (!res.ok) throw new Error(`Google Drive wouldn't start the upload (${res.status}).`);
      return res.headers.get('Location');
    }
    // How much of the upload Drive already has (after a hiccup)
    async function received(session, total) {
      const res = await fetchImpl(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total || '*'}` } });
      if (res.status === 200 || res.status === 201) return { done: await res.json() };
      const range = res.headers.get('Range');
      return { have: range ? Number(range.split('-')[1]) + 1 : 0 };
    }
    async function putChunk(session, buf, offset, total, isLast) {
      const end = offset + buf.length - 1;
      const size = isLast ? (total || end + 1) : (total || '*');
      for (let attempt = 1; ; attempt += 1) {
        try {
          const res = await fetchImpl(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end}/${size}` }, body: buf });
          if (res.status === 308) return null;
          if (res.ok) return res.json();
          if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`Google Drive stopped the upload (${res.status}).`), { fatal: true });
        } catch (err) {
          if (err.fatal || attempt >= 5) throw err;
        }
        await sleep(1000 * 2 ** attempt);
        const r = await received(session, total);
        if (r.done) return r.done;
        if (r.have > offset) { buf = buf.subarray(r.have - offset); offset = r.have; }
      }
    }
    // Upload a stream (the LiveBarn file as it arrives) in 16 MB pieces.
    async function uploadStream(session, stream, total, onProgress = () => {}) {
      const reader = stream.getReader();
      let buf = new Uint8Array(CHUNK);
      let fill = 0;
      let offset = 0;
      let result = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          let v = value;
          while (v.length) {
            const n = Math.min(CHUNK - fill, v.length);
            buf.set(v.subarray(0, n), fill);
            fill += n;
            v = v.subarray(n);
            if (fill === CHUNK) {
              const isLast = Boolean(total) && offset + fill === total;
              result = await putChunk(session, buf.slice(0, fill), offset, total, isLast);
              offset += fill;
              fill = 0;
              onProgress(offset);
            }
          }
        }
        if (done) break;
      }
      if (!fill && !result) {
        // ended exactly on a piece boundary with no size known: tell Drive the final size
        result = (await received(session, offset)).done || null;
      } else if (fill || !result) {
        result = await putChunk(session, buf.slice(0, fill), offset, total || offset + fill, true);
        offset += fill;
        onProgress(offset);
      }
      if (!result) throw new Error('Google Drive did not confirm the upload.');
      return result;
    }
    async function writeJson(folderId, name, data) {
      const boundary = `fwp${Math.random().toString(36).slice(2)}`;
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
      return json(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    }
    return { ensureFolder, startUpload, uploadStream, writeJson, CHUNK };
  }

  root.FWPDrive = { client, CHUNK };
})(typeof self !== 'undefined' ? self : globalThis);
