// Cut and join MP4 files without re-processing the video.
// Reads the parts' sample tables, keeps the samples between the marks (cutting at keyframes),
// and writes one new MP4 (moov first, so it streams) whose bytes are produced on demand.

export class Mp4Error extends Error {}

const CHUNK_SECONDS = 1;

// ---------- readers ----------
export function blobReader(blob) {
  return {
    size: blob.size,
    async read(start, end) { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); },
  };
}

// ---------- parsing ----------
const typeAt = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

export async function topBoxes(reader) {
  const boxes = [];
  let off = 0;
  while (off + 8 <= reader.size) {
    const h = await reader.read(off, Math.min(off + 16, reader.size));
    const dv = view(h);
    let size = dv.getUint32(0);
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = reader.size - off;
    if (size < hdr) throw new Mp4Error('This video file looks damaged.');
    boxes.push({ type: typeAt(h, 4), start: off, size });
    off += size;
  }
  return boxes;
}

function* kids(u8, start, end) {
  const dv = view(u8);
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    yield { type: typeAt(u8, o + 4), start: o, body: o + hdr, end: o + size };
    o += size;
  }
}

function find(u8, box, path) {
  let cur = box;
  for (const t of path) {
    cur = [...kids(u8, cur.body, cur.end)].find((b) => b.type === t);
    if (!cur) return null;
  }
  return cur;
}

function need(box, what) {
  if (!box) throw new Mp4Error(`This video file is missing its ${what}, so it can't be joined.`);
  return box;
}

function parseTrack(u8, trak) {
  const dv = view(u8);
  const hdlr = find(u8, trak, ['mdia', 'hdlr']);
  if (!hdlr) return null;
  const handler = typeAt(u8, hdlr.body + 8);
  if (handler !== 'vide' && handler !== 'soun') return null;

  const tkhd = need(find(u8, trak, ['tkhd']), 'track header');
  const tkhdV = u8[tkhd.body];
  const trackId = dv.getUint32(tkhd.body + (tkhdV === 1 ? 20 : 12));
  const tkhdTail = u8.slice(tkhd.end - 44, tkhd.end);

  const mdhd = need(find(u8, trak, ['mdia', 'mdhd']), 'timing');
  const mdV = u8[mdhd.body];
  const timescale = dv.getUint32(mdhd.body + (mdV === 1 ? 20 : 12));
  const language = u8.slice(mdhd.body + (mdV === 1 ? 32 : 20), mdhd.body + (mdV === 1 ? 34 : 22));

  const stbl = need(find(u8, trak, ['mdia', 'minf', 'stbl']), 'sample table');
  const get = (t) => [...kids(u8, stbl.body, stbl.end)].find((b) => b.type === t) || null;
  const stsd = need(get('stsd'), 'codec settings');

  // sizes
  const stsz = get('stsz');
  if (!stsz) throw new Mp4Error("This video file uses a layout the app can't join yet.");
  const fixed = dv.getUint32(stsz.body + 4);
  const n = dv.getUint32(stsz.body + 8);
  const sizes = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) sizes[i] = fixed || dv.getUint32(stsz.body + 12 + i * 4);

  // times
  const stts = need(get('stts'), 'timing table');
  const dts = new Float64Array(n);
  const dur = new Uint32Array(n);
  let s = 0;
  let t = 0;
  for (let e = 0, ec = dv.getUint32(stts.body + 4); e < ec; e += 1) {
    const count = dv.getUint32(stts.body + 8 + e * 8);
    const delta = dv.getUint32(stts.body + 12 + e * 8);
    for (let k = 0; k < count && s < n; k += 1) { dts[s] = t; dur[s] = delta; t += delta; s += 1; }
  }
  const totalDur = t;

  // composition offsets (B-frames)
  const cto = new Int32Array(n);
  const ctts = get('ctts');
  let hasCto = false;
  if (ctts) {
    const signed = u8[ctts.body] === 1;
    s = 0;
    for (let e = 0, ec = dv.getUint32(ctts.body + 4); e < ec; e += 1) {
      const count = dv.getUint32(ctts.body + 8 + e * 8);
      const off = signed ? dv.getInt32(ctts.body + 12 + e * 8) : dv.getUint32(ctts.body + 12 + e * 8) | 0;
      for (let k = 0; k < count && s < n; k += 1) { cto[s] = off; if (off) hasCto = true; s += 1; }
    }
  }

  // keyframes
  const sync = new Uint8Array(n);
  const stss = get('stss');
  if (stss) {
    for (let e = 0, ec = dv.getUint32(stss.body + 4); e < ec; e += 1) {
      const idx = dv.getUint32(stss.body + 8 + e * 4) - 1;
      if (idx >= 0 && idx < n) sync[idx] = 1;
    }
  } else sync.fill(1);

  // byte offsets
  const stco = get('stco');
  const co64 = get('co64');
  const chunkBox = need(stco || co64, 'data index');
  const chunkCount = dv.getUint32(chunkBox.body + 4);
  const chunkOffsets = new Float64Array(chunkCount);
  for (let c = 0; c < chunkCount; c += 1) {
    chunkOffsets[c] = co64 ? Number(dv.getBigUint64(chunkBox.body + 8 + c * 8)) : dv.getUint32(chunkBox.body + 8 + c * 4);
  }
  const stsc = need(get('stsc'), 'chunk table');
  const runs = [];
  for (let e = 0, ec = dv.getUint32(stsc.body + 4); e < ec; e += 1) {
    runs.push({ first: dv.getUint32(stsc.body + 8 + e * 12) - 1, spc: dv.getUint32(stsc.body + 12 + e * 12) });
  }
  const offsets = new Float64Array(n);
  s = 0;
  for (let r = 0; r < runs.length; r += 1) {
    const last = r + 1 < runs.length ? runs[r + 1].first : chunkCount;
    for (let c = runs[r].first; c < last; c += 1) {
      let off = chunkOffsets[c];
      for (let k = 0; k < runs[r].spc && s < n; k += 1) { offsets[s] = off; off += sizes[s]; s += 1; }
    }
  }
  if (s < n) throw new Mp4Error('This video file looks damaged (its data index is short).');

  return {
    kind: handler === 'vide' ? 'video' : 'audio',
    trackId, timescale, language, tkhdTail,
    stsd: u8.slice(stsd.start, stsd.end),
    n, sizes, dts, dur, cto, hasCto, sync, offsets, totalDur,
  };
}

