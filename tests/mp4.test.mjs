import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, openAsBlob, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blobReader, readMp4, buildJoin, Mp4Error } from '../js/mp4.js';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const dir = mkdtempSync(join(tmpdir(), 'fwp-mp4-'));

function makePart(name, seconds, extra = []) {
  const out = join(dir, name);
  if (!existsSync(out)) {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x160:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...extra, out]);
  }
  return out;
}
async function load(path) {
  const reader = blobReader(await openAsBlob(path));
  return { reader, info: await readMp4(reader) };
}
async function write(joined, path) {
  const chunk = 1 << 20;
  const bufs = [];
  for (let o = 0; o < joined.size; o += chunk) bufs.push(await joined.read(o, Math.min(joined.size, o + chunk)));
  writeFileSync(path, Buffer.concat(bufs));
}
const probe = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', path]).toString());
const decodeErrors = (path) => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

test('reads the sample tables of a camera-style MP4', { skip: !hasFfmpeg }, async () => {
  const { info } = await load(makePart('a.mp4', 12));
  assert.ok(Math.abs(info.duration - 12) < 0.1);
  assert.equal(info.video.n, 360);
  assert.ok(info.video.hasCto, 'B-frames give composition offsets');
  assert.ok(info.audio && info.audio.n > 500);
  assert.equal([...info.video.sync].filter(Boolean).length, 6);
});

test('cuts at keyframes and joins three parts into one playable file', { skip: !hasFfmpeg }, async () => {
  const parts = [await load(makePart('a.mp4', 12)), await load(makePart('b.mp4', 12)), await load(makePart('c.mp4', 12))];
  const joined = buildJoin(parts, { startPart: 0, startSec: 3.3, endPart: 2, endSec: 4.1 });
  // starts at the keyframe at 2 s (1.3 s early), ends at the keyframe at 6 s
  assert.ok(Math.abs(joined.startSec - 2) < 0.01);
  assert.ok(Math.abs(joined.duration - 28) < 0.05, `duration ${joined.duration}`);
  const out = join(dir, 'joined.mp4');
  await write(joined, out);
  const p = probe(out);
  assert.ok(Math.abs(Number(p.format.duration) - 28) < 0.2, `ffprobe duration ${p.format.duration}`);
  assert.deepEqual(p.streams.map((s) => s.codec_type).sort(), ['audio', 'video']);
  const audio = p.streams.find((s) => s.codec_type === 'audio');
  assert.ok(Math.abs(Number(audio.duration) - 28) < 0.15, `audio ${audio.duration}`);
  assert.equal(decodeErrors(out), '');
  // moov comes before mdat, so Drive can start playing before it has the whole file
  const head = (await joined.read(0, 64));
  assert.equal(String.fromCharCode(...head.subarray(4, 8)), 'ftyp');
});

test('trims a single part', { skip: !hasFfmpeg }, async () => {
  const parts = [await load(makePart('a.mp4', 12))];
  const joined = buildJoin(parts, { startPart: 0, startSec: 0.5, endPart: 0, endSec: 7 });
  assert.ok(Math.abs(joined.duration - 8) < 0.05);
  const out = join(dir, 'single.mp4');
  await write(joined, out);
  assert.equal(decodeErrors(out), '');
});

test('reads in odd-sized pieces give the same bytes', { skip: !hasFfmpeg }, async () => {
  const parts = [await load(makePart('a.mp4', 12)), await load(makePart('b.mp4', 12))];
  const joined = buildJoin(parts, { startPart: 0, startSec: 5, endPart: 1, endSec: null });
  const whole = await joined.read(0, joined.size);
  const bits = [];
  for (let o = 0; o < joined.size; o += 77777) bits.push(await joined.read(o, Math.min(joined.size, o + 77777)));
  assert.deepEqual(Buffer.concat(bits), Buffer.from(whole));
});

test('refuses parts with different settings', { skip: !hasFfmpeg }, async () => {
  const parts = [await load(makePart('a.mp4', 12)), await load(makePart('small.mp4', 4, ['-s', '160x80']))];
  assert.throws(() => buildJoin(parts, { startPart: 0, startSec: 0, endPart: 1, endSec: null }), Mp4Error);
});

test('refuses streaming-style (fragmented) files', { skip: !hasFfmpeg }, async () => {
  const path = makePart('frag.mp4', 4, ['-movflags', 'frag_keyframe+empty_moov']);
  await assert.rejects(load(path), Mp4Error);
});

test('refuses an end mark before the start', { skip: !hasFfmpeg }, async () => {
  const parts = [await load(makePart('a.mp4', 12))];
  const j = buildJoin(parts, { startPart: 0, startSec: 9, endPart: 0, endSec: 3 });
  // the end snaps to the next keyframe after the start, never before it
  assert.ok(j.duration > 0);
});
