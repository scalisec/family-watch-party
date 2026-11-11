import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinedQueueItem, clipQueueItem, queuedOriginal } from '../js/publish.js';
import { emptyRecord, addFile, replaceWithJoined, alreadyImported } from '../js/library.js';

const game = { id: 'g1', kid: 'Lucas', date: '2026-11-07', opponentLabel: 'vs Woodstock Jr Navy Vets' };
const team = { season: '2026-27', label: 'U10BB Blue' };
const pcFile = (name, size) => ({ name, size, lastModified: 1, type: 'video/mp4' });

test('a queued full game carries its folder, name, start and the parts to trash', () => {
  const parts = [
    { id: 'a', driveId: 'D1', clock: 46800, size: 10 },
    { id: 'b', file: pcFile('2026-11-07 13-30 PANO.mp4', 20), clock: 48600, size: 20 },
  ];
  const joined = { size: 25, duration: 3605.4, startSec: 120 };
  const item = joinedQueueItem({ joined, used: parts, parts, game, team, view: 'PANO' });
  assert.equal(item.kind, 'full');
  assert.equal(item.gameId, 'g1');
  assert.equal(item.size, 25);
  assert.equal(item.name, '2026-11-07 vs Woodstock Jr Navy Vets full game PANO.mp4');
  assert.deepEqual(item.folderPath.slice(-2), ['2026-11-07 vs Woodstock Jr Navy Vets', 'full game']);
  assert.deepEqual(item.trashIds, ['D1']);
  assert.equal(item.entry.startSec, 46920);
  assert.equal(item.entry.start, 782);
  assert.equal(item.entry.duration, 3605);
  assert.deepEqual(item.entry.originals.map((o) => o.name), ['2026-11-07 13-30 PANO.mp4']);
});

test('a queued clip goes to the clips folder as it is', () => {
  const item = clipQueueItem({ file: pcFile('goal.mp4', 5), duration: 12.4, game, team });
  assert.equal(item.kind, 'clip');
  assert.equal(item.folderPath.at(-1), 'clips');
  assert.equal(item.entry.duration, 12);
  assert.equal(item.entry.original.name, 'goal.mp4');
});

test('files waiting in the uploads are spotted so they are not added twice', () => {
  const parts = [{ id: 'b', file: pcFile('p1.mp4', 20), clock: 0, size: 20 }];
  const items = [
    joinedQueueItem({ joined: { size: 20, duration: 60, startSec: 0 }, used: parts, parts, game, team, view: 'PANO' }),
    clipQueueItem({ file: pcFile('goal.mp4', 5), game, team }),
  ];
  assert.equal(queuedOriginal(items, pcFile('p1.mp4', 20)), true);
  assert.equal(queuedOriginal(items, pcFile('goal.mp4', 5)), true);
  assert.equal(queuedOriginal(items, pcFile('p1.mp4', 21)), false, 'same name, different file');
  assert.equal(queuedOriginal([], pcFile('p1.mp4', 20)), false);
});

test('when the upload finishes, the record gets the same entry Save used to write', () => {
  let rec = addFile(emptyRecord(), 'g1', { driveId: 'D1', name: 'part 1', kind: 'full', view: 'PANO', size: 10, original: pcFile('old.mp4', 10) });
  const parts = [{ id: 'a', driveId: 'D1', clock: 0, size: 10 }, { id: 'b', file: pcFile('p2.mp4', 20), clock: 1800, size: 20 }];
  const item = joinedQueueItem({ joined: { size: 28, duration: 3000, startSec: 5 }, used: parts, parts, game, team, view: 'PANO' });
  rec = replaceWithJoined(rec, item.gameId, item.trashIds, { ...item.entry, driveId: 'J1', name: item.name, size: item.size });
  const files = rec.games.g1.files;
  assert.equal(files.length, 1);
  assert.equal(files[0].driveId, 'J1');
  assert.equal(files[0].joined, true);
  assert.equal(files[0].view, 'PANO');
  assert.ok(alreadyImported(rec, pcFile('old.mp4', 10)), 'the Drive part it replaced');
  assert.ok(alreadyImported(rec, pcFile('p2.mp4', 20)), 'the file picked on this PC');
});
