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
