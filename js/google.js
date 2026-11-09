// Google sign-in (Google Identity Services token client). The short-lived access token (about an hour)
// is kept in sessionStorage so it carries across this app's pages in the same tab. It is erased when
// the tab closes, when it expires, or on disconnect. No refresh token or password is ever stored.
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let tokenClient = null;
let token = null;
let expiresAt = 0;
let email = '';
const listeners = new Set();
const SESSION_KEY = 'fwp.session';
let expiryTimer = null;

function saveSession() {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* fine: just means one more click */ }
}
function watchExpiry() {
  clearTimeout(expiryTimer);
  if (token) expiryTimer = setTimeout(() => { forget(); }, Math.max(0, expiresAt - Date.now()));
}
function forget() { token = null; expiresAt = 0; saveSession(); clearTimeout(expiryTimer); notify(); }
function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (saved && saved.token && Date.now() < saved.expiresAt) { token = saved.token; expiresAt = saved.expiresAt; watchExpiry(); }
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* fine */ }
}

function remember(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* fine */ }
}
function recall(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export function wasConnected() { return recall('fwp.google') === '1'; }
export function isConnected() { return Boolean(token) && Date.now() < expiresAt; }
export function accountEmail() { return email || recall('fwp.googleEmail'); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(isConnected()); }
restoreSession();

export function setAccountEmail(value) {
  email = value || '';
  remember('fwp.googleEmail', email || null);
}

function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't reach Google sign-in. Check your connection and try again."));
    document.head.append(s);
  });
}

// Must be called from a click: Google opens a small window to confirm.
export async function connect() {
  await loadGis();
  const oauth2 = window.google.accounts.oauth2;
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPES.join(' '), callback: () => {} });
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in didn't finish (${resp.error}).`)); return; }
      if (!oauth2.hasGrantedAllScopes(resp, ...GOOGLE_SCOPES)) {
        reject(new Error('Family Watch Party needs both boxes ticked on Google\'s screen: your Drive files from this app, and your calendars (read only). Press Connect again and tick both.'));
        return;
      }
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) - 120) * 1000;
      remember('fwp.google', '1');
      saveSession();
      watchExpiry();
      notify();
      resolve();
    };
    tokenClient.error_callback = (err) => {
      reject(new Error(err && err.type === 'popup_closed'
        ? 'The Google window was closed before signing in.'
        : 'The Google sign-in window was blocked. Allow pop-ups for this site, then press Connect again.'));
    };
    tokenClient.requestAccessToken({ prompt: wasConnected() ? '' : 'consent', login_hint: accountEmail() || undefined });
  });
}

export function disconnect() {
  if (token && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(token, () => {});
  remember('fwp.google', null);
  setAccountEmail('');
  forget();
}

export class NotConnectedError extends Error {
  constructor(message) { super(message || 'Google Drive is not connected. Press Connect Google, then try again.'); this.code = 'not-connected'; }
}

// fetch with the access token. Throws NotConnectedError when the token has run out.
export async function gfetch(url, options = {}) {
  if (!isConnected()) { if (token) forget(); throw new NotConnectedError(); }
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { forget(); throw new NotConnectedError(); }
  return res;
}

export async function gjson(url, options) {
  const res = await gfetch(url, options);
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body.error && body.error.message ? body.error.message : ''; } catch { /* not json */ }
    throw new Error(`Google said ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.status === 204 ? null : res.json();
}
