import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('the streaming helper only talks to Google Drive and never stores the pass', () => {
  const sw = read('sw.js');
  const hosts = [...sw.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(hosts)], ['https://www.googleapis.com']);
  assert.doesNotMatch(sw, /indexedDB|caches\.|localStorage|cookieStore/);
  assert.match(sw, /url\.origin !== self\.location\.origin/, 'only answers the app\'s own addresses');
  assert.match(sw, /event\.origin !== self\.location\.origin/, 'only takes messages from the app');
  assert.match(sw, /\/drive-stream\//);
});

test('the player is on the game page, and clips stream instead of downloading first', () => {
  const html = read('join.html');
  for (const id of ['watchCard', 'watchTabs', 'watchRoot']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(read('js/join-page.js'), /createWatcher\(/);
  assert.match(read('js/clips-page.js'), /streamUrl\(clip\.driveId/);
  assert.doesNotMatch(read('js/watch.js'), /innerHTML/);
});

test('version, release history, version.json and every page byline all agree', async () => {
  const { VERSION, RELEASES, compareVersions } = await import('../js/version.js');
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(VERSION, pkg);
  assert.equal(JSON.parse(read('version.json')).version, pkg);
  assert.equal(RELEASES[0].version, pkg, 'newest release first');
  for (let i = 1; i < RELEASES.length; i += 1) assert.equal(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), 1, 'history in order');
  for (const r of RELEASES) { assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(r.notes.length); }
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.9.0', '0.9.0'), 0);
});

test('the app can be installed: manifest, icons and the service worker on every app page', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  for (const i of m.icons) assert.ok(readFileSync(path.join(root, i.src)).length > 500, i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const page of ['index.html', 'import.html', 'join.html', 'clips.html', 'settings.html']) {
    assert.match(read(page), /<link rel="manifest" href="manifest\.webmanifest">/, page);
  }
  assert.match(read('js/header.js'), /registerApp\(\)/);
  assert.match(read('js/header.js'), /quietUpdateCheck\(\)/);
});
