// Import downloads: match files on this PC to games, mark where each game starts and ends,
// then upload one full-game file per camera view (and clips as they are) to Drive.
import { TEAMS } from './config.js';
import { dayLabel, timeLabel } from './games.js';
import { parseVideoFileName, matchFile, viewFromSize, kindFor } from './import-match.js';
import { alreadyImported, downloadedIds, joinedFile, partsByView } from './library.js';
import { $, h, toast, formatBytes, formatDuration, driveFolderLink, readMeta } from './ui.js';
import { isConnected, NotConnectedError } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, cacheRecord, combine, loadGoogle } from './data.js';
import { loadLibrary } from './drive.js';
import { Mp4Error } from './mp4.js';
import { createMarker, marksValid, markClock, clockText, lengthOf, cutFor } from './marker.js';
import { prepareJoin, publishJoined, publishClip } from './publish.js';

const state = {
  games: [],
  league: [],
  teamsnap: cachedTeamSnap(),
  record: cachedRecord(),
  library: null,
  rows: [],
  groups: {},          // gameId -> { marks, whole }
  marking: '',         // gameId open in the marking panel
  marker: null,
  uploading: false,
  stop: false,
  nextId: 1,
};

const gameById = (id) => state.games.find((g) => g.id === id) || null;
const teamFor = (game) => TEAMS.find((t) => t.key === game.teamKey);
const groupFor = (id) => { state.groups[id] = state.groups[id] || { marks: {}, whole: false }; return state.groups[id]; };

// ---------- reading files ----------
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
    row.view = viewFromSize(row.meta.width, row.meta.height) || 'Video';
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

// ---------- games and their parts ----------
const included = () => state.rows.filter((r) => r.include && r.gameId && r.state !== 'done' && r.state !== 'reading');

// Why a game's files for a view can't be joined here (empty when they can)
function blockFor(gameId, view) {
  if (joinedFile(state.record, gameId, view)) return `already has a full ${view} file in Drive`;
  if ((partsByView(state.record, gameId)[view] || []).length) return `has ${view} parts in Drive already: open the game's page to finish it`;
  return '';
}

export function groupRows(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.gameId)) out.set(r.gameId, { gameId: r.gameId, full: [], clips: [] });
    out.get(r.gameId)[r.kind === 'clip' ? 'clips' : 'full'].push(r);
  }
  return [...out.values()];
}

function viewsFor(group) {
  const out = {};
  for (const r of group.full) {
    if (blockFor(group.gameId, r.view)) continue;
    (out[r.view] = out[r.view] || []).push({
      id: `row-${r.id}`, row: r, file: r.file, size: r.file.size,
      clock: Number.isFinite(r.parsed.seconds) ? r.parsed.seconds : null, duration: r.meta && r.meta.duration,
    });
  }
  for (const v of Object.keys(out)) out[v].sort((a, b) => (a.clock ?? Infinity) - (b.clock ?? Infinity) || a.file.name.localeCompare(b.file.name));
  return out;
}

function groupReady(group) {
  const views = viewsFor(group);
  const g = groupFor(group.gameId);
  return Object.keys(views).every((v) => g.whole || marksValid(views, g.marks, v));
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
  if (row.view && row.view !== 'Video') bits.push(row.view);
  if (Number.isFinite(row.parsed.seconds)) bits.push(`starts ${clockText(row.parsed.seconds)}`);
  return bits.join(' · ');
}

function statusCell(row) {
  if (row.state === 'reading') return [h('span', { class: 'pill pill-none' }, 'Reading…')];
  if (row.state === 'uploading') {
    const pct = Math.round(row.sent * 100) || 0;
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
      onchange: (e) => { row.include = e.target.checked; render(); },
    })),
    h('td', { class: 'c-file' }, h('span', { class: 'file-name' }, row.file.name), h('span', { class: 'sub' }, describe(row))),
    h('td', { class: 'c-type' }, h('select', {
      'aria-label': `Type of ${row.file.name}`, disabled: locked,
      onchange: (e) => { row.kind = e.target.value; render(); },
    }, h('option', { value: 'full', selected: row.kind === 'full' }, 'Full game file'), h('option', { value: 'clip', selected: row.kind === 'clip' }, 'Clip'))),
    h('td', { class: 'c-game' }, h('select', {
      'aria-label': `Game for ${row.file.name}`, disabled: locked,
      onchange: (e) => { row.gameId = e.target.value; row.confidence = 'picked'; row.include = Boolean(row.gameId); render(); },
    }, ...gameOptions(row.gameId))),
    h('td', { class: 'c-status' }, ...statusCell(row)),
  );
}

