// Small shared page helpers.
export const $ = (id) => document.getElementById(id);

// h('td', { class: 'x', onclick: fn }, child, 'text', …)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(text, ms = 4500) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

export function readSaved(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private window: fine */ }
}
export function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or private: fine */ }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return i === 0 ? `${v} bytes` : `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return m >= 1 ? `${m} min` : `0:${String(s).padStart(2, '0')}`;
}

// Links that open Drive in the browser (not API calls)
export function driveFileLink(id) {
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}
export function driveFolderLink(id) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

// Width, height and length of a video file (empty if the browser can't read it)
export function readMeta(file) {
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

// Opens the file picker in the Downloads folder where the browser allows it; falls back to the plain picker.
export async function pickVideoFiles(input) {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true, startIn: 'downloads', id: 'fwp-videos',
        types: [{ description: 'Videos', accept: { 'video/mp4': ['.mp4', '.m4v'], 'video/quicktime': ['.mov'] } }],
      });
      return Promise.all(handles.map((x) => x.getFile()));
    } catch (err) {
      if (err.name === 'AbortError') return [];
    }
  }
  return new Promise((resolve) => {
    const done = () => { input.removeEventListener('change', done); resolve([...input.files]); input.value = ''; };
    input.addEventListener('change', done);
    input.click();
  });
}
