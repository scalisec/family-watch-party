// The Google button and LiveBarn helper status in the header, shared by every page.
import { $, toast } from './ui.js';
import { connect, isConnected, wasConnected, accountEmail, onChange } from './google.js';
import { pingHelper } from './helper-client.js';
import { h } from './ui.js';
import { registerApp } from './stream.js';
import { VERSION, compareVersions, latestVersion } from './version.js';
import './install.js';

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
  onChange(paint);
  paint();

  registerApp();
  quietUpdateCheck();

  const chip = $('helperChip');
  if (chip) {
    pingHelper().then((version) => {
      chip.textContent = version ? '● LiveBarn helper' : 'LiveBarn helper not installed';
      chip.className = `chip ${version ? 'chip-good' : 'chip-muted'}`;
    });
  }
}