export function parseMoov(u8) {
  const root = { body: 0, end: u8.length };
  const moov = need([...kids(u8, root.body, root.end)].find((b) => b.type === 'moov'), 'index');
  const tracks = [];
  for (const b of kids(u8, moov.body, moov.end)) {
    if (b.type === 'trak') { const tr = parseTrack(u8, b); if (tr) tracks.push(tr); }
  }
  const video = tracks.find((tr) => tr.kind === 'video');
  if (!video) throw new Mp4Error("This file has no video track, so it can't be joined.");
  const audio = tracks.find((tr) => tr.kind === 'audio') || null;
  return { video, audio, duration: video.totalDur / video.timescale };
}

export async function readMp4(reader) {
  const boxes = await topBoxes(reader);
  if (boxes.some((b) => b.type === 'moof')) {
    throw new Mp4Error("This file is saved in streaming pieces, which the app can't join yet.");
  }
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) throw new Mp4Error("This file has no index, so it may not have finished downloading.");
  return parseMoov(await reader.read(moov.start, moov.start + moov.size));
}

// ---------- planning the cut ----------
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkCompatible(infos) {
  const [first] = infos;
  for (const info of infos.slice(1)) {
    if (info.video.timescale !== first.video.timescale || !sameBytes(info.video.stsd, first.video.stsd)) {
      throw new Mp4Error("These parts were recorded with different video settings, so they can't be joined without re-processing.");
    }
    if (Boolean(info.audio) !== Boolean(first.audio)) throw new Mp4Error('Only some of these parts have sound, so they can\'t be joined.');
    if (info.audio && (info.audio.timescale !== first.audio.timescale || !sameBytes(info.audio.stsd, first.audio.stsd))) {
      throw new Mp4Error("These parts were recorded with different sound settings, so they can't be joined.");
    }
  }
}

