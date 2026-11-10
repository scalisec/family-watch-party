// Runs the helper's background worker against a pretend Chrome and LiveBarn tab, to check how it moves
// between 30-minute windows. Recreates the Nov 9 dry run failure: right after the helper sends the tab to
// the next window, the old page still answers for a moment and is then swapped out mid-answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');
const BFCACHE = 'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.';

function harness({ navDelay = 1200, failFirstRunWindow = false } = {}) {
  const logs = [];
  const windowsRun = [];
  let page = null;          // { id, url, ready }
  let pages = 0;
  let failed = false;
  const listeners = { connectExternal: [], message: [], determine: [], changed: [] };

  function loadPage(url) {
    page = { id: `page-${++pages}`, url, ready: false };
    const p = page;
    setTimeout(() => { p.ready = true; }, 200);
  }

  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.1.1' }),
      onConnectExternal: { addListener: (f) => listeners.connectExternal.push(f) },
      onMessage: { addListener: (f) => listeners.message.push(f) },
    },
    downloads: {
      onDeterminingFilename: { addListener: (f) => listeners.determine.push(f) },
      onChanged: { addListener: (f) => listeners.changed.push(f) },
      search: async () => [],
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
          return { ok: true, pano: true, usageBefore: { used: 662, limit: 1800 }, clips: [], picked: [] };
        }
        return null;
      },
    },
  };

  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, Promise, Date, Math, Number, String, JSON, Map, Set, Object, Array, Error });
  ctx.self = ctx;
  ctx.importScripts = (path) => vm.runInContext(read(path), ctx);
  vm.runInContext(read('background.js'), ctx);

  function run(game, dryRun = true) {
    return new Promise((resolve) => {
      const port = {
        sender: { origin: 'https://scalisec.github.io' },
        onMessage: { addListener: (f) => { port.send = f; } },
        onDisconnect: { addListener: () => {} },
        postMessage: (m) => { logs.push(m); if (m.type === 'done' || m.type === 'error') resolve(m); },
        disconnect: () => {},
      };
      listeners.connectExternal[0](port);
      port.send({ type: 'downloadGame', game, dryRun });
    });
  }
  return { run, logs, windowsRun };
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
