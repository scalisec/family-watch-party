import { TEAMS } from './config.js';
import { dayLabel, timeLabel } from './games.js';
import { parseVideoFileName, matchFile, viewFromSize, kindFor } from './import-match.js';
import {
  folderPath, fullGameFileName, addFile, nextPart, alreadyImported, downloadedIds, safeName, extensionOf,
} from './library.js';
import { $, h, toast, formatBytes, formatDuration, driveFolderLink } from './ui.js';
import { isConnected, NotConnectedError } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, cacheRecord, combine, loadGoogle } from './data.js';
import { ensureFolder, uploadFile, saveLibrary, loadLibrary } from './drive.js';

const state = {
  games: [],
  league: [],
  teamsnap: cachedTeamSnap(),
  record: cachedRecord(),
  library: null,
  rows: [],
  uploading: false,
  stop: false,
  nextId: 1,
};

const gameById = (id) => state.games.find((g) => g.id === id) || null;
const teamFor = (game) => TEAMS.find((t) => t.key === game.teamKey);

// ---------- reading files ----------
function readMeta(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (meta) => { if (settled) return; settled = true; URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(meta); };
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => finish({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => finish({});
    setTimeout(() => finish({}), 15000);
    v.src = url;
  });
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name));
  if (!files.length) { toast('Those weren\'t video files. Pick MP4 or MOV files.'); return; }
  for (const file of files) {
    if (state.rows.some((r) => r.file.name === file.name && r.file.size === file.size)) continue;
    state.rows.push({ id: state.nextId++, file, parsed: parseVideoFileName(file.name), meta: null, kind: 'full', view: '', gameId: '', confidence: 'none', reason: 'Reading the file…', include: false, state: 'reading', sent: 0, error: '' });
  }
  $('reviewCard').hidden = false;
  $('doneCard').hidden = true;
  render();
  for (const row of state.rows.filter((r) => r.state === 'reading')) {
    row.meta = await readMeta(row.file);
    row.view = viewFromSize(row.meta.width, row.meta.height);
    row.kind = kindFor(row.parsed, row.meta.duration);
    const m = row.kind === 'full' ? matchFile(row.parsed, state.games) : { game: null, confidence: 'none', reason: 'Clip: pick the game it belongs to.' };
    row.gameId = m.game ? m.game.id : '';
    row.confidence = m.confidence;
    row.reason = m.reason;
    row.state = 'ready';
    row.include = Boolean(row.gameId);
    if (alreadyImported(state.record, row.file)) { row.state = 'skipped'; row.include = false; row.reason = 'Already in Drive.'; }
    render();
  }
}

// ---------- rendering ----------
function gameOptions(selectedId) {
  const now = Date.now() + 3 * 60 * 60 * 1000;
  const past = state.games.filter((g) => g.startMs <= now).sort((a, b) => b.startMs - a.startMs);
  const groups = TEAMS.map((t) => h('optgroup', { label: `${t.kid} · ${t.label}` },
    ...past.filter((g) => g.teamKey === t.key).map((g) => h('option', { value: g.id, selected: g.id === selectedId },
      `${dayLabel(g.date)} · ${timeLabel(g.time)} · ${g.opponentLabel}`))));
  return [h('option', { value: '', selected: !selectedId }, 'Pick the game…'), ...groups];
}

function describe(row) {
  const bits = [formatBytes(row.file.size)];
  if (row.meta && row.meta.duration) bits.push(formatDuration(row.meta.duration));
  if (row.parsed.source === 'livebarn') bits.push('LiveBarn');
  if (row.parsed.source === 'helper') bits.push('From the helper');
  if (row.view) bits.push(row.view);
  if (Number.isFinite(row.parsed.minutes)) {
    const hh = Math.floor(row.parsed.minutes / 60); const mm = row.parsed.minutes % 60;
    bits.push(`starts ${timeLabel(`${hh}:${String(mm).padStart(2, '0')}`)}`);
  }
  return bits.join(' · ');
}

