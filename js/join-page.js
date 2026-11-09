// Mark puck drop and the final buzzer, then join a view's parts into one full-game file in Drive.
import { TEAMS } from './config.js';
import { dayLabel, timeLabel } from './games.js';
import {
  partsByView, joinedFile, joinedFileName, setMarks, replaceWithJoined, clockSec, folderPath, parseHHMMSafe,
} from './library.js';
import { $, h, toast, formatBytes, formatDuration, driveFolderLink } from './ui.js';
import { isConnected, NotConnectedError } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, cacheRecord, combine, loadGoogle } from './data.js';
import { ensureFolder, uploadFile, saveLibrary, downloadFile, trashFile } from './drive.js';
import { blobReader, readMp4, buildJoin, Mp4Error } from './mp4.js';

const gameId = new URLSearchParams(location.search).get('game') || '';

const state = {
  game: null,
  team: null,
  record: cachedRecord(),
  library: null,
  views: {},           // { PANO: [entries], AUTO: [...] }
  view: '',
  part: 0,
  marks: {},           // { PANO: { start: { id, sec }, end: { id, sec }, estimated } }
  blobs: new Map(),    // driveId -> Blob (picked on this PC or loaded from Drive)
  urls: new Map(),     // driveId -> object URL for the player
  loading: new Map(),  // driveId -> Promise<Blob>
  busy: false,
  abort: null,
  make: {},            // view -> ticked
};

