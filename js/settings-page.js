// Settings: Google account, Drive, download choices, teams, and resetting this browser.
import { TEAMS, DATA_BASE } from './config.js';
import { $, h, toast, formatBytes, readSaved, save, driveFolderLink } from './ui.js';
import { isConnected, accountEmail, disconnect } from './google.js';
import { setupHeader } from './header.js';
import { cachedRecord, loadGoogle } from './data.js';
import { totals } from './library.js';
import { VERSION, RELEASES, compareVersions, latestVersion, releaseDate } from './version.js';
import { platform, canPrompt, onInstallChange, promptInstall } from './install.js';
import { loadLibrary, saveLibrary } from './drive.js';
import { cacheRecord } from './data.js';
import { hasBook, bookState, cached, syncBook, pickBook, pickerReady, forgetBook, kidNumber, rememberKidNumber, bookName, onBookChange } from './game-book.js';


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
    bookRecord = out.library.record;
    paintTotals(out.library.record);
    $('folderLink').href = driveFolderLink(out.library.rootId);
    $('folderLink').hidden = false;
  }
  paintGoogle();
  paintBooks();
  syncBooks();
}

function setupTeams() {
  $('teamList').replaceChildren(...TEAMS.map((t) => h('li', {},
    t.logo ? h('img', { class: 'logo', src: DATA_BASE + t.logo, alt: '' }) : null,
    h('span', {},
      h('strong', {}, `${t.kid} · ${t.season} ${t.label}`),
      h('span', { class: 'small muted block' }, `League schedule: ${t.feedName}`),
      h('span', { class: 'small muted block' }, `TeamSnap calendar: ${t.calendarName}`)))));
}

// ---------- Game Book: the kids' numbers and where each team's book is ----------
let bookRecord = null;
function bookLine(t) {
  const s = cached(t.key);
  const state = bookState(t.key);
  if (state === 'connect') return t.gameBook.shared ? 'The coaches’ Game Book in the Bulldogs team folder. Connect Google to open it.' : 'Kept in your Family Hockey folder. Connect Google to open it.';
  if (state === 'pick') return `The coaches’ Game Book in the Bulldogs team folder. Connect it once a season: Google’s file picker opens, tap “${bookName(t)}”, then Select.`;
  if (s.err) return `Couldn’t reach it in Drive: ${s.err}`;
  const games = s.book ? Object.keys(s.book.games || {}).length : 0;
  const where = t.gameBook.shared ? 'Shared with the Bulldogs coaches' : 'In your Family Hockey folder';
  return `${where} · ${s.name || bookName(t)}${games ? ` · ${games} game${games === 1 ? '' : 's'}` : ''}${s.dirty ? ' · changes waiting to go to Drive' : ''}`;
}

function paintBooks() {
  $('bookList').replaceChildren(...TEAMS.filter(hasBook).map((t) => {
    const input = h('input', { class: 'kid-number', type: 'text', inputmode: 'numeric', maxlength: '3', id: `num-${t.key}`, value: kidNumber(t.key, bookRecord || cachedRecord()), 'aria-describedby': `numnote-${t.key}` });
    input.addEventListener('change', () => saveNumber(t, input.value));
    const actions = [];
    const state = bookState(t.key);
    if (t.gameBook.shared && state === 'pick' && pickerReady()) actions.push(h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => pick(t) }, 'Connect the Bulldogs Game Book'));
    if (t.gameBook.shared && state === 'ready' && cached(t.key).fileId) actions.push(h('button', { class: 'btn btn-small', type: 'button', onclick: () => { forgetBook(t.key); paintBooks(); } }, 'Pick a different file'));
    return h('li', {},
      h('span', {},
        h('strong', {}, `${t.kid} · ${t.gameBook.team}`),
        h('span', { class: 'small muted block' }, bookLine(t)),
        h('label', { class: 'row', for: `num-${t.key}` }, `${t.kid}’s jersey number`, input),
        h('span', { class: 'small muted block', id: `numnote-${t.key}` }, `Used to show ${t.kid}’s goals, assists and points. Saved in your Family Hockey folder, not in the Game Book.`),
        actions.length ? h('span', { class: 'row' }, ...actions) : null));
  }));
}

async function saveNumber(t, value) {
  const number = rememberKidNumber(t.key, value);
  $(`num-${t.key}`).value = number;
  if (!isConnected()) { toast(`Saved on this device. Connect Google to save ${t.kid}’s number for your other devices too.`); return; }
  try {
    const lib = await loadLibrary();
    const kids = { ...(lib.record.kids || {}) };
    kids[t.key] = { number };
    const saved = await saveLibrary({ ...lib, record: { ...lib.record, kids } });
    bookRecord = saved.record;
    cacheRecord(saved.record);
    toast(`Saved ${t.kid}’s number.`);
  } catch (e) { toast(`Saved on this device; couldn’t save it to Drive: ${e.message}`, 7000); }
}

async function pick(t) {
  try {
    const picked = await pickBook(t.key);
    if (!picked) { toast('Nothing picked. Open the Bulldogs team folder in the picker and tap the Game Book file.', 7000); return; }
    toast(`Connected: ${picked.name}`);
    await syncBook(t.key);
  } catch (e) { toast(e.message, 8000); }
  paintBooks();
}

async function syncBooks() {
  for (const t of TEAMS.filter(hasBook)) { try { await syncBook(t.key); } catch { /* shown in the line */ } }
  paintBooks();
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
  setupTeams();
  paintBooks();
  onBookChange(paintBooks);
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
  if (isConnected()) await onConnected();
}

if (typeof document !== 'undefined' && document.getElementById('teamList')) start();
