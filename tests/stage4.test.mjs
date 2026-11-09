import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyRecord, addFile, gameSummary, partsByView, joinedFile, joinedFileName, setMarks, replaceWithJoined, alreadyImported, clockSec,
} from '../js/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const game = { id: 'g1', date: '2026-11-07', opponentLabel: 'vs Woodstock Jr Navy Vets' };

function threeParts() {
  let r = emptyRecord();
  r = addFile(r, 'g1', { driveId: 'p2', name: 'part 2', kind: 'full', view: 'PANO', start: 810, startSec: 48600, size: 2, original: { name: 'b.mp4', size: 2 } }, 'T');
  r = addFile(r, 'g1', { driveId: 'p1', name: 'part 1', kind: 'full', view: 'PANO', start: 794, startSec: 47663, size: 1, original: { name: 'a.mp4', size: 1 } }, 'T');
  r = addFile(r, 'g1', { driveId: 'q1', name: 'auto 1', kind: 'full', view: 'AUTO', start: 794, size: 5, original: { name: 'c.mp4', size: 5 } }, 'T');
  r = addFile(r, 'g1', { driveId: 'k', name: 'goal', kind: 'clip', size: 9, original: { name: 'goal.mp4', size: 9 } }, 'T');
  return r;
}

test('parts are grouped by view, in time order', () => {
  const by = partsByView(threeParts(), 'g1');
  assert.deepEqual(Object.keys(by).sort(), ['AUTO', 'PANO']);
  assert.deepEqual(by.PANO.map((f) => f.driveId), ['p1', 'p2']);
  assert.equal(clockSec(by.AUTO[0]), 794 * 60, 'older entries fall back to whole minutes');
});

test('joining swaps the parts for one full-game file and remembers the originals', () => {
  let r = threeParts();
  r = setMarks(r, 'g1', 'PANO', { start: { part: 0, sec: 95 }, end: { part: 1, sec: 1200 } }, 'T2');
  assert.deepEqual(r.games.g1.marks.PANO.start, { part: 0, sec: 95 });
  r = replaceWithJoined(r, 'g1', ['p1', 'p2'], { driveId: 'j', name: joinedFileName(game, 'PANO'), view: 'PANO', size: 3 }, 'T3');
  assert.equal(joinedFile(r, 'g1', 'PANO').driveId, 'j');
  assert.equal(joinedFile(r, 'g1', 'PANO').name, '2026-11-07 vs Woodstock Jr Navy Vets full game PANO.mp4');
  assert.deepEqual(partsByView(r, 'g1').PANO, undefined);
  assert.equal(gameSummary(r, 'g1').toJoin, true, 'AUTO still has a part');
  assert.equal(alreadyImported(r, { name: 'a.mp4', size: 1 }), true, 'the parts are never imported twice');
  r = replaceWithJoined(r, 'g1', ['q1'], { driveId: 'j2', name: 'x', view: 'AUTO', size: 5 }, 'T4');
  const s = gameSummary(r, 'g1');
  assert.equal(s.joined, true);
  assert.equal(s.toJoin, false);
  assert.equal(s.clips, 1);
  assert.equal(r.games.g1.marks.PANO.end.sec, 1200, 'marks are kept');
});

test('join page exists, uses only its own ids, and never uses innerHTML', () => {
  const html = read('join.html');
  const js = read('js/join-page.js');
  assert.doesNotMatch(js, /innerHTML/);
  for (const m of js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) assert.match(html, new RegExp(`id="${m[1]}"`), `missing #${m[1]}`);
  assert.match(html, /js\/join-page\.js/);
});

test('home links games with parts to the join page', () => {
  assert.match(read('js/home.js'), /join\.html\?game=/);
});
