// Clips: every clip in the Family Hockey folder, by kid, with play, save, share and open in Drive.
import { TEAMS } from './config.js';
import { dayLabel } from './games.js';
import { $, h, toast, formatBytes, formatDuration, driveFileLink, readSaved, save } from './ui.js';
import { isConnected } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, combine, loadGoogle } from './data.js';
import { downloadFile } from './drive.js';
import { clipList, reelFolderPath, addReel, reelList, safeName } from './library.js';
import { ensureFolder, uploadFile, saveLibrary } from './drive.js';
import { cacheRecord } from './data.js';
import { reelGroups, reelPlan, reelLength, reelName } from './reel.js';
import { drawTitle, recordReel } from './reel-render.js';
import { audioFor } from './clip-render.js';
import { SHAPES } from './clip-edit.js';
import { saveBlobAs, shareBlob } from './share.js';
import { streamReady, streamUrl } from './stream.js';

const state = {
  record: cachedRecord(),
  games: new Map(),
  kid: readSaved('fwp.clipsKid', 'all'),
  blobs: new Map(),
  playingUrl: '',
  library: null,
  reel: null,      // { kid, shape, titles, picked: Set, title }
  reelBusy: null,
  reelVideo: null,
  reelAudio: null,
  reelResult: null,
};

const title = (clip) => String(clip.name || 'Clip').replace(/\.[a-z0-9]{2,4}$/i, '');

async function blobFor(clip) {
  if (state.blobs.has(clip.driveId)) return state.blobs.get(clip.driveId);
  if (!isConnected()) throw new Error('Connect Google first.');
  const blob = await downloadFile(clip.driveId, clip.size);
  state.blobs.set(clip.driveId, blob);
  return blob;
}

async function play(clip) {
  $('playerCard').hidden = false;
  $('player-h').textContent = title(clip);
  $('playerSub').textContent = describe(clip);
  $('playerNote').textContent = 'Loading from Drive…';
  $('playerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    if (!isConnected()) throw new Error('Connect Google first.');
    let src;
    try {
      await streamReady();
      src = streamUrl(clip.driveId, clip.size);
    } catch {
      const blob = await blobFor(clip);
      if (state.playingUrl) URL.revokeObjectURL(state.playingUrl);
      state.playingUrl = URL.createObjectURL(blob);
      src = state.playingUrl;
    }
    $('player').src = src;
    $('playerNote').textContent = '';
    $('player').play().catch(() => {});
  } catch (err) {
    $('playerNote').textContent = err.message;
  }
}

async function saveClip(clip, btn) {
  btn.disabled = true;
  try { await saveBlobAs(await blobFor(clip), clip.name); } catch (err) { toast(`Couldn't save it: ${err.message}`, 6000); } finally { btn.disabled = false; }
}

async function shareClip(clip, btn) {
  btn.disabled = true;
  try { await shareBlob(await blobFor(clip), clip.name, title(clip)); } catch (err) { toast(`Couldn't share it: ${err.message}`, 6000); } finally { btn.disabled = false; }
}

function describe(clip) {
  const g = clip.game;
  const bits = [];
  if (clip.reel) bits.push(clip.kid, `made ${String(clip.addedAt || '').slice(0, 10)}`, `${(clip.clipIds || []).length} clips`);
  if (g) bits.push(g.kid, dayLabel(g.date), g.opponentLabel);
  if (clip.duration) bits.push(formatDuration(clip.duration));
  bits.push(formatBytes(clip.size));
  return bits.filter(Boolean).join(' · ');
}

function clipCard(clip) {
  const saveBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: () => saveClip(clip, saveBtn) }, 'Save');
  const shareBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: () => shareClip(clip, shareBtn) }, 'Share');
  return h('article', { class: 'card clip-card' },
    h('h3', { class: 'clip-title' }, title(clip)),
    h('p', { class: 'small muted' }, describe(clip)),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => play(clip) }, 'Play'),
      saveBtn, shareBtn,
      h('a', { class: 'btn btn-small', href: driveFileLink(clip.driveId), target: '_blank', rel: 'noopener' }, 'Open in Drive')));
}

