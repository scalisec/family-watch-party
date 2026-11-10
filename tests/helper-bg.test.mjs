// Runs the helper's background worker against a pretend Chrome and LiveBarn tab, to check how it moves
// between 30-minute windows. Recreates the Nov 9 dry run failure: right after the helper sends the tab to
// the next window, the old page still answers for a moment and is then swapped out mid-answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
const BFCACHE = 'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.';

function harness({ navDelay = 1200, failFirstRunWindow = false, onRunWindow = null, signedIn = false } = {}) {
  const sent = [];        // messages the background sent to the offscreen page
  const cancelled = [];
  const logs = [];
  const windowsRun = [];
  let page = null;          // { id, url, ready }
  let pages = 0;
  let failed = false;
  const listeners = { connectExternal: [], message: [], determine: [], changed: [], created: [] };
  const downloads = new Map();   // id -> { id, state, filename }
  const fromPage = (msg) => new Promise((resolve) => {
    const keep = listeners.message[0](msg, { tab: { id: 7 } }, resolve);
    if (keep !== true) setTimeout(() => resolve(undefined), 0);
  });
  // LiveBarn's link is clicked: Chrome starts a download and asks the helper for its name
  const startDownload = (id, { saveAs = false } = {}) => {
    downloads.set(id, { id, state: 'in_progress', filename: saveAs ? '' : `C:/Downloads/f${id}.mp4` });
    let named = null;
    const url = 'https://livebarn-prod-vod-media.s3.amazonaws.com/x/Appleby_Ice_Centre_2026-11-07T133002.mp4?X-Amz-Signature=abc';
    for (const f of listeners.created) f({ id, url, finalUrl: url });
    listeners.determine[0]({ id, url, finalUrl: url }, (s) => { named = s.filename; });
    return named;
  };

  function loadPage(url) {
    page = { id: `page-${++pages}`, url, ready: false };
    const p = page;
    setTimeout(() => { p.ready = true; }, 200);
  }

  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.2.0' }),
      id: 'ihlieolhaepnpncmgebcejlabomnifmi',
      sendMessage: async (m) => { sent.push(m); return { ok: true }; },
      onConnectExternal: { addListener: (f) => listeners.connectExternal.push(f) },
      onMessage: { addListener: (f) => listeners.message.push(f) },
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} }, local: { get: async () => ({}), set: async () => {} } },
    identity: { getRedirectURL: () => 'https://ihlieolhaepnpncmgebcejlabomnifmi.chromiumapp.org/', launchWebAuthFlow: async () => { if (!signedIn) throw new Error('not signed in'); return 'https://ihlieolhaepnpncmgebcejlabomnifmi.chromiumapp.org/#access_token=tok123&expires_in=3599'; } },
    offscreen: { hasDocument: async () => true, createDocument: async () => {} },
    downloads: {
      onCreated: { addListener: (f) => listeners.created.push(f) },
      cancel: async (id) => { cancelled.push(id); }, erase: async () => {},
      onDeterminingFilename: { addListener: (f) => listeners.determine.push(f) },
      onChanged: { addListener: (f) => listeners.changed.push(f) },
      search: async ({ id }) => (downloads.has(id) ? [downloads.get(id)] : []),
    },
    tabs: {
      create: async ({ url }) => { loadPage(url); return { id: 7 }; },
      remove: async () => {},
      // the old page keeps answering until the new one starts loading
      update: async (_id, { url }) => { const old = page; setTimeout(() => { if (page === old) loadPage(url); }, navDelay); },
      sendMessage: async (_id, msg) => {
        const p = page;
        if (!p.ready) throw new Error('Could not establish connection. Receiving end does not exist.');
        if (msg.type === 'hello') return { ok: true, signedOut: false, pageId: p.id, href: p.url };
        if (msg.type === 'runWindow') {
          await new Promise((r) => setTimeout(r, 300));
          if (page !== p) throw new Error(BFCACHE);   // swapped out while answering
          if (failFirstRunWindow && !failed) { failed = true; throw new Error(BFCACHE); }
          const time = p.url.split('/').pop();
          windowsRun.push(time);
          if (onRunWindow) await onRunWindow(time, { fromPage, startDownload, downloads });
          return { ok: true, pano: true, usageBefore: { used: 662, limit: 1800 }, clips: [], picked: [] };
        }
        return null;
      },
    },
  };

  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, URLSearchParams, Promise, Date, Math, Number, String, JSON, Map, Set, Object, Array, Error });
  ctx.self = ctx;
  ctx.importScripts = (path) => vm.runInContext(read(path), ctx);
  vm.runInContext(read('background.js'), ctx);

  function run(game, dryRun = true, drive = null) {
    return new Promise((resolve) => {
      const port = {
        sender: { origin: 'https://scalisec.github.io' },
        onMessage: { addListener: (f) => { port.send = f; } },
        onDisconnect: { addListener: () => {} },
        postMessage: (m) => { logs.push(m); if (m.type === 'done' || m.type === 'error') resolve(m); },
        disconnect: () => {},
      };
      listeners.connectExternal[0](port);
      port.send({ type: 'downloadGame', game, dryRun, drive });
    });
  }
  // the offscreen page reporting back to the background
  const fromOffscreen = (msg) => listeners.message.forEach((f) => f({ target: 'background', ...msg }, { id: 'ihlieolhaepnpncmgebcejlabomnifmi' }, () => {}));
  return { run, logs, windowsRun, downloads, sent, cancelled, fromOffscreen };
}

const GAME = { kid: 'Lucas', opponent: 'vs Woodstock Jr Navy Vets', surfaceId: '4334', date: '2026-11-07', start: '13:15', durationMin: 60, extraAfterMin: 0 };

