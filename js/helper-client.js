// Talks to the Family Watch Party LiveBarn helper extension.
export const HELPER_ID = 'ihlieolhaepnpncmgebcejlabomnifmi';
// The oldest helper version this app works with. Raise it when the extension changes.
export const MIN_HELPER = '0.1.1';

export function helperOutdated(version) {
  const a = String(version || '0').split('.').map(Number);
  const b = MIN_HELPER.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); }
  return false;
}

export const HELPER_UPDATE_STEPS = 'Download the latest files (github.com/scalisec/family-watch-party → Code → Download ZIP), replace the contents of your helper folder with the new extension folder, then press the reload arrow on the helper at chrome://extensions.';
export const HELPER_INSTALL_STEPS = 'Install it: download github.com/scalisec/family-watch-party (Code → Download ZIP) and unzip it, open chrome://extensions, switch on Developer mode, press Load unpacked and pick the extension folder.';

export function helperAvailable() {
  return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function';
}

// Opens a connection. onEvent receives every message the helper sends.
export function connectHelper(onEvent) {
  if (!helperAvailable()) return null;
  let port;
  try { port = chrome.runtime.connect(HELPER_ID); } catch { return null; }
  port.onMessage.addListener((msg) => onEvent(msg));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // read it so Chrome doesn't log it as unchecked
    onEvent({ type: 'disconnected' });
  });
  return port;
}

// Resolves with the helper's version, or null when it isn't installed or doesn't answer.
export function pingHelper(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); try { port && port.disconnect(); } catch { /* ignore */ } } };
    const port = connectHelper((msg) => {
      if (msg.type === 'pong') finish(msg.version);
      if (msg.type === 'disconnected') finish(null);
    });
    if (!port) { finish(null); return; }
    port.postMessage({ type: 'ping' });
    setTimeout(() => finish(null), timeoutMs);
  });
}
