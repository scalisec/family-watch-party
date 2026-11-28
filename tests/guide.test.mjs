import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { emptyRecord, addFile, setToDownload, toDownloadGames, normalizeRecord } from '../js/library.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

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
  assert.equal(existsSync(new URL('../js/guide.js', import.meta.url)), false);
  assert.doesNotMatch(read('join.html'), /id="guideCard"/, 'the download guide card is gone too (0.15.4)');
  assert.doesNotMatch(read('js/home.js'), /Download guide/);
});
