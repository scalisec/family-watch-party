// A game's page: bring in its files from this PC (or use parts already in Drive), mark puck drop and
// the final buzzer, and save one full-game file per camera view to Drive. Clips go up as they are.
import { TEAMS } from './config.js';
import { dayLabel, timeLabel } from './games.js';
import { partsByView, joinedFile, setMarks, clockSec, alreadyImported, folderPath } from './library.js';
import { parseVideoFileName, viewFromSize, kindFor } from './import-match.js';
import { $, h, toast, formatBytes, formatDuration, driveFolderLink, readMeta } from './ui.js';
import { isConnected, NotConnectedError } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, cacheRecord, combine, loadGoogle } from './data.js';
import { saveLibrary, downloadFile, ensureFolder } from './drive.js';
import { Mp4Error } from './mp4.js';
import { createMarker, marksValid, lengthOf, markClock, clockText, cutFor } from './marker.js';
import { prepareJoin, publishJoined, publishClip } from './publish.js';
import { streamReady, streamUrl } from './stream.js';
import { createWatcher } from './watch.js';
import { createClipEditor } from './clip-editor.js';

const gameId = new URLSearchParams(location.search).get('game') || '';
const VIEWS = ['PANO', 'AUTO', 'Video'];

const state = {
  game: null,
  team: null,
  record: cachedRecord(),
  library: null,
  local: [],           // files picked on this PC that aren't in Drive yet
  blobs: new Map(),    // driveId -> Blob (picked on this PC, or loaded from Drive)
  loading: new Map(),
  marks: {},
  whole: false,
  make: {},
  busy: false,
  abort: null,
  marker: null,
  nextId: 1,
  watchView: '',
  watcher: null,
  watchingId: '',
  editor: null,
};

const showError = (text) => { $('pageError').textContent = text; $('pageError').hidden = !text; };

// ---------- the parts ----------
function driveParts() {
  const by = partsByView(state.record, gameId);
  const out = {};
  for (const [view, list] of Object.entries(by)) {
    out[view] = list.map((e) => ({ id: e.driveId, driveId: e.driveId, clock: clockSec(e), size: e.size, duration: e.duration, entry: e }));
  }
  return out;
}

// Every view's parts, in time order: Drive parts plus new full-game files from this PC
function views() {
  const out = driveParts();
  for (const f of state.local) {
    if (f.kind !== 'full' || f.blocked) continue;
    (out[f.view] = out[f.view] || []).push(f);
  }
  for (const v of Object.keys(out)) {
    out[v].sort((a, b) => (a.clock ?? Infinity) - (b.clock ?? Infinity) || String(a.file ? a.file.name : a.entry.name).localeCompare(String(b.file ? b.file.name : b.entry.name)));
  }
  return out;
}
const localClips = () => state.local.filter((f) => f.kind === 'clip');

async function getBlob(part, onProgress) {
  if (part.file) return part.file;
  if (state.blobs.has(part.driveId)) return state.blobs.get(part.driveId);
  if (!state.loading.has(part.driveId)) {
    if (!isConnected()) throw new NotConnectedError('Connect Google to load this part from Drive, or pick the file on this PC.');
    const p = downloadFile(part.driveId, part.size, onProgress)
      .then((blob) => { state.blobs.set(part.driveId, blob); renderParts(); return blob; })
      .finally(() => state.loading.delete(part.driveId));
    state.loading.set(part.driveId, p);
    renderParts();
  }
  return state.loading.get(part.driveId);
}

function blockReason(f) {
  if (f.kind !== 'full') return '';
  const done = joinedFile(state.record, gameId, f.view);
  return done ? `This game already has a full ${f.view} file in Drive.` : '';
}

async function pickFiles(fileList) {
  const files = [...fileList].filter((f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name));
  if (!files.length) { toast('Pick MP4 or MOV video files.'); return; }
  const parts = Object.values(driveParts()).flat();
  let linked = 0;
  for (const file of files) {
    const same = (o) => o && o.name === file.name && o.size === file.size;
    const part = parts.find((p) => same(p.entry.original) || (p.entry.name === file.name && p.entry.size === file.size));
    if (part) { state.blobs.set(part.driveId, file); linked += 1; continue; }
    if (state.local.some((f) => same(f.file))) continue;
    if (alreadyImported(state.record, file)) { toast(`${file.name} is already in Drive.`); continue; }
    const parsed = parseVideoFileName(file.name);
    state.local.push({
      id: `local-${state.nextId++}`, file, parsed, size: file.size, clock: Number.isFinite(parsed.seconds) ? parsed.seconds : null,
      view: '', kind: kindFor(parsed, undefined), duration: null, reading: true,
    });
  }
  if (linked) toast(`Using ${linked} file${linked === 1 ? '' : 's'} from this PC for the parts already in Drive.`);
  renderAll();
  for (const f of state.local.filter((x) => x.reading)) {
    const meta = await readMeta(f.file);
    f.reading = false;
    f.duration = meta.duration || null;
    f.view = viewFromSize(meta.width, meta.height) || 'Video';
    f.kind = kindFor(f.parsed, meta.duration);
    f.blocked = blockReason(f);
  }
  renderAll();
  if (state.marker) state.marker.start();
}