// ---------- small helpers ----------
function clockText(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}
function posText(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const parts = () => state.views[state.view] || [];
const current = () => parts()[state.part] || null;
const indexOf = (view, id) => (state.views[view] || []).findIndex((p) => p.driveId === id);
// Clock time for a mark (seconds after midnight), or null when the part has no start time
function markClock(view, mark) {
  if (!mark) return null;
  const p = (state.views[view] || [])[indexOf(view, mark.id)];
  const base = p ? clockSec(p) : null;
  return base == null ? null : base + mark.sec;
}
// Turn a clock time into a mark in another view
function markAtClock(view, clock) {
  const list = state.views[view] || [];
  let best = null;
  for (const p of list) { const c = clockSec(p); if (c != null && c <= clock) best = p; }
  if (!best) best = list[0];
  if (!best || clockSec(best) == null) return null;
  return { id: best.driveId, sec: Math.max(0, clock - clockSec(best)) };
}
function markOrder(view, m) { return [indexOf(view, m.id), m.sec]; }
function marksValid(view) {
  const m = state.marks[view];
  if (!m || !m.start || !m.end) return false;
  const [a, b] = [markOrder(view, m.start), markOrder(view, m.end)];
  if (a[0] < 0 || b[0] < 0) return false;
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}
function lengthOf(view) {
  const m = state.marks[view];
  const a = markClock(view, m.start);
  const b = markClock(view, m.end);
  return a != null && b != null ? b - a : null;
}

function showError(text) { $('pageError').textContent = text; $('pageError').hidden = !text; }

// ---------- getting the files ----------
async function blobFor(entry, onProgress) {
  if (state.blobs.has(entry.driveId)) return state.blobs.get(entry.driveId);
  if (!state.loading.has(entry.driveId)) {
    if (!isConnected()) throw new NotConnectedError('Connect Google to load this part from Drive, or pick the file on this PC.');
    const p = downloadFile(entry.driveId, entry.size, onProgress)
      .then((blob) => { state.blobs.set(entry.driveId, blob); renderParts(); return blob; })
      .finally(() => state.loading.delete(entry.driveId));
    state.loading.set(entry.driveId, p);
  }
  return state.loading.get(entry.driveId);
}

function pickLocal(fileList) {
  const all = Object.values(state.views).flat();
  let matched = 0;
  const strangers = [];
  for (const file of fileList) {
    const entry = all.find((p) => p.original && p.original.name === file.name && p.original.size === file.size)
      || all.find((p) => p.name === file.name && p.size === file.size);
    if (entry) { state.blobs.set(entry.driveId, file); matched += 1; } else strangers.push(file.name);
  }
  if (strangers.length) toast(`${strangers.length === 1 ? `${strangers[0]} isn't` : `${strangers.length} files aren't`} one of this game's parts.`, 6000);
  else if (matched) toast(`Using ${matched} file${matched === 1 ? '' : 's'} from this PC.`);
  renderParts();
  if (matched && !$('player').src) showPart(state.part);
}

// ---------- player ----------
async function showPart(index, seekTo = null) {
  const entry = parts()[index];
  if (!entry) return;
  state.part = index;
  renderTabs();
  const player = $('player');
  const note = $('playerNote');
  let url = state.urls.get(entry.driveId);
  if (!url) {
    note.textContent = state.blobs.has(entry.driveId) ? 'Opening…' : `Loading part ${index + 1} from Drive…`;
    try {
      const blob = await blobFor(entry, (got, size) => {
        if (state.part === index) note.textContent = `Loading part ${index + 1} from Drive: ${formatBytes(got)} of ${formatBytes(size || entry.size)}`;
      });
      url = URL.createObjectURL(blob);
      state.urls.set(entry.driveId, url);
    } catch (err) {
      note.textContent = err.message;
      return;
    }
    if (state.part !== index) return;
  }
  note.textContent = '';
  if (player.src !== url) {
    player.src = url;
    await new Promise((res) => { player.onloadedmetadata = res; player.onerror = res; });
    if (player.error) { note.textContent = "This browser can't play this file."; return; }
  }
  if (seekTo != null) player.currentTime = Math.min(Math.max(0, seekTo), Math.max(0, player.duration - 0.1));
  paintClock();
}

function paintClock() {
  const entry = current();
  const player = $('player');
  if (!entry || !player.src) { $('clock').textContent = '—'; $('partPos').textContent = ''; return; }
  const base = clockSec(entry);
  $('clock').textContent = base == null ? posText(player.currentTime) : clockText(base + player.currentTime);
  $('partPos').textContent = `Part ${state.part + 1} · ${posText(player.currentTime)}${Number.isFinite(player.duration) ? ` of ${posText(player.duration)}` : ''}`;
}

function nudge(by) {
  const player = $('player');
  if (!player.src) return;
  const t = player.currentTime + by;
  if (t < 0 && state.part > 0) { const prev = state.part - 1; showPart(prev, Infinity); return; }
  if (Number.isFinite(player.duration) && t > player.duration && state.part < parts().length - 1) { showPart(state.part + 1, t - player.duration); return; }
  player.currentTime = Math.max(0, Math.min(t, player.duration || t));
}

function goToClock(clock) {
  const m = markAtClock(state.view, clock);
  if (!m) { toast("These parts don't have start times, so pick the part and scrub to it."); return; }
  showPart(indexOf(state.view, m.id), m.sec);
}

function goToMark(which) {
  const m = state.marks[state.view] && state.marks[state.view][which];
  if (m) showPart(indexOf(state.view, m.id), m.sec);
}

// ---------- marks ----------
async function saveMarks() {
  state.record = setMarks(state.record, state.game.id, state.view, state.marks[state.view]);
  cacheRecord(state.record);
  if (state.library && isConnected()) {
    try { state.library = await saveLibrary({ ...state.library, record: state.record }); } catch { /* saved locally; tried again on the next change */ }
  }
}

function setMark(which) {
  const entry = current();
  const player = $('player');
  if (!entry || !player.src) { toast('Play a part first.'); return; }
  const m = { ...(state.marks[state.view] || {}) };
  m[which] = { id: entry.driveId, sec: Math.round(player.currentTime * 10) / 10 };
  m.estimated = false;
  state.marks[state.view] = m;
  delete state.make[state.view];
  // Fill in the other views as a starting point
  const clock = markClock(state.view, m[which]);
  for (const v of Object.keys(state.views)) {
    if (v === state.view || clock == null) continue;
    const other = { ...(state.marks[v] || {}) };
    if (other[which] && !other.estimated) continue;
    const est = markAtClock(v, clock);
    if (est) { other[which] = est; other.estimated = true; state.marks[v] = other; }
  }
  renderMarks();
  renderMake();
  saveMarks();
}

function markLabel(view, m) {
  if (!m) return 'Not set';
  const i = indexOf(view, m.id);
  const clock = markClock(view, m);
  return `${clock != null ? clockText(clock) : posText(m.sec)} · part ${i + 1}, ${posText(m.sec)}`;
}

function renderMarks() {
  const m = state.marks[state.view] || {};
  $('startMark').textContent = markLabel(state.view, m.start);
  $('endMark').textContent = markLabel(state.view, m.end);
  $('startMark').className = `mark-text${m.estimated && m.start ? ' estimated' : ''}`;
  $('endMark').className = `mark-text${m.estimated && m.end ? ' estimated' : ''}`;
  $('goStart').hidden = !m.start;
  $('goEnd').hidden = !m.end;
  const other = Object.keys(state.views).find((v) => v !== state.view);
  let note = '';
  if (m.estimated) note = `These were estimated from the ${other} marks, but the two cameras' clocks can differ a little. Check them with "Go to it" and set them again if they're off.`;
  else if (m.start && m.end && !marksValid(state.view)) note = 'The final buzzer is before puck drop. Set them again.';
  $('markNote').textContent = note;
  $('markNote').hidden = !note;
}

// ---------- rendering ----------
function renderTabs() {
  const views = Object.keys(state.views);
  $('viewTabs').replaceChildren(...(views.length > 1 ? views.map((v) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(v === state.view),
    onclick: () => { if (v !== state.view) { state.view = v; state.part = 0; $('player').removeAttribute('src'); $('player').load(); renderAll(); showPart(0); } },
  }, v)) : []));
  $('partTabs').replaceChildren(...parts().map((p, i) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(i === state.part),
    onclick: () => showPart(i),
  }, `Part ${i + 1}${clockSec(p) != null ? ` · ${clockText(clockSec(p)).replace(/:\d\d (AM|PM)$/, ' $1')}` : ''}`)));
  const sched = parseHHMMSafe(state.game && state.game.time);
  $('jumpSched').hidden = !Number.isFinite(sched);
  if (Number.isFinite(sched)) $('jumpSched').textContent = `Go to scheduled start (${timeLabel(state.game.time)})`;
}

