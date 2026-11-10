import { connectHelper, pingHelper, helperAvailable, helperOutdated, MIN_HELPER, HELPER_UPDATE_STEPS, HELPER_INSTALL_STEPS } from './helper-client.js';

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
    return;
  }
  const version = await pingHelper();
  if (version && helperOutdated(version)) { setConn('bad', `Helper ${version} is installed but out of date (this app needs ${MIN_HELPER} or newer). ${HELPER_UPDATE_STEPS}`); return; }
  if (version) setConn('ok', `Helper version ${version} is installed and answering.`);
  else setConn('bad', 'The helper isn\'t answering. Check it is installed and switched on at chrome://extensions, then press Check again.');
}

function updateRunLabel() {
  $('run').textContent = $('dryRun').checked ? 'Run dry run' : 'Download for real';
  $('run').classList.toggle('btn-primary', true);
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
    case 'download':
      if (msg.state === 'started') addLog(`Part ${msg.part} started: ${msg.fileName}`, 'ok');
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
  running = true;
  $('run').disabled = true;
  $('log').innerHTML = '';
  const game = gameFromForm();
  addLog(`Sending ${game.kid}'s game ${game.opponent} on ${game.date} at ${game.start}${dryRun ? ' as a dry run' : ''}.`);
  port.postMessage({ type: 'downloadGame', game, dryRun });
});

$('dryRun').addEventListener('change', updateRunLabel);
$('recheck').addEventListener('click', check);
updateRunLabel();
check();
