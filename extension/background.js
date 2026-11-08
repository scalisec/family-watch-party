// Family Watch Party helper — background worker.
// Takes one "download this game" request at a time from the Family Watch Party site,
// drives the LiveBarn page script window by window, and names the downloads it starts.
importScripts('lib/plan.js');
const P = self.FWPPlan;

const APP_ORIGIN = 'https://scalisec.github.io';
const VERSION = chrome.runtime.getManifest().version;

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
    if (msg.type === 'downloadGame') {
      if (job) { post(port, { type: 'error', code: 'busy', message: 'Another game is downloading. Wait for it to finish.' }); return; }
      const problems = P.validateGame(msg.game);
      if (problems.length) { post(port, { type: 'error', code: 'invalid', message: problems.join(' ') }); return; }
      runJob(port, msg.game, Boolean(msg.dryRun)).catch((err) => {
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
async function runJob(port, game, dryRun) {
  job = { port, game, dryRun, taken: [], part: 0, tabId: null, usageStart: null, usageEnd: null, picked: [] };
  let windowStart = P.firstWindow(game);
  say(`Opening LiveBarn at ${P.toHHMM(windowStart)} on ${game.date}${dryRun ? ' (dry run: nothing will be downloaded)' : ''}.`);

  const tab = await chrome.tabs.create({ url: P.videoUrl(game.surfaceId, game.date, windowStart), active: true });
  job.tabId = tab.id;

  try {
    for (let guard = 0; guard < 12; guard += 1) {
      await waitForPage(job.tabId);
      say(`Checking the ${P.toHHMM(windowStart)} window.`);
      const result = await chrome.tabs.sendMessage(job.tabId, {
        type: 'runWindow', game, dryRun, taken: job.taken, firstPart: job.part + 1,
      });
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
        : `Started ${job.picked.length} download(s), ${minutes} minutes. Chrome finishes them in the background.`,
    });
  } finally {
    if (job.tabId !== null) { try { await chrome.tabs.remove(job.tabId); } catch { /* already closed */ } }
  }
}

// Waits until the LiveBarn page script answers, up to 40 seconds.
async function waitForPage(tabId) {
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'hello' });
      if (r && r.ok) {
        if (r.signedOut) throw Object.assign(new Error('Sign in to LiveBarn in this Chrome window, then try again.'), { code: 'signin' });
        return;
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
    const entry = pending.find((p) => p.start === msg.start) || [...active.values()].find((a) => a.start === msg.start);
    if (!entry) { sendResponse({ ok: false }); return false; }
    if (entry.downloadId !== undefined) { sendResponse({ ok: true }); return false; }
    const timer = setTimeout(() => {
      const i = pending.indexOf(entry);
      if (i >= 0) pending.splice(i, 1);
      sendResponse({ ok: false });
    }, 20000);
    entry.startedPromise.then(() => { clearTimeout(timer); sendResponse({ ok: true }); });
    return true; // answer later
  }
  return false;
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!P.isLiveBarnMedia(item.finalUrl || item.url) || pending.length === 0) return;
  const entry = pending.shift();
  entry.downloadId = item.id;
  active.set(item.id, entry);
  suggest({ filename: entry.fileName, conflictAction: 'uniquify' });
  entry.started();
  post(entry.port, { type: 'download', state: 'started', part: entry.part, fileName: entry.fileName });
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
