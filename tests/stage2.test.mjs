import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS, DATA_BASE } from '../js/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('index.html: every id home.js uses exists', () => {
  const html = read('index.html');
  const js = read('js/home.js');
  for (const id of new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} missing from index.html`);
  }
});

test('index.html: loads home styles and script', () => {
  const html = read('index.html');
  assert.match(html, /href="css\/home.css"/);
  assert.match(html, /<script type="module" src="js\/home.js"><\/script>/);
});

test('home.js never writes HTML strings into the page', () => {
  assert.doesNotMatch(read('js/home.js'), /innerHTML|outerHTML|insertAdjacentHTML/);
});

test('config: two kids, each with a feed, label and logo; data read from the same site', () => {
  assert.equal(TEAMS.length, 2);
  for (const t of TEAMS) {
    for (const k of ['key', 'kid', 'label', 'feed', 'feedName', 'logo', 'season']) assert.ok(t[k], `${t.kid} missing ${k}`);
  }
  assert.equal(DATA_BASE, '/alliance-tracker/');
});

test('game table works on phones (cards under 720px)', () => {
  const css = read('css/home.css');
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /grid-template-areas: "check game result" "check when kid" "check rink rink" "check video action";/);
});