function renderParts() {
  const items = [];
  let local = 0;
  let total = 0;
  for (const [view, list] of Object.entries(state.views)) {
    items.push(h('li', { class: 'view-label' }, view));
    list.forEach((p, i) => {
      total += 1;
      const here = state.blobs.has(p.driveId);
      if (here) local += 1;
      const loading = state.loading.has(p.driveId);
      items.push(h('li', {},
        h('span', {}, h('span', { class: 'part-name' }, `Part ${i + 1}`), ' ',
          h('span', { class: 'small muted' }, `${clockSec(p) != null ? `starts ${clockText(clockSec(p))} · ` : ''}${formatBytes(p.size)}${p.duration ? ` · ${formatDuration(p.duration)}` : ''}`)),
        h('span', { class: `pill ${here ? 'pill-good' : 'pill-none'}` }, here ? 'On this PC' : loading ? 'Loading from Drive…' : 'In Drive')));
    });
  }
  $('partsList').replaceChildren(...items);
  $('partsSummary').textContent = total ? `${local} of ${total} picked from this PC` : '';
  $('dropZone').hidden = total > 0 && local === total;
}

// Views to make: estimated marks start unticked until checked
function chosenViews() {
  return Object.keys(state.views).filter((v) => {
    if (!marksValid(v)) return false;
    return v in state.make ? state.make[v] : !state.marks[v].estimated;
  });
}

