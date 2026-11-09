// Google sign-in (Google Identity Services token client). The access token lives only in
// memory for this page; nothing secret is stored. Each visit needs one click to connect.
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let tokenClient = null;
let token = null;
let expiresAt = 0;
let email = '';
const listeners = new Set();

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
  token = null;
  expiresAt = 0;
  remember('fwp.google', null);
  setAccountEmail('');
  notify();
}

export class NotConnectedError extends Error {
  constructor() { super('Google Drive is not connected. Press Connect Google, then try again.'); this.code = 'not-connected'; }
}

// fetch with the access token. Throws NotConnectedError when the token has run out.
export async function gfetch(url, options = {}) {
  if (!isConnected()) { token = null; notify(); throw new NotConnectedError(); }
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { token = null; notify(); throw new NotConnectedError(); }
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
