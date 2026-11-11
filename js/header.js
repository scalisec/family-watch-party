// The Google button and LiveBarn helper status in the header, shared by every page.
import { $, toast } from './ui.js';
import { connect, isConnected, wasConnected, accountEmail, onChange } from './google.js';
import { h } from './ui.js';
import { registerApp } from './stream.js';
import { VERSION, compareVersions, latestVersion } from './version.js';
import './install.js';
import { onQueueChange, queueItems, kick, retry, remove } from './upload-queue.js';

const CHECKED_KEY = 'fwp.updateChecked';

// Quietly checks for a newer version (at most every 30 minutes) and shows a bar when there is one.
export async function quietUpdateCheck() {
  try {
    const last = Number(sessionStorage.getItem(CHECKED_KEY) || 0);
    if (Date.now() - last < 30 * 60 * 1000) return;
    sessionStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch { /* fine */ }
  try {
    const latest = await latestVersion();
    if (compareVersions(latest, VERSION) > 0) showUpdateBar(latest);
  } catch { /* offline: try another time */ }
}

export function showUpdateBar(latest) {
  if (document.querySelector('.update-bar')) return;
  const bar = h('div', { class: 'update-bar', role: 'status' },
    h('span', {}, `Version ${latest} is ready.`),
    h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => location.reload() }, 'Update now'),
    h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Hide this note', onclick: () => bar.remove() }, 'Later'));
  document.body.prepend(bar);
}

export function setupHeader(onConnected) {
  const btn = $('googleBtn');
  const paint = () => {
    if (isConnected()) {
      btn.textContent = '● Google Drive';
      btn.className = 'chip chip-btn chip-good';
      btn.title = accountEmail() ? `Connected as ${accountEmail()}` : 'Connected';
    } else {
      btn.textContent = wasConnected() ? 'Reconnect Google' : 'Connect Google';
      btn.className = 'chip chip-btn chip-action';
      btn.title = 'Connect Google Drive and your calendars';
    }
  };
  btn.addEventListener('click', async () => {
    if (isConnected()) { toast(accountEmail() ? `Connected to Google as ${accountEmail()}.` : 'Connected to Google.'); return; }
    btn.textContent = 'Connecting…';
    try {
      await connect();
      paint();
      if (onConnected) await onConnected();
    } catch (err) {
      paint();
      toast(err.message, 7000);
    }
  });
  onChange(() => { paint(); if (isConnected()) kick(); });
  paint();

  setupUploads(btn);
  registerApp();
  quietUpdateCheck();

}

// ---------- the Uploads button and panel ----------
const gb = (n) => (n / 1e9 >= 1 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

function setupUploads(googleBtn) {
  const chip = h('button', { type: 'button', class: 'chip chip-btn', id: 'uploadsBtn', hidden: true, 'aria-haspopup': 'dialog' }, 'Uploads');
  googleBtn.parentNode.insertBefore(chip, googleBtn);
  const list = h('ul', { class: 'upload-list' });
  const note = h('p', { class: 'small muted' }, 'Uploads run while any page of this app is open on this PC and Google is connected. If you close the app, they pick up where they stopped next time you open it.');
  const dialog = h('dialog', { class: 'upload-dialog', 'aria-labelledby': 'uploads-h' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'uploads-h' }, 'Uploads to Drive'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => dialog.close() }, 'Close')),
    list, note);
  document.body.append(dialog);
  chip.addEventListener('click', () => { paint(); dialog.showModal(); });

  const paint = () => {
    const items = queueItems();
    chip.hidden = items.length === 0;
    if (!items.length) { if (dialog.open) dialog.close(); return; }
    const sent = items.reduce((t, i) => t + (i.sent || 0), 0);
    const total = items.reduce((t, i) => t + (i.size || 0), 0);
    const bad = items.some((i) => i.state === 'error');
    const paused = !isConnected() || items.some((i) => i.state === 'paused');
    const pct = total ? Math.floor((sent / total) * 100) : 0;
    chip.textContent = bad ? `⚠ Uploads (${items.length})` : paused ? `⏸ Uploads (${items.length})` : `↑ Uploading ${pct}% · ${items.length} left`;
    chip.className = `chip chip-btn ${bad ? 'chip-work' : paused ? 'chip-action' : 'chip-good'}`;
    list.replaceChildren(...items.map((i) => {
      const p = i.size ? Math.floor(((i.sent || 0) / i.size) * 100) : 0;
      const status = i.state === 'error' ? i.error
        : !isConnected() ? 'Waiting for Google: press Connect Google at the top.'
        : i.state === 'paused' ? i.error
        : i.state === 'uploading' ? `${gb(i.sent || 0)} of ${gb(i.size)} sent`
        : 'Waiting its turn';
      return h('li', {},
        h('div', { class: 'upload-head' },
          h('strong', {}, i.label || i.name),
          h('span', { class: 'small muted' }, `${p}%`)),
        h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(p), 'aria-label': `Uploading ${i.label || i.name}` },
          h('div', { class: 'meter-fill', style: `width: ${p}%` })),
        h('p', { class: `small ${i.state === 'error' ? 'warn-text' : 'muted'}` }, status),
        h('div', { class: 'row' },
          i.state === 'error' ? h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => retry(i.id) }, 'Try again') : null,
          h('button', { type: 'button', class: 'btn btn-small', onclick: (e) => {
            const b = e.currentTarget;
            if (b.dataset.sure) { remove(i.id); return; }
            b.dataset.sure = '1';
            b.textContent = 'Press again to remove';
            b.title = 'Deletes the copy saved for uploading. Your original downloads stay where they are.';
          } }, 'Remove')));
    }));
  };
  let last = 0;
  onQueueChange((event) => {
    if (event && event.type === 'progress' && Date.now() - last < 500) return;
    last = Date.now();
    paint();
    if (event && event.type === 'done' && event.item) toast(`Saved to Drive: ${event.item.label || event.item.name}`, 5000);
  });
  onChange(paint);
  kick();
}
