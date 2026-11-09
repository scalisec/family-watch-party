// The Google button and LiveBarn helper status in the header, shared by every page.
import { $, toast } from './ui.js';
import { connect, isConnected, wasConnected, accountEmail, onChange } from './google.js';
import { pingHelper } from './helper-client.js';

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

  const chip = $('helperChip');
  if (chip) {
    pingHelper().then((version) => {
      chip.textContent = version ? '● LiveBarn helper' : 'LiveBarn helper not installed';
      chip.className = `chip ${version ? 'chip-good' : 'chip-muted'}`;
    });
  }
}
