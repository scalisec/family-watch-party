import { connectHelper, pingHelper, helperAvailable, helperOutdated, MIN_HELPER, HELPER_UPDATE_STEPS, HELPER_INSTALL_STEPS } from './helper-client.js';
import { TEAMS } from './config.js';
import { loadLeague, cachedTeamSnap, cachedRecord, combine } from './data.js';
import { dayLabel, timeLabel } from './games.js';
import { withRinks } from './rinks.js';
import { folderPath } from './library.js';
import { readSaved } from './ui.js';

let games = [];
let picked = null;
const defaultView = () => (readSaved('fwp.defaultView', 'PANO') === 'AUTO' ? 'AUTO' : 'PANO');

const $ = (id) => document.getElementById(id);
let port = null;
let running = false;

function addLog(text, kind = '') {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const span = document.createElement('span');
  span.textContent = text;
  if (kind) span.className = kind;
  li.append(time, span);
  $('log').append(li);
  li.scrollIntoView({ block: 'nearest' });
}

function setConn(state, text) {
  const pill = $('connPill');
  pill.className = `pill ${state === 'ok' ? 'pill-good' : state === 'bad' ? 'pill-bad' : 'pill-info'}`;
  pill.textContent = state === 'ok' ? '● Connected' : state === 'bad' ? 'Not found' : 'Checking…';
  $('connText').textContent = text;
  $('run').disabled = state !== 'ok' || running;
}

async function check() {
  setConn('wait', 'Looking for the helper in this browser.');
  if (!helperAvailable()) {
    setConn('bad', `The helper isn't installed in this Chrome profile, or it's switched off. ${HELPER_INSTALL_STEPS}`);
    $('googleText').textContent = 'Needs the helper first.';
    return;
  }
  const version = await pingHelper();
  if (!version || helperOutdated(version)) $('googleText').textContent = 'Needs the helper (version 0.2.0 or newer) first.';
  if (version && helperOutdated(version)) { setConn('bad', `Helper ${version} is installed but out of date (this app needs ${MIN_HELPER} or newer). ${HELPER_UPDATE_STEPS}`); return; }
  if (version) { setConn('ok', `Helper version ${version} is installed and answering.`); askGoogle(); }
  else setConn('bad', 'The helper isn\'t answering. Check it is installed and switched on at chrome://extensions, then press Check again.');
}

function updateRunLabel() {
  $('run').textContent = $('dryRun').checked ? 'Run dry run' : 'Download for real';
  $('run').classList.toggle('btn-primary', true);
}

// ---------- the helper's own Google connection ----------
function askGoogle() {
  const p = connectHelper((msg) => {
    if (msg.type === 'google') {
      $('googleText').textContent = msg.connected
        ? 'Connected: files can go straight into Drive.'
        : msg.everConnected ? 'Connected before, but Google needs you again (sign in to Google in this Chrome, or press Connect).' : 'Not connected yet. Connect once so files can go straight into Drive.';
      $('connectGoogle').hidden = msg.connected;
      $('connectGoogle').disabled = false;
      try { p.disconnect(); } catch { /* fine */ }
    }
    if (msg.type === 'error') { $('googleText').textContent = msg.message; $('connectGoogle').disabled = false; }
  });
  if (p) p.postMessage({ type: 'googleStatus' });
}
$('connectGoogle').addEventListener('click', () => {
  $('connectGoogle').disabled = true;
  $('googleText').textContent = 'A Google window opens: pick your account and allow Family Watch Party.';
  const p = connectHelper((msg) => {
    if (msg.type === 'google' || msg.type === 'error') {
      if (msg.type === 'google') {
        $('googleText').textContent = msg.connected ? 'Connected: files can go straight into Drive.' : 'Not connected. Try again.';
        $('connectGoogle').hidden = msg.connected;
      } else $('googleText').textContent = msg.message;
      $('connectGoogle').disabled = false;
      try { p.disconnect(); } catch { /* fine */ }
    }
  });
  if (p) p.postMessage({ type: 'connectGoogle' });
});

// ---------- picking the game ----------
async function loadGames() {
  try {
    const league = await loadLeague();
    const now = Date.now();
    games = withRinks(combine(league.games, cachedTeamSnap()), cachedRecord())
      .filter((g) => g.liveBarn && g.startMs < now && now - g.startMs < 31 * 86400000)
      .sort((a, b) => b.startMs - a.startMs);
    $('gamePick').replaceChildren(
      new Option(games.length ? 'Pick a game (fills in the form)…' : 'No played games with a LiveBarn rink in the last 30 days', ''),
      ...games.map((g) => new Option(`${dayLabel(g.date)} · ${timeLabel(g.time)} · ${g.kid} · ${g.opponentLabel}`, g.id)));
  } catch {
    $('gamePick').replaceChildren(new Option("Couldn't load the games; fill in the form below", ''));
  }
}
$('gamePick').addEventListener('change', () => {
  picked = games.find((g) => g.id === $('gamePick').value) || null;
  if (!picked) return;
  $('kid').value = picked.kid;
  $('opponent').value = picked.opponentLabel;
  $('surfaceId').value = picked.liveBarn.surfaceId;
  $('date').value = picked.date;
  $('start').value = picked.time.padStart(5, '0');
});