// ---------- marks ----------
async function saveMarks(marks) {
  state.marks = marks;
  // Only marks on parts already in Drive are worth keeping in the record
  const keep = {};
  for (const [view, m] of Object.entries(marks)) {
    const inDrive = (id) => id && !String(id).startsWith('local-');
    if (m && inDrive(m.start && m.start.id) && inDrive(m.end && m.end.id)) keep[view] = m;
  }
  for (const v of Object.keys(keep)) state.record = setMarks(state.record, gameId, v, keep[v]);
  if (Object.keys(keep).length) {
    cacheRecord(state.record);
    if (state.library && isConnected()) {
      try { state.library = await saveLibrary({ ...state.library, record: state.record }); } catch { /* kept locally */ }
    }
  }
  renderMake();
}

// ---------- rendering ----------
function partLine(label, text, pill, extra = []) {
  return h('li', {},
    h('span', {}, h('span', { class: 'part-name' }, label), ' ', h('span', { class: 'small muted' }, text)),
    h('span', { class: 'part-actions' }, ...extra, pill));
}

function renderParts() {
  const items = [];
  const all = views();
  let fromPc = 0;
  let total = 0;
  for (const [view, list] of Object.entries(all)) {
    items.push(h('li', { class: 'view-label' }, view));
    list.forEach((p, i) => {
      total += 1;
      const here = Boolean(p.file || state.blobs.has(p.driveId));
      if (here) fromPc += 1;
      const desc = `${p.clock != null ? `starts ${clockText(p.clock)} · ` : ''}${formatBytes(p.size)}${p.duration ? ` · ${formatDuration(p.duration)}` : ''}${p.file ? ` · ${p.file.name}` : ''}`;
      const pill = p.file ? h('span', { class: 'pill pill-info' }, 'New · on this PC')
        : here ? h('span', { class: 'pill pill-good' }, 'In Drive · on this PC')
          : h('span', { class: 'pill pill-none' }, state.loading.has(p.driveId) ? 'Loading from Drive…' : 'In Drive');
      items.push(partLine(`Part ${i + 1}`, desc, pill, p.file ? [kindSelect(p), removeBtn(p)] : []));
    });
  }
  const clips = localClips();
  if (clips.length) {
    items.push(h('li', { class: 'view-label' }, 'Clips'));
    for (const c of clips) items.push(partLine(c.file.name, `${formatBytes(c.size)}${c.duration ? ` · ${formatDuration(c.duration)}` : ''}`, h('span', { class: 'pill pill-info' }, 'New · on this PC'), [kindSelect(c), removeBtn(c)]));
  }
  for (const f of state.local.filter((x) => x.reading || x.blocked)) {
    items.push(partLine(f.file.name, f.reading ? 'Reading…' : f.blocked, h('span', { class: `pill ${f.blocked ? 'pill-work' : 'pill-none'}` }, f.blocked ? 'Not used' : 'Reading'), f.blocked ? [removeBtn(f)] : []));
  }
  const wrongDay = state.local.filter((f) => f.parsed && f.parsed.date && state.game && f.parsed.date !== state.game.date);
  if (wrongDay.length) items.push(h('li', {}, h('span', { class: 'small warn-text' }, `${wrongDay.length === 1 ? `${wrongDay[0].file.name} was` : `${wrongDay.length} files were`} recorded on a different day than this game. Check you picked the right files.`)));
  $('partsList').replaceChildren(...items);
  $('partsList').hidden = !items.length;
  $('partsSummary').textContent = total ? `${total} full-game file${total === 1 ? '' : 's'}${clips.length ? ` · ${clips.length} clip${clips.length === 1 ? '' : 's'}` : ''}` : '';
  const driveOnly = total - fromPc;
  $('dropText').replaceChildren(...(driveOnly > 0
    ? [h('strong', {}, 'Still have the files on this PC?'), ` Pick them and ${driveOnly === 1 ? 'the part in Drive is' : `the ${driveOnly} parts in Drive are`} read from here instead, which is much faster. You can also add more files or clips for this game.`]
    : [h('strong', {}, "Pick this game's files on this PC"), ': the full-game downloads and any clips. Nothing goes to Drive until you press Save.']));
}

