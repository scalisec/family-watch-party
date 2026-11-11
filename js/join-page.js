// A game's page: bring in its files from this PC (or use parts already in Drive), mark puck drop and
// the final buzzer, and save one full-game file per camera view to Drive. Clips go up as they are.
import { TEAMS } from './config.js';
import { dayLabel, timeLabel } from './games.js';
import { partsByView, joinedFile, setMarks, clockSec, alreadyImported, folderPath, scheduleMarks, setToDownload, downloadedIds } from './library.js';
import { parseVideoFileName, viewFromSize, kindFor } from './import-match.js';
import { $, h, toast, formatBytes, formatDuration, driveFolderLink, readMeta, pickVideoFiles, readSaved } from './ui.js';
import { guideWindows, minutesUpTo, clockLabel } from './guide.js';
import { isConnected, NotConnectedError } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, cacheRecord, combine, loadGoogle } from './data.js';
import { saveLibrary, downloadFile, ensureFolder, driveReader } from './drive.js';
import { Mp4Error } from './mp4.js';
import { createMarker, marksValid, lengthOf, markClock, clockText, cutFor } from './marker.js';
import { prepareJoin, publishClip, joinedQueueItem, clipQueueItem, queuedOriginal } from './publish.js';
import { saveCopy, enqueue, onQueueChange, queuedFor, queueItems } from './upload-queue.js';
import { streamReady, streamUrl } from './stream.js';
import { createWatcher } from './watch.js';
import { createClipEditor } from './clip-editor.js';
import { withRinks, watchUrl } from './rinks.js';
import { pickRink } from './rink-picker.js';

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
// Views with a full game waiting in the upload queue are left out until it's in Drive.
const queuedViews = () => new Set(queuedFor(gameId).filter((i) => i.kind === 'full').map((i) => i.view));
function views() {
  const out = driveParts();
  for (const v of queuedViews()) delete out[v];
  for (const f of state.local) {
    if (f.kind !== 'full' || f.blocked || queuedViews().has(f.view)) continue;
    (out[f.view] = out[f.view] || []).push(f);
  }
  for (const v of Object.keys(out)) {
    out[v].sort((a, b) => (a.clock ?? Infinity) - (b.clock ?? Infinity) || String(a.file ? a.file.name : a.entry.name).localeCompare(String(b.file ? b.file.name : b.entry.name)));
  }
  return out;
}
const localClips = () => state.local.filter((f) => f.kind === 'clip');

// For joining: parts on this PC are read from here; parts in Drive are read from Drive in pieces.
async function getSource(part, onProgress) {
  if (part.file) return part.file;
  if (state.blobs.has(part.driveId)) return state.blobs.get(part.driveId);
  if (!isConnected()) throw new NotConnectedError('Connect Google to read this part from Drive, or pick the file on this PC.');
  return driveReader(part.driveId, part.size);
}