function groupText(group) {
  const views = viewsFor(group);
  const g = groupFor(group.gameId);
  const bits = [];
  for (const [view, parts] of Object.entries(views)) {
    if (g.whole) bits.push(`${view}: whole files, ${parts.length} part${parts.length === 1 ? '' : 's'}`);
    else if (marksValid(views, g.marks, view)) {
      const m = g.marks[view];
      const len = lengthOf(views, g.marks, view);
      bits.push(`${view}: ${clockText(markClock(views, view, m.start))} → ${clockText(markClock(views, view, m.end))}${len != null ? ` (${formatDuration(len)})` : ''}${m.estimated ? ', estimated: check it' : ''}`);
    } else bits.push(`${view}: ${parts.length} part${parts.length === 1 ? '' : 's'}, not marked yet`);
  }
  const blocked = [...new Set(group.full.map((r) => r.view))].map((v) => [v, blockFor(group.gameId, v)]).filter(([, why]) => why);
  for (const [, why] of blocked) bits.push(`skipped: this game ${why}`);
  if (group.clips.length) bits.push(`${group.clips.length} clip${group.clips.length === 1 ? '' : 's'} as they are`);
  return bits.join(' · ');
}

function groupEl(group) {
  const game = gameById(group.gameId);
  const g = groupFor(group.gameId);
  const views = viewsFor(group);
  const hasFull = Object.keys(views).length > 0;
  const ready = groupReady(group);
  const locked = state.uploading;
  const pill = !hasFull ? h('span', { class: 'pill pill-info' }, 'Clips only')
    : ready ? h('span', { class: 'pill pill-good' }, g.whole ? 'Whole files' : 'Marked')
      : h('span', { class: 'pill pill-work' }, 'Needs marking');
  return h('li', {},
    h('div', { class: 'group-main' },
      h('strong', {}, game ? `${dayLabel(game.date)} · ${game.kid} · ${game.opponentLabel}` : 'Unknown game'),
      h('span', { class: 'small muted' }, groupText(group))),
    h('div', { class: 'group-actions' },
      pill,
      hasFull ? h('label', {}, h('input', {
        type: 'checkbox', checked: g.whole, disabled: locked,
        onchange: (e) => { g.whole = e.target.checked; if (g.whole && state.marking === group.gameId) closeMarker(); render(); },
      }), 'Use whole files') : null,
      hasFull && !g.whole ? h('button', {
        type: 'button', class: `btn btn-small${ready ? '' : ' btn-primary'}`, disabled: locked,
        onclick: () => openMarker(group.gameId),
      }, ready ? 'Change marks' : 'Mark start & end') : null));
}

function uploadPlan() {
  const groups = groupRows(included());
  const ready = groups.filter((gr) => groupReady(gr));
  const waiting = groups.filter((gr) => !groupReady(gr));
  let bytes = 0;
  let games = 0;
  let clips = 0;
  for (const gr of ready) {
    const views = viewsFor(gr);
    if (Object.keys(views).length) games += 1;
    for (const parts of Object.values(views)) bytes += parts.reduce((s, p) => s + p.size, 0);
    clips += gr.clips.length;
    bytes += gr.clips.reduce((s, r) => s + r.file.size, 0);
  }
  return { groups, ready, waiting, bytes, games, clips };
}

