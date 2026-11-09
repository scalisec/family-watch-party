import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEdit, cropRect, frameAt, setFrame, buildSteps, outputLength, problems, tidy, clipName } from '../js/clip-edit.js';

test('a new clip starts 5 seconds before where you are, 15 seconds long', () => {
  const e = newEdit(100, 4000);
  assert.equal(e.in, 95);
  assert.equal(e.out, 110);
  assert.equal(e.shape, 'wide');
});

test('wide and tall framing crop the PANO picture at the right shape', () => {
  const wide = cropRect({ cx: 0.5, cy: 0.5, zoom: 1 }, 3840, 1920, 'wide');
  assert.ok(Math.abs(wide.sw / wide.sh - 16 / 9) < 1e-9);
  assert.equal(wide.sh, 1920);
  const tall = cropRect({ cx: 0.5, cy: 0.5, zoom: 1 }, 3840, 1920, 'tall');
  assert.equal(tall.sh, 1920);
  assert.equal(Math.round(tall.sw), 1080);
  const zoomed = cropRect({ cx: 0, cy: 0, zoom: 2 }, 3840, 1920, 'wide');
  assert.deepEqual([zoomed.sx, zoomed.sy], [0, 0], 'stays inside the picture');
  assert.equal(zoomed.sh, 960);
});

test('framing glides between keyframes and holds at the ends', () => {
  let e = newEdit(100, 4000);
  e = setFrame(e, 96, { cx: 0.2, cy: 0.5, zoom: 2 });
  e = setFrame(e, 104, { cx: 0.6, cy: 0.5, zoom: 2 });
  assert.equal(frameAt(e, 90).cx, 0.2);
  assert.equal(frameAt(e, 200).cx, 0.6);
  assert.ok(Math.abs(frameAt(e, 100).cx - 0.4) < 1e-9);
  e = setFrame(e, 104.2, { cx: 0.7, cy: 0.5, zoom: 2 });
  assert.equal(e.frames.length, 2, 'a nearby keyframe is replaced, not added');
});

test('slow motion and freezes become play and freeze steps, and add to the length', () => {
  const e = { ...newEdit(100, 4000), slows: [{ t: 100, length: 2, rate: 0.5 }], freezes: [{ t: 103, hold: 3, drawings: [] }] };
  const steps = buildSteps(e);
  assert.deepEqual(steps.map((s) => s.type === 'play' ? `play ${s.from}-${s.to} @${s.rate}` : `freeze ${s.at} ${s.hold}s`), [
    'play 95-100 @1', 'play 100-102 @0.5', 'play 102-103 @1', 'freeze 103 3s', 'play 103-110 @1',
  ]);
  assert.equal(outputLength(e), 15 + 2 + 3);
});

test('effects outside the clip are dropped, and overlapping slow motion is trimmed', () => {
  const e = tidy({ ...newEdit(100, 4000), slows: [{ t: 96, length: 5, rate: 0.5 }, { t: 98, length: 2, rate: 0.25 }, { t: 200, length: 2, rate: 0.5 }], freezes: [{ t: 50, hold: 2 }] });
  assert.deepEqual(e.slows.map((s) => [s.t, s.length]), [[96, 2], [98, 2]]);
  assert.equal(e.freezes.length, 0);
});

test('clips over 90 seconds are flagged', () => {
  assert.deepEqual(problems(newEdit(100, 4000)), []);
  assert.equal(problems({ ...newEdit(100, 4000), out: 200 }).length, 1);
});

test('clip names', () => {
  assert.equal(clipName('Lucas', { date: '2026-11-07', opponentLabel: 'vs Woodstock Jr Navy Vets' }, 2), 'Lucas 2026-11-07 vs Woodstock Jr Navy Vets clip 2');
});

