// The clip editor's data and timing rules (no screen code, so it can be tested on its own).
//
// An edit:
// {
//   in, out,                 // seconds in the source video
//   shape: 'wide' | 'tall',  // 16:9 or 9:16
//   frames: [{ t, cx, cy, zoom }],   // framing keyframes (cx, cy 0..1 of the source; zoom >= 1)
//   slows: [{ t, length, rate }],    // slow motion from t for length seconds of the game
//   freezes: [{ t, hold, drawings: [...] }],  // pause at t for hold seconds, with drawings on top
//   mute: false,
// }
// Drawings use 0..1 coordinates of the output picture:
//   { kind: 'spotlight', x, y, r } · { kind: 'circle', x, y, r } · { kind: 'arrow', x1, y1, x2, y2 } · { kind: 'text', x, y, text }

export const MAX_LENGTH = 90;
export const SHAPES = { wide: { w: 1920, h: 1080, label: 'Wide 16:9' }, tall: { w: 1080, h: 1920, label: 'Tall 9:16' } };

export function newEdit(at, duration, shape = 'wide') {
  const start = Math.max(0, at - 5);
  return { in: start, out: Math.min(duration || start + 15, start + 15), shape, frames: [], slows: [], freezes: [], mute: false };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The part of the source picture shown for a frame, in source pixels.
export function cropRect(frame, srcW, srcH, shape) {
  const { w, h } = SHAPES[shape];
  const aspect = w / h;
  let cw;
  let ch;
  if (srcW / srcH > aspect) { ch = srcH; cw = srcH * aspect; } else { cw = srcW; ch = srcW / aspect; }
  const zoom = clamp(frame.zoom || 1, 1, 8);
  cw /= zoom;
  ch /= zoom;
  const cx = clamp(frame.cx * srcW, cw / 2, srcW - cw / 2);
  const cy = clamp(frame.cy * srcH, ch / 2, srcH - ch / 2);
  return { sx: cx - cw / 2, sy: cy - ch / 2, sw: cw, sh: ch };
}

export const DEFAULT_FRAME = { cx: 0.5, cy: 0.5, zoom: 1 };

// Framing at time t: glides between keyframes, holds before the first and after the last.
export function frameAt(edit, t) {
  const ks = [...edit.frames].sort((a, b) => a.t - b.t);
  if (!ks.length) return { ...DEFAULT_FRAME };
  if (t <= ks[0].t) return { cx: ks[0].cx, cy: ks[0].cy, zoom: ks[0].zoom };
  const last = ks[ks.length - 1];
  if (t >= last.t) return { cx: last.cx, cy: last.cy, zoom: last.zoom };
  for (let i = 0; i < ks.length - 1; i += 1) {
    const a = ks[i];
    const b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      const ease = f * f * (3 - 2 * f);
      return { cx: a.cx + (b.cx - a.cx) * ease, cy: a.cy + (b.cy - a.cy) * ease, zoom: a.zoom + (b.zoom - a.zoom) * ease };
    }
  }
  return { ...DEFAULT_FRAME };
}

// Adds or replaces the keyframe nearest t (within 0.4 s).
export function setFrame(edit, t, frame) {
  const rt = Math.round(t * 10) / 10;
  const frames = edit.frames.filter((k) => Math.abs(k.t - rt) > 0.4);
  frames.push({ t: rt, cx: frame.cx, cy: frame.cy, zoom: frame.zoom });
  frames.sort((a, b) => a.t - b.t);
  return { ...edit, frames };
}

export function removeAt(edit, list, index) {
  const next = [...edit[list]];
  next.splice(index, 1);
  return { ...edit, [list]: next };
}

// Keep effects inside the clip and in order; slows don't overlap.
export function tidy(edit) {
  const inside = (t) => t >= edit.in && t < edit.out;
  const slows = edit.slows.filter((s) => inside(s.t)).sort((a, b) => a.t - b.t)
    .map((s) => ({ ...s, length: Math.max(0.5, Math.min(s.length, edit.out - s.t)) }));
  for (let i = 1; i < slows.length; i += 1) {
    const prevEnd = slows[i - 1].t + slows[i - 1].length;
    if (slows[i].t < prevEnd) slows[i - 1] = { ...slows[i - 1], length: slows[i].t - slows[i - 1].t };
  }
  const freezes = edit.freezes.filter((f) => f.t >= edit.in && f.t <= edit.out).sort((a, b) => a.t - b.t);
  return { ...edit, slows: slows.filter((s) => s.length > 0.05), freezes };
}

// The order things happen when the clip is made: play pieces at a speed, and freezes.
export function buildSteps(input) {
  const edit = tidy(input);
  const cuts = new Set([edit.in, edit.out]);
  for (const s of edit.slows) { cuts.add(s.t); cuts.add(Math.min(edit.out, s.t + s.length)); }
  for (const f of edit.freezes) cuts.add(f.t);
  const times = [...cuts].filter((t) => t >= edit.in && t <= edit.out).sort((a, b) => a - b);
  const steps = [];
  const rateAt = (t) => {
    const s = edit.slows.find((x) => t >= x.t - 1e-6 && t < x.t + x.length - 1e-6);
    return s ? s.rate : 1;
  };
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    for (const f of edit.freezes.filter((x) => Math.abs(x.t - t) < 1e-6)) steps.push({ type: 'freeze', at: t, hold: f.hold, drawings: f.drawings || [] });
    if (i < times.length - 1 && times[i + 1] - t > 1e-3) {
      const rate = rateAt(t);
      const prev = steps[steps.length - 1];
      if (prev && prev.type === 'play' && prev.rate === rate && Math.abs(prev.to - t) < 1e-6) prev.to = times[i + 1];
      else steps.push({ type: 'play', from: t, to: times[i + 1], rate });
    }
  }
  return steps;
}

// How long the finished clip will be, in seconds.
export function outputLength(edit) {
  return buildSteps(edit).reduce((s, st) => s + (st.type === 'play' ? (st.to - st.from) / st.rate : st.hold), 0);
}

export function problems(edit) {
  const out = [];
  if (edit.out - edit.in < 1) out.push('The clip needs to be at least 1 second long.');
  if (outputLength(edit) > MAX_LENGTH) out.push(`Keep clips under ${MAX_LENGTH} seconds (with slow motion and freezes included).`);
  return out;
}

export function clipName(kid, game, n) {
  const opp = game ? game.opponentLabel : '';
  return `${kid ? `${kid} ` : ''}${game ? `${game.date} ${opp}` : ''} clip ${n}`.replace(/\s+/g, ' ').trim();
}
