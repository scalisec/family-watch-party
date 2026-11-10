// Family Watch Party helper — background worker.
// Takes one "download this game" request at a time from the Family Watch Party site,
// drives the LiveBarn page script window by window, and either names the downloads it starts or
// (when the app asks) moves each file straight into Google Drive instead of the Downloads folder.
importScripts('lib/plan.js');
const P = self.FWPPlan;

const APP_ORIGIN = 'https://scalisec.github.io';
const VERSION = chrome.runtime.getManifest().version;

// ---------- Google (only Drive files this app created: drive.file) ----------
const CLIENT_ID = '1061398617166-8t015jus9o3vb95n6r46t01v46jnetkk.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let google = { token: null, expiresAt: 0 };

// Gets a Google pass for the helper. interactive=false never shows a window (used in the background);
// it works once you've connected the helper and are signed in to Google in this Chrome.
async function googleToken(interactive = false) {
  if (google.token && Date.now() < google.expiresAt - 60000) return google.token;
  try {
    const saved = await chrome.storage.session.get('google');
    if (saved.google && Date.now() < saved.google.expiresAt - 60000) { google = saved.google; return google.token; }
  } catch { /* fine */ }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'token', redirect_uri: chrome.identity.getRedirectURL(), scope: SCOPE,
    include_granted_scopes: 'true', ...(interactive ? {} : { prompt: 'none' }),
  }).toString();
  let final;
  try {
    final = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive });
  } catch (err) {
    if (!interactive) return null;
    throw new Error(`Google sign-in didn't finish: ${err.message}`);
  }
  const params = new URLSearchParams(new URL(final).hash.slice(1));
  if (!params.get('access_token')) {
    if (!interactive) return null;
    throw new Error(`Google said: ${params.get('error') || 'no pass was given'}.`);
  }
  google = { token: params.get('access_token'), expiresAt: Date.now() + Number(params.get('expires_in') || 3600) * 1000 };
  try { await chrome.storage.session.set({ google }); await chrome.storage.local.set({ googleConnected: true }); } catch { /* fine */ }
  return google.token;
}

async function googleStatus() {
  const token = await googleToken(false);
  let everConnected = false;
  try { everConnected = Boolean((await chrome.storage.local.get('googleConnected')).googleConnected); } catch { /* fine */ }
  return { type: 'google', connected: Boolean(token), everConnected };
}

// ---------- the invisible page that moves files into Drive ----------
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Moves LiveBarn downloads into Google Drive.' });
}

let job = null;            // the running job, or null
const pending = [];        // downloads we expect LiveBarn to start, in order
const active = new Map();  // Chrome download id -> { fileName, start, part }

// ---------- talking to the app ----------
chrome.runtime.onConnectExternal.addListener((port) => {
  const origin = port.sender && port.sender.origin;
  if (origin !== APP_ORIGIN) { port.disconnect(); return; }

  port.onMessage.addListener(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      post(port, { type: 'pong', version: VERSION, busy: Boolean(job) });
      return;
    }
    if (msg.type === 'googleStatus') { post(port, await googleStatus()); return; }
    if (msg.type === 'connectGoogle') {
      try { await googleToken(true); } catch (err) { post(port, { type: 'error', code: 'google', message: err.message }); }
      post(port, await googleStatus());
      return;
    }
    if (msg.type === 'downloadGame') {
      if (job) { post(port, { type: 'error', code: 'busy', message: 'Another game is downloading. Wait for it to finish.' }); return; }
      const problems = P.validateGame(msg.game);
      if (problems.length) { post(port, { type: 'error', code: 'invalid', message: problems.join(' ') }); return; }
      if (msg.drive && !msg.dryRun) {
        const bad = P.validateDrive(msg.drive);
        if (bad.length) { post(port, { type: 'error', code: 'invalid', message: bad.join(' ') }); return; }
        if (!(await googleToken(false))) { post(port, { type: 'error', code: 'google', message: 'Connect the helper to Google first (Helper test → Connect the helper to Google).' }); return; }
        await ensureOffscreen();
      }
      runJob(port, msg.game, Boolean(msg.dryRun), msg.dryRun ? null : msg.drive || null).catch((err) => {
        post(port, { type: 'error', code: 'unexpected', message: String(err && err.message || err) });
      }).finally(() => { job = null; });
    }
  });
  port.onDisconnect.addListener(() => {
    if (job && job.port === port) job.port = null;
    for (const e of [...pending, ...active.values()]) if (e.port === port) e.port = null;
  });
});

function post(port, msg) {
  try { if (port) port.postMessage(msg); } catch { /* app page closed; carry on */ }
}
function say(text) { post(job && job.port, { type: 'log', text }); }

