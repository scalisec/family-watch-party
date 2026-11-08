import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  formatBytes, computeCrop, droppedPercent, pickRecorderMime, rate, overallVerdict, resultsText,
} from '../js/pano-check-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');

// ---------- files and structure ----------
test('core files exist', () => {
  for (const f of ['index.html', 'pano-check.html', 'css/app.css', 'js/pano-check.js', 'js/pano-check-core.js', 'README.md', '.nojekyll']) {
    assert.ok(existsSync(path.join(root, f)), `${f} missing`);
  }
});

for (const page of ['index.html', 'pano-check.html']) {
  test(`${page}: header lockup, byline and nav`, () => {
    const html = read(page);
    assert.match(html, /<html lang="en-CA">/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /class="app-name">Family Watch Party</);
    assert.match(html, /BY BENCH BOSS LABS · V\d+\.\d+\.\d+/);
    for (const item of ['Games', 'Clips', 'Settings']) assert.match(html, new RegExp(`>${item}</a>`));
    assert.match(html, /href="css\/app.css"/);
  });

  test(`${page}: only allowed external hosts`, () => {
    const html = read(page);
    const urls = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
    for (const host of urls) assert.ok(['fonts.googleapis.com'].includes(host), `unexpected host ${host}`);
  });

  test(`${page}: no emoji`, () => {
    assert.doesNotMatch(read(page), /\p{Extended_Pictographic}/u);
  });
}

test('pano-check.html: every id the script uses exists', () => {
  const html = read('pano-check.html');
  const js = read('js/pano-check.js');
  const ids = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `#${id} missing from page`);
});

test('pano-check.html: file label points at the file input', () => {
  const html = read('pano-check.html');
  assert.match(html, /<label class="btn btn-primary" for="fileInput">/);
  assert.match(html, /<input id="fileInput" type="file" accept="video\/\*"/);
});

test('app.css: Bench Boss Labs tokens', () => {
  const css = read('css/app.css');
  for (const [name, value] of [['--ground', '#0B1B31'], ['--surface', '#12263F'], ['--accent', '#078DFF'], ['--on-accent', '#0B1B31'], ['--navy', '#07142A']]) {
    assert.match(css, new RegExp(`${name}: ${value};`), `${name} should be ${value}`);
  }
  assert.match(css, /--tap-min: 44px/);
  assert.match(css, /outline: 3px solid var\(--focus\); outline-offset: 2px/);
});

// ---------- helpers ----------
test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(415731712), '396 MB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2.0 GB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(NaN), '—');
});

test('computeCrop: zoom 1 fills the width at 16:9', () => {
  const c = computeCrop(7552, 3776, 1, 0.5, 0.5, 16 / 9);
  assert.equal(c.sw, 6713);
  assert.equal(c.sh, 3776);
  assert.equal(c.sx, Math.round((7552 - 6713.0) / 2));
  assert.equal(c.sy, 0);
});

test('computeCrop: zoom 4 is a quarter of the zoom-1 view', () => {
  const c = computeCrop(7552, 3776, 4, 0.5, 0.5, 16 / 9);
  assert.equal(c.sh, 944);   // 3776 / 4
  assert.equal(c.sw, 1678);  // 6713 / 4, keeping 16:9
});

test('computeCrop: stays inside the frame at the corners', () => {
  for (const [cx, cy] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
    const c = computeCrop(7552, 3776, 3, cx, cy, 16 / 9);
    assert.ok(c.sx >= 0 && c.sy >= 0, 'negative origin');
    assert.ok(c.sx + c.sw <= 7552 && c.sy + c.sh <= 3776, 'past the edge');
  }
});

test('computeCrop: zoom below 1 is treated as 1; 720p source works', () => {
  assert.deepEqual(computeCrop(1280, 720, 0.5, 0.5, 0.5, 16 / 9), { sx: 0, sy: 0, sw: 1280, sh: 720 });
});

test('droppedPercent', () => {
  assert.equal(droppedPercent(0, 0), 0);
  assert.equal(droppedPercent(3, 600), 0.5);
  assert.equal(droppedPercent(60, 600), 10);
});

test('pickRecorderMime prefers MP4, falls back to WebM, handles none', () => {
  assert.equal(pickRecorderMime(() => true), 'video/mp4;codecs=avc1.640028');
  assert.equal(pickRecorderMime((m) => m.startsWith('video/webm')), 'video/webm;codecs=vp9');
  assert.equal(pickRecorderMime(() => false), '');
  assert.equal(pickRecorderMime(() => { throw new Error('x'); }), '');
});

test('rate and overallVerdict', () => {
  assert.equal(rate('dropped', 1), 'good');
  assert.equal(rate('dropped', 5), 'work');
  assert.equal(rate('dropped', 20), 'bad');
  assert.equal(rate('seek', 300), 'good');
  assert.equal(rate('seek', 2000), 'bad');
  assert.equal(rate('exportFrames', 99), 'good');
  assert.equal(rate('exportFrames', 85), 'work');
  assert.equal(rate('exportFrames', 50), 'bad');
  assert.equal(rate('nope', 1), 'unknown');
  assert.equal(rate('seek', NaN), 'unknown');
  assert.equal(overallVerdict([]), 'unknown');
  assert.equal(overallVerdict(['good', 'good']), 'good');
  assert.equal(overallVerdict(['good', 'work']), 'work');
  assert.equal(overallVerdict(['work', 'bad', 'unknown']), 'bad');
});

test('resultsText includes every measurement', () => {
  const text = resultsText({
    fileName: 'a.mp4', fileSize: 1024, width: 7552, height: 3776, duration: 960,
    dropped: 0.5, seek: 320, exportFrames: 98, exportSeconds: 10.4, exportSize: 5_000_000,
    exportType: 'video/mp4', userAgent: 'Chrome',
  });
  for (const part of ['a.mp4', '7552×3776', '0.5%', '320 ms', '98%', '10.4 s', 'video/mp4', 'Chrome']) {
    assert.ok(text.includes(part), `missing ${part}`);
  }
});