function renderFooter() {
  const plan = uploadPlan();
  const btn = $('uploadBtn');
  const what = [plan.games ? `${plan.games} game${plan.games === 1 ? '' : 's'}` : '', plan.clips ? `${plan.clips} clip${plan.clips === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  btn.textContent = what ? `Upload ${what} to Drive (about ${formatBytes(plan.bytes)})` : 'Upload to Drive';
  btn.disabled = state.uploading || !what;
  $('stopBtn').hidden = !state.uploading;
  $('clearBtn').disabled = state.uploading;
  if (!state.uploading) {
    const notes = [];
    if (!isConnected() && what) notes.push('Connect Google at the top to upload.');
    if (plan.waiting.length) notes.push(`${plan.waiting.length} game${plan.waiting.length === 1 ? ' still needs' : 's still need'} marking and will wait.`);
    else if (what) notes.push('Keep this page open while it uploads.');
    $('uploadNote').textContent = notes.join(' ');
  }
  $('gamesSummary').textContent = plan.groups.length ? `${plan.ready.length} of ${plan.groups.length} ready` : '';

  const counts = { matched: 0, check: 0, pick: 0, already: 0 };
  for (const r of state.rows) {
    if (r.state === 'skipped') counts.already += 1;
    else if (!r.gameId) counts.pick += 1;
    else if (r.confidence === 'low') counts.check += 1;
    else counts.matched += 1;
  }
  $('reviewSummary').textContent = `${state.rows.length} file${state.rows.length === 1 ? '' : 's'}: ${counts.matched} matched, ${counts.check} to check, ${counts.pick} to pick${counts.already ? `, ${counts.already} already in Drive` : ''}`;
}

function render() {
  $('connectCard').hidden = isConnected();
  $('importBody').replaceChildren(...state.rows.map(rowEl));
  const groups = groupRows(included());
  $('gamesCard').hidden = !groups.length && !state.uploading;
  $('gameList').replaceChildren(...groups.map(groupEl));
  if (state.marker) {
    const group = groups.find((gr) => gr.gameId === state.marking);
    const views = group ? viewsFor(group) : {};
    if (!Object.keys(views).length) closeMarker(); else state.marker.setViews(views);
  }
  renderFooter();
}

// ---------- marking ----------
function openMarker(gameId) {
  closeMarker();
  const group = groupRows(included()).find((gr) => gr.gameId === gameId);
  if (!group) return;
  const game = gameById(gameId);
  const g = groupFor(gameId);
  state.marking = gameId;
  state.marker = createMarker({
    views: viewsFor(group), marks: g.marks, game,
    getBlob: (part) => Promise.resolve(part.file),
    onChange: (marks) => { g.marks = marks; render(); },
  });
  $('markerRoot').replaceChildren(state.marker.el);
  $('markTitle').textContent = game ? `${dayLabel(game.date)} · ${game.opponentLabel}` : 'Mark the game';
  $('markSub').textContent = game ? `${game.kid} · scheduled ${timeLabel(game.time)}${game.rink ? ` · ${game.rink}` : ''}. Set puck drop and the final buzzer, then press Done marking.` : '';
  $('markPanel').hidden = false;
  state.marker.start();
  $('markPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeMarker() {
  if (state.marker) state.marker.destroy();
  state.marker = null;
  state.marking = '';
  $('markPanel').hidden = true;
}

// ---------- uploading ----------
async function upload() {
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const plan = uploadPlan();
  if (!plan.ready.length) return;
  closeMarker();
  state.uploading = true;
  state.stop = false;
  const before = downloadedIds(state.record);
  let doneBytes = 0;
  let uploadedGames = 0;
  let uploadedClips = 0;
  let notTrashed = 0;
  $('overall').hidden = false;
  const setOverall = (sentOfItem) => {
    const pct = Math.min(100, Math.round(((doneBytes + sentOfItem) / plan.bytes) * 100));
    $('overallFill').style.width = `${pct}%`;
    $('overall').setAttribute('aria-valuenow', String(pct));
    $('uploadNote').textContent = `Uploading: about ${pct}% of ${formatBytes(plan.bytes)}. Keep this page open.`;
  };
  render();

  try {
    if (!state.library) state.library = await loadLibrary();
    state.record = state.library.record;
    for (const group of plan.ready) {
      if (state.stop) break;
      const game = gameById(group.gameId);
      const team = game && teamFor(game);
      const g = groupFor(group.gameId);
      if (!game) { for (const r of [...group.full, ...group.clips]) { r.state = 'error'; r.error = 'That game is no longer in the list.'; } continue; }
      const views = viewsFor(group);
      for (const [view, parts] of Object.entries(views)) {
        const rows = parts.map((p) => p.row);
        const share = parts.reduce((s, p) => s + p.size, 0);
        for (const r of rows) { r.state = 'uploading'; r.sent = 0; }
        render();
        try {
          $('uploadNote').textContent = `${game.opponentLabel} ${view}: reading the files…`;
          const { joined, used } = await prepareJoin(parts, cutFor(views, g.marks, view, g.whole), (p) => Promise.resolve(p.file));
          let lastPaint = 0;
          const out = await publishJoined({
            joined, used, parts, game, team, view, record: state.record, library: state.library,
            onSent: (sent) => {
              const f = sent / joined.size;
              for (const r of rows) r.sent = f;
              setOverall(f * share);
              if (Date.now() - lastPaint > 500) { lastPaint = Date.now(); render(); }
            },
          });
          state.record = out.record;
          state.library = out.library;
          cacheRecord(state.record);
          notTrashed += out.notTrashed;
          for (const r of rows) { r.state = 'done'; r.savedAs = out.name; r.include = false; }
          uploadedGames += 1;
        } catch (err) {
          if (err instanceof NotConnectedError) throw err;
          for (const r of rows) { r.state = 'error'; r.error = err instanceof Mp4Error ? err.message : `Couldn't save it: ${err.message}`; }
        }
        doneBytes += share;
        render();
      }
      for (const r of group.clips) {
        if (state.stop) break;
        r.state = 'uploading';
        r.sent = 0;
        render();
        try {
          let lastPaint = 0;
          const out = await publishClip({
            file: r.file, duration: r.meta && r.meta.duration, game, team, record: state.record, library: state.library,
            onSent: (sent) => { r.sent = sent / r.file.size; setOverall(sent); if (Date.now() - lastPaint > 500) { lastPaint = Date.now(); render(); } },
          });
          state.record = out.record;
          state.library = out.library;
          cacheRecord(state.record);
          r.state = 'done';
          r.savedAs = out.name;
          r.include = false;
          uploadedClips += 1;
        } catch (err) {
          if (err instanceof NotConnectedError) throw err;
          r.state = 'error';
          r.error = err.message;
        }
        doneBytes += r.file.size;
        render();
      }
      delete state.groups[group.gameId];
    }
  } catch (err) {
    for (const r of state.rows) if (r.state === 'uploading') { r.state = 'error'; r.error = 'Stopped: Google sign-in ran out.'; }
    toast(err instanceof NotConnectedError ? 'Google sign-in ran out. Press Reconnect Google, then Upload again. Finished games are kept.' : err.message, 8000);
  } finally {
    state.uploading = false;
    $('overall').hidden = true;
    render();
  }

  const newGames = [...downloadedIds(state.record)].filter((id) => !before.has(id)).length;
  const failed = state.rows.filter((r) => r.state === 'error').length;
  const parts = [];
  if (uploadedGames) parts.push(`${uploadedGames} full-game file${uploadedGames === 1 ? '' : 's'}`);
  if (uploadedClips) parts.push(`${uploadedClips} clip${uploadedClips === 1 ? '' : 's'}`);
  $('doneText').textContent = `Uploaded ${parts.join(' and ') || 'nothing'}. ${newGames} game${newGames === 1 ? ' is' : 's are'} now marked Downloaded.${failed ? ` ${failed} file${failed === 1 ? '' : 's'} didn't upload; they're marked in the list and can be tried again.` : ''}${notTrashed ? ' Some old parts couldn\'t be moved to the trash.' : ''}`;
  if (state.library) $('driveLink').href = driveFolderLink(state.library.rootId);
  $('driveLink').hidden = !state.library;
  $('doneCard').hidden = !parts.length && !failed;
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
  $('stopBtn').addEventListener('click', () => { state.stop = true; $('uploadNote').textContent = 'Stopping after this game…'; });
  $('clearBtn').addEventListener('click', () => { closeMarker(); state.rows = []; state.groups = {}; $('reviewCard').hidden = true; $('doneCard').hidden = true; render(); });
  $('markClose').addEventListener('click', () => { closeMarker(); $('gamesCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
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
  if (isConnected()) await onConnected();
}

$('driveLink').hidden = true;
start();