// ---------- the job ----------
async function runJob(port, game, dryRun, drive = null) {
  job = { port, game, dryRun, drive, taken: [], part: 0, tabId: null, usageStart: null, usageEnd: null, picked: [] };
  job.started = [];          // start times of files whose download really began (never take them twice)
  let windowStart = P.firstWindow(game);
  let lastPageId = null;
  say(`Opening LiveBarn at ${P.toHHMM(windowStart)} on ${game.date}${dryRun ? ' (dry run: nothing will be downloaded)' : ''}.`);

  const tab = await chrome.tabs.create({ url: P.videoUrl(game.surfaceId, game.date, windowStart), active: true });
  job.tabId = tab.id;

  try {
    for (let guard = 0; guard < 12; guard += 1) {
      say(`Checking the ${P.toHHMM(windowStart)} window.`);
      let result = null;
      for (let attempt = 1; attempt <= 2 && !result; attempt += 1) {
        lastPageId = await waitForPage(job.tabId, lastPageId);
        try {
          result = await chrome.tabs.sendMessage(job.tabId, {
            type: 'runWindow', game, dryRun, taken: [...job.taken, ...job.started], firstPart: job.part + 1,
          });
        } catch (err) {
          // Chrome closes the channel if the page is swapped out mid-answer (back/forward cache, reload).
          if (attempt === 2 || !P.isChannelClosed(err)) throw err;
          say('The LiveBarn page changed while the helper was reading it; trying this window again.');
          lastPageId = null;
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      if (!result || !result.ok) {
        post(job.port, { type: 'error', code: (result && result.code) || 'page', message: (result && result.message) || 'The LiveBarn page did not answer.' });
        return;
      }
      if (job.usageStart === null && result.usageBefore) job.usageStart = result.usageBefore;
      if (result.usageAfter || result.usageBefore) job.usageEnd = result.usageAfter || result.usageBefore;
      for (const c of result.picked) {
        job.taken.push(c.start);
        job.picked.push(c);
        if (!dryRun) job.part += 1;
      }
      post(job.port, { type: 'window', windowStart: P.toHHMM(windowStart), files: result.clips, picked: result.picked, usage: job.usageEnd, pano: result.pano });

      if (!P.needsNextWindow(windowStart, game)) break;
      windowStart += 30;
      await chrome.tabs.update(job.tabId, { url: P.videoUrl(game.surfaceId, game.date, windowStart) });
    }

    const minutes = job.picked.reduce((sum, c) => sum + c.minutes, 0);
    post(job.port, {
      type: 'done', dryRun, files: job.picked.length, minutes,
      usageStart: job.usageStart, usageEnd: job.usageEnd,
      message: dryRun
        ? `Dry run finished: ${job.picked.length} file(s), ${minutes} minutes would be downloaded.`
        : job.drive
          ? `Started ${job.picked.length} file(s), ${minutes} minutes; each one is going straight into Google Drive.`
          : `Started ${job.picked.length} download(s), ${minutes} minutes. Chrome finishes them in the background.`,
    });
  } finally {
    if (job.tabId !== null) { try { await chrome.tabs.remove(job.tabId); } catch { /* already closed */ } }
  }
}

// Waits until a LiveBarn page answers, up to 40 seconds, and returns its page ID.
// With notPageId, keeps waiting until a different (newly loaded) page answers: right after the helper
// sends the tab to the next window, the old page can still answer for a moment.
async function waitForPage(tabId, notPageId = null) {
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'hello' });
      if (r && r.ok && (!notPageId || r.pageId !== notPageId)) {
        if (r.signedOut) throw Object.assign(new Error('Sign in to LiveBarn in this Chrome window, then try again.'), { code: 'signin' });
        return r.pageId || null;
      }
    } catch (err) {
      if (err && err.code === 'signin') throw err;
    }
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error('The LiveBarn page did not finish loading.');
}

// ---------- downloads ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!job || !sender.tab || sender.tab.id !== job.tabId) return false;
  if (msg.type === 'log') { say(msg.text); return false; }
  if (msg.type === 'expectDownload') {
    const entry = { fileName: msg.fileName, start: msg.start, part: msg.part, started: null, port: job.port };
    entry.startedPromise = new Promise((res) => { entry.started = res; });
    pending.push(entry);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'waitStarted') {
    const entry = pending.find((p) => p.start === msg.start) || [...active.values(), ...toDrive.values()].find((a) => a.start === msg.start);
    if (!entry) { sendResponse({ ok: false }); return false; }
    if (entry.downloadId !== undefined) { sendResponse({ ok: true }); return false; }
    const timer = setTimeout(() => {
      // Keep expecting it for a few minutes: if Chrome starts it late, it still gets the right name.
      entry.late = true;
      setTimeout(() => { const i = pending.indexOf(entry); if (i >= 0 && entry.downloadId === undefined) pending.splice(i, 1); }, 180000);
      sendResponse({ ok: false });
    }, 45000);
    entry.startedPromise.then(() => { clearTimeout(timer); sendResponse({ ok: true }); });
    return true; // answer later
  }
  if (msg.type === 'waitClear') {
    waitUntilNoSaveAs().then((ok) => sendResponse({ ok }));
    return true;
  }
  return false;
});