function statusCell(row) {
  if (row.state === 'reading') return [h('span', { class: 'pill pill-none' }, 'Reading…')];
  if (row.state === 'uploading') {
    const pct = Math.round((row.sent / row.file.size) * 100) || 0;
    return [h('span', { class: 'pill pill-info' }, `Uploading ${pct}%`),
      h('div', { class: 'row-progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${row.file.name} upload` }, h('div', { style: `width: ${pct}%` }))];
  }
  if (row.state === 'done') return [h('span', { class: 'pill pill-good' }, 'In Drive'), h('span', { class: 'sub' }, row.savedAs || '')];
  if (row.state === 'error') return [h('span', { class: 'pill pill-bad' }, 'Didn\'t upload'), h('span', { class: 'sub' }, row.error)];
  if (row.state === 'skipped') return [h('span', { class: 'pill pill-info' }, 'Already in Drive'), h('span', { class: 'sub' }, 'Tick it to upload again anyway.')];
  if (!row.gameId) return [h('span', { class: 'pill pill-work' }, 'Pick the game'), h('span', { class: 'sub' }, row.reason)];
  if (row.confidence === 'low') return [h('span', { class: 'pill pill-work' }, 'Check this'), h('span', { class: 'sub' }, row.reason)];
  if (row.confidence === 'high') return [h('span', { class: 'pill pill-good' }, 'Matched'), h('span', { class: 'sub' }, row.reason)];
  return [h('span', { class: 'pill pill-info' }, 'Ready'), h('span', { class: 'sub' }, 'Game picked by you.')];
}

function rowEl(row) {
  const locked = state.uploading || row.state === 'done' || row.state === 'reading';
  return h('tr', { class: row.state === 'skipped' && !row.include ? 'skipped' : '' },
    h('td', { class: 'col-check c-check' }, h('input', {
      type: 'checkbox', checked: row.include, disabled: locked || !row.gameId,
      'aria-label': `Upload ${row.file.name}`,
      onchange: (e) => { row.include = e.target.checked; renderFooter(); },
    })),
    h('td', { class: 'c-file' }, h('span', { class: 'file-name' }, row.file.name), h('span', { class: 'sub' }, describe(row))),
    h('td', { class: 'c-type' }, h('select', {
      'aria-label': `Type of ${row.file.name}`, disabled: locked,
      onchange: (e) => { row.kind = e.target.value; render(); },
    }, h('option', { value: 'full', selected: row.kind === 'full' }, 'Full game file'), h('option', { value: 'clip', selected: row.kind === 'clip' }, 'Clip'))),
    h('td', { class: 'c-game' }, h('select', {
      'aria-label': `Game for ${row.file.name}`, disabled: locked,
      onchange: (e) => {
        row.gameId = e.target.value;
        row.confidence = 'picked';
        row.include = Boolean(row.gameId);
        render();
      },
    }, ...gameOptions(row.gameId))),
    h('td', { class: 'c-status' }, ...statusCell(row)),
  );
}

function queue() {
  return state.rows.filter((r) => r.include && r.gameId && r.state !== 'done' && r.state !== 'reading');
}

function renderFooter() {
  const q = queue();
  const bytes = q.reduce((s, r) => s + r.file.size, 0);
  const btn = $('uploadBtn');
  btn.textContent = q.length ? `Upload ${q.length} file${q.length === 1 ? '' : 's'} to Drive (${formatBytes(bytes)})` : 'Upload to Drive';
  btn.disabled = state.uploading || !q.length || !isConnected();
  $('stopBtn').hidden = !state.uploading;
  $('clearBtn').disabled = state.uploading;
  if (!isConnected() && q.length) $('uploadNote').textContent = 'Connect Google at the top to upload.';
  else if (!state.uploading) $('uploadNote').textContent = q.length ? 'Keep this page open while it uploads. Large games take a few minutes each.' : '';

  const counts = { matched: 0, check: 0, pick: 0, already: 0 };
  for (const r of state.rows) {
    if (r.state === 'skipped') counts.already += 1;
    else if (!r.gameId) counts.pick += 1;
    else if (r.confidence === 'low') counts.check += 1;
    else counts.matched += 1;
  }
  $('reviewSummary').textContent = `${state.rows.length} file${state.rows.length === 1 ? '' : 's'}: ${counts.matched} ready, ${counts.check} to check, ${counts.pick} to pick${counts.already ? `, ${counts.already} already in Drive` : ''}`;
}

function render() {
  $('connectCard').hidden = isConnected();
  $('importBody').replaceChildren(...state.rows.map(rowEl));
  renderFooter();
}

// ---------- uploading ----------
async function upload() {
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const q = queue().sort((a, b) => (a.gameId === b.gameId ? (a.parsed.minutes || 0) - (b.parsed.minutes || 0) : a.gameId.localeCompare(b.gameId)));
  if (!q.length) return;
  state.uploading = true;
  state.stop = false;
  const before = downloadedIds(state.record);
  const totalBytes = q.reduce((s, r) => s + r.file.size, 0);
  let doneBytes = 0;
  let uploaded = 0;
  $('overall').hidden = false;
  const setOverall = (sent) => {
    const pct = Math.round(((doneBytes + sent) / totalBytes) * 100);
    $('overallFill').style.width = `${pct}%`;
    $('overall').setAttribute('aria-valuenow', String(pct));
    $('uploadNote').textContent = `Uploading: ${formatBytes(doneBytes + sent)} of ${formatBytes(totalBytes)}. Keep this page open.`;
  };
  render();

  try {
    if (!state.library) state.library = await loadLibrary();
    state.record = state.library.record;
    for (const row of q) {
      if (state.stop) break;
      const game = gameById(row.gameId);
      if (!game) { row.state = 'error'; row.error = 'That game is no longer in the list.'; continue; }
      row.state = 'uploading';
      row.sent = 0;
      render();
      try {
        const folderId = await ensureFolder(folderPath(game, teamFor(game), row.kind));
        const name = row.kind === 'full'
          ? fullGameFileName(game, nextPart(state.record, game.id, row.view), row.parsed.minutes, row.view, extensionOf(row.file.name))
          : safeName(row.file.name);
        let lastPaint = 0;
        const file = await uploadFile(row.file, folderId, name, (sent) => {
          row.sent = sent;
          setOverall(sent);
          if (Date.now() - lastPaint > 500) { lastPaint = Date.now(); render(); }
        });
        state.record = addFile(state.record, game.id, {
          driveId: file.id, name, kind: row.kind, view: row.view, start: Number.isFinite(row.parsed.minutes) ? row.parsed.minutes : null,
          size: row.file.size, duration: row.meta && row.meta.duration ? Math.round(row.meta.duration) : null,
          original: { name: row.file.name, size: row.file.size, lastModified: row.file.lastModified },
        });
        state.library = await saveLibrary({ ...state.library, record: state.record });
        cacheRecord(state.record);
        row.state = 'done';
        row.savedAs = name;
        row.include = false;
        uploaded += 1;
      } catch (err) {
        if (err instanceof NotConnectedError) throw err;
        row.state = 'error';
        row.error = err.message;
      }
      doneBytes += row.file.size;
      render();
    }
  } catch (err) {
    for (const r of state.rows) if (r.state === 'uploading') { r.state = 'error'; r.error = 'Stopped: Google sign-in ran out.'; }
    toast(err instanceof NotConnectedError ? 'Google sign-in ran out. Press Reconnect Google, then Upload again. Finished files are kept.' : err.message, 8000);
  } finally {
    state.uploading = false;
    $('overall').hidden = true;
    render();
  }

  const after = downloadedIds(state.record);
  const newGames = [...after].filter((id) => !before.has(id)).length;
  const failed = state.rows.filter((r) => r.state === 'error').length;
  $('doneText').textContent = `Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}. ${newGames} game${newGames === 1 ? ' is' : 's are'} now marked Downloaded.${failed ? ` ${failed} didn't upload; they're marked in the list and can be tried again.` : ''}`;
  if (state.library) $('driveLink').href = driveFolderLink(state.library.rootId);
  $('driveLink').hidden = !state.library;
  $('doneCard').hidden = uploaded === 0 && failed === 0;
}

// ---------- page setup ----------
async function onConnected() {
  const out = await loadGoogle();
  if (out) {
    if (out.library) { state.library = out.library; state.record = out.library.record; }
    if (out.teamsnap) { state.teamsnap = out.teamsnap; state.games = combine(state.league, state.teamsnap); }
    if (out.problems.length) toast(out.problems.join(' '), 8000);
    for (const r of state.rows) {
      if (r.state === 'ready' && alreadyImported(state.record, r.file)) { r.state = 'skipped'; r.include = false; }
    }
  }
  render();
}

function setupPicker() {
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const zone = $('dropZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragging'); if (!state.uploading) addFiles(e.dataTransfer.files); });
  $('uploadBtn').addEventListener('click', upload);
  $('stopBtn').addEventListener('click', () => { state.stop = true; $('uploadNote').textContent = 'Stopping after this file…'; });
  $('clearBtn').addEventListener('click', () => { state.rows = []; $('reviewCard').hidden = true; $('doneCard').hidden = true; render(); });
  window.addEventListener('beforeunload', (e) => { if (state.uploading) { e.preventDefault(); e.returnValue = ''; } });
}

async function start() {
  setupHeader(onConnected);
  setupPicker();
  render();
  try {
    const league = await loadLeague();
    state.league = league.games;
    state.games = combine(state.league, state.teamsnap);
  } catch {
    toast("Couldn't load the league schedules, so files can't be matched yet. Reload the page to try again.", 8000);
  }
  render();
}

$('driveLink').hidden = true;
start();