// For watching while marking: parts in Drive are streamed, so they start in seconds.
async function getUrl(part) {
  if (part.file || state.blobs.has(part.driveId) || !isConnected()) return null;
  try { await streamReady(); return streamUrl(part.driveId, part.size); } catch { return null; }
}

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
  if (queuedViews().has(f.view)) return `This game's ${f.view} full game is already in the uploads.`;
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
    if (queuedOriginal(queueItems(), file)) { toast(`${file.name} is already in the uploads.`); continue; }
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
    // PANO only by default: AUTO is saved only when ticked (unless it's the only view)
    const autoOff = v === 'AUTO' && Object.keys(all).some((x) => x !== 'AUTO');
    return v in state.make ? state.make[v] : !estimated && !autoOff;
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
    if (ok && view === 'AUTO' && !ticked && Object.keys(all).some((x) => x !== 'AUTO')) detail += ' · not saved unless ticked (it doubles the upload)';
    items.push(h('li', {}, h('label', {},
      h('input', { type: 'checkbox', checked: ok && ticked, disabled: !ok || state.busy, onchange: (e) => { state.make[view] = e.target.checked; renderMake(); } }),
      h('span', {}, h('strong', {}, `${view}: `), h('span', { class: ok ? '' : 'muted' }, detail)))));
  }
  const clips = localClips();
  if (clips.length) items.push(h('li', {}, h('span', {}, h('strong', {}, 'Clips: '), `${clips.length} added as they are, to the game's clips folder`)));
  for (const q of queuedFor(gameId)) {
    const p = q.size ? Math.floor(((q.sent || 0) / q.size) * 100) : 0;
    items.push(h('li', {}, h('span', {}, h('strong', {}, q.kind === 'full' ? `${q.view}: ` : 'Clip: '), q.kind === 'full' ? `full game waiting to go to Drive (${p}% sent)` : `${q.name} (${p}% sent)`), h('span', { class: 'pill' }, q.state === 'error' ? 'Problem: see Uploads' : 'Uploading')));
  }
  for (const view of VIEWS) {
    if (queuedViews().has(view)) continue;
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

// ---------- download guide ----------
const GUIDE_KEY = () => `fwp.guide.${gameId}`;
function guideState() { try { return JSON.parse(localStorage.getItem(GUIDE_KEY()) || '{}'); } catch { return {}; } }
function saveGuide(g) { try { localStorage.setItem(GUIDE_KEY(), JSON.stringify(g)); } catch { /* fine */ } }

function renderGuide() {
  const g = state.game;
  const done = g && (downloadedIds(state.record).has(g.id) || VIEWS.some((v) => joinedFile(state.record, g.id, v)));
  const played = g && g.startMs <= Date.now();
  $('guideCard').hidden = !g || !played || Boolean(done);
  if ($('guideCard').hidden) return;
  const view = readSaved('fwp.defaultView', 'PANO') === 'AUTO' ? 'AUTO' : 'PANO';
  $('guideView').textContent = view;
  const onList = Boolean((state.record.toDownload || {})[g.id]);
  $('todoToggle').hidden = false;
  $('todoToggle').textContent = onList ? '✓ On your To-download list' : '＋ Add to To-download list';
  if (!g.liveBarn) {
    $('guideSummary').textContent = "This game has no LiveBarn rink yet. Press Pick the LiveBarn rink at the top first.";
    $('guideWindows').replaceChildren();
    $('guideMore').hidden = true;
    return;
  }
  $('guideMore').hidden = false;
  const saved = guideState();
  const windows = guideWindows(g, { extraWindows: saved.extra || 0 });
  const ticks = saved.done || {};
  const left = windows.filter((w) => !ticks[w.start]).length;
  $('guideSummary').textContent = `${clockLabel(windows[0] ? windows[0].from : 0)} to about ${clockLabel(windows.length ? windows[windows.length - 1].to : 0)} · ${windows.length} window${windows.length === 1 ? '' : 's'} · up to ${minutesUpTo(windows)} minutes of your LiveBarn time (each file counts for its full length)${g.liveBarn.picked ? ' · rink picked by you' : ''}.`;
  $('guideWindows').replaceChildren(...windows.map((w) => h('li', { class: ticks[w.start] ? 'done' : '' },
    h('label', { class: 'guide-tick' }, h('input', {
      type: 'checkbox', checked: Boolean(ticks[w.start]), 'aria-label': `Done with the ${clockLabel(w.start)} window`,
      onchange: (e) => { const s = guideState(); s.done = { ...(s.done || {}), [w.start]: e.target.checked }; saveGuide(s); renderGuide(); },
    })),
    h('span', { class: 'guide-text' },
      h('strong', {}, `${clockLabel(w.start)} window`),
      h('span', { class: 'small muted' }, w.extra ? ` · the whole window (game ran long)` : ` · take the file(s) covering ${clockLabel(w.from)}–${clockLabel(w.to)}`)),
    h('a', { class: 'btn btn-small', href: w.url, target: '_blank', rel: 'noopener', onclick: () => { const s = guideState(); s.opened = { ...(s.opened || {}), [w.start]: true }; saveGuide(s); } }, 'Open in LiveBarn ↗'))));
  $('guideNote').textContent = left ? '' : 'All windows ticked: now press Pick files below.';
}

async function toggleToDownload() {
  if (!isConnected()) { toast('Connect Google first, so the list is saved where your phone and PC can both see it.'); return; }
  const on = !(state.record.toDownload || {})[gameId];
  try {
    if (!state.library) {
      const out = await loadGoogle();
      if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive.");
      state.library = out.library;
      state.record = out.library.record;
    }
    state.record = setToDownload(state.record, gameId, on);
    state.library = await saveLibrary({ ...state.library, record: state.record });
    cacheRecord(state.record);
    toast(on ? 'Added to your To-download list.' : 'Taken off your To-download list.');
  } catch (err) { toast(`Couldn't save the list: ${err.message}`, 6000); }
  renderGuide();
}

// ---------- LiveBarn rink ----------
function renderLinks() {
  const g = state.game;
  if (!g) { $('gameLinks').replaceChildren(); return; }
  const played = g.startMs <= Date.now();
  const items = [];
  if (g.liveBarn && played) items.push(h('a', { class: 'btn btn-small', href: watchUrl(g), target: '_blank', rel: 'noopener' }, 'Open in LiveBarn ↗'));
  if (g.liveBarn && g.liveBarn.picked) items.push(h('button', { type: 'button', class: 'btn btn-small', onclick: openPicker }, `Change rink (LiveBarn #${g.liveBarn.surfaceId})`));
  if (!g.liveBarn) items.push(h('button', { type: 'button', class: 'btn btn-small', onclick: openPicker }, 'Pick the LiveBarn rink'));
  $('gameLinks').replaceChildren(...items);
}

async function openPicker() {
  const out = await pickRink({ game: state.game, games: withRinks(state.allGames, state.record), record: state.record, library: state.library });
  if (!out) return;
  state.record = out.record;
  state.library = out.library;
  state.game = withRinks([state.baseGame], state.record)[0];
  renderLinks();
  renderGuide();
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
    state.marker = createMarker({ views: all, marks: state.marks, game: state.game, getBlob, getUrl, onChange: saveMarks });
    $('markerRoot').replaceChildren(state.marker.el);
  } else if (state.marker) state.marker.setViews(all);
  renderParts();
  renderMake();
  renderWatch();
  renderLinks();
  renderGuide();
}

