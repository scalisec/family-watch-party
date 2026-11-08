import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { URL };
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(root, 'extension/lib/plan.js'), 'utf8'), ctx);
const P = ctx.FWPPlan;

// The real list LiveBarn showed for the Woodstock game (1:00–1:30 window, PANO).
const LIST = [
  'Clip 1  01:00 PM - 01:14 PM  14 minutes  DOWNLOAD',
  'Clip 2  01:14 PM - 01:29 PM  16 minutes  DOWNLOAD',
];
const WOODSTOCK = { surfaceId: '4334', date: '2026-11-07', start: '13:15', durationMin: 60, kid: 'Lucas', opponent: 'vs Woodstock Jr Navy Vets' };

test('parseClock', () => {
  assert.equal(P.parseClock('01:14 PM'), 13 * 60 + 14);
  assert.equal(P.parseClock('12:00 PM'), 12 * 60);
  assert.equal(P.parseClock('12:30 AM'), 30);
  assert.equal(P.parseClock('9:05 am'), 9 * 60 + 5);
  assert.ok(Number.isNaN(P.parseClock('13:00')));
  assert.ok(Number.isNaN(P.parseClock('')));
});

test('parseHHMM and toHHMM round-trip', () => {
  assert.equal(P.parseHHMM('13:15'), 795);
  assert.equal(P.toHHMM(795), '13:15');
  assert.equal(P.toHHMM(60), '01:00');
  assert.ok(Number.isNaN(P.parseHHMM('1:15 PM')));
});

test('parseClipRow reads LiveBarn rows', () => {
  const c = P.parseClipRow(LIST[1]);
  assert.equal(c.index, 2);
  assert.equal(c.start, 13 * 60 + 14);
  assert.equal(c.end, 13 * 60 + 29);
  assert.equal(c.minutes, 16);
  assert.equal(c.label, '01:14 PM - 01:29 PM');
  assert.equal(P.parseClipRow('Clip 1\n01:00 PM - 01:14 PM\n14 minutes').start, 780);
  assert.equal(P.parseClipRow('nothing here'), null);
});

test('parseClipRow handles a file running past midnight', () => {
  const c = P.parseClipRow('Clip 1 11:45 PM - 12:15 AM 30 minutes');
  assert.equal(c.end - c.start, 30);
});

test('parseUsage', () => {
  assert.deepEqual({ ...P.parseUsage('Download usage: 662/1800 minutes downloaded') }, { used: 662, limit: 1800 });
  assert.equal(P.parseUsage('no usage'), null);
});

test('windows: Woodstock 1:15 game opens at 1:00 and needs 1:30 and 2:00', () => {
  assert.equal(P.firstWindow(WOODSTOCK), 780);
  assert.equal(P.needsNextWindow(780, WOODSTOCK), true);   // game runs to 2:15
  assert.equal(P.needsNextWindow(810, WOODSTOCK), true);
  assert.equal(P.needsNextWindow(840, WOODSTOCK), false);
  assert.equal(P.videoUrl('4334', '2026-11-07', 780), 'https://watch.livebarn.com/en/video/4334/2026-11-07/13:00');
});

test('clipsToDownload takes only Clip 2 for a 1:15 start (as Cristian chose)', () => {
  const clips = LIST.map(P.parseClipRow);
  const pick = P.clipsToDownload(clips, WOODSTOCK, []);
  assert.equal(pick.length, 1);
  assert.equal(pick[0].index, 2);
});

test('clipsToDownload with extra time before includes the earlier file', () => {
  const clips = LIST.map(P.parseClipRow);
  const pick = P.clipsToDownload(clips, { ...WOODSTOCK, extraBeforeMin: 5 }, []);
  assert.deepEqual(pick.map((c) => c.index), [1, 2]);
});

test('clipsToDownload skips files already taken and files after the game', () => {
  const clips = [
    P.parseClipRow('Clip 1 02:00 PM - 02:30 PM 30 minutes'),
    P.parseClipRow('Clip 2 02:30 PM - 03:00 PM 30 minutes'),
  ];
  const pick = P.clipsToDownload(clips, WOODSTOCK, []);
  assert.deepEqual(pick.map((c) => c.index), [1]);                 // game ends 2:15
  assert.equal(P.clipsToDownload(clips, WOODSTOCK, [14 * 60]).length, 0);
});

test('extra time after a game reaches into the next file', () => {
  const clips = [P.parseClipRow('Clip 1 02:30 PM - 03:00 PM 30 minutes')];
  assert.equal(P.clipsToDownload(clips, WOODSTOCK, []).length, 0);
  assert.equal(P.clipsToDownload(clips, { ...WOODSTOCK, extraAfterMin: 30 }, []).length, 1);
  assert.equal(P.needsNextWindow(840, { ...WOODSTOCK, extraAfterMin: 30 }), true);
});

test('isPanoHref tells PANO from AUTO by the file folder', () => {
  const base = 'https://livebarn-prod-vod-media.s3.amazonaws.com/x/20261107/';
  assert.equal(P.isPanoHref(`${base}abc4_7552x3776p/abc4_7552x3776p_20261107_181423_1.mp4?a=1`), true);
  assert.equal(P.isPanoHref(`${base}abc5_720p/abc5_720p_20261107_181450_1.mp4?a=1`), false);
  assert.equal(P.isPanoHref('not a url'), false);
});

test('isLiveBarnMedia', () => {
  assert.equal(P.isLiveBarnMedia('https://livebarn-prod-vod-media.s3.amazonaws.com/a.mp4'), true);
  assert.equal(P.isLiveBarnMedia('https://evil.example.com/livebarn-prod-vod-media.s3.amazonaws.com'), false);
});

test('fileNameFor builds a tidy, safe path', () => {
  const clip = P.parseClipRow(LIST[1]);
  assert.equal(P.fileNameFor(WOODSTOCK, clip, 1),
    'FamilyWatchParty/Lucas/2026-11-07 vs Woodstock Jr Navy Vets/2026-11-07 vs Woodstock Jr Navy Vets part 1 (1314).mp4');
  const odd = P.fileNameFor({ ...WOODSTOCK, kid: '../Grace', opponent: 'at A/B: "C"?' }, clip, 2);
  assert.ok(!odd.includes('..'), 'no parent folder');
  assert.ok(!/[:*?"<>|]/.test(odd), 'no illegal characters');
});

test('validateGame', () => {
  assert.deepEqual([...P.validateGame(WOODSTOCK)], []);
  assert.equal(P.validateGame(null).length, 1);
  const bad = P.validateGame({ surfaceId: 'abc', date: 'Nov 7', start: '1:15 PM', durationMin: 5 });
  assert.equal(bad.length, 4);
});