function renderMake() {
  const items = [];
  for (const view of Object.keys(state.views)) {
    const ok = marksValid(view);
    const len = ok ? lengthOf(view) : null;
    const m = state.marks[view] || {};
    const ticked = view in state.make ? state.make[view] : !m.estimated;
    const detail = ok
      ? `${clockText(markClock(view, m.start))} → ${clockText(markClock(view, m.end))}${len != null ? ` · about ${formatDuration(len)}` : ''} · from ${state.views[view].length} part${state.views[view].length === 1 ? '' : 's'}${m.estimated ? ' · marks estimated, check them' : ''}`
      : 'Set puck drop and the final buzzer first.';
    items.push(h('li', {}, h('label', {},
      h('input', { type: 'checkbox', checked: ok && ticked, disabled: !ok || state.busy, onchange: (e) => { state.make[view] = e.target.checked; renderMake(); } }),
      h('span', {}, h('strong', {}, `${view}: `), h('span', { class: ok ? '' : 'muted' }, detail)))));
  }
  for (const view of ['PANO', 'AUTO', 'Video']) {
    const done = state.record && state.game ? joinedFile(state.record, state.game.id, view) : null;
    if (done && !state.views[view]) items.push(h('li', {}, h('span', {}, h('strong', {}, `${view}: `), `Full game is in Drive (${done.duration ? formatDuration(done.duration) : formatBytes(done.size)})`), h('span', { class: 'pill pill-good' }, 'Done')));
  }
  $('makeList').replaceChildren(...items);
  const chosen = chosenViews();
  $('makeBtn').disabled = state.busy || !chosen.length;
  $('makeBtn').textContent = chosen.length > 1 ? `Make full games (${chosen.join(' + ')})` : 'Make full game';
  if (!state.busy) $('makeNote').textContent = !isConnected() && chosen.length ? 'Connect Google at the top to save it to Drive.' : '';
}

function renderAll() {
  const hasParts = Object.keys(state.views).length > 0;
  $('connectCard').hidden = isConnected();
  $('partsCard').hidden = !hasParts;
  $('markCard').hidden = !hasParts;
  $('makeCard').hidden = !state.game;
  renderParts();
  renderTabs();
  renderMarks();
  renderMake();
}

// ---------- making the full game ----------
function setProgress(fraction, text) {
  const pct = Math.round(fraction * 100);
  $('makeFill').style.width = `${pct}%`;
  $('makeProgress').setAttribute('aria-valuenow', String(pct));
  $('makeNote').textContent = text;
}

async function makeOne(view, signal) {
  const list = state.views[view];
  const m = state.marks[view];
  const a = indexOf(view, m.start.id);
  const b = indexOf(view, m.end.id);
  const used = list.slice(a, b + 1);

  const loaded = [];
  for (let i = 0; i < used.length; i += 1) {
    const entry = used[i];
    const blob = await blobFor(entry, (got, size) => setProgress(0, `${view}: loading part ${a + i + 1} from Drive (${formatBytes(got)} of ${formatBytes(size || entry.size)})…`));
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    setProgress(0, `${view}: reading part ${a + i + 1}…`);
    const reader = blobReader(blob);
    loaded.push({ reader, info: await readMp4(reader) });
  }
  const joined = buildJoin(loaded, { startPart: 0, startSec: m.start.sec, endPart: loaded.length - 1, endSec: m.end.sec });
  const name = joinedFileName(state.game, view);
  const folderId = await ensureFolder(folderPath(state.game, state.team, 'full'));
  const file = await uploadFile(joined, folderId, name, (sent) => {
    setProgress(sent / joined.size, `${view}: saving to Drive, ${formatBytes(sent)} of ${formatBytes(joined.size)}. Keep this page open.`);
  }, signal);

  const startClock = clockSec(used[0]) != null ? clockSec(used[0]) + joined.startSec : null;
  state.record = replaceWithJoined(state.record, state.game.id, list.map((p) => p.driveId), {
    driveId: file.id, name, view, size: joined.size, duration: Math.round(joined.duration),
    start: startClock != null ? Math.floor(startClock / 60) : null, startSec: startClock,
  });
  state.library = await saveLibrary({ ...state.library, record: state.record });
  cacheRecord(state.record);

  // Only now that the full game is safely recorded do the parts go to the trash
  let notTrashed = 0;
  for (const p of list) { try { await trashFile(p.driveId); } catch { notTrashed += 1; } }
  return { name, duration: joined.duration, notTrashed };
}