function kindSelect(f) {
  return h('select', {
    'aria-label': `Type of ${f.file.name}`, disabled: state.busy,
    onchange: (e) => { f.kind = e.target.value; f.blocked = blockReason(f); renderAll(); },
  }, h('option', { value: 'full', selected: f.kind === 'full' }, 'Full game'), h('option', { value: 'clip', selected: f.kind === 'clip' }, 'Clip'));
}
function removeBtn(f) {
  return h('button', {
    type: 'button', class: 'btn btn-small', disabled: state.busy, 'aria-label': `Remove ${f.file.name}`,
    onclick: () => { state.local = state.local.filter((x) => x !== f); renderAll(); },
  }, 'Remove');
}

function chosenViews() {
  const all = views();
  return Object.keys(all).filter((v) => {
    const ready = state.whole || marksValid(all, state.marks, v);
    if (!ready) return false;
    const estimated = !state.whole && state.marks[v] && state.marks[v].estimated;
    return v in state.make ? state.make[v] : !estimated;
  });
}

function renderMake() {
  const all = views();
  const items = [];
  for (const view of Object.keys(all)) {
    const list = all[view];
    const ok = state.whole || marksValid(all, state.marks, view);
    const m = state.marks[view] || {};
    const ticked = chosenViews().includes(view);
    let detail;
    if (state.whole) detail = `whole files · ${list.length} part${list.length === 1 ? '' : 's'}${list.some((p) => p.duration) ? ` · about ${formatDuration(list.reduce((s, p) => s + (p.duration || 0), 0))}` : ''}`;
    else if (ok) {
      const len = lengthOf(all, state.marks, view);
      detail = `${clockText(markClock(all, view, m.start))} → ${clockText(markClock(all, view, m.end))}${len != null ? ` · about ${formatDuration(len)}` : ''} · from ${list.length} part${list.length === 1 ? '' : 's'}${m.estimated ? ' · marks estimated, check them' : ''}`;
    } else detail = 'Set puck drop and the final buzzer, or tick Use whole files.';
    items.push(h('li', {}, h('label', {},
      h('input', { type: 'checkbox', checked: ok && ticked, disabled: !ok || state.busy, onchange: (e) => { state.make[view] = e.target.checked; renderMake(); } }),
      h('span', {}, h('strong', {}, `${view}: `), h('span', { class: ok ? '' : 'muted' }, detail)))));
  }
  const clips = localClips();
  if (clips.length) items.push(h('li', {}, h('span', {}, h('strong', {}, 'Clips: '), `${clips.length} added as they are, to the game's clips folder`)));
  for (const view of VIEWS) {
    const done = state.game ? joinedFile(state.record, gameId, view) : null;
    if (done && !all[view]) items.push(h('li', {}, h('span', {}, h('strong', {}, `${view}: `), `full game is in Drive (${done.duration ? formatDuration(done.duration) : formatBytes(done.size)})`), h('span', { class: 'pill pill-good' }, 'Done')));
  }
  $('makeList').replaceChildren(...items);
  const views_ = chosenViews();
  const count = views_.length + (clips.length ? 1 : 0);
  $('makeBtn').disabled = state.busy || !count;
  $('makeBtn').textContent = views_.length > 1 ? `Save full games (${views_.join(' + ')}) to Drive` : views_.length ? `Save full game (${views_[0]}) to Drive` : clips.length ? `Save ${clips.length} clip${clips.length === 1 ? '' : 's'} to Drive` : 'Save to Drive';
  $('wholeFiles').checked = state.whole;
  $('wholeFiles').disabled = state.busy;
  $('wholeFiles').closest('label').hidden = !Object.keys(all).length;
  if (!state.busy) $('makeNote').textContent = !isConnected() && count ? 'Connect Google at the top to save to Drive.' : '';
}

// ---------- watching ----------
function finishedFiles() {
  return VIEWS.map((v) => joinedFile(state.record, gameId, v)).filter(Boolean);
}

