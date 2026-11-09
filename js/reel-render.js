// Recording a highlight reel: title cards and clips, one after another, onto one canvas.
import { SHAPES } from './clip-edit.js';
import { pickRecorderMime } from './pano-check-core.js';

const NAVY = '#07142A';
const BLUE = '#078DFF';

export function drawTitle(ctx, shape, lines, { big = false, fade = 1 } = {}) {
  const { w, h } = SHAPES[shape];
  const unit = Math.min(w, h);
  ctx.save();
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = fade;
  ctx.fillStyle = BLUE;
  const barW = unit * 0.32;
  ctx.fillRect((w - barW) / 2, h * 0.5 - unit * (big ? 0.2 : 0.16), barW, unit * 0.012);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const [first, ...rest] = lines;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(unit * (big ? 0.085 : 0.07))}px Montserrat, Inter, system-ui, sans-serif`;
  fitText(ctx, first || '', w / 2, h * 0.5 - unit * (big ? 0.07 : 0.05), w * 0.9);
  ctx.font = `600 ${Math.round(unit * 0.045)}px Inter, system-ui, sans-serif`;
  rest.forEach((line, i) => {
    ctx.fillStyle = i === rest.length - 1 && !big ? BLUE : '#C9D6EA';
    fitText(ctx, line, w / 2, h * 0.5 + unit * (0.05 + i * 0.07), w * 0.9);
  });
  ctx.fillStyle = 'rgba(201, 214, 234, 0.6)';
  ctx.font = `700 ${Math.round(unit * 0.026)}px Inter, system-ui, sans-serif`;
  ctx.fillText('FAMILY WATCH PARTY', w / 2, h - unit * 0.07);
  ctx.restore();
}

function fitText(ctx, text, x, y, maxW) {
  let size = parseFloat(ctx.font.match(/(\d+)px/)[1]);
  while (ctx.measureText(text).width > maxW && size > 12) {
    size -= 2;
    ctx.font = ctx.font.replace(/\d+px/, `${size}px`);
  }
  ctx.fillText(text, x, y);
}

// Fit the clip into the reel's shape; fill the spare space with a blurred copy instead of black bars.
export function drawFit(ctx, video, shape) {
  const { w, h } = SHAPES[shape];
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (!video.videoWidth) return;
  const vr = video.videoWidth / video.videoHeight;
  const cr = w / h;
  if (Math.abs(vr - cr) > 0.02) {
    const cover = Math.max(w / video.videoWidth, h / video.videoHeight);
    const coverW = video.videoWidth * cover;
    const coverH = video.videoHeight * cover;
    ctx.save();
    ctx.filter = 'blur(28px) brightness(0.55)';
    ctx.drawImage(video, (w - coverW) / 2, (h - coverH) / 2, coverW, coverH);
    ctx.restore();
  }
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
  const dw = video.videoWidth * scale;
  const dh = video.videoHeight * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays the reel onto the canvas in real time and records it.
 * steps: [{ type: 'title', lines, hold, big }, { type: 'clip', load: () => Promise<url> }]
 * Each clip is loaded while the step before it plays, so there's no pause between clips.
 */
export async function recordReel({ video, canvas, shape, steps, audio, signal, onProgress = () => {}, total }) {
  const { w, h } = SHAPES[shape];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
  const stream = canvas.captureStream(30);
  if (audio) for (const track of audio.dest.stream.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  if (audio) { audio.ctx.resume().catch(() => {}); audio.gain.gain.value = 0; }

  const loads = new Map();
  const preload = (from) => {
    const i = steps.findIndex((st, k) => k >= from && st.type === 'clip');
    if (i >= 0 && !loads.has(i)) loads.set(i, steps[i].load());
  };
  preload(0);
  let elapsed = 0;
  const check = () => { if (signal && signal.aborted) throw new DOMException('Stopped', 'AbortError'); };
  drawTitle(ctx, shape, (steps[0] && steps[0].lines) || [], { big: true, fade: 0 });
  recorder.start(1000);
  try {
    for (let k = 0; k < steps.length; k += 1) {
      const step = steps[k];
      check();
      if (step.type === 'title') {
        const start = performance.now();
        while (performance.now() - start < step.hold * 1000) {
          check();
          const t = (performance.now() - start) / 1000;
          const fade = Math.min(1, t / 0.4, Math.max(0, (step.hold - t) / 0.3));
          drawTitle(ctx, shape, step.lines, { big: step.big, fade });
          onProgress(elapsed + t, total);
          await sleep(33);
        }
        elapsed += step.hold;
      } else {
        preload(k);
        const src = await loads.get(k);
        preload(k + 1);
        video.src = src;
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve;
          video.onerror = () => reject(new Error(`Couldn't load ${step.clip ? step.clip.name : 'a clip'}.`));
        });
        video.currentTime = 0;
        if (audio) audio.gain.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.03);
        await video.play();
        const startedAt = elapsed;
        await new Promise((resolve, reject) => {
          const tick = () => {
            if (signal && signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
            drawFit(ctx, video, shape);
            onProgress(startedAt + video.currentTime, total);
            if (video.ended) { resolve(); return; }
            requestAnimationFrame(tick);
          };
          tick();
        });
        if (audio) audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.03);
        elapsed = startedAt + (Number.isFinite(video.duration) ? video.duration : step.duration || 0);
      }
    }
    // a short black tail so players don't cut the last frame
    ctx.fillStyle = NAVY;
    ctx.fillRect(0, 0, w, h);
    await sleep(300);
  } finally {
    video.pause();
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
  }
  onProgress(total, total);
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}