test('moves to the next window only once the new LiveBarn page has loaded', async () => {
  const h = harness({ navDelay: 1200 });
  const end = await h.run(GAME);
  assert.equal(end.type, 'done', JSON.stringify(end));
  assert.deepEqual(h.windowsRun, ['13:00', '13:30', '14:00'], 'each window read once, on its own page');
});

test('if Chrome closes the channel mid-answer, that window is tried again once', async () => {
  const h = harness({ navDelay: 300, failFirstRunWindow: true });
  const end = await h.run(GAME);
  assert.equal(end.type, 'done', JSON.stringify(end));
  assert.ok(h.logs.some((m) => m.type === 'log' && /trying this window again/.test(m.text)));
  assert.deepEqual(h.windowsRun, ['13:00', '13:30', '14:00']);
});

test('the helper knows which errors mean the page went away', () => {
  const ctx = vm.createContext({ console });
  ctx.self = ctx;
  vm.runInContext(read('lib/plan.js'), ctx);
  const P = ctx.FWPPlan;
  assert.equal(P.isChannelClosed(new Error(BFCACHE)), true);
  assert.equal(P.isChannelClosed(new Error('Could not establish connection. Receiving end does not exist.')), true);
  assert.equal(P.isChannelClosed(new Error('Sign in to LiveBarn')), false);
});

test('waits while an earlier file sits on Chrome\'s Save As window, and says so', async () => {
  let waitedMs = 0;
  const h = harness({
    navDelay: 300,
    onRunWindow: async (time, api) => {
      if (time === '13:00') {
        await api.fromPage({ type: 'expectDownload', fileName: 'FamilyWatchParty/Lucas/x/x part 1 (1314).mp4', start: 794, part: 1 });
        assert.equal((await api.fromPage({ type: 'waitClear' })).ok, true, 'nothing waiting yet');
        const name = api.startDownload(1, { saveAs: true });
        assert.match(name, /part 1 \(1314\)\.mp4$/, 'still named by the helper');
        assert.equal((await api.fromPage({ type: 'waitStarted', start: 794 })).ok, true);
        // the person presses Save 2.5 seconds later
        setTimeout(() => { api.downloads.get(1).filename = 'C:/Downloads/FamilyWatchParty/x part 1 (1314).mp4'; }, 2500);
      }
      if (time === '13:30') {
        const t0 = Date.now();
        assert.equal((await api.fromPage({ type: 'waitClear' })).ok, true);
        waitedMs = Date.now() - t0;
      }
    },
  });
  const end = await h.run(GAME, false);
  assert.equal(end.type, 'done', JSON.stringify(end));
  assert.ok(waitedMs > 500, `the 13:30 click waited for the Save As window (${waitedMs} ms)`);
  assert.ok(h.logs.some((m) => m.type === 'log' && /asking where to save part 1/.test(m.text)), 'explains the Save As window');
});

const DRIVE = { gameId: 'lucas-2379430', folderPath: ['Family Hockey', 'Lucas', '2026-27 U10BB Bulldogs Blue', '2026-11-07 vs Woodstock Jr Navy Vets', 'full game'], view: 'PANO' };

test('Drive mode: cancels Chrome\'s copy and streams the LiveBarn file into the game\'s Drive folder', async () => {
  let h;
  h = harness({
    navDelay: 300, signedIn: true,
    onRunWindow: async (time, api) => {
      if (time !== '13:30') return;
      await api.fromPage({ type: 'expectDownload', fileName: 'FamilyWatchParty/Lucas/2026-11-07 vs Woodstock Jr Navy Vets/2026-11-07 vs Woodstock Jr Navy Vets part 1 (1330).mp4', start: 810, part: 1 });
      api.startDownload(5, { saveAs: true });
      assert.equal((await api.fromPage({ type: 'waitStarted', start: 810 })).ok, true);
    },
  });
  const end = await h.run(GAME, false, DRIVE);
  assert.equal(end.type, 'done', JSON.stringify(end));
  assert.deepEqual(h.cancelled, [5], "Chrome's own download is cancelled, so no Save As and nothing in Downloads");
  const t = h.sent.find((m) => m.target === 'offscreen' && m.type === 'transfer');
  assert.ok(t, 'handed to the offscreen page');
  assert.equal(t.name, '2026-11-07 vs Woodstock Jr Navy Vets part 1 (1330) PANO.mp4');
  assert.deepEqual(t.folderPath, DRIVE.folderPath);
  assert.equal(t.note.gameId, 'lucas-2379430');
  assert.equal(t.note.startSec, 13 * 3600 + 30 * 60 + 2, 'exact start from LiveBarn\'s file name');
  assert.equal(t.note.original.name, 'Appleby_Ice_Centre_2026-11-07T133002.mp4');
  h.fromOffscreen({ type: 'transfer', id: 5, state: 'done', driveId: 'D1', size: 123, name: t.name });
  assert.ok(h.logs.some((m) => m.type === 'transfer' && m.state === 'done' && m.driveId === 'D1'), 'the app hears when it is in Drive');
  assert.ok(h.logs.some((m) => m.type === 'done' && /straight into Google Drive/.test(m.message)));
});

test('Drive mode needs the helper connected to Google, and a Family Hockey folder', async () => {
  const h = harness({ navDelay: 300, signedIn: false });
  const end = await h.run(GAME, false, DRIVE);
  assert.equal(end.type, 'error');
  assert.equal(end.code, 'google');
  const h2 = harness({ navDelay: 300, signedIn: true });
  const bad = await h2.run(GAME, false, { ...DRIVE, folderPath: ['Somewhere else'] });
  assert.equal(bad.code, 'invalid');
});