// ---------- saving ----------
function setProgress(fraction, text) {
  const pct = Math.round(fraction * 100);
  $('makeFill').style.width = `${pct}%`;
  $('makeProgress').setAttribute('aria-valuenow', String(pct));
  $('makeNote').textContent = text;
}

// Save makes the trimmed file and keeps a copy on this PC (a few seconds to a minute), then hands it to
// the upload queue. The upload carries on in the background, so there's no need to wait on this page.
async function save() {
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
  const queued = [];
  try {
    for (const view of chosen) {
      const all = views();
      const parts = all[view];
      const { joined, used } = await prepareJoin(parts, cutFor(all, state.marks, view, state.whole), getSource, (what, got, size) => {
        setProgress(0, `${view}: ${what}${got ? ` (${formatBytes(got)} of ${formatBytes(size)})` : ''}…`);
      });
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const localName = await saveCopy(joined, (done, size) => {
        if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
        setProgress(done / size, `${view}: getting the file ready for upload, ${formatBytes(done)} of ${formatBytes(size)}…`);
      });
      await enqueue({ ...joinedQueueItem({ joined, used, parts, game: state.game, team: state.team, view }), localName });
      state.local = state.local.filter((f) => !(f.kind === 'full' && f.view === view));
      delete state.marks[view];
      queued.push(`${view} full game (${formatDuration(joined.duration)}, ${formatBytes(joined.size)})`);
    }
    for (const c of clips) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const localName = await saveCopy(c.file, (done, size) => setProgress(done / size, `Clip ${c.file.name}: getting it ready for upload…`));
      await enqueue({ ...clipQueueItem({ file: c.file, duration: c.duration, game: state.game, team: state.team }), localName });
      state.local = state.local.filter((f) => f !== c);
      queued.push(`clip ${c.file.name}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('Stopped. Anything already in the uploads carries on.');
    else if (err instanceof NotConnectedError) toast('Google sign-in ran out. Press Reconnect Google, then Save again.', 8000);
    else if (err instanceof Mp4Error) showError(err.message);
    else showError(`Couldn't get the file ready: ${err.message}`);
  } finally {
    state.busy = false;
    state.abort = null;
    $('stopBtn').hidden = true;
    $('makeProgress').hidden = true;
    if (state.marker && !Object.keys(views()).length) { state.marker.destroy(); state.marker = null; }
    renderAll();
  }
  if (queued.length) {
    $('doneText').textContent = `Uploading to Drive: ${queued.join(', ')}. It carries on in the background, so you can go back to your games or start the next one. Press Uploads at the top to see how it's going. ${isConnected() ? '' : 'Connect Google at the top to start the upload. '}Keep the app open on this PC until it's done; if you close it, it picks up where it stopped next time.`;
    $('doneCard').hidden = false;
    $('driveLink').hidden = true;
    if (isConnected()) ensureFolder(folderPath(state.game, state.team, 'full').slice(0, -1)).then((id) => { $('driveLink').href = driveFolderLink(id); $('driveLink').hidden = false; }).catch(() => {});
  }
}

// ---------- page setup ----------
function loadMarks() {
  const saved = (state.record.games[gameId] && state.record.games[gameId].marks) || {};
  for (const v of Object.keys(saved)) if (!state.marks[v]) state.marks[v] = saved[v];
  // No marks yet: start from the schedule (puck drop at the scheduled time, final buzzer an hour later)
  const all = views();
  for (const v of Object.keys(all)) {
    if (state.marks[v]) continue;
    const m = scheduleMarks(all[v], state.game);
    if (m) state.marks[v] = m;
  }
  if (state.marker) state.marker.setMarks(state.marks);
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) {
    state.library = out.library;
    state.record = out.library.record;
    for (const f of state.local) f.blocked = blockReason(f);
    if (state.baseGame) state.game = withRinks([state.baseGame], state.record)[0];
    loadMarks();
  }
  if (out && out.problems.length) toast(out.problems.join(' '), 8000);
  renderAll();
}

