// Clips: every clip in the Family Hockey folder, by kid, with play, save, share and open in Drive.
import { TEAMS } from './config.js';
import { dayLabel } from './games.js';
import { $, h, toast, formatBytes, formatDuration, driveFileLink, readSaved, save } from './ui.js';
import { isConnected } from './google.js';
import { setupHeader } from './header.js';
import { loadLeague, cachedTeamSnap, cachedRecord, combine, loadGoogle } from './data.js';
import { downloadFile } from './drive.js';
import { clipList } from './library.js';

const state = {
  record: cachedRecord(),
  games: new Map(),
  kid: readSaved('fwp.clipsKid', 'all'),
  blobs: new Map(),
  playingUrl: '',
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
    const blob = await blobFor(clip);
    if (state.playingUrl) URL.revokeObjectURL(state.playingUrl);
    state.playingUrl = URL.createObjectURL(blob);
    $('player').src = state.playingUrl;
    $('playerNote').textContent = '';
    $('player').play().catch(() => {});
  } catch (err) {
    $('playerNote').textContent = err.message;
  }
}

async function saveClip(clip, btn) {
  btn.disabled = true;
  try {
    const blob = await blobFor(clip);
    if (window.showSaveFilePicker) {
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: clip.name, types: [{ description: 'Video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast(`Saved ${clip.name}.`);
    } else {
      const a = h('a', { href: URL.createObjectURL(blob), download: clip.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
  } catch (err) {
    toast(`Couldn't save it: ${err.message}`, 6000);
  } finally {
    btn.disabled = false;
  }
}

async function shareClip(clip, btn) {
  btn.disabled = true;
  try {
    const blob = await blobFor(clip);
    const file = new File([blob], clip.name, { type: blob.type || 'video/mp4' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
      toast("This browser can't share video files. Use Save, then send it from your PC.", 6000);
      return;
    }
    await navigator.share({ files: [file], title: title(clip) });
  } catch (err) {
    if (err.name !== 'AbortError') toast(`Couldn't share it: ${err.message}`, 6000);
  } finally {
    btn.disabled = false;
  }
}

function describe(clip) {
  const g = clip.game;
  const bits = [];
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
  $('emptyText').textContent = all.length && !shown.length
    ? `No clips for ${state.kid} yet.`
    : 'Clips you import show up here, sorted by game. Making clips from a full game comes with the clip editor in a later update.';
}

async function onConnected() {
  const out = await loadGoogle();
  if (out && out.library) state.record = out.library.record;
  if (out && out.teamsnap) {
    const league = [...state.games.values()].filter((g) => g.source !== 'teamsnap');
    state.games = new Map(combine(league, out.teamsnap).map((g) => [g.id, g]));
  }
  if (out && out.problems.length) toast(out.problems.join(' '), 8000);
  render();
}

async function start() {
  setupHeader(onConnected);
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
