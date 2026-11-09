// Family Watch Party streaming helper.
// Lets the video player stream a file from Google Drive in pieces (so a 1.6 GB game starts in seconds).
// It only answers this app's own /drive-stream/<id> addresses, and only fetches from Google's Drive API.
// The short-lived Google pass is asked from the open page when needed and kept in memory only.

const API = 'https://www.googleapis.com/drive/v3/files/';
const PIECE = 8 * 1024 * 1024;
let token = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data || {};
  if (data.type === 'fwp-token') token = typeof data.token === 'string' && data.token ? data.token : null;
});

async function askPage(event) {
  const ids = [event.clientId, event.resultingClientId].filter(Boolean);
  let clients = [];
  for (const id of ids) { const c = await self.clients.get(id); if (c) clients.push(c); }
  if (!clients.length) clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    const answer = await new Promise((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 3000);
      ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data && e.data.token ? e.data.token : null); };
      client.postMessage({ type: 'fwp-token-request' }, [ch.port2]);
    });
    if (answer) return answer;
  }
  return null;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'bad';
  return { start, end: Math.min(end, start + PIECE - 1) };
}

async function stream(event, id, size) {
  if (!token) token = await askPage(event);
  if (!token) return new Response('Google is not connected.', { status: 401 });
  const range = Number.isFinite(size) && size > 0 ? parseRange(event.request.headers.get('range'), size) : null;
  if (range === 'bad') return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = `bytes=${range.start}-${range.end}`;
  let res;
  try {
    res = await fetch(`${API}${encodeURIComponent(id)}?alt=media`, { headers, signal: event.request.signal });
  } catch {
    return new Response('Network trouble.', { status: 503 });
  }
  if (res.status === 401) { token = null; return new Response('Google sign-in ran out.', { status: 401 }); }
  if (!res.ok) return new Response('', { status: res.status });
  if (!range) return new Response(res.body, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ...(size ? { 'Content-Length': String(size) } : {}) } });
  return new Response(res.body, {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(range.end - range.start + 1),
    },
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  const m = /\/drive-stream\/([A-Za-z0-9_-]{10,200})$/.exec(url.pathname);
  if (!m) return;
  event.respondWith(stream(event, m[1], Number(url.searchParams.get('size'))));
});
