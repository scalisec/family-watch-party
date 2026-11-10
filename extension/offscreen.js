// Moves one LiveBarn file into Google Drive while it downloads, then leaves a note for the app.
// Runs in the helper's invisible page so long transfers aren't cut off.
(function () {
  'use strict';
  const INBOX = ['Family Hockey', 'Helper inbox'];

  async function getToken(fresh) {
    const r = await chrome.runtime.sendMessage({ target: 'background', type: 'token', fresh: Boolean(fresh) });
    return r && r.token ? r.token : null;
  }
  const drive = self.FWPDrive.client(getToken);

  async function transfer(msg) {
    const report = (m) => chrome.runtime.sendMessage({ target: 'background', type: 'transfer', id: msg.id, ...m }).catch(() => {});
    try {
      const res = await fetch(msg.url, { credentials: 'omit' });
      if (!res.ok || !res.body) throw new Error(`LiveBarn's file wouldn't download (${res.status}). Its link may have expired.`);
      const total = Number(res.headers.get('content-length')) || null;
      report({ state: 'progress', sent: 0, total });
      const folderId = await drive.ensureFolder(msg.folderPath);
      const session = await drive.startUpload(folderId, msg.name, total);
      let last = 0;
      const file = await drive.uploadStream(session, res.body, total, (sent) => {
        if (sent - last >= drive.CHUNK || sent === total) { last = sent; report({ state: 'progress', sent, total }); }
      });
      const size = Number(file.size) || total;
      const notes = await drive.ensureFolder(INBOX);
      await drive.writeJson(notes, `part-${file.id}.json`, { ...msg.note, type: 'part', driveId: file.id, name: msg.name, size, at: new Date().toISOString() });
      report({ state: 'done', driveId: file.id, size, name: msg.name });
    } catch (err) {
      report({ state: 'error', message: String((err && err.message) || err) });
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'offscreen') return false;
    if (msg.type === 'transfer') { transfer(msg); sendResponse({ ok: true }); }
    return false;
  });
})();