function renderFilter() {
  const options = [{ key: 'all', text: 'Both kids' }, ...TEAMS.map((t) => ({ key: t.kid, text: t.kid }))];
  $('kidFilter').replaceChildren(...options.map((o) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(state.kid === o.key),
    onclick: () => { state.kid = o.key; save('fwp.clipsKid', o.key); render(); },
  }, o.text)));
}

function render() {
  renderFilter();
  $('connectCard').hidden = isConnected();
  const all = clipList(state.record, state.games);
  const shown = all.filter((c) => state.kid === 'all' || (c.game && c.game.kid === state.kid));
  $('clipGrid').replaceChildren(...shown.map(clipCard));
  $('summary').textContent = shown.length ? `${shown.length} clip${shown.length === 1 ? '' : 's'} · ${formatBytes(shown.reduce((s, c) => s + (c.size || 0), 0))}` : '';
  $('list-h').textContent = state.kid === 'all' ? 'All clips' : `${state.kid}'s clips`;
  $('emptyCard').hidden = shown.length > 0;
  const reels = reelList(state.record, state.kid === 'all' ? '' : state.kid).map((r) => ({ ...r, reel: true, game: null }));
  $('reelsSection').hidden = !reels.length;
  $('reelsGrid').replaceChildren(...reels.map(clipCard));
  $('reelsSummary').textContent = reels.length ? `${reels.length} reel${reels.length === 1 ? '' : 's'}` : '';
  $('reelBtn').disabled = !all.length;
  $('emptyText').textContent = all.length && !shown.length
    ? `No clips for ${state.kid} yet.`
    : 'Clips you make on a game\'s page (Watch the game → Make a clip) or import show up here, sorted by game.';
}

// ---------- highlight reels ----------
const teamOf = (kid) => TEAMS.find((t) => t.kid === kid);

function openReel() {
  const kid = state.kid !== 'all' ? state.kid : (TEAMS.find((t) => clipList(state.record, state.games).some((c) => c.game && c.game.kid === t.kid)) || TEAMS[0]).kid;
  setReelKid(kid);
  $('reelCard').hidden = false;
  $('reelCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setReelKid(kid) {
  const team = teamOf(kid);
  const groups = reelGroups(clipList(state.record, state.games), kid);
  state.reel = {
    kid, shape: state.reel ? state.reel.shape : 'wide', titles: state.reel ? state.reel.titles : true,
    picked: new Set(groups.flatMap((g) => g.clips.map((c) => c.driveId))),
    title: `${kid}'s highlights`,
    sub: team ? `${team.season} ${team.label}` : '',
  };
  $('reelTitle').value = state.reel.title;
  clearReelResult();
  renderReel();
}

function reelSteps() {
  const groups = reelGroups(clipList(state.record, state.games), state.reel.kid);
  return reelPlan({ groups, picked: state.reel.picked, titles: state.reel.titles, heading: state.reel.title, subheading: state.reel.sub, dayLabel });
}

function renderReel() {
  if (!state.reel) return;
  const r = state.reel;
  const busy = Boolean(state.reelBusy);
  $('reelKid').replaceChildren(...TEAMS.map((t) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(r.kid === t.kid), disabled: busy, onclick: () => setReelKid(t.kid),
  }, t.kid)));
  $('reelShape').replaceChildren(...Object.entries(SHAPES).map(([key, sh]) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(r.shape === key), disabled: busy,
    onclick: () => { r.shape = key; clearReelResult(); renderReel(); },
  }, sh.label)));
  $('reelTitles').checked = r.titles;
  const groups = reelGroups(clipList(state.record, state.games), r.kid);
  $('reelList').replaceChildren(...(groups.length ? groups.map((g) => h('li', {},
    h('strong', {}, `${dayLabel(g.game.date)} · ${g.game.opponentLabel}${g.game.result ? ` · ${g.game.result.outcome} ${g.game.result.us}–${g.game.result.them}` : ''}`),
    ...g.clips.map((c) => h('label', {},
      h('input', { type: 'checkbox', checked: r.picked.has(c.driveId), disabled: busy, onchange: (e) => { if (e.target.checked) r.picked.add(c.driveId); else r.picked.delete(c.driveId); clearReelResult(); renderReel(); } }),
      h('span', {}, `${title(c)}${c.duration ? ` · ${formatDuration(c.duration)}` : ''}`)))))
    : [h('li', {}, h('span', { class: 'muted' }, `No clips for ${r.kid} yet.`))]));
  const steps = reelSteps();
  const clips = steps.filter((s) => s.type === 'clip').length;
  $('reelSummary').textContent = `${clips} clip${clips === 1 ? '' : 's'} · about ${formatDuration(reelLength(steps))}`;
  $('reelMake').disabled = busy || !clips;
  $('reelStop').hidden = !busy;
  $('reelAll').disabled = busy;
  $('reelNone').disabled = busy;
  $('reelTitles').disabled = busy;
  $('reelTitle').disabled = busy;
  if (!busy) {
    const canvas = $('reelCanvas');
    const { w, h: hh } = SHAPES[r.shape];
    canvas.width = w;
    canvas.height = hh;
    $('reelStage').classList.toggle('tall', r.shape === 'tall');
    drawTitle(canvas.getContext('2d'), r.shape, [r.title, r.sub].filter(Boolean), { big: true });
  }
}