async function renderWatch() {
  const files = finishedFiles();
  $('watchCard').hidden = !files.length;
  if (!files.length) { if (state.watcher) { state.watcher.destroy(); state.watcher = null; state.watchingId = ''; } return; }
  if (!files.some((f) => (f.view || 'Video') === state.watchView)) state.watchView = (files.find((f) => f.view === 'PANO') || files[0]).view || 'Video';
  $('watchTabs').replaceChildren(...(files.length > 1 ? files.map((f) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String((f.view || 'Video') === state.watchView),
    onclick: () => { state.watchView = f.view || 'Video'; renderWatch(); },
  }, f.view || 'Video')) : []));
  const file = files.find((f) => (f.view || 'Video') === state.watchView);
  if (state.watchingId === file.driveId) return;
  if (!isConnected()) {
    $('watchRoot').replaceChildren(h('p', { class: 'muted' }, 'Connect Google at the top to watch this game.'));
    return;
  }
  state.watchingId = file.driveId;
  if (state.watcher) state.watcher.destroy();
  state.watcher = null;
  $('watchRoot').replaceChildren(h('p', { class: 'muted' }, 'Starting the player…'));
  try {
    await streamReady();
  } catch (err) {
    state.watchingId = '';
    $('watchRoot').replaceChildren(h('p', { class: 'error-box' }, err.message));
    return;
  }
  if (state.watchingId !== file.driveId) return;
  state.watcher = createWatcher({ src: streamUrl(file.driveId, file.size), startSec: Number.isFinite(file.startSec) ? file.startSec : null });
  $('watchRoot').replaceChildren(state.watcher.el);
}

