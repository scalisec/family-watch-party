// Family Watch Party helper — runs on watch.livebarn.com.
// Uses LiveBarn's own buttons: switches to PANO, opens Download › 30 minute clip,
// reads the list, and clicks only the files that overlap the game. Never clicks a file twice.
(function () {
  'use strict';
  const P = self.FWPPlan;
  // A new ID each time a LiveBarn page loads, so the helper can tell the next window's page from the last one.
  const PAGE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const log = (text) => { try { chrome.runtime.sendMessage({ type: 'log', text }); } catch { /* ignore */ } };
  const ask = (msg) => chrome.runtime.sendMessage(msg);
  const textOf = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();

  async function waitFor(find, ms = 10000, step = 250) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const found = find();
      if (found) return found;
      await sleep(step);
    }
    return null;
  }

  // One click, with the pointer events a real click sends first.
  function realClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  const buttonByText = (words) => [...document.querySelectorAll('button')].find((b) => textOf(b) === words);
  const panoButton = () => document.querySelector('button[aria-label="Panoramic"]');
  const downloadButton = () => buttonByText('Download');
  const menuItem30 = () => {
    const el = [...document.querySelectorAll('[role="menuitem"], li, div, span')]
      .find((e) => textOf(e) === 'Download 30 minute clip' && e.children.length <= 1);
    return el ? (el.closest('[role="menuitem"]') || el) : null;
  };
  const usageEl = () => [...document.querySelectorAll('div, p, span')]
    .find((e) => /^Download usage:/i.test(textOf(e)) && e.children.length <= 2);
  const mediaLinks = () => [...document.querySelectorAll('a[href]')].filter((a) => P.isLiveBarnMedia(a.href));
  const signedOut = () => /\/signin/.test(location.pathname);

  function readList() {
    const usage = P.parseUsage(textOf(usageEl()));
    const rows = mediaLinks().map((a) => {
      let row = a.parentElement;
      for (let i = 0; i < 6 && row && !/Clip\s*\d+/i.test(textOf(row)); i += 1) row = row.parentElement;
      const clip = row ? P.parseClipRow(textOf(row)) : null;
      return clip ? { ...clip, link: a, pano: P.isPanoHref(a.href) } : null;
    }).filter(Boolean);
    return { usage, rows };
  }

  async function closeList() {
    const close = buttonByText('Done') || buttonByText('DONE') || buttonByText('Cancel') || buttonByText('CANCEL');
    if (close) realClick(close);
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !usageEl(), 4000);
  }

  async function openList() {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const btn = await waitFor(downloadButton, 15000);
      if (!btn) return false;
      realClick(btn);
      const item = await waitFor(menuItem30, 5000);
      if (item) {
        realClick(item);
        if (await waitFor(usageEl, 10000)) {
          await waitFor(() => {
            const u = usageEl();
            return mediaLinks().length > 0 || (u && /no video|0 minutes/i.test(textOf(u.parentElement)));
          }, 5000);
          return true;
        }
      }
      log(`The download list didn't open (try ${attempt} of 2).`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(1000);
    }
    return false;
  }

  async function selectPano() {
    const btn = await waitFor(panoButton, 8000);
    if (!btn) return false;
    realClick(btn);
    await sleep(3000);
    return true;
  }

  async function runWindow(msg) {
    const { game, dryRun, taken, firstPart } = msg;
    if (signedOut()) return { ok: false, code: 'signin', message: 'Sign in to LiveBarn in this Chrome window, then try again.' };

    const hasPano = await selectPano();
    if (!hasPano && !game.allowAuto) {
      return { ok: false, code: 'nopano', message: 'This rink has no PANO view on LiveBarn. Nothing was downloaded.' };
    }

    if (!(await openList())) return { ok: false, code: 'nolist', message: "LiveBarn's download list didn't open. Nothing was downloaded." };
    let list = readList();

    if (hasPano && list.rows.some((r) => !r.pano)) {
      log('The list showed AUTO files; switching to PANO again.');
      await closeList();
      await selectPano();
      if (!(await openList())) return { ok: false, code: 'nolist', message: "LiveBarn's download list didn't open. Nothing was downloaded." };
      list = readList();
      if (list.rows.some((r) => !r.pano)) {
        await closeList();
        return { ok: false, code: 'pano', message: "LiveBarn kept offering AUTO files instead of PANO. Nothing was downloaded." };
      }
    }

    const clips = list.rows.map(({ link, ...c }) => c);
    const picked = P.clipsToDownload(list.rows, game, taken);
    const summary = picked.map((c) => c.label).join(', ') || 'none';
    log(`Files in this window: ${clips.length}. Overlapping the game: ${summary}.`);

    if (dryRun || picked.length === 0) {
      await closeList();
      return { ok: true, pano: hasPano, usageBefore: list.usage, clips, picked: picked.map(({ link, ...c }) => c) };
    }

    const needed = picked.reduce((s, c) => s + c.minutes, 0);
    if (list.usage && list.usage.used + needed > list.usage.limit) {
      await closeList();
      return { ok: false, code: 'quota', message: `Not enough LiveBarn minutes left: ${list.usage.limit - list.usage.used} left, ${needed} needed.` };
    }

    const done = [];
    let part = firstPart;
    for (const clip of picked) {
      const fileName = P.fileNameFor(game, clip, part);
      await ask({ type: 'expectDownload', fileName, start: clip.start, part });
      log(`Downloading ${clip.label} (${clip.minutes} min).`);
      realClick(clip.link);
      const started = await ask({ type: 'waitStarted', start: clip.start });
      if (!started || !started.ok) {
        await closeList();
        return { ok: false, code: 'nostart', message: `The download for ${clip.label} didn't start. Stopped here so nothing is charged twice; check LiveBarn's download usage before trying again.`, picked: done };
      }
      const { link, ...plain } = clip;
      done.push(plain);
      part += 1;
      await sleep(1500);
    }

    await sleep(2000);
    const usageAfter = P.parseUsage(textOf(usageEl()));
    await closeList();
    return { ok: true, pano: hasPano, usageBefore: list.usage, usageAfter, clips, picked: done };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'hello') {
      sendResponse({ ok: true, signedOut: signedOut(), pageId: PAGE_ID, href: location.href });
      return false;
    }
    if (msg && msg.type === 'runWindow') {
      runWindow(msg).then(sendResponse, (err) => sendResponse({ ok: false, code: 'page', message: String(err && err.message || err) }));
      return true;
    }
    return false;
  });
})();