function clearReelResult() {
  if (state.reelResult) { URL.revokeObjectURL($('reelVideo').src); state.reelResult = null; }
  $('reelResult').hidden = true;
}

async function makeReel() {
  if (!isConnected()) { toast('Connect Google first.'); return; }
  const r = state.reel;
  const steps = reelSteps();
  if (!steps.some((s) => s.type === 'clip')) return;
  state.reelBusy = new AbortController();
  clearReelResult();
  $('reelProgress').hidden = false;
  renderReel();
  const setP = (done, total) => {
    const pct = Math.round((done / (total || 1)) * 100);
    $('reelFill').style.width = `${pct}%`;
    $('reelProgress').setAttribute('aria-valuenow', String(pct));
    $('reelStatus').textContent = `Making the reel: ${formatDuration(done)} of ${formatDuration(total)}. Keep this tab in front.`;
  };
  try {
    const urls = [];
    for (const s of steps) if (s.type === 'clip') s.load = () => blobFor(s.clip).then((blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; });
    state.reelUrls = urls;
    if (!state.reelVideo) {
      state.reelVideo = h('video', { playsinline: true, preload: 'auto', class: 'clip-source' });
      $('reelStage').append(state.reelVideo);
      state.reelAudio = audioFor(state.reelVideo);
    }
    const blob = await recordReel({
      video: state.reelVideo, canvas: $('reelCanvas'), shape: r.shape, steps, audio: state.reelAudio,
      signal: state.reelBusy.signal, onProgress: setP, total: reelLength(steps),
    });
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const team = teamOf(r.kid);
    const name = `${safeName(r.title === `${r.kid}'s highlights` ? reelName(r.kid, team) : r.title)}.${ext}`;
    state.reelResult = { blob, name };
    $('reelVideo').src = URL.createObjectURL(blob);
    $('reelResult').hidden = false;
    $('reelStatus').textContent = `${formatBytes(blob.size)} · saving to Drive…`;
    if (!state.library) {
      const out = await loadGoogle();
      if (!out || !out.library) throw new Error("Couldn't open the Family Hockey folder in Drive.");
      state.library = out.library;
      state.record = out.library.record;
    }
    const folderId = await ensureFolder(reelFolderPath(team));
    const saved = await uploadFile(new File([blob], name, { type: blob.type }), folderId, name, (sent) => {
      $('reelStatus').textContent = `Saving to Drive: ${formatBytes(sent)} of ${formatBytes(blob.size)}`;
    });
    state.record = addReel(state.record, {
      driveId: saved.id, name, kid: r.kid, size: blob.size, duration: Math.round(reelLength(steps)), shape: r.shape,
      clipIds: steps.filter((s) => s.type === 'clip').map((s) => s.clip.driveId),
    });
    state.library = await saveLibrary({ ...state.library, record: state.record });
    cacheRecord(state.record);
    $('reelStatus').textContent = `Saved to Drive in ${reelFolderPath(team).slice(1).join(' › ')} as ${name}.`;
  } catch (err) {
    $('reelStatus').textContent = err.name === 'AbortError' ? 'Stopped. Nothing was saved.' : `Something went wrong: ${err.message}${state.reelResult ? ' You can still save the reel to this PC.' : ''}`;
  } finally {
    for (const u of state.reelUrls || []) URL.revokeObjectURL(u);
    state.reelUrls = [];
    state.reelBusy = null;
    $('reelProgress').hidden = true;
    renderReel();
    render();
  }
}