function lastSyncAtOrBefore(v, target) {
  let best = -1;
  for (let i = 0; i < v.n && v.dts[i] <= target; i += 1) if (v.sync[i]) best = i;
  if (best >= 0) return best;
  for (let i = 0; i < v.n; i += 1) if (v.sync[i]) return i;
  return 0;
}
function firstSyncAtOrAfter(v, target) {
  for (let i = 0; i < v.n; i += 1) if (v.sync[i] && v.dts[i] >= target) return i;
  return v.n;
}
function firstAtOrAfter(tr, target) {
  for (let i = 0; i < tr.n; i += 1) if (tr.dts[i] >= target) return i;
  return tr.n;
}

// cut = { startPart, startSec, endPart, endSec } (seconds from the start of each part; endSec null = to the end)
export function planSegments(infos, cut) {
  const segments = [];
  for (let p = cut.startPart; p <= cut.endPart; p += 1) {
    const { video: v, audio: a } = infos[p];
    const vts = v.timescale;
    const i0 = p === cut.startPart ? lastSyncAtOrBefore(v, cut.startSec * vts) : 0;
    const i1 = p === cut.endPart && cut.endSec != null ? Math.max(firstSyncAtOrAfter(v, cut.endSec * vts), i0 + 1) : v.n;
    if (i1 <= i0) continue;
    const tS = v.dts[i0] / vts;
    const tE = (i1 < v.n ? v.dts[i1] : v.totalDur) / vts;
    let a0 = 0;
    let a1 = 0;
    if (a) {
      const half = (a.dur[0] || 1024) / 2;
      a0 = firstAtOrAfter(a, tS * a.timescale - half);
      a1 = Math.max(a0, firstAtOrAfter(a, tE * a.timescale - half));
    }
    segments.push({ part: p, i0, i1, a0, a1, tS, tE });
  }
  if (!segments.length) throw new Mp4Error('The final buzzer is before puck drop. Check the marks.');
  return segments;
}