function wire() {
  $('pickBtn').addEventListener('click', async () => { const files = await pickVideoFiles($('fileInput')); if (files.length) pickFiles(files); });
  $('guideMore').addEventListener('click', () => { const g = guideState(); g.extra = (g.extra || 0) + 1; saveGuide(g); renderGuide(); });
  $('todoToggle').addEventListener('click', toggleToDownload);
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

function onQueue(event) {
  if (event && event.type === 'progress') { if (!state.busy) renderMake(); return; }
  if (event && event.type === 'done' && event.record) {
    state.record = event.record;
    if (state.library) state.library = { ...state.library, record: event.record };
    if (state.baseGame) state.game = withRinks([state.baseGame], state.record)[0];
  }
  if (!state.busy) renderAll();
}

async function start() {
  setupHeader(onConnected);
  onQueueChange(onQueue);
  wire();
  let games = [];
  try {
    const league = await loadLeague();
    games = combine(league.games, cachedTeamSnap());
  } catch {
    showError("Couldn't load the schedules. Reload the page to try again.");
  }
  state.allGames = games;
  state.baseGame = games.find((g) => g.id === gameId) || null;
  state.game = state.baseGame ? withRinks([state.baseGame], state.record)[0] : null;
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
  if (location.hash === '#guideCard' && !$('guideCard').hidden) $('guideCard').scrollIntoView({ block: 'start' });
  if (isConnected()) await onConnected();
}

start();