function driveFor() {
  if (!$('toDrive').checked || !picked) return null;
  const team = TEAMS.find((t) => t.key === picked.teamKey);
  return { gameId: picked.id, folderPath: folderPath(picked, team, 'full'), view: defaultView() };
}

function gameFromForm() {
  return {
    kid: $('kid').value,
    opponent: $('opponent').value.trim(),
    surfaceId: $('surfaceId').value.trim(),
    date: $('date').value,
    start: $('start').value,
    durationMin: Number($('durationMin').value),
    extraAfterMin: Number($('extraAfterMin').value),
  };
}

function usageText(u) {
  return u ? `LiveBarn minutes used: ${u.used} of ${u.limit}` : '';
}

function onEvent(msg) {
  switch (msg.type) {
    case 'log': addLog(msg.text); break;
    case 'window': {
      const picked = msg.picked.map((c) => c.label).join(', ') || 'none';
      addLog(`${msg.windowStart} window: ${msg.files.length} file(s) listed; taking ${picked}.${msg.pano ? '' : ' (AUTO view)'}`);
      $('usage').textContent = usageText(msg.usage);
      break;
    }
    case 'transfer':
      if (msg.state === 'progress' && msg.total) $('usage').textContent = `Part ${msg.part}: ${Math.round((msg.sent || 0) / 1048576)} of ${Math.round(msg.total / 1048576)} MB in Drive`;
      else if (msg.state === 'done') addLog(`Part ${msg.part} is in Drive (${Math.round((msg.size || 0) / 1048576)} MB): ${msg.name}. Open the game in the app to mark and save it.`, 'ok');
      else if (msg.state === 'error') addLog(`Part ${msg.part} didn't reach Drive: ${msg.message}`, 'err');
      break;
    case 'download':
      if (msg.state === 'started' && msg.toDrive) addLog(`Part ${msg.part} started, going straight into Drive: ${msg.fileName}`, 'ok');
      else if (msg.state === 'started') addLog(`Part ${msg.part} started: ${msg.fileName}`, 'ok');
      else if (msg.state === 'complete') addLog(`Part ${msg.part} finished${msg.bytes ? ` (${Math.round(msg.bytes / 1048576)} MB)` : ''}.`, 'ok');
      else addLog(`Part ${msg.part} stopped: ${msg.error || 'interrupted'}. Check Chrome's downloads.`, 'err');
      break;
    case 'done':
      addLog(msg.message, 'ok');
      if (msg.usageStart && msg.usageEnd && !msg.dryRun) addLog(`Minutes used went from ${msg.usageStart.used} to ${msg.usageEnd.used}.`);
      finish();
      break;
    case 'error':
      addLog(msg.message, 'err');
      finish();
      break;
    case 'disconnected':
      if (running) { addLog('Lost contact with the helper. Downloads already started carry on in Chrome.', 'warn'); finish(); }
      break;
    default: break;
  }
}

function finish() {
  running = false;
  $('run').disabled = false;
}

$('run').addEventListener('click', () => {
  const dryRun = $('dryRun').checked;
  if (!dryRun && !confirm('This downloads the game for real and uses LiveBarn minutes. Go ahead?')) return;
  if (port) { try { port.disconnect(); } catch { /* ignore */ } }
  port = connectHelper(onEvent);
  if (!port) { setConn('bad', 'Couldn\'t reach the helper.'); return; }
  const drive = driveFor();
  if (!dryRun && $('toDrive').checked && !drive) { addLog('Pick the game from the list at the top so the files can go into its Drive folder, or untick Save straight to Google Drive.', 'err'); return; }
  running = true;
  $('run').disabled = true;
  $('log').replaceChildren();
  const game = gameFromForm();
  addLog(`Sending ${game.kid}'s game ${game.opponent} on ${game.date} at ${game.start}${dryRun ? ' as a dry run' : drive ? ', straight into Drive' : ''}.`);
  port.postMessage({ type: 'downloadGame', game, dryRun, drive });
});

$('dryRun').addEventListener('change', updateRunLabel);
$('recheck').addEventListener('click', check);
updateRunLabel();
check();
loadGames();
