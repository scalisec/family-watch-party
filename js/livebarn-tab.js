// One LiveBarn tab for the whole app. Every open LiveBarn tab plays a stream, and the LiveBarn account allows 2 at a
// time, so all "Open in LiveBarn" buttons reuse the same named tab, and "Close the LiveBarn tab" closes it.
// The tab keeps its link to this app (Chrome forgets a tab's name, and the app could no longer find or close it, if
// that link is cut). LiveBarn's page could in theory send this tab elsewhere; the app holds no passwords on its pages.
import { readSaved, save } from './ui.js';

const NAME = 'fwp-livebarn';
const KEY = 'fwp.livebarnTab';
let handle = null;
const listeners = new Set();

export function onLiveBarnTabChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed(open) { save(KEY, open ? Date.now() : 0); for (const fn of listeners) { try { fn(open); } catch { /* a page's problem */ } } }

/** True while the app's LiveBarn tab is (probably) open. */
export function liveBarnTabOpen() {
  if (handle) {
    if (!handle.closed) return true;
    handle = null;
    changed(false);
    return false;
  }
  return Boolean(Number(readSaved(KEY, 0)));
}

/** Opens url in the app's LiveBarn tab (the same tab every time). Call it from a click. */
export function openLiveBarn(url) {
  let w = handle && !handle.closed ? handle : null;
  if (!w) {
    w = window.open('', NAME);              // the tab from an earlier page, or a new blank one
    if (!w) { window.open(url, '_blank', 'noopener'); return; }   // pop-ups blocked: a plain new tab
  }
  try { w.location.href = url; } catch { w = window.open(url, NAME); }
  handle = w;
  try { w.focus(); } catch { /* fine */ }
  changed(true);
}

/** Closes the app's LiveBarn tab, freeing its stream. Downloads Chrome already started carry on. */
export function closeLiveBarn() {
  let w = handle && !handle.closed ? handle : null;
  if (!w && Number(readSaved(KEY, 0))) w = window.open('', NAME);   // opened from another page of the app
  try { if (w) w.close(); } catch { /* fine */ }
  handle = null;
  changed(false);
}

/** An "Open in LiveBarn" link that uses the shared tab (a normal link still works with a middle-click). */
export function liveBarnLink(h, url, attrs = {}, text = 'Open in LiveBarn ↗') {
  return h('a', {
    ...attrs, href: url, target: NAME, rel: 'noopener',
    onclick: (e) => {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      if (attrs.onclick) attrs.onclick(e);
      openLiveBarn(url);
    },
  }, text);
}

window.addEventListener('focus', () => { liveBarnTabOpen(); });