// ---------- writing ----------
function bytes(len) { return new Uint8Array(len); }
function u32s(...vals) { const b = bytes(vals.length * 4); const dv = view(b); vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return b; }
function u32arr(arr) { const b = bytes(arr.length * 4); const dv = view(b); for (let i = 0; i < arr.length; i += 1) dv.setUint32(i * 4, arr[i] >>> 0); return b; }
function u64arr(arr) { const b = bytes(arr.length * 8); const dv = view(b); for (let i = 0; i < arr.length; i += 1) dv.setBigUint64(i * 8, BigInt(Math.round(arr[i]))); return b; }
function u64(v) { const b = bytes(8); view(b).setBigUint64(0, BigInt(Math.round(v))); return b; }
function u16s(...vals) { const b = bytes(vals.length * 2); const dv = view(b); vals.forEach((v, i) => dv.setUint16(i * 2, v)); return b; }
function ascii(s) { return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
function concat(parts) {
  const out = bytes(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function box(type, ...parts) {
  const body = concat(parts);
  const out = bytes(8 + body.length);
  view(out).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}
const fullBox = (type, version, flags, ...parts) => box(type, Uint8Array.of(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
const MATRIX = u32s(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

function runs(values) {
  const out = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0] += 1; else out.push([1, v]);
  }
  return out;
}

function sampleTable(tr, out) {
  const n = out.size.length;
  const parts = [box('stsd', tr.stsd.subarray(8))];
  const stts = runs(out.dur);
  parts.push(fullBox('stts', 0, 0, u32s(stts.length), u32arr(stts.flat())));
  if (tr.kind === 'video' && out.cto.some((c) => c !== 0)) {
    const signed = out.cto.some((c) => c < 0);
    const ctts = runs(out.cto);
    parts.push(fullBox('ctts', signed ? 1 : 0, 0, u32s(ctts.length), u32arr(ctts.flat())));
  }
  if (tr.kind === 'video') {
    const keys = [];
    for (let i = 0; i < n; i += 1) if (out.sync[i]) keys.push(i + 1);
    parts.push(fullBox('stss', 0, 0, u32s(keys.length), u32arr(keys)));
  }
  const spc = runs(out.chunks.map((c) => c.count));
  let chunkNo = 1;
  const stscEntries = [];
  for (const [count, perChunk] of spc) { stscEntries.push(chunkNo, perChunk, 1); chunkNo += count; }
  parts.push(fullBox('stsc', 0, 0, u32s(spc.length), u32arr(stscEntries)));
  parts.push(fullBox('stsz', 0, 0, u32s(0, n), u32arr(out.size)));
  parts.push(fullBox('co64', 0, 0, u32s(out.chunks.length), u64arr(out.chunks.map((c) => c.dst))));
  return box('stbl', ...parts);
}

function trak(tr, out, movieDurMs, trackId) {
  const isVideo = tr.kind === 'video';
  const trackDur = out.dur.reduce((s, d) => s + d, 0);
  const tkhd = fullBox('tkhd', 0, 3, u32s(0, 0, trackId, 0, movieDurMs, 0, 0), u16s(0, isVideo ? 0 : 1, isVideo ? 0 : 0x0100, 0), tr.tkhdTail);
  const parts = [tkhd];
  if (isVideo && out.cto.length && out.cto[0] > 0) {
    parts.push(box('edts', fullBox('elst', 0, 0, u32s(1, movieDurMs, out.cto[0], 0x00010000))));
  }
  const mdhd = fullBox('mdhd', 1, 0, u64(0), u64(0), u32s(tr.timescale), u64(trackDur), tr.language, u16s(0));
  const hdlr = fullBox('hdlr', 0, 0, u32s(0), ascii(isVideo ? 'vide' : 'soun'), u32s(0, 0, 0), ascii(isVideo ? 'VideoHandler\0' : 'SoundHandler\0'));
  const mhd = isVideo ? fullBox('vmhd', 0, 1, u16s(0, 0, 0, 0)) : fullBox('smhd', 0, 0, u16s(0, 0));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32s(1), fullBox('url ', 0, 1)));
  parts.push(box('mdia', mdhd, hdlr, box('minf', mhd, dinf, sampleTable(tr, out))));
  return box('trak', ...parts);
}

// Collect the output samples for one track (video or audio) across the segments.
function collect(infos, segments, kind) {
  const list = [];
  for (const seg of segments) {
    const tr = infos[seg.part][kind];
    const [i0, i1] = kind === 'video' ? [seg.i0, seg.i1] : [seg.a0, seg.a1];
    const segLen = Math.round((seg.tE - seg.tS) * tr.timescale);
    let used = 0;
    for (let i = i0; i < i1; i += 1) {
      let d = tr.dur[i];
      if (i === i1 - 1) d = Math.max(1, segLen - used);
      used += d;
      list.push({ part: seg.part, src: tr.offsets[i], size: tr.sizes[i], dur: d, cto: tr.cto[i], sync: tr.sync[i], seg: seg.part });
    }
  }
  return list;
}

function chunkUp(list, timescale, track) {
  const chunks = [];
  let t = 0;
  let cur = null;
  list.forEach((s, i) => {
    if (!cur || s.seg !== list[cur.first].seg || t - cur.time * timescale >= CHUNK_SECONDS * timescale) {
      cur = { track, first: i, count: 0, time: t / timescale, dst: 0 };
      chunks.push(cur);
    }
    cur.count += 1;
    t += s.dur;
  });
  return chunks;
}

// Build the joined file. Returns { size, duration, read(start, end) }.
export function buildJoin(parts, cut) {
  const infos = parts.map((p) => p.info);
  checkCompatible(infos);
  const segments = planSegments(infos, cut);
  const base = infos[0];
  const kinds = base.audio ? ['video', 'audio'] : ['video'];

  const tracks = kinds.map((kind) => {
    const tr = base[kind];
    const list = collect(infos, segments, kind);
    const chunks = chunkUp(list, tr.timescale, kind);
    return {
      kind, tr, list, chunks,
      out: {
        size: list.map((s) => s.size), dur: list.map((s) => s.dur), cto: list.map((s) => s.cto), sync: list.map((s) => s.sync), chunks,
      },
    };
  });
  const video = tracks[0];
  const durationSec = video.out.dur.reduce((s, d) => s + d, 0) / video.tr.timescale;
  const movieDurMs = Math.round(durationSec * 1000);

  // Interleave chunks by time (video first on ties)
  const order = tracks.flatMap((t) => t.chunks.map((c) => ({ c, t })))
    .sort((x, y) => x.c.time - y.c.time || (x.t.kind === 'video' ? -1 : 1));

  const ftyp = box('ftyp', ascii('isom'), u32s(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const makeMoov = () => {
    const mvhd = fullBox('mvhd', 0, 0, u32s(0, 0, 1000, movieDurMs, 0x00010000), u16s(0x0100, 0), u32s(0, 0), MATRIX, u32s(0, 0, 0, 0, 0, 0), u32s(tracks.length + 1));
    return box('moov', mvhd, ...tracks.map((t, i) => trak(t.tr, t.out, movieDurMs, i + 1)));
  };

  // Assign destinations (moov size doesn't depend on the offset values)
  const layout = (dataStart) => {
    let dst = dataStart;
    const pieces = [];
    for (const { c, t } of order) {
      c.dst = dst;
      for (let i = c.first; i < c.first + c.count; i += 1) {
        const s = t.list[i];
        const last = pieces[pieces.length - 1];
        if (last && last.part === s.part && last.src + last.size === s.src && last.dst + last.size === dst) last.size += s.size;
        else pieces.push({ part: s.part, src: s.src, size: s.size, dst });
        dst += s.size;
      }
    }
    return { pieces, end: dst };
  };
  const probe = makeMoov();
  const dataStart = ftyp.length + probe.length + 16;
  const { pieces, end } = layout(dataStart);
  const moov = makeMoov();
  if (moov.length !== probe.length) throw new Error('Internal error laying out the joined file.');
  const mdatHdr = concat([u32s(1), ascii('mdat'), u64(end - dataStart + 16)]);
  const header = concat([ftyp, moov, mdatHdr]);

  async function read(start, stop) {
    const out = bytes(stop - start);
    if (start < header.length) out.set(header.subarray(start, Math.min(stop, header.length)), 0);
    // first piece that ends after start
    let lo = 0;
    let hi = pieces.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pieces[mid].dst + pieces[mid].size <= start) lo = mid + 1; else hi = mid; }
    const wanted = [];
    for (let i = lo; i < pieces.length && pieces[i].dst < stop; i += 1) {
      const pc = pieces[i];
      const from = Math.max(start, pc.dst);
      const to = Math.min(stop, pc.dst + pc.size);
      wanted.push({ part: pc.part, src: pc.src + (from - pc.dst), len: to - from, at: from - start });
    }
    const byPart = new Map();
    for (const w of wanted) { if (!byPart.has(w.part)) byPart.set(w.part, []); byPart.get(w.part).push(w); }
    for (const [p, ws] of byPart) {
      let lowSrc = Infinity;
      let highSrc = 0;
      for (const w of ws) { lowSrc = Math.min(lowSrc, w.src); highSrc = Math.max(highSrc, w.src + w.len); }
      const buf = await parts[p].reader.read(lowSrc, highSrc);
      for (const w of ws) out.set(buf.subarray(w.src - lowSrc, w.src - lowSrc + w.len), w.at);
    }
    return out;
  }

  const startOffset = segments[0].tS - (cut.startSec || 0);
  return {
    size: end, duration: durationSec, type: 'video/mp4', read,
    startPart: segments[0].part, startSec: segments[0].tS, endSec: segments[segments.length - 1].tE, earlyBy: -startOffset,
  };
}
