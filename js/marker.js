// The "mark puck drop and the final buzzer" screen, shared by the game page and Import.
// Parts: { id, clock (seconds after midnight or null), size, duration, label? }
// Marks per view: { start: { id, sec }, end: { id, sec }, estimated }
import { h, toast, formatBytes } from './ui.js';
import { timeLabel } from './games.js';
import { parseHHMMSafe } from './library.js';

export function clockText(sec) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
}
export function posText(sec) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor(s / 60) % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${mm}:${String(s % 60).padStart(2, '0')}`;
}

export const indexOf = (views, view, id) => (views[view] || []).findIndex((p) => p.id === id);

export function markClock(views, view, mark) {
  if (!mark) return null;
  const p = (views[view] || [])[indexOf(views, view, mark.id)];
  return p && p.clock != null ? p.clock + mark.sec : null;
}

export function markAtClock(views, view, clock) {
  const list = views[view] || [];
  let best = null;
  for (const p of list) if (p.clock != null && p.clock <= clock) best = p;
  if (!best) best = list[0];
  if (!best || best.clock == null) return null;
  return { id: best.id, sec: Math.max(0, clock - best.clock) };
}

export function marksValid(views, marks, view) {
  const m = marks && marks[view];
  if (!m || !m.start || !m.end) return false;
  const a = [indexOf(views, view, m.start.id), m.start.sec];
  const b = [indexOf(views, view, m.end.id), m.end.sec];
  if (a[0] < 0 || b[0] < 0) return false;
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

export function lengthOf(views, marks, view) {
  const m = marks[view];
  const a = markClock(views, view, m && m.start);
  const b = markClock(views, view, m && m.end);
  return a != null && b != null ? b - a : null;
}

// The cut for joining: marks, or the whole files
export function cutFor(views, marks, view, whole) {
  const list = views[view] || [];
  if (whole) return { first: 0, last: list.length - 1, startSec: 0, endSec: null };
  const m = marks[view];
  return { first: indexOf(views, view, m.start.id), last: indexOf(views, view, m.end.id), startSec: m.start.sec, endSec: m.end.sec };
}

// Set a mark and fill the other views in as an estimate from the clock time
export function applyMark(views, marks, view, which, mark) {
  const out = { ...marks };
  out[view] = { ...(out[view] || {}), [which]: mark, estimated: false, fromSchedule: false };
  const clock = markClock(views, view, mark);
  if (clock == null) return out;
  for (const v of Object.keys(views)) {
    if (v === view) continue;
    const other = { ...(out[v] || {}) };
    if (other[which] && !other.estimated) continue;
    const est = markAtClock(views, v, clock);
    if (est) { other[which] = est; other.estimated = true; out[v] = other; }
  }
  return out;
}

/**
 * Build the marking screen.
 * @param {object} o
 * @param {object} o.views   { PANO: [part], AUTO: [part] }
 * @param {object} o.marks   saved marks
 * @param {object} o.game    the game (for the scheduled start)
 * @param {(part, onProgress) => Promise<Blob>} o.getBlob
 * @param {(marks) => void} o.onChange
 */
export function createMarker({ views, marks = {}, game = null, getBlob, getUrl = null, onChange = () => {} }) {
  let state = { views, marks: { ...marks }, view: '', part: 0 };
  const urls = new Map();

  const viewTabs = h('div', { class: 'row', role: 'group', 'aria-label': 'Camera view' });
  const partTabs = h('div', { class: 'row', role: 'group', 'aria-label': 'Part' });
  const player = h('video', { controls: true, playsinline: true, preload: 'metadata' });
  const note = h('p', { class: 'player-note' }, 'Pick a part to start watching.');
  const clock = h('strong', { class: 'clock' }, '—');
  const pos = h('span', { class: 'small muted' });
  const btn = (text, label, fn, cls = 'btn btn-small') => h('button', { type: 'button', class: cls, 'aria-label': label || undefined, onclick: fn }, text);
  const jump = btn('Go to scheduled start', null, () => {
    const t = parseHHMMSafe(game && game.time);
    if (Number.isFinite(t)) goToClock(t * 60);
  });
  const startText = h('span', { class: 'mark-text' }, 'Not set');
  const endText = h('span', { class: 'mark-text' }, 'Not set');
  const goStart = btn('Go to it', 'Go to puck drop', () => goToMark('start'));
  const goEnd = btn('Go to it', 'Go to the final buzzer', () => goToMark('end'));
  const markNote = h('p', { class: 'small muted', hidden: true });

  const el = h('div', { class: 'marker stack' },
    h('div', { class: 'row marker-tabs' }, viewTabs, partTabs),
    h('div', { class: 'player-box' }, player, note),
    h('div', { class: 'clock-row' },
      h('div', {}, clock, pos),
      h('div', { class: 'row nudge', role: 'group', 'aria-label': 'Move the video' },
        btn('−10s', 'Back 10 seconds', () => nudge(-10)),
        btn('−1s', 'Back 1 second', () => nudge(-1)),
        btn('+1s', 'Forward 1 second', () => nudge(1)),
        btn('+10s', 'Forward 10 seconds', () => nudge(10)),
        jump)),
    h('div', { class: 'marks' },
      h('div', { class: 'mark' }, btn('Set puck drop here', null, () => setMark('start'), 'btn btn-primary'), startText, goStart),
      h('div', { class: 'mark' }, btn('Set final buzzer here', null, () => setMark('end'), 'btn btn-primary'), endText, goEnd)),
    markNote);

  const parts = () => state.views[state.view] || [];
  const current = () => parts()[state.part] || null;

  function paintClock() {
    const p = current();
    if (!p || !player.src) { clock.textContent = '—'; pos.textContent = ''; return; }
    clock.textContent = p.clock == null ? posText(player.currentTime) : clockText(p.clock + player.currentTime);
    pos.textContent = ` Part ${state.part + 1} · ${posText(player.currentTime)}${Number.isFinite(player.duration) ? ` of ${posText(player.duration)}` : ''}`;
  }
  player.addEventListener('timeupdate', paintClock);
  player.addEventListener('seeked', paintClock);

  async function showPart(index, seekTo = null) {
    const p = parts()[index];
    if (!p) return;
    state.part = index;
    renderTabs();
    let url = urls.get(p.id);
    if (!url) {
      note.textContent = 'Opening…';
      try {
        const streamed = getUrl ? await getUrl(p) : null;
        if (streamed) { url = streamed; urls.set(p.id, url); }
        const blob = streamed ? null : await getBlob(p, (got, size) => {
          if (state.part === index) note.textContent = `Loading part ${index + 1} from Drive: ${formatBytes(got)} of ${formatBytes(size || p.size)}`;
        });
        if (blob) { url = URL.createObjectURL(blob); urls.set(p.id, url); }
      } catch (err) {
        note.textContent = err.message;
        return;
      }
      if (state.part !== index || parts()[index] !== p) return;
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

  function nudge(by) {
    if (!player.src) return;
    const t = player.currentTime + by;
    if (t < 0 && state.part > 0) { showPart(state.part - 1, Infinity); return; }
    if (Number.isFinite(player.duration) && t > player.duration && state.part < parts().length - 1) { showPart(state.part + 1, t - player.duration); return; }
    player.currentTime = Math.max(0, Math.min(t, player.duration || t));
  }

  function goToClock(c) {
    const m = markAtClock(state.views, state.view, c);
    if (!m) { toast("These files don't have start times, so pick the part and scrub to it."); return; }
    showPart(indexOf(state.views, state.view, m.id), m.sec);
  }

  function goToMark(which) {
    const m = state.marks[state.view] && state.marks[state.view][which];
    if (m) showPart(indexOf(state.views, state.view, m.id), m.sec);
  }

  function setMark(which) {
    const p = current();
    if (!p || !player.src) { toast('Play a part first.'); return; }
    state.marks = applyMark(state.views, state.marks, state.view, which, { id: p.id, sec: Math.round(player.currentTime * 10) / 10 });
    renderMarks();
    onChange(state.marks, state.view);
  }

  function label(m) {
    if (!m) return 'Not set';
    const c = markClock(state.views, state.view, m);
    return `${c != null ? clockText(c) : posText(m.sec)} · part ${indexOf(state.views, state.view, m.id) + 1}, ${posText(m.sec)}`;
  }

  function renderMarks() {
    const m = state.marks[state.view] || {};
    startText.textContent = label(m.start);
    endText.textContent = label(m.end);
    startText.classList.toggle('estimated', Boolean(m.estimated && m.start));
    endText.classList.toggle('estimated', Boolean(m.estimated && m.end));
    goStart.hidden = !m.start;
    goEnd.hidden = !m.end;
    const other = Object.keys(state.views).find((v) => v !== state.view);
    let text = '';
    if (m.fromSchedule) text = 'Set from the schedule: puck drop at the scheduled time and the final buzzer an hour later. Check them with "Go to it" and set them again if the game started late.';
    else if (m.estimated) text = `These were estimated from the ${other} marks, but the two cameras' clocks can differ a little. Check them with "Go to it" and set them again if they're off.`;
    else if (m.start && m.end && !marksValid(state.views, state.marks, state.view)) text = 'The final buzzer is before puck drop. Set them again.';
    markNote.textContent = text;
    markNote.hidden = !text;
  }

  function resetPlayer() {
    player.pause();
    player.removeAttribute('src');
    player.load();
    note.textContent = 'Pick a part to start watching.';
  }

  function renderTabs() {
    const names = Object.keys(state.views);
    viewTabs.replaceChildren(...(names.length > 1 ? names.map((v) => h('button', {
      type: 'button', class: 'tab', 'aria-pressed': String(v === state.view),
      onclick: () => { if (v !== state.view) { state.view = v; state.part = 0; resetPlayer(); renderAll(); showPart(0); } },
    }, v)) : []));
    partTabs.replaceChildren(...parts().map((p, i) => h('button', {
      type: 'button', class: 'tab', 'aria-pressed': String(i === state.part), onclick: () => showPart(i),
    }, `Part ${i + 1}${p.clock != null ? ` · ${clockText(p.clock).replace(/:\d\d (AM|PM)$/, ' $1')}` : ''}`)));
    const sched = parseHHMMSafe(game && game.time);
    jump.hidden = !Number.isFinite(sched);
    if (Number.isFinite(sched)) jump.textContent = `Go to scheduled start (${timeLabel(game.time)})`;
  }

  function renderAll() { renderTabs(); renderMarks(); paintClock(); }

  function pickView() {
    if (!state.views[state.view]) { state.view = state.views.PANO ? 'PANO' : Object.keys(state.views)[0] || ''; state.part = 0; }
  }

  pickView();
  renderAll();

  return {
    el,
    get marks() { return state.marks; },
    get view() { return state.view; },
    start() { if (parts().length && !player.src) showPart(state.part); },
    setViews(next) {
      const playing = current();
      state.views = next;
      const before = state.view;
      pickView();
      if (state.view !== before) { resetPlayer(); state.part = 0; } else if (playing) {
        const i = indexOf(next, state.view, playing.id);
        state.part = i >= 0 ? i : 0;
        if (i < 0) resetPlayer();
      }
      renderAll();
    },
    setMarks(next) { state.marks = { ...next }; renderMarks(); },
    destroy() { resetPlayer(); for (const u of urls.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u); urls.clear(); el.remove(); },
  };
}
