// Settings: Google account, Drive, download choices, teams, helper, and resetting this browser.
import { TEAMS, DATA_BASE } from './config.js';
import { $, h, toast, formatBytes, readSaved, save, driveFolderLink } from './ui.js';
import { isConnected, accountEmail, disconnect } from './google.js';
import { setupHeader } from './header.js';
import { cachedRecord, loadGoogle } from './data.js';
import { totals } from './library.js';
import { pingHelper, helperOutdated, MIN_HELPER, HELPER_UPDATE_STEPS } from './helper-client.js';
import { VERSION, RELEASES, compareVersions, latestVersion, releaseDate } from './version.js';
import { platform, canPrompt, onInstallChange, promptInstall } from './install.js';

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

// ---------- install ----------
function setupInstall() {
  const paint = () => {
    const p = platform();
    const steps = [];
    let status;
    $('installBtn').hidden = true;
    if (p.standalone) status = 'Installed. You\'re using the app in its own window.';
    else if (canPrompt()) { status = 'Add Family Watch Party to your PC or phone, with its own icon and window.'; $('installBtn').hidden = false; }
    else if (p.iOS) {
      status = 'On iPhone and iPad, install from Safari:';
      steps.push('Tap the Share button (the square with an arrow).', 'Tap Add to Home Screen, then Add.');
    } else if (p.android) {
      status = p.installedBefore ? 'It looks like the app is already installed. Open it from your home screen.' : 'Install from the browser menu:';
      if (!p.installedBefore) steps.push(p.samsung ? 'Tap the menu (☰), then Add page to → Home screen.' : 'Tap the menu (⋮) at the top right.', 'Tap Install app or Add to Home screen.');
    } else {
      status = p.installedBefore ? 'It looks like the app is already installed on this PC. Open it from the Start menu or desktop.' : 'Install from Chrome or Edge:';
      if (!p.installedBefore) steps.push('Click the install icon at the right end of the address bar (a screen with a down arrow).', 'Or open the menu (⋮) → Cast, save and share → Install page as app.');
    }
    $('installStatus').textContent = status;
    $('installSteps').replaceChildren(...steps.map((t) => h('li', {}, t)));
    $('installSteps').hidden = !steps.length;
  };
  $('installBtn').addEventListener('click', async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast('Installed. Look for Family Watch Party on your desktop or home screen.');
    paint();
  });
  onInstallChange(paint);
  paint();
}

// ---------- version ----------
function setupVersion() {
  const current = RELEASES.find((r) => r.version === VERSION);
  $('versionNow').textContent = `Version ${VERSION}`;
  $('versionDate').textContent = current ? `· released ${releaseDate(current.date)}` : '';
  $('releaseList').replaceChildren(...RELEASES.map((r) => h('li', {},
    h('div', { class: 'release-head' }, h('strong', {}, `Version ${r.version}`), h('span', { class: 'small muted' }, releaseDate(r.date))),
    h('ul', {}, ...r.notes.map((n) => h('li', { class: 'small' }, n))))));
  $('updateBtn').addEventListener('click', async () => {
    $('updateBtn').disabled = true;
    $('updateNote').textContent = 'Checking…';
    try {
      const latest = await latestVersion();
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.update().catch(() => {});
      if (compareVersions(latest, VERSION) > 0) {
        $('updateNote').textContent = `Version ${latest} is available.`;
        $('reloadBtn').hidden = false;
      } else {
        $('updateNote').textContent = `You're on the latest version (${VERSION}).`;
      }
    } catch (err) {
      $('updateNote').textContent = `Couldn't check right now: ${err.message}`;
    } finally {
      $('updateBtn').disabled = false;
    }
  });
  $('reloadBtn').addEventListener('click', () => location.reload());
}

async function start() {
  setupHeader(onConnected);
  setupView();
  setupTeams();
  setupReset();
  paintGoogle();
  paintTotals(cachedRecord());
  setupInstall();
  setupVersion();
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
      ? (helperOutdated(version) ? `Version ${version} is installed but out of date (needs ${MIN_HELPER}). ${HELPER_UPDATE_STEPS}` : `Installed in this browser (version ${version}).`)
      : 'Not found in this browser. It only runs in Chrome on your PC, after loading it in Developer mode.';
  });
  if (isConnected()) await onConnected();
}

if (typeof document !== 'undefined' && document.getElementById('teamList')) start();
