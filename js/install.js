// "Install the app" support (same approach as Alliance Tracker).
// - Chrome and Edge (PC and Android) fire beforeinstallprompt: keep it so a button can open the real install dialog.
// - iPhone and iPad have no install API: show Share -> Add to Home Screen.
// - Already installed (running in its own window): nothing to do.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try { localStorage.setItem('fwp.installed', '1'); } catch { /* fine */ }
    notify();
  });
}

export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  return {
    iOS,
    android: /Android/.test(ua),
    samsung: /SamsungBrowser/.test(ua),
    standalone,
    installedBefore: (() => { try { return localStorage.getItem('fwp.installed') === '1'; } catch { return false; } })(),
  };
}

export const canPrompt = () => Boolean(deferred);
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  notify();
  return outcome;
}