function setupReel() {
  $('reelBtn').addEventListener('click', openReel);
  $('reelClose').addEventListener('click', () => { if (state.reelBusy) state.reelBusy.abort(); $('reelCard').hidden = true; });
  $('reelTitles').addEventListener('change', (e) => { state.reel.titles = e.target.checked; clearReelResult(); renderReel(); });
  $('reelTitle').addEventListener('input', (e) => { state.reel.title = e.target.value.trim() || `${state.reel.kid}'s highlights`; clearReelResult(); renderReel(); });
  $('reelAll').addEventListener('click', () => { reelGroups(clipList(state.record, state.games), state.reel.kid).forEach((g) => g.clips.forEach((c) => state.reel.picked.add(c.driveId))); clearReelResult(); renderReel(); });
  $('reelNone').addEventListener('click', () => { state.reel.picked.clear(); clearReelResult(); renderReel(); });
  $('reelMake').addEventListener('click', makeReel);
  $('reelStop').addEventListener('click', () => { if (state.reelBusy) state.reelBusy.abort(); });
  $('reelSave').addEventListener('click', () => state.reelResult && saveBlobAs(state.reelResult.blob, state.reelResult.name).catch((e) => toast(`Couldn't save it: ${e.message}`, 6000)));
  $('reelShare').addEventListener('click', () => state.reelResult && shareBlob(state.reelResult.blob, state.reelResult.name, state.reel.title));
  window.addEventListener('beforeunload', (e) => { if (state.reelBusy) { e.preventDefault(); e.returnValue = ''; } });
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) { state.record = out.library.record; state.library = out.library; }
  renderReel();
  if (out && out.teamsnap) {
    const league = [...state.games.values()].filter((g) => g.source !== 'teamsnap');
    state.games = new Map(combine(league, out.teamsnap).map((g) => [g.id, g]));
  }
  if (out && out.problems.length) toast(out.problems.join(' '), 8000);
  render();
}

async function start() {
  setupHeader(onConnected);
  setupReel();
  $('closePlayer').addEventListener('click', () => {
    $('player').pause();
    $('player').removeAttribute('src');
    $('player').load();
    $('playerCard').hidden = true;
  });
  render();
  try {
    const league = await loadLeague();
    state.games = new Map(combine(league.games, cachedTeamSnap()).map((g) => [g.id, g]));
  } catch {
    toast("Couldn't load the schedules, so clips may show without their game.", 6000);
  }
  render();
  if (isConnected()) await onConnected();
}

if (typeof document !== 'undefined' && document.getElementById('clipGrid')) start();
