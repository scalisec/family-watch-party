// Settings: Google account, Drive, download choices, teams, helper, and resetting this browser.
import { TEAMS, DATA_BASE } from './config.js';
import { $, h, toast, formatBytes, readSaved, save, driveFolderLink } from './ui.js';
import { isConnected, accountEmail, disconnect } from './google.js';
import { setupHeader } from './header.js';
import { cachedRecord, loadGoogle } from './data.js';
import { totals } from './library.js';
import { pingHelper } from './helper-client.js';

export const DEFAULT_VIEW_KEY = 'fwp.defaultView';
export function defaultView() { return readSaved(DEFAULT_VIEW_KEY, 'PANO') === 'AUTO' ? 'AUTO' : 'PANO'; }

function paintGoogle() {
  const on = isConnected();
  $('googleStatus').textContent = on
    ? `Connected${accountEmail() ? ` as ${accountEmail()}` : ''}. You stay connected in this tab for about an hour at a time.`
    : 'Not connected. Press Connect Google at the top.';
  $('signOut').hidden = !on;
}

function paintTotals(record) {
  const t = totals(record);
  $('familyTotals').textContent = t.games || t.clips
    ? `Family Hockey: ${t.games} game${t.games === 1 ? '' : 's'}, ${t.clips} clip${t.clips === 1 ? '' : 's'}, ${formatBytes(t.bytes)}`
    : '';
}

async function onConnected() {
  paintGoogle();
  $('driveStatus').textContent = 'Loading…';
  const out = await loadGoogle();
  if (!out) return;
  const q = out.about && out.about.storageQuota;
  if (q && Number(q.limit)) {
    const used = Number(q.usage);
    const limit = Number(q.limit);
    $('driveStatus').textContent = `${formatBytes(used)} of ${formatBytes(limit)} used (${Math.round((used / limit) * 100)}%) across your whole Google account.`;
    $('driveBar').style.width = `${Math.min(100, (used / limit) * 100)}%`;
    $('driveMeter').hidden = false;
  } else {
    $('driveStatus').textContent = out.problems.length ? out.problems.join(' ') : 'Connected.';
  }
  if (out.library) {
    paintTotals(out.library.record);
    $('folderLink').href = driveFolderLink(out.library.rootId);
    $('folderLink').hidden = false;
  }
  paintGoogle();
}

function setupView() {
  const current = defaultView();
  for (const input of document.querySelectorAll('input[name="view"]')) {
    input.checked = input.value === current;
    input.addEventListener('change', () => {
      save(DEFAULT_VIEW_KEY, input.value);
      $('viewNote').textContent = `Saved. Downloads will use ${input.value}. (Importing works with either; the app tells PANO and AUTO apart by the picture size.)`;
    });
  }
}

function setupTeams() {
  $('teamList').replaceChildren(...TEAMS.map((t) => h('li', {},
    t.logo ? h('img', { class: 'logo', src: DATA_BASE + t.logo, alt: '' }) : null,
    h('span', {},
      h('strong', {}, `${t.kid} · ${t.season} ${t.label}`),
      h('span', { class: 'small muted block' }, `League schedule: ${t.feedName}`),
      h('span', { class: 'small muted block' }, `TeamSnap calendar: ${t.calendarName}`)))));
}

function setupReset() {
  let armed = false;
  let timer = null;
  $('resetBtn').addEventListener('click', () => {
    if (!armed) {
      armed = true;
      $('resetBtn').textContent = 'Press again to reset';
      $('resetNote').textContent = 'This clears what this browser remembers. Drive is not touched.';
      timer = setTimeout(() => { armed = false; $('resetBtn').textContent = 'Reset saved info'; $('resetNote').textContent = ''; }, 6000);
      return;
    }
    clearTimeout(timer);
    if (isConnected()) disconnect();
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('fwp.')) localStorage.removeItem(key);
      for (const key of Object.keys(sessionStorage)) if (key.startsWith('fwp.')) sessionStorage.removeItem(key);
    } catch { /* fine */ }
    armed = false;
    $('resetBtn').textContent = 'Reset saved info';
    $('resetNote').textContent = 'Done. This browser starts fresh; your files in Drive are unchanged.';
    setupView();
    paintGoogle();
    paintTotals(cachedRecord());
  });
}

async function start() {
  setupHeader(onConnected);
  setupView();
  setupTeams();
  setupReset();
  paintGoogle();
  paintTotals(cachedRecord());
  $('version').textContent = `Version ${document.querySelector('.byline').textContent.split('·').pop().trim().replace(/^V/, '')}`;
  $('signOut').addEventListener('click', () => {
    disconnect();
    paintGoogle();
    $('driveStatus').textContent = 'Signed out here. Connect Google to see your Family Hockey folder.';
    $('driveMeter').hidden = true;
    $('folderLink').hidden = true;
    toast('Signed out of Google in this app.');
  });
  pingHelper().then((version) => {
    $('helperStatus').textContent = version
      ? `Installed in this browser (version ${version}).`
      : 'Not found in this browser. It only runs in Chrome on your PC, after loading it in Developer mode.';
  });
  if (isConnected()) await onConnected();
}

if (typeof document !== 'undefined' && document.getElementById('teamList')) start();