// A download whose file name is still empty is waiting on Chrome's "Save As" window.
async function savingAs() {
  const out = [];
  for (const [id, entry] of active) {
    const [item] = await chrome.downloads.search({ id });
    if (item && item.state === 'in_progress' && !item.filename) out.push(entry);
  }
  return out;
}

// Before the next file is clicked: wait (up to 2.5 minutes) while an earlier one sits on a Save As window.
async function waitUntilNoSaveAs() {
  const until = Date.now() + 150000;
  let told = false;
  while (Date.now() < until) {
    const waiting = await savingAs();
    if (!waiting.length) return true;
    if (!told) { say(SAVE_AS_HELP(waiting[0].part)); told = true; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const SAVE_AS_HELP = (part) => `Chrome is asking where to save part ${part}: press Save in that window (the name and folder are already filled in). To stop these windows, switch off "Ask where to save each file before downloading" at chrome://settings/downloads.`;

// ---------- straight to Drive ----------
const toDrive = new Map();   // Chrome download id -> entry (the file goes to Drive, not to Downloads)

// LiveBarn's own Download click starts a normal Chrome download (that's what LiveBarn counts).
// In Drive mode the helper cancels Chrome's copy at once and streams the same file into Drive itself,
// so there's no Save As window and nothing lands in Downloads.
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url;
  if (!job || !job.drive || !P.isLiveBarnMedia(url) || pending.length === 0) return;
  const entry = pending.shift();
  entry.downloadId = item.id;
  entry.drive = true;
  toDrive.set(item.id, entry);
  if (job.started) job.started.push(entry.start);
  try { await chrome.downloads.cancel(item.id); await chrome.downloads.erase({ id: item.id }); } catch { /* already gone */ }
  const name = P.driveNameFor(entry.fileName, job.drive.view);
  const original = P.liveBarnFileName(url);
  entry.started();
  post(entry.port, { type: 'download', state: 'started', part: entry.part, fileName: name, toDrive: true });
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'transfer', id: item.id, url, name, folderPath: job.drive.folderPath,
      note: {
        gameId: job.drive.gameId, view: job.drive.view, start: entry.start, startSec: P.startSecFromName(original) ?? entry.start * 60,
        original: original ? { name: original } : null,
      },
    });
  } catch (err) {
    post(entry.port, { type: 'transfer', state: 'error', part: entry.part, message: `Couldn't start moving it to Drive: ${err.message}` });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'background' || sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'token') {
    // fresh: the old pass was turned down, so drop it and get a new one quietly
    const forget = msg.fresh ? chrome.storage.session.remove('google').catch(() => {}).then(() => { google = { token: null, expiresAt: 0 }; }) : Promise.resolve();
    forget.then(() => googleToken(false)).then((token) => sendResponse({ token }));
    return true;
  }
  if (msg.type === 'transfer') {
    const entry = toDrive.get(msg.id);
    if (entry) {
      post(entry.port, { type: 'transfer', state: msg.state, part: entry.part, sent: msg.sent, total: msg.total, driveId: msg.driveId, size: msg.size, name: msg.name, message: msg.message });
      if (msg.state === 'done' || msg.state === 'error') toDrive.delete(msg.id);
    }
  }
  return false;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (toDrive.has(item.id)) return;
  if (!P.isLiveBarnMedia(item.finalUrl || item.url) || pending.length === 0) return;
  const entry = pending.shift();
  entry.downloadId = item.id;
  active.set(item.id, entry);
  if (job && job.started) job.started.push(entry.start);
  suggest({ filename: entry.fileName, conflictAction: 'uniquify' });
  entry.started();
  post(entry.port, { type: 'download', state: 'started', part: entry.part, fileName: entry.fileName });
  if (entry.late) post(entry.port, { type: 'log', text: `Part ${entry.part} started late, after the helper had stopped; it's still saved with the right name.` });
  // Tell the person if Chrome is holding it on a Save As window
  setTimeout(async () => {
    const [it] = await chrome.downloads.search({ id: item.id });
    if (it && it.state === 'in_progress' && !it.filename) post(entry.port, { type: 'log', text: SAVE_AS_HELP(entry.part) });
  }, 3000);
});

chrome.downloads.onChanged.addListener((delta) => {
  const entry = active.get(delta.id);
  if (!entry || !delta.state) return;
  const state = delta.state.current;
  if (state !== 'complete' && state !== 'interrupted') return;
  active.delete(delta.id);
  chrome.downloads.search({ id: delta.id }).then(([item]) => {
    post(entry.port, {
      type: 'download', state, part: entry.part, fileName: entry.fileName,
      bytes: item ? item.fileSize || item.bytesReceived : undefined,
      error: item && item.error,
    });
  });
});
