import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ setTimeout, console, URL, TextEncoder, Uint8Array, Math, JSON, Number, String, Error, Object, Promise });
ctx.self = ctx;
vm.runInContext(readFileSync(new URL('../extension/lib/drive-lite.js', import.meta.url), 'utf8'), ctx);
const { client, CHUNK } = ctx.FWPDrive;

function streamOf(bytes, piece = 3_000_000) {
  let o = 0;
  return new ReadableStream({ pull(c) { if (o >= bytes.length) { c.close(); return; } c.enqueue(bytes.subarray(o, o + piece)); o += piece; } });
}

test('streams a file into Drive in 16 MB pieces and survives a hiccup', async () => {
  const total = CHUNK * 2 + 5_000_000;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < total; i += 4099) bytes[i] = i % 251;
  const got = new Uint8Array(total);
  let have = 0;
  let failedOnce = false;
  const ranges = [];
  const fakeFetch = async (url, opts = {}) => {
    const h = opts.headers || {};
    if (url.includes('uploadType=resumable')) {
      assert.equal(h.Authorization, 'Bearer T');
      assert.equal(h['X-Upload-Content-Length'], String(total));
      return new Response('', { status: 200, headers: { Location: 'https://upload.example/session1' } });
    }
    if (url === 'https://upload.example/session1') {
      const cr = h['Content-Range'];
      ranges.push(cr);
      if (/^bytes \*\//.test(cr)) return new Response('', { status: 308, headers: have ? { Range: `bytes=0-${have - 1}` } : {} });
      const [, a, b] = /bytes (\d+)-(\d+)\//.exec(cr).map(Number);
      if (a === CHUNK && !failedOnce) { failedOnce = true; return new Response('', { status: 503 }); }
      got.set(new Uint8Array(opts.body.buffer, opts.body.byteOffset, opts.body.byteLength), a);
      have = b + 1;
      if (have === total) return new Response(JSON.stringify({ id: 'F1', size: String(total) }), { status: 200 });
      return new Response('', { status: 308, headers: { Range: `bytes=0-${b}` } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const realSet = ctx.setTimeout;
  ctx.setTimeout = (f) => realSet(f, 0); // no real waiting between retries in the test
  const d = client(async () => 'T', fakeFetch);
  const session = await d.startUpload('folder1', 'x.mp4', total);
  const seen = [];
  const result = await d.uploadStream(session, streamOf(bytes), total, (s) => seen.push(s));
  ctx.setTimeout = realSet;
  assert.equal(result.id, 'F1');
  assert.ok(got.every((v, i) => v === bytes[i]), 'Drive received exactly the file');
  assert.ok(failedOnce, 'one piece failed and was retried');
  assert.deepEqual(seen, [CHUNK, CHUNK * 2, total]);
  assert.ok(ranges.includes(`bytes ${CHUNK * 2}-${total - 1}/${total}`), 'last piece carries the total');
});