// ---------- making clips ----------
function openEditor() {
  const file = finishedFiles().find((f) => (f.view || 'Video') === state.watchView);
  if (!file || !state.watcher) { toast('Start watching the game first.'); return; }
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const at = state.watcher.video.currentTime || 0;
  state.watcher.video.pause();
  if (state.editor) state.editor.close();
  const clips = ((state.record.games[gameId] || {}).files || []).filter((f) => f.kind === 'clip').length;
  state.editor = createClipEditor({
    src: streamUrl(file.driveId, file.size),
    startSec: Number.isFinite(file.startSec) ? file.startSec : null,
    at, game: state.game, kid: state.game.kid, clipNumber: clips + 1,
    saveToDrive: async (blob, info) => {
      if (!state.library) {
        const out = await loadGoogle();
        if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive.");
        state.library = out.library;
        state.record = out.library.record;
      }
      const upload = new File([blob], info.name, { type: blob.type || 'video/mp4' });
      const out = await publishClip({
        file: upload, duration: info.duration, game: state.game, team: state.team, record: state.record, library: state.library,
        extra: { shape: info.shape, edit: info.edit, fromFile: file.driveId },
      });
      state.record = out.record;
      state.library = out.library;
      cacheRecord(state.record);
      return out.name;
    },
    onClose: () => { state.editor = null; $('clipCard').hidden = true; },
  });
  $('clipRoot').replaceChildren(state.editor.el);
  $('clipCard').hidden = false;
  $('clipCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAll() {
  const all = views();
  $('connectCard').hidden = isConnected();
  $('partsCard').hidden = !state.game;
  $('makeCard').hidden = !state.game;
  const hasParts = Object.keys(all).length > 0;
  $('markCard').hidden = !hasParts || state.whole;
  $('make-h').textContent = `${$('markCard').hidden ? 2 : 3} · Save to Drive`;
  if (hasParts && !state.marker) {
    state.marker = createMarker({ views: all, marks: state.marks, game: state.game, getBlob, onChange: saveMarks });
    $('markerRoot').replaceChildren(state.marker.el);
  } else if (state.marker) state.marker.setViews(all);
  renderParts();
  renderMake();
  renderWatch();
}

// ---------- saving ----------
function setProgress(fraction, text) {
  const pct = Math.round(fraction * 100);
  $('makeFill').style.width = `${pct}%`;
  $('makeProgress').setAttribute('aria-valuenow', String(pct));
  $('makeNote').textContent = text;
}

async function save() {
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const chosen = chosenViews();
  const clips = localClips();
  if (!chosen.length && !clips.length) return;
  state.busy = true;
  state.abort = new AbortController();
  const signal = state.abort.signal;
  $('stopBtn').hidden = false;
  $('makeProgress').hidden = false;
  $('doneCard').hidden = true;
  showError('');
  renderAll();
  const saved = [];
  let notTrashed = 0;
  try {
    if (!state.library) {
      const out = await loadGoogle();
      if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive. Try again in a minute.");
      state.library = out.library;
      state.record = out.library.record;
    }
    for (const view of chosen) {
      const all = views();
      const parts = all[view];
      const { joined, used } = await prepareJoin(parts, cutFor(all, state.marks, view, state.whole), getBlob, (what, got, size) => {
        setProgress(0, `${view}: ${what}${got ? ` (${formatBytes(got)} of ${formatBytes(size)})` : ''}…`);
      });
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const out = await publishJoined({
        joined, used, parts, game: state.game, team: state.team, view, record: state.record, library: state.library, signal,
        onSent: (sent) => setProgress(sent / joined.size, `${view}: saving to Drive, ${formatBytes(sent)} of ${formatBytes(joined.size)}. Keep this page open.`),
      });
      state.record = out.record;
      state.library = out.library;
      cacheRecord(state.record);
      notTrashed += out.notTrashed;
      state.local = state.local.filter((f) => !(f.kind === 'full' && f.view === view));
      delete state.marks[view];
      saved.push(`${view} full game (${formatDuration(joined.duration)})`);
    }
    for (const c of clips) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const out = await publishClip({
        file: c.file, duration: c.duration, game: state.game, team: state.team, record: state.record, library: state.library, signal,
        onSent: (sent) => setProgress(sent / c.size, `Clip ${c.file.name}: ${formatBytes(sent)} of ${formatBytes(c.size)}`),
      });
      state.record = out.record;
      state.library = out.library;
      cacheRecord(state.record);
      state.local = state.local.filter((f) => f !== c);
      saved.push(`clip ${out.name}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('Stopped. Anything already saved stays in Drive.');
    else if (err instanceof NotConnectedError) toast('Google sign-in ran out. Press Reconnect Google, then Save again.', 8000);
    else if (err instanceof Mp4Error) showError(err.message);
    else showError(`Couldn't save to Drive: ${err.message}`);
  } finally {
    state.busy = false;
    state.abort = null;
    $('stopBtn').hidden = true;
    $('makeProgress').hidden = true;
    if (state.marker && !Object.keys(views()).length) { state.marker.destroy(); state.marker = null; }
    renderAll();
  }
  if (saved.length) {
    $('doneText').textContent = `Saved to Drive: ${saved.join(', ')}.${notTrashed ? ' Some parts couldn\'t be moved to the trash; you can delete them in Drive.' : ''}`;
    $('doneCard').hidden = false;
    $('driveLink').hidden = true;
    ensureFolder(folderPath(state.game, state.team, 'full').slice(0, -1)).then((id) => { $('driveLink').href = driveFolderLink(id); $('driveLink').hidden = false; }).catch(() => {});
  }
}

// ---------- page setup ----------
function loadMarks() {
  const saved = (state.record.games[gameId] && state.record.games[gameId].marks) || {};
  for (const v of Object.keys(saved)) if (!state.marks[v]) state.marks[v] = saved[v];
  if (state.marker) state.marker.setMarks(state.marks);
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) {
    state.library = out.library;
    state.record = out.library.record;
    for (const f of state.local) f.blocked = blockReason(f);
    loadMarks();
  }
  if (out && out.problems.length) toast(out.problems.join(' '), 8000);
  renderAll();
}

function wire() {
  $('fileInput').addEventListener('change', (e) => { pickFiles([...e.target.files]); e.target.value = ''; });
  const zone = $('dropZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragging'); if (!state.busy) pickFiles([...e.dataTransfer.files]); });
  $('makeClipBtn').addEventListener('click', openEditor);
  $('wholeFiles').addEventListener('change', (e) => { state.whole = e.target.checked; state.make = {}; renderAll(); });
  $('makeBtn').addEventListener('click', save);
  $('stopBtn').addEventListener('click', () => { if (state.abort) state.abort.abort(); });
  window.addEventListener('beforeunload', (e) => { if (state.busy) { e.preventDefault(); e.returnValue = ''; } });
}

async function start() {
  setupHeader(onConnected);
  wire();
  let games = [];
  try {
    const league = await loadLeague();
    games = combine(league.games, cachedTeamSnap());
  } catch {
    showError("Couldn't load the schedules. Reload the page to try again.");
  }
  state.game = games.find((g) => g.id === gameId) || null;
  if (!state.game) {
    $('subtitle').textContent = '';
    if (games.length) showError("That game isn't in the schedule any more. Go back to Games and pick it again.");
    renderAll();
    return;
  }
  state.team = TEAMS.find((t) => t.key === state.game.teamKey);
  $('title').textContent = state.game.opponentLabel;
  $('subtitle').textContent = [state.game.kid, state.team && state.team.label, dayLabel(state.game.date), timeLabel(state.game.time), state.game.rink].filter(Boolean).join(' · ');
  document.title = `${state.game.opponentLabel} · Family Watch Party`;
  loadMarks();
  renderAll();
  if (isConnected()) await onConnected();
}

start();
