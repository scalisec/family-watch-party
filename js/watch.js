// A player for full games and clips: play, jump, speed, clock time, and zoom + drag around the PANO picture.
import { h } from './ui.js';
import { clockText, posText } from './marker.js';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

/**
 * @param {object} o
 * @param {string} o.src           video address (a Drive stream or an object URL)
 * @param {number|null} o.startSec clock time when the video starts (seconds after midnight), for the clock display
 * @param {() => void} [o.onRetry] called when the person presses Retry after an error
 */
export function createWatcher({ src, startSec = null, onRetry = null }) {
  let zoom = 1;
  let x = 0;
  let y = 0;
  let dragging = null;
  let destroyed = false;

  const video = h('video', { playsinline: true, preload: 'metadata', class: 'watch-video' });
  const note = h('p', { class: 'player-note' }, 'Loading…');
  const retry = h('button', { type: 'button', class: 'btn btn-small', hidden: true, onclick: () => { retry.hidden = true; load(src); if (onRetry) onRetry(); } }, 'Retry');
  const stage = h('div', { class: 'watch-stage', tabindex: '0', 'aria-label': 'Video. Space plays and pauses, arrows jump, plus and minus zoom.' }, video, h('div', { class: 'watch-overlay' }, note, retry));

  const playBtn = h('button', { type: 'button', class: 'btn btn-small btn-primary watch-play', 'aria-label': 'Play' }, 'Play');
  const seek = h('input', { type: 'range', min: '0', max: '0', step: '0.1', value: '0', class: 'watch-seek', 'aria-label': 'Position in the video' });
  const timeText = h('span', { class: 'watch-time' }, '—');
  const speed = h('select', { 'aria-label': 'Speed' }, ...SPEEDS.map((s) => h('option', { value: String(s), selected: s === 1 }, `${s}×`)));
  const zoomInput = h('input', { type: 'range', min: '1', max: '6', step: '0.1', value: '1', 'aria-label': 'Zoom' });
  const zoomText = h('span', { class: 'small muted' }, '1.0×');
  const btn = (text, label, fn) => h('button', { type: 'button', class: 'btn btn-small', 'aria-label': label, onclick: fn }, text);

  const el = h('div', { class: 'watcher stack' },
    stage,
    h('div', { class: 'watch-bar' }, playBtn, seek),
    h('div', { class: 'watch-controls' },
      h('div', { class: 'row' },
        btn('−10s', 'Back 10 seconds', () => jump(-10)),
        btn('−1s', 'Back 1 second', () => jump(-1)),
        btn('+1s', 'Forward 1 second', () => jump(1)),
        btn('+10s', 'Forward 10 seconds', () => jump(10)),
        h('label', { class: 'small muted inline-label' }, 'Speed ', speed)),
      timeText,
      h('div', { class: 'row' },
        h('label', { class: 'small muted inline-label' }, 'Zoom ', zoomInput), zoomText,
        btn('Fit', 'Zoom out to the whole picture', () => setZoom(1)),
        btn('Full screen', 'Full screen', () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {})))));

  // ---------- zoom and drag ----------
  function clamp() {
    const w = stage.clientWidth;
    const hgt = stage.clientHeight;
    x = Math.min(0, Math.max(w - w * zoom, x));
    y = Math.min(0, Math.max(hgt - hgt * zoom, y));
  }
  function paintZoom() {
    clamp();
    video.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    zoomInput.value = String(zoom);
    zoomText.textContent = `${zoom.toFixed(1)}×`;
    stage.classList.toggle('zoomed', zoom > 1.01);
  }
  function setZoom(next, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
    const z = Math.min(6, Math.max(1, next));
    // keep the point under (cx, cy) in place
    x = cx - ((cx - x) / zoom) * z;
    y = cy - ((cy - y) / zoom) * z;
    zoom = z;
    paintZoom();
  }
  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    setZoom(zoom > 1.01 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top);
  });
  stage.addEventListener('pointerdown', (e) => {
    if (zoom <= 1.01) return;
    dragging = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x, y, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging || dragging.id !== e.pointerId) return;
    x = dragging.x + (e.clientX - dragging.sx);
    y = dragging.y + (e.clientY - dragging.sy);
    if (Math.abs(e.clientX - dragging.sx) + Math.abs(e.clientY - dragging.sy) > 4) dragging.moved = true;
    paintZoom();
  });
  const endDrag = (e) => {
    if (!dragging || dragging.id !== e.pointerId) return;
    const wasClick = !dragging.moved;
    dragging = null;
    if (wasClick) toggle();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', () => { dragging = null; });
  stage.addEventListener('click', () => { if (zoom <= 1.01) toggle(); });
  window.addEventListener('resize', paintZoom);

  // ---------- playing ----------
  function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }
  function jump(by) {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + by));
  }
  playBtn.addEventListener('click', toggle);
  speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
  seek.addEventListener('input', () => { video.currentTime = Number(seek.value); });
  stage.addEventListener('keydown', (e) => {
    const keys = {
      ' ': toggle, k: toggle,
      ArrowLeft: () => jump(e.shiftKey ? -1 : -5), ArrowRight: () => jump(e.shiftKey ? 1 : 5),
      j: () => jump(-10), l: () => jump(10),
      ',': () => { video.pause(); jump(-1 / 30); }, '.': () => { video.pause(); jump(1 / 30); },
      '+': () => setZoom(zoom * 1.25), '=': () => setZoom(zoom * 1.25), '-': () => setZoom(zoom / 1.25), 0: () => setZoom(1),
    };
    const fn = keys[e.key];
    if (fn) { e.preventDefault(); fn(); }
  });

  function paintTime() {
    const t = video.currentTime || 0;
    if (document.activeElement !== seek) seek.value = String(t);
    const len = Number.isFinite(video.duration) ? ` / ${posText(video.duration)}` : '';
    timeText.textContent = `${startSec != null ? `${clockText(startSec + t)} · ` : ''}${posText(t)}${len}`;
  }
  video.addEventListener('timeupdate', paintTime);
  video.addEventListener('seeked', paintTime);
  video.addEventListener('loadedmetadata', () => { seek.max = String(video.duration || 0); note.textContent = ''; paintTime(); paintZoom(); });
  video.addEventListener('waiting', () => { if (!video.paused) note.textContent = 'Loading…'; });
  video.addEventListener('playing', () => { note.textContent = ''; });
  video.addEventListener('play', () => { playBtn.textContent = 'Pause'; playBtn.setAttribute('aria-label', 'Pause'); });
  video.addEventListener('pause', () => { playBtn.textContent = 'Play'; playBtn.setAttribute('aria-label', 'Play'); });
  video.addEventListener('error', () => {
    if (destroyed) return;
    note.textContent = "Couldn't play this. If Google sign-in ran out, press Reconnect Google at the top, then Retry.";
    retry.hidden = false;
  });

  function load(url) {
    const t = video.currentTime || 0;
    note.textContent = 'Loading…';
    video.src = url;
    if (t) video.addEventListener('loadedmetadata', () => { video.currentTime = t; }, { once: true });
  }
  load(src);

  return {
    el,
    video,
    get zoom() { return { zoom, x, y, width: stage.clientWidth, height: stage.clientHeight }; },
    setZoom,
    seekTo(t) { video.currentTime = t; },
    destroy() {
      destroyed = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      window.removeEventListener('resize', paintZoom);
      el.remove();
    },
  };
}
