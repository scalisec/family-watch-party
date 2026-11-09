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
