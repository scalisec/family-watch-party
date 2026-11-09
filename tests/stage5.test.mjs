import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyRecord, addFile, clipList } from '../js/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

test('every page links Games, Clips and Settings to real pages', () => {
  for (const page of readdirSync(root).filter((f) => f.endsWith('.html'))) {
    const html = read(page);
    assert.match(html, /<a href="index\.html"[^>]*>Games<\/a>/, page);
    assert.match(html, /<a href="clips\.html"[^>]*>Clips<\/a>/, page);
    assert.match(html, /<a href="settings\.html"[^>]*>Settings<\/a>/, page);
    assert.doesNotMatch(html, /href="#(clips|settings)"/, page);
  }
});

for (const [page, script] of [['clips.html', 'js/clips-page.js'], ['settings.html', 'js/settings-page.js']]) {
  test(`${page} uses only its own ids and no innerHTML`, () => {
    const html = read(page);
    const js = read(script);
    assert.doesNotMatch(js, /innerHTML/);
    for (const m of js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) assert.match(html, new RegExp(`id="${m[1]}"`), `missing #${m[1]} in ${page}`);
    assert.match(html, new RegExp(script.replace('.', '\\.')));
  });
}

test('clips are listed with their game, newest game first', () => {
  let r = emptyRecord();
  r = addFile(r, 'old', { driveId: 'c1', name: 'early goal.mp4', kind: 'clip', size: 1 }, 'T1');
  r = addFile(r, 'new', { driveId: 'c2', name: 'save.mp4', kind: 'clip', size: 2 }, 'T2');
  r = addFile(r, 'new', { driveId: 'f', name: 'full.mp4', kind: 'full', size: 9 }, 'T3');
  const games = new Map([['old', { id: 'old', kid: 'Lucas', startMs: 1 }], ['new', { id: 'new', kid: 'Grace', startMs: 2 }]]);
  const list = clipList(r, games);
  assert.deepEqual(list.map((c) => c.driveId), ['c2', 'c1']);
  assert.equal(list[0].game.kid, 'Grace');
});

test('reset only clears this app\'s own saved info', () => {
  const js = read('js/settings-page.js');
  assert.match(js, /key\.startsWith\('fwp\.'\)/);
  assert.doesNotMatch(js, /localStorage\.clear\(\)|sessionStorage\.clear\(\)/);
});
