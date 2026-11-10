import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { guideWindows, minutesUpTo, clockLabel } from '../js/guide.js';
import { emptyRecord, addFile, setToDownload, toDownloadGames, normalizeRecord } from '../js/library.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const game = { id: 'g', date: '2026-11-07', time: '13:15', liveBarn: { surfaceId: '4334' } };

test('the guide lists the same LiveBarn windows the helper found on Nov 10', () => {
  const w = guideWindows(game);
  assert.deepEqual(w.map((x) => [clockLabel(x.start), clockLabel(x.from), clockLabel(x.to)]), [
    ['1:00 PM', '1:15 PM', '1:30 PM'], ['1:30 PM', '1:30 PM', '2:00 PM'], ['2:00 PM', '2:00 PM', '2:15 PM'],
  ]);
  assert.equal(w[0].url, 'https://watch.livebarn.com/en/video/4334/2026-11-07/13:00');
  assert.equal(minutesUpTo(w), 90);
  const long = guideWindows(game, { extraWindows: 1 });
  assert.equal(long.length, 4);
  assert.equal(long[3].extra, true);
  assert.equal(long[3].url.endsWith('/14:30'), true);
  assert.deepEqual(guideWindows({ ...game, liveBarn: null }), [], 'no rink, no windows');
  assert.deepEqual(guideWindows({ ...game, time: '14:00' }).map((x) => clockLabel(x.start)), ['2:00 PM', '2:30 PM']);
});

test('the To-download list syncs in the record and drops games once downloaded', () => {
  let r = setToDownload(emptyRecord(), 'a', true, 'T1');
  r = setToDownload(r, 'b', true, 'T2');
  r = normalizeRecord(JSON.parse(JSON.stringify(r)));
  const games = [{ id: 'a', startMs: 2 }, { id: 'b', startMs: 1 }, { id: 'c', startMs: 3 }];
  assert.deepEqual(toDownloadGames(r, games).map((g) => g.id), ['b', 'a'], 'oldest first');
  r = addFile(r, 'b', { driveId: 'x', name: 'x', kind: 'full', view: 'PANO', size: 1 }, 'T3');
  assert.deepEqual(toDownloadGames(r, games).map((g) => g.id), ['a']);
  r = setToDownload(r, 'a', false, 'T4');
  assert.deepEqual(toDownloadGames(r, games), []);
});

test('the LiveBarn helper is gone from the app', () => {
  assert.equal(existsSync(new URL('../extension', import.meta.url)), false);
  assert.equal(existsSync(new URL('../helper-test.html', import.meta.url)), false);
  for (const f of ['index.html', 'settings.html', 'js/header.js', 'js/settings-page.js', 'js/data.js', 'js/home.js']) {
    assert.doesNotMatch(read(f), /helper-client|helper-test|helperChip|Helper inbox/, f);
  }
  assert.match(read('join.html'), /id="guideCard"/);
  assert.match(read('js/home.js'), /Download guide/);
});