async function make() {
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const chosen = chosenViews();
  if (!chosen.length) return;
  state.busy = true;
  state.abort = new AbortController();
  $('stopBtn').hidden = false;
  $('makeProgress').hidden = false;
  $('doneCard').hidden = true;
  showError('');
  renderMake();
  const results = [];
  try {
    if (!state.library) {
      const out = await loadGoogle();
      if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive. Try again in a minute.");
      state.library = out.library;
    }
    for (const view of chosen) {
      const r = await makeOne(view, state.abort.signal);
      results.push({ view, ...r });
      delete state.views[view];
    }
  } catch (err) {
    if (err.name === 'AbortError') toast('Stopped. Nothing was changed for the view that was in progress.');
    else if (err instanceof NotConnectedError) toast('Google sign-in ran out. Press Reconnect Google, then Make full game again.', 8000);
    else if (err instanceof Mp4Error) showError(err.message);
    else showError(`Couldn't make the full game: ${err.message}`);
  } finally {
    state.busy = false;
    state.abort = null;
    $('stopBtn').hidden = true;
    $('makeProgress').hidden = true;
    if (!Object.keys(state.views).includes(state.view)) {
      state.view = Object.keys(state.views)[0] || '';
      state.part = 0;
      $('player').removeAttribute('src');
      $('player').load();
      if (state.view) showPart(0);
    }
    renderAll();
  }
  if (results.length) {
    const bits = results.map((r) => `${r.view}: ${formatDuration(r.duration)}`);
    const trashNote = results.some((r) => r.notTrashed) ? ' Some parts couldn\'t be moved to the trash; you can delete them in Drive.' : ' The parts are in Drive\'s trash.';
    $('doneText').textContent = `Saved the full game to Drive (${bits.join(', ')}).${trashNote}`;
    $('doneCard').hidden = false;
    $('driveLink').hidden = true;
    ensureFolder(folderPath(state.game, state.team, 'full')).then((id) => { $('driveLink').href = driveFolderLink(id); $('driveLink').hidden = false; }).catch(() => {});
  }
}

// ---------- page setup ----------
function loadFromRecord() {
  state.views = partsByView(state.record, gameId);
  const saved = (state.record.games[gameId] && state.record.games[gameId].marks) || {};
  for (const v of Object.keys(state.views)) if (!state.marks[v] && saved[v]) state.marks[v] = saved[v];
  if (!state.views[state.view]) { state.view = state.views.PANO ? 'PANO' : Object.keys(state.views)[0] || ''; state.part = 0; }
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) {
    state.library = out.library;
    state.record = out.library.record;
    loadFromRecord();
  }
  if (out && out.problems.length) toast(out.problems.join(' '), 8000);
  renderAll();
  if (state.view && !$('player').src && state.blobs.size) showPart(state.part);
  else if (state.view && !$('player').src) $('playerNote').textContent = 'Pick a part above to load it, or pick the files on this PC for a faster start.';
}

function wire() {
  $('fileInput').addEventListener('change', (e) => { pickLocal([...e.target.files]); e.target.value = ''; });
  const zone = $('dropZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragging'); pickLocal([...e.dataTransfer.files]); });
  const player = $('player');
  player.addEventListener('timeupdate', paintClock);
  player.addEventListener('seeked', paintClock);
  $('back10').addEventListener('click', () => nudge(-10));
  $('back1').addEventListener('click', () => nudge(-1));
  $('fwd1').addEventListener('click', () => nudge(1));
  $('fwd10').addEventListener('click', () => nudge(10));
  $('jumpSched').addEventListener('click', () => { const t = parseHHMMSafe(state.game.time); if (Number.isFinite(t)) goToClock(t * 60); });
  $('setStart').addEventListener('click', () => setMark('start'));
  $('setEnd').addEventListener('click', () => setMark('end'));
  $('goStart').addEventListener('click', () => goToMark('start'));
  $('goEnd').addEventListener('click', () => goToMark('end'));
  $('makeBtn').addEventListener('click', make);
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
  $('title').textContent = `${state.game.opponentLabel}`;
  $('subtitle').textContent = `${state.game.kid} · ${state.team ? state.team.label : ''} · ${dayLabel(state.game.date)} · ${timeLabel(state.game.time)} · ${state.game.rink || ''}`.replace(/ · $/, '');
  document.title = `${state.game.opponentLabel} · Family Watch Party`;
  loadFromRecord();
  renderAll();
  if (isConnected()) { await onConnected(); return; }
  if (!Object.keys(state.views).length) {
    const done = ['PANO', 'AUTO', 'Video'].some((v) => joinedFile(state.record, gameId, v));
    if (!done && !isConnected()) $('makeNote').textContent = 'Connect Google to load this game\'s files.';
  } else if (!isConnected()) {
    $('playerNote').textContent = 'Pick the files on this PC to start, or connect Google to load them from Drive.';
  }
}

start();
