// The clip editor: pick the moment, frame your kid (wide or tall), add slow motion and
// freeze-and-draw, then make the clip, save it to Drive, and save or share it.
import { h, toast, formatBytes, formatDuration } from './ui.js';
import {
  newEdit, cropRect, frameAt, setFrame, removeAt, tidy, outputLength, problems, clipName, SHAPES, MAX_LENGTH,
} from './clip-edit.js';
import { drawVideo, drawDrawings, perform, audioFor } from './clip-render.js';
import { clockText, posText } from './marker.js';
import { saveBlobAs, shareBlob } from './share.js';
import { safeName } from './library.js';

const TOOLS = [['spotlight', 'Spotlight'], ['arrow', 'Arrow'], ['circle', 'Circle'], ['text', 'Text']];

/**
 * @param {object} o
 * @param {string} o.src        the full game (stream address)
 * @param {number|null} o.startSec clock time at the start of the full game
 * @param {number} o.at          where the person was watching (seconds)
 * @param {object} o.game
 * @param {string} o.kid
 * @param {number} o.clipNumber  for the default name
 * @param {(blob, info) => Promise<string>} o.saveToDrive  uploads; resolves with the saved name
 * @param {() => void} o.onClose
 */
export function createClipEditor({ src, startSec = null, at = 0, game = null, kid = '', clipNumber = 1, saveToDrive, onClose }) {
  let edit = newEdit(at, Infinity);
  let drawing = null;       // index of the freeze being drawn on
  let tool = 'spotlight';
  let busy = null;          // AbortController while previewing or making
  let audio = null;
  let pending = null;       // drawing in progress
  let result = null;        // { blob, name }
  let ready = false;

  const video = h('video', { class: 'clip-source', playsinline: true, preload: 'auto' });
  const canvas = h('canvas', { class: 'clip-canvas', 'aria-label': 'Clip picture. Drag to move the frame, scroll to zoom.' });
  const ctx = canvas.getContext('2d');
  const textInput = h('input', { type: 'text', class: 'clip-text-input', maxlength: '24', placeholder: 'Type, then Enter', hidden: true, 'aria-label': 'Label text' });
  const stage = h('div', { class: 'clip-stage' }, canvas, textInput, video);
  const note = h('p', { class: 'small muted', role: 'status' }, 'Loading the game…');

  const shapeTabs = h('div', { class: 'row', role: 'group', 'aria-label': 'Clip shape' });
  const playBtn = h('button', { type: 'button', class: 'btn btn-small btn-primary watch-play' }, 'Play');
  const scrub = h('input', { type: 'range', class: 'watch-seek', step: '0.05', 'aria-label': 'Position' });
  const timeText = h('span', { class: 'watch-time' }, '—');
  const rangeText = h('span', { class: 'small' });
  const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.05', value: '1', 'aria-label': 'Zoom' });
  const framesList = h('div', { class: 'chip-list' });
  const slowLen = h('select', { 'aria-label': 'Slow motion length' }, ...[1, 2, 3, 5].map((s) => h('option', { value: String(s), selected: s === 2 }, `${s} s`)));
  const slowRate = h('select', { 'aria-label': 'Slow motion speed' }, h('option', { value: '0.5', selected: true }, '½ speed'), h('option', { value: '0.25' }, '¼ speed'));
  const effectsList = h('div', { class: 'chip-list' });
  const mute = h('input', { type: 'checkbox', 'aria-label': 'Mute rink sound' });
  const nameInput = h('input', { type: 'text', class: 'clip-name', value: clipName(kid, game, clipNumber), 'aria-label': 'Clip name', maxlength: '80' });
  const problemText = h('p', { class: 'small warn-text', hidden: true });
  const previewBtn = h('button', { type: 'button', class: 'btn' }, 'Preview');
  const makeBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Make clip and save to Drive');
  const stopBtn = h('button', { type: 'button', class: 'btn', hidden: true }, 'Stop');
  const progress = h('div', { class: 'meter', hidden: true, role: 'progressbar', 'aria-label': 'Making the clip', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'meter-fill', style: 'width: 0%' }));
  const progressText = h('span', { class: 'small muted', role: 'status' });

  const toolBtns = TOOLS.map(([key, label]) => h('button', { type: 'button', class: 'tab', 'aria-pressed': String(key === tool), onclick: () => { tool = key; paintTools(); } }, label));
  const holdSel = h('select', { 'aria-label': 'Freeze length' }, ...[2, 3, 4, 5, 8].map((s) => h('option', { value: String(s) }, `${s} s`)));
  const drawPanel = h('div', { class: 'draw-panel', hidden: true },
    h('strong', {}, 'Draw on the frozen picture'),
    h('div', { class: 'row', role: 'group', 'aria-label': 'Drawing tool' }, ...toolBtns),
    h('span', { class: 'small muted' }, 'Spotlight, circle: drag from the centre outwards. Arrow: drag from start to tip. Text: click where it goes.'),
    h('div', { class: 'row' },
      h('label', { class: 'small muted inline-label' }, 'Hold for ', holdSel),
      h('button', { type: 'button', class: 'btn btn-small', onclick: undoDrawing }, 'Undo'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: clearDrawings }, 'Clear'),
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => { drawing = null; paintAll(); } }, 'Done drawing')));

  const resultVideo = h('video', { controls: true, playsinline: true, class: 'clip-result-video' });
  const resultText = h('p', { class: 'small muted' });
  const resultBox = h('div', { class: 'clip-result stack', hidden: true },
    h('strong', {}, 'Your clip'),
    resultVideo, resultText,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => result && saveBlobAs(result.blob, result.name).catch((e) => toast(`Couldn't save it: ${e.message}`, 6000)) }, 'Save to this PC'),
      h('button', { type: 'button', class: 'btn', onclick: () => result && shareBlob(result.blob, result.name, nameInput.value) }, 'Share'),
      h('button', { type: 'button', class: 'btn', onclick: () => { resultBox.hidden = true; clearResult(); } }, 'Keep editing')));

  const btn = (text, label, fn, cls = 'btn btn-small') => h('button', { type: 'button', class: cls, 'aria-label': label || undefined, onclick: fn }, text);

  const el = h('div', { class: 'clip-editor stack' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Make a clip'), btn('Close', 'Close the clip editor', close)),
    h('div', { class: 'clip-editor-grid' },
      h('div', { class: 'stack' },
        stage,
        h('div', { class: 'watch-bar' }, playBtn, scrub),
        h('div', { class: 'watch-controls' },
          h('div', { class: 'row' }, btn('−1s', 'Back 1 second', () => nudge(-1)), btn('−⅓s', 'Back a little', () => nudge(-0.333)), btn('+⅓s', 'Forward a little', () => nudge(0.333)), btn('+1s', 'Forward 1 second', () => nudge(1))),
          timeText),
        note),
      h('div', { class: 'stack clip-side' },
        h('section', { class: 'clip-step' }, h('h3', {}, '1 · Moment'),
          h('div', { class: 'row' }, btn('Start here', 'Clip starts here', () => setIn(video.currentTime)), btn('End here', 'Clip ends here', () => setOut(video.currentTime))),
          h('div', { class: 'row' },
            h('span', { class: 'small muted' }, 'Start'), btn('−1', 'Start 1 second earlier', () => setIn(edit.in - 1)), btn('+1', 'Start 1 second later', () => setIn(edit.in + 1)),
            h('span', { class: 'small muted' }, 'End'), btn('−1', 'End 1 second earlier', () => setOut(edit.out - 1)), btn('+1', 'End 1 second later', () => setOut(edit.out + 1))),
          rangeText),
        h('section', { class: 'clip-step' }, h('h3', {}, '2 · Shape and framing'), shapeTabs,
          h('label', { class: 'small muted inline-label' }, 'Zoom ', zoom),
          h('span', { class: 'small muted' }, 'Drag the picture to keep your kid in frame. Move it again at later moments and the frame glides between them.'),
          framesList),
        h('section', { class: 'clip-step' }, h('h3', {}, '3 · Slow motion and freeze'),
          h('div', { class: 'row' }, btn('Slow motion from here', null, addSlow), slowLen, slowRate),
          h('div', { class: 'row' }, btn('Freeze here and draw', null, addFreeze)),
          effectsList, drawPanel),
        h('section', { class: 'clip-step' }, h('h3', {}, '4 · Finish'),
          h('label', { class: 'check-line' }, mute, h('span', {}, 'Mute the rink sound (slow motion is always silent)')),
          h('label', { class: 'small muted stack-tight' }, 'Name', nameInput),
          problemText,
          h('div', { class: 'row' }, previewBtn, makeBtn, stopBtn),
          progress, progressText))),
    resultBox);

  // ---------- drawing the picture ----------
  function sizeCanvas() {
    const { w, h: hh } = SHAPES[edit.shape];
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    stage.classList.toggle('tall', edit.shape === 'tall');
  }
  function paint() {
    if (busy && busy.performing) return;
    sizeCanvas();
    drawVideo(ctx, video, video.currentTime, edit);
    if (drawing != null) {
      const f = edit.freezes[drawing];
      drawDrawings(ctx, [...(f ? f.drawings : []), ...(pending ? [pending] : [])], edit.shape, 1);
    }
  }
  const loop = () => { if (!video.paused) { paint(); paintTime(); requestAnimationFrame(loop); } };

  function paintTime() {
    const t = video.currentTime || 0;
    if (document.activeElement !== scrub) scrub.value = String(t);
    const inClip = Math.max(0, t - edit.in);
    timeText.textContent = `${startSec != null ? `${clockText(startSec + t)} · ` : ''}${t < edit.in || t > edit.out ? 'outside the clip' : `${posText(inClip)} into the clip`}`;
  }

  function windowRange() {
    const pad = 10;
    const dur = Number.isFinite(video.duration) ? video.duration : edit.out + pad;
    return [Math.max(0, edit.in - pad), Math.min(dur, edit.out + pad)];
  }

  function paintAll() {
    edit = tidy(edit);
    const [lo, hi] = windowRange();
    scrub.min = String(lo);
    scrub.max = String(hi);
    shapeTabs.replaceChildren(...Object.entries(SHAPES).map(([key, s]) => h('button', {
      type: 'button', class: 'tab', 'aria-pressed': String(edit.shape === key), disabled: Boolean(busy),
      onclick: () => { edit = { ...edit, shape: key }; clearResult(); paintAll(); },
    }, s.label)));
    const len = outputLength(edit);
    rangeText.textContent = `${startSec != null ? `${clockText(startSec + edit.in)} → ${clockText(startSec + edit.out)} · ` : ''}${formatDuration(edit.out - edit.in)} of the game · finished clip ${formatDuration(len)}`;
    zoom.value = String(frameAt(edit, video.currentTime).zoom);
    framesList.replaceChildren(...(edit.frames.length
      ? edit.frames.map((k, i) => h('span', { class: 'chip-item' },
        h('button', { type: 'button', class: 'linkish', onclick: () => seek(k.t) }, `Frame at ${posText(Math.max(0, k.t - edit.in))}`),
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove this framing point', onclick: () => { edit = removeAt(edit, 'frames', i); clearResult(); paintAll(); } }, '×')))
      : [h('span', { class: 'small muted' }, 'No framing yet: the whole picture is used.')]));
    effectsList.replaceChildren(
      ...edit.slows.map((s, i) => h('span', { class: 'chip-item' },
        h('button', { type: 'button', class: 'linkish', onclick: () => seek(s.t) }, `Slow ${s.rate === 0.25 ? '¼' : '½'} at ${posText(s.t - edit.in)} for ${s.length} s`),
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove this slow motion', onclick: () => { edit = removeAt(edit, 'slows', i); clearResult(); paintAll(); } }, '×'))),
      ...edit.freezes.map((f, i) => h('span', { class: `chip-item${drawing === i ? ' active' : ''}` },
        h('button', { type: 'button', class: 'linkish', onclick: () => openDrawing(i) }, `Freeze at ${posText(f.t - edit.in)} · ${f.hold} s · ${f.drawings.length} drawing${f.drawings.length === 1 ? '' : 's'}`),
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Remove this freeze', onclick: () => { if (drawing === i) drawing = null; edit = removeAt(edit, 'freezes', i); clearResult(); paintAll(); } }, '×'))));
    drawPanel.hidden = drawing == null;
    if (drawing != null && edit.freezes[drawing]) holdSel.value = String(edit.freezes[drawing].hold);
    mute.checked = edit.mute;
    const issues = problems(edit);
    problemText.textContent = issues.join(' ');
    problemText.hidden = !issues.length;
    const locked = Boolean(busy) || !ready;
    previewBtn.disabled = locked || issues.length > 0;
    makeBtn.disabled = locked || issues.length > 0;
    stopBtn.hidden = !busy;
    paintTools();
    paint();
    paintTime();
  }
  function paintTools() { toolBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(TOOLS[i][0] === tool))); }

  // ---------- moving around ----------
  function seek(t) {
    video.pause();
    const [lo, hi] = windowRange();
    video.currentTime = Math.min(hi, Math.max(lo, t));
  }
  function nudge(by) { seek(video.currentTime + by); }
  function setIn(t) { edit = { ...edit, in: Math.max(0, Math.min(t, edit.out - 1)) }; clearResult(); paintAll(); }
  function setOut(t) {
    const dur = Number.isFinite(video.duration) ? video.duration : t;
    edit = { ...edit, out: Math.min(dur, Math.max(t, edit.in + 1)) };
    clearResult();
    paintAll();
  }
  playBtn.addEventListener('click', () => {
    if (busy) return;
    if (video.paused) {
      if (video.currentTime >= edit.out - 0.05 || video.currentTime < edit.in - 10) video.currentTime = edit.in;
      drawing = null;
      video.play().then(loop).catch(() => {});
    } else video.pause();
    paintAll();
  });
  video.addEventListener('play', () => { playBtn.textContent = 'Pause'; });
  video.addEventListener('pause', () => { playBtn.textContent = 'Play'; paint(); paintTime(); });
  video.addEventListener('seeked', () => { paint(); paintTime(); zoom.value = String(frameAt(edit, video.currentTime).zoom); });
  scrub.addEventListener('input', () => seek(Number(scrub.value)));

  // ---------- framing ----------
  function currentCrop() { return cropRect(frameAt(edit, video.currentTime), video.videoWidth || 16, video.videoHeight || 9, edit.shape); }
  function moveFrame(dxOut, dyOut, z) {
    if (!video.videoWidth) return;
    const f = frameAt(edit, video.currentTime);
    const r = currentCrop();
    const next = {
      cx: Math.min(1, Math.max(0, f.cx - (dxOut * r.sw) / video.videoWidth)),
      cy: Math.min(1, Math.max(0, f.cy - (dyOut * r.sh) / video.videoHeight)),
      zoom: z ?? f.zoom,
    };
    // keep the centre inside what can be shown at this zoom
    const shown = cropRect(next, video.videoWidth, video.videoHeight, edit.shape);
    next.cx = (shown.sx + shown.sw / 2) / video.videoWidth;
    next.cy = (shown.sy + shown.sh / 2) / video.videoHeight;
    edit = setFrame(edit, video.currentTime, next);
    clearResult();
    paint();
  }
  zoom.addEventListener('input', () => { moveFrame(0, 0, Number(zoom.value)); });
  zoom.addEventListener('change', paintAll);
  canvas.addEventListener('wheel', (e) => {
    if (busy || drawing != null) return;
    e.preventDefault();
    const f = frameAt(edit, video.currentTime);
    moveFrame(0, 0, Math.min(4, Math.max(1, f.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    zoom.value = String(frameAt(edit, video.currentTime).zoom);
    clearTimeout(canvas.wheelTimer);
    canvas.wheelTimer = setTimeout(paintAll, 250);
  }, { passive: false });

  let drag = null;
  const norm = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    video.pause();
    const p = norm(e);
    canvas.setPointerCapture(e.pointerId);
    if (drawing != null) {
      if (tool === 'text') { placeText(p); return; }
      drag = { mode: 'draw', start: p };
      pending = tool === 'arrow' ? { kind: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y } : { kind: tool, x: p.x, y: p.y, r: 0.01 };
    } else drag = { mode: 'pan', last: p };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = norm(e);
    if (drag.mode === 'pan') {
      moveFrame(p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else {
      const { w, h: hh } = SHAPES[edit.shape];
      const unit = Math.min(w, hh);
      if (pending.kind === 'arrow') { pending.x2 = p.x; pending.y2 = p.y; } else {
        pending.r = Math.max(0.01, Math.hypot((p.x - drag.start.x) * w, (p.y - drag.start.y) * hh) / unit);
      }
      paint();
    }
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.mode === 'draw' && pending) {
      const ok = pending.kind === 'arrow' ? Math.hypot(pending.x2 - pending.x1, pending.y2 - pending.y1) > 0.02 : pending.r > 0.015;
      if (ok) updateFreeze({ drawings: [...edit.freezes[drawing].drawings, pending] });
      pending = null;
    }
    if (drag.mode === 'pan') paintAll();
    drag = null;
    paint();
  });

  // ---------- slow motion and freezes ----------
  function addSlow() {
    const t = Math.max(edit.in, Math.min(video.currentTime, edit.out - 0.5));
    edit = { ...edit, slows: [...edit.slows.filter((s) => Math.abs(s.t - t) > 0.2), { t, length: Number(slowLen.value), rate: Number(slowRate.value) }] };
    clearResult();
    paintAll();
  }
  function addFreeze() {
    const t = Math.max(edit.in, Math.min(video.currentTime, edit.out));
    video.pause();
    edit = tidy({ ...edit, freezes: [...edit.freezes.filter((f) => Math.abs(f.t - t) > 0.1), { t, hold: 3, drawings: [] }] });
    clearResult();
    openDrawing(edit.freezes.findIndex((f) => Math.abs(f.t - t) < 0.01));
  }
  function openDrawing(i) {
    if (i < 0 || !edit.freezes[i]) return;
    drawing = i;
    tool = edit.freezes[i].drawings.length ? tool : 'spotlight';
    seek(edit.freezes[i].t);
    paintAll();
  }
  function updateFreeze(patch) {
    const freezes = [...edit.freezes];
    freezes[drawing] = { ...freezes[drawing], ...patch };
    edit = { ...edit, freezes };
    clearResult();
    paintAll();
  }
  function undoDrawing() { if (drawing != null) updateFreeze({ drawings: edit.freezes[drawing].drawings.slice(0, -1) }); }
  function clearDrawings() { if (drawing != null) updateFreeze({ drawings: [] }); }
  holdSel.addEventListener('change', () => updateFreeze({ hold: Number(holdSel.value) }));
  function placeText(p) {
    textInput.hidden = false;
    textInput.value = '';
    textInput.style.left = `${p.x * 100}%`;
    textInput.style.top = `${p.y * 100}%`;
    textInput.dataset.x = String(p.x);
    textInput.dataset.y = String(p.y);
    setTimeout(() => textInput.focus(), 0);
  }
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = textInput.value.trim();
      textInput.hidden = true;
      if (text && drawing != null) updateFreeze({ drawings: [...edit.freezes[drawing].drawings, { kind: 'text', x: Number(textInput.dataset.x), y: Number(textInput.dataset.y), text }] });
    } else if (e.key === 'Escape') textInput.hidden = true;
  });
  textInput.addEventListener('blur', () => { textInput.hidden = true; });
  mute.addEventListener('change', () => { edit = { ...edit, mute: mute.checked }; clearResult(); });

  // ---------- preview and make ----------
  function clearResult() {
    if (result) { URL.revokeObjectURL(resultVideo.src); result = null; }
    resultBox.hidden = true;
  }
  function setProgress(done, total, label) {
    const pct = Math.round((done / (total || 1)) * 100);
    progress.firstChild.style.width = `${pct}%`;
    progress.setAttribute('aria-valuenow', String(pct));
    progressText.textContent = `${label} ${posText(done)} of ${posText(total)}`;
  }
  async function run(record) {
    drawing = null;
    busy = new AbortController();
    busy.performing = true;
    progress.hidden = false;
    paintAll();
    try {
      if (!audio) audio = audioFor(video);
      const blob = await perform({
        video, canvas, edit, record, signal: busy.signal, audio,
        onProgress: (d, t) => setProgress(d, t, record ? 'Making the clip:' : 'Preview:'),
      });
      if (!record) { progressText.textContent = 'Preview finished.'; return; }
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${safeName(nameInput.value || clipName(kid, game, clipNumber))}.${ext}`;
      result = { blob, name };
      resultVideo.src = URL.createObjectURL(blob);
      resultText.textContent = `${formatDuration(outputLength(edit))} · ${formatBytes(blob.size)} · saving to Drive…`;
      resultBox.hidden = false;
      progressText.textContent = 'Saving to Drive…';
      busy.performing = false;
      const saved = await saveToDrive(blob, { name, duration: outputLength(edit), edit, shape: edit.shape });
      resultText.textContent = `${formatDuration(outputLength(edit))} · ${formatBytes(blob.size)} · saved to Drive as ${saved}.`;
      progressText.textContent = 'Saved to Drive.';
      clipNumber += 1;
      nameInput.value = clipName(kid, game, clipNumber);
    } catch (err) {
      progressText.textContent = err.name === 'AbortError' ? 'Stopped.' : `Something went wrong: ${err.message}`;
      if (result && err.name !== 'AbortError') resultText.textContent += ' It wasn\'t saved to Drive, but you can still save it to this PC.';
    } finally {
      busy = null;
      progress.hidden = true;
      paintAll();
    }
  }
  previewBtn.addEventListener('click', () => run(false));
  makeBtn.addEventListener('click', () => run(true));
  stopBtn.addEventListener('click', () => { if (busy) busy.abort(); });

  function close() {
    if (busy) busy.abort();
    video.pause();
    video.removeAttribute('src');
    video.load();
    clearResult();
    if (audio) audio.ctx.close().catch(() => {});
    el.remove();
    if (onClose) onClose();
  }

  // ---------- start ----------
  video.addEventListener('loadedmetadata', () => {
    ready = true;
    edit = { ...edit, out: Math.min(video.duration, edit.out) };
    note.textContent = `Up to ${MAX_LENGTH} seconds per clip. Keep this tab in front while a clip is being made: it records in real time.`;
    seek(at);
    paintAll();
  });
  video.addEventListener('error', () => { note.textContent = "Couldn't load the game. If Google sign-in ran out, press Reconnect Google, then open the clip editor again."; });
  video.src = src;
  paintAll();

  return { el, close, get edit() { return edit; } };
}
