// Drawing a clip's frames onto a canvas, and "performing" the edit in real time to record it.
import { cropRect, frameAt, buildSteps, outputLength, SHAPES } from './clip-edit.js';
import { pickRecorderMime } from './pano-check-core.js';

const INK = '#FFD60A';
const SHADOW = 'rgba(0, 0, 0, 0.55)';

export function drawVideo(ctx, video, t, edit) {
  const { w, h } = SHAPES[edit.shape];
  if (!video.videoWidth) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
  const r = cropRect(frameAt(edit, t), video.videoWidth, video.videoHeight, edit.shape);
  ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
}

function arrowHead(ctx, x1, y1, x2, y2, size) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
  ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

// fade: 0..1, how far the drawings have appeared
export function drawDrawings(ctx, drawings, shape, fade = 1) {
  const { w, h } = SHAPES[shape];
  const unit = Math.min(w, h);
  const spots = drawings.filter((d) => d.kind === 'spotlight');
  if (spots.length) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.62 * fade})`;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    for (const s of spots) { ctx.moveTo(s.x * w + s.r * unit, s.y * h); ctx.arc(s.x * w, s.y * h, s.r * unit, 0, Math.PI * 2, true); }
    ctx.fill('evenodd');
    ctx.globalAlpha = fade;
    ctx.strokeStyle = INK;
    ctx.lineWidth = unit * 0.006;
    for (const s of spots) { ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r * unit, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = unit * 0.01;
  for (const d of drawings) {
    if (d.kind === 'circle') {
      ctx.lineWidth = unit * 0.008;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r * unit, 0, Math.PI * 2);
      ctx.stroke();
    } else if (d.kind === 'arrow') {
      ctx.lineWidth = unit * 0.009;
      const [x1, y1, x2, y2] = [d.x1 * w, d.y1 * h, d.x2 * w, d.y2 * h];
      const head = unit * 0.04;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - ((x2 - x1) / len) * head * 0.8, y2 - ((y2 - y1) / len) * head * 0.8);
      ctx.stroke();
      arrowHead(ctx, x1, y1, x2, y2, head);
    } else if (d.kind === 'text' && d.text) {
      const size = Math.round(unit * 0.065);
      ctx.font = `800 ${size}px Montserrat, Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(d.text).width;
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7, 20, 42, 0.78)';
      const pad = size * 0.35;
      ctx.fillRect(d.x * w - tw / 2 - pad, d.y * h - size / 2 - pad * 0.6, tw + pad * 2, size + pad * 1.2);
      ctx.fillStyle = INK;
      ctx.fillText(d.text, d.x * w, d.y * h);
      ctx.shadowBlur = unit * 0.01;
    }
  }
  ctx.restore();
}

function waitSeek(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.01 && video.readyState >= 2) { resolve(); return; }
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
    setTimeout(done, 8000);
  });
}

function frameLoop(video, fn) {
  let stop = false;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const tick = () => { if (stop) return; fn(); video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  }
  // also run on animation frames so freezes and drawings keep updating
  const raf = () => { if (stop) return; fn(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return () => { stop = true; };
}

/**
 * Plays the edit onto the canvas in real time. With record: true, returns the recorded Blob.
 * @param {object} o
 * @param {HTMLVideoElement} o.video  source (same-origin, so the canvas can be recorded)
 * @param {HTMLCanvasElement} o.canvas sized to the shape
 * @param {object} o.edit
 * @param {boolean} [o.record]
 * @param {AbortSignal} [o.signal]
 * @param {(done: number, total: number) => void} [o.onProgress] seconds of finished clip
 * @param {object} [o.audio] { ctx, gain } from audioFor(video), needed for sound when recording
 */
export async function perform({ video, canvas, edit, record = false, signal, onProgress = () => {}, audio = null }) {
  const ctx = canvas.getContext('2d');
  const steps = buildSteps(edit);
  const total = outputLength(edit);
  let elapsed = 0;
  let mode = { type: 'play' };
  let freezeStart = 0;

  const paint = () => {
    drawVideo(ctx, video, video.currentTime, edit);
    if (mode.type === 'freeze') {
      const f = Math.min(1, (performance.now() - freezeStart) / 300);
      drawDrawings(ctx, mode.drawings, edit.shape, f);
    }
  };

  video.pause();
  await waitSeek(video, steps.length ? (steps[0].type === 'play' ? steps[0].from : steps[0].at) : edit.in);
  paint();

  let recorder = null;
  let chunks = [];
  let mime = '';
  if (record) {
    mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    const stream = canvas.captureStream(30);
    if (audio) for (const track of audio.dest.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: edit.shape === 'tall' ? 10_000_000 : 10_000_000, audioBitsPerSecond: 160_000 });
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(1000);
  }
  if (audio) { audio.ctx.resume().catch(() => {}); }
  const setSound = (on) => { if (audio) audio.gain.gain.setTargetAtTime(on && !edit.mute ? 1 : 0, audio.ctx.currentTime, 0.02); };

  const stopLoop = frameLoop(video, paint);
  try {
    for (const step of steps) {
      if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (step.type === 'play') {
        mode = { type: 'play' };
        if (Math.abs(video.currentTime - step.from) > 0.25) await waitSeek(video, step.from);
        video.playbackRate = step.rate;
        setSound(step.rate === 1);
        const startedAt = elapsed;
        await video.play().catch(() => {});
        await new Promise((resolve, reject) => {
          const check = () => {
            if (signal && signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
            onProgress(Math.min(total, startedAt + (video.currentTime - step.from) / step.rate), total);
            if (video.currentTime >= step.to - 0.02 || video.ended) resolve(); else setTimeout(check, 15);
          };
          check();
        });
        video.pause();
        elapsed = startedAt + (step.to - step.from) / step.rate;
      } else {
        setSound(false);
        video.pause();
        mode = { type: 'freeze', drawings: step.drawings };
        freezeStart = performance.now();
        const until = performance.now() + step.hold * 1000;
        const startedAt = elapsed;
        while (performance.now() < until) {
          if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError');
          onProgress(startedAt + (step.hold - (until - performance.now()) / 1000), total);
          await new Promise((r) => setTimeout(r, 50));
        }
        mode = { type: 'play' };
        elapsed = startedAt + step.hold;
      }
    }
  } finally {
    stopLoop();
    video.pause();
    video.playbackRate = 1;
    setSound(false);
  }
  onProgress(total, total);
  if (!recorder) return null;
  await new Promise((r) => setTimeout(r, 150));
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}

// Sound from the source video, routed so it can be recorded and muted (call once per video element).
export function audioFor(video) {
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(video);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const dest = ctx.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(dest);
  source.connect(ctx.destination); // so you still hear it while editing
  return { ctx, gain, dest };
}
