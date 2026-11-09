// Streaming Drive videos into a <video> through the app's service worker (sw.js).
import { currentToken, onChange } from './google.js';

let ready = null;
let registered = null;

// Installs the app's service worker (needed for streaming and for installing the app).
export function registerApp() {
  if (registered) return registered;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registered = navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname })
    .catch(() => null);
  return registered;
}

function sendToken() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (sw) sw.postMessage({ type: 'fwp-token', token: currentToken() || '' });
}

// Registers the worker once per page and resolves when it controls the page.
export function streamReady() {
  if (ready) return ready;
  ready = (async () => {
    if (!('serviceWorker' in navigator)) throw new Error("This browser can't stream from Drive.");
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'fwp-token-request' && e.ports[0]) e.ports[0].postMessage({ token: currentToken() || '' });
    });
    await registerApp();
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 4000);
      });
    }
    if (!navigator.serviceWorker.controller) throw new Error('The streaming helper didn\'t start. Reload the page and try again.');
    navigator.serviceWorker.addEventListener('controllerchange', sendToken);
    onChange(sendToken);
    sendToken();
  })();
  return ready;
}

export function streamUrl(driveId, size) {
  return new URL(`../drive-stream/${encodeURIComponent(driveId)}?size=${Math.round(size || 0)}`, import.meta.url).href;
}