test('the clip editor is on the game page and saves clips with their edit', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(read('join.html'), /id="makeClipBtn"/);
  assert.match(read('join.html'), /id="clipCard"/);
  assert.match(read('js/join-page.js'), /createClipEditor\(/);
  assert.match(read('js/join-page.js'), /extra: \{ shape: info\.shape, edit: info\.edit/);
  for (const f of ['js/clip-editor.js', 'js/clip-render.js', 'js/share.js']) assert.doesNotMatch(read(f), /innerHTML/, f);
});

test('highlight reels: clips grouped by game in season order, with title cards', async () => {
  const { reelGroups, reelPlan, reelLength, gameTitleLines } = await import('../js/reel.js');
  const g1 = { id: 'a', kid: 'Lucas', startMs: 2, date: '2026-11-07', opponentLabel: 'vs Woodstock', result: { outcome: 'W', us: 4, them: 0 } };
  const g0 = { id: 'b', kid: 'Lucas', startMs: 1, date: '2026-10-31', opponentLabel: 'at Oakville', tournament: 'Halloween Classic' };
  const gGrace = { id: 'c', kid: 'Grace', startMs: 3, date: '2026-11-08', opponentLabel: 'vs Hamilton' };
  const clips = [
    { driveId: 'x2', gameId: 'a', game: g1, duration: 10, addedAt: '2' },
    { driveId: 'x1', gameId: 'a', game: g1, duration: 12, addedAt: '1' },
    { driveId: 'y', gameId: 'b', game: g0, duration: 8, addedAt: '3' },
    { driveId: 'z', gameId: 'c', game: gGrace, duration: 9 },
  ];
  const groups = reelGroups(clips, 'Lucas');
  assert.deepEqual(groups.map((g) => g.game.id), ['b', 'a']);
  assert.deepEqual(groups[1].clips.map((c) => c.driveId), ['x1', 'x2']);
  assert.deepEqual(gameTitleLines(g1, (d) => d), ['2026-11-07', 'vs Woodstock', 'W 4–0']);
  const steps = reelPlan({ groups, picked: new Set(['x1', 'x2', 'y']), titles: true, heading: 'Lucas', subheading: '2026-27', dayLabel: (d) => d });
  assert.deepEqual(steps.map((s) => s.type === 'title' ? `title:${s.lines[0]}` : `clip:${s.clip.driveId}`), ['title:Lucas', 'title:2026-10-31', 'clip:y', 'title:2026-11-07', 'clip:x1', 'clip:x2']);
  assert.equal(reelLength(steps), 3 + 2.5 + 8 + 2.5 + 12 + 10);
  const noTitles = reelPlan({ groups, picked: new Set(['x1']), titles: false, heading: 'Lucas', dayLabel: (d) => d });
  assert.deepEqual(noTitles.map((s) => s.type), ['title', 'clip']);
});

test('reels are kept in the record and survive reloading it', async () => {
  const { emptyRecord, addReel, reelList, normalizeRecord, reelFolderPath } = await import('../js/library.js');
  let r = addReel(emptyRecord(), { driveId: 'r1', kid: 'Lucas', name: 'a.mp4' }, '2026-11-09T01:00:00Z');
  r = addReel(r, { driveId: 'r2', kid: 'Grace', name: 'b.mp4' }, '2026-11-09T02:00:00Z');
  assert.deepEqual(reelList(normalizeRecord(JSON.parse(JSON.stringify(r))), 'Lucas').map((x) => x.driveId), ['r1']);
  assert.deepEqual(reelFolderPath({ kid: 'Lucas', season: '2026-27', label: 'U10BB Bulldogs Blue' }), ['Family Hockey', 'Lucas', '2026-27 U10BB Bulldogs Blue', 'Highlight reels']);
});

test('the reel maker is on the Clips page and uses only its own ids', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const html = read('clips.html');
  const js = read('js/clips-page.js');
  for (const m of js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) assert.match(html, new RegExp(`id="${m[1]}"`), `missing #${m[1]}`);
  assert.match(js, /recordReel\(/);
  assert.match(js, /reelFolderPath\(team\)/);
  assert.doesNotMatch(read('js/reel-render.js'), /innerHTML/);
});
