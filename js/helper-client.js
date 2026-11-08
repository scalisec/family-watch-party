// Talks to the Family Watch Party LiveBarn helper extension.
export const HELPER_ID = 'ihlieolhaepnpncmgebcejlabomnifmi';

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
