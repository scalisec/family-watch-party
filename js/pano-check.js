import {
  formatBytes, computeCrop, droppedPercent, pickRecorderMime, rate, overallVerdict, resultsText,
} from './pano-check-core.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('zoomCanvas');
const ctx = canvas.getContext('2d');
const OUT_W = 1280;
const OUT_H = 720;

const state = {
  zoom: 2, cx: 0.5, cy: 0.5,
  results: { userAgent: navigator.userAgent },
  ratings: {},
};

// ---------- file ----------
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  state.results.fileName = file.name;
  state.results.fileSize = file.size;
  $('fileStatus').textContent = `${file.name} · ${formatBytes(file.size)} · loading…`;
});

video.addEventListener('loadedmetadata', () => {
  const r = state.results;
  r.width = video.videoWidth;
  r.height = video.videoHeight;
  r.duration = video.duration;
  $('fileStatus').textContent = `${r.fileName} · ${formatBytes(r.fileSize)} · ${r.width}×${r.height}`;
  $('rSize').textContent = `${r.width}×${r.height} · ${Math.round(r.duration / 60)} min`;
  ['playTest', 'seekTest', 'exportTest'].forEach((id) => { $(id).disabled = false; });
  $('playStatus').textContent = 'Ready.';
  $('exportStatus').textContent = 'Ready.';
  video.currentTime = Math.min(60, r.duration / 3);
});

video.addEventListener('error', () => {
  $('fileStatus').textContent = 'This browser could not open that file. Try Chrome, or check it is the LiveBarn MP4.';
});

// ---------- zoom preview ----------
function drawZoom(target = ctx) {
  if (!video.videoWidth) return;
  const { sx, sy, sw, sh } = computeCrop(video.videoWidth, video.videoHeight, state.zoom, state.cx, state.cy, OUT_W / OUT_H);
  target.drawImage(video, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
}

function previewLoop() {
  drawZoom();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(previewLoop);
}
video.addEventListener('loadeddata', () => {
  drawZoom();
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(previewLoop);
});
video.addEventListener('seeked', () => drawZoom());

$('zoom').addEventListener('input', (e) => {
  state.zoom = Number(e.target.value);
  $('zoomValue').textContent = `${state.zoom.toFixed(1)}×`;
  drawZoom();
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const { sx, sy, sw, sh } = computeCrop(video.videoWidth, video.videoHeight, state.zoom, state.cx, state.cy, OUT_W / OUT_H);
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  state.cx = (sx + px * sw) / video.videoWidth;
  state.cy = (sy + py * sh) / video.videoHeight;
  drawZoom();
});

// ---------- playback test ----------
$('playTest').addEventListener('click', async () => {
  $('playTest').disabled = true;
  $('playStatus').textContent = 'Playing for 20 seconds…';
  const before = video.getVideoPlaybackQuality();
  try { await video.play(); } catch {
    $('playStatus').textContent = 'Playback was blocked. Press play on the video, then try again.';
    $('playTest').disabled = false;
    return;
  }
  await new Promise((res) => setTimeout(res, 20000));
  video.pause();
  const after = video.getVideoPlaybackQuality();
  const pct = droppedPercent(after.droppedVideoFrames - before.droppedVideoFrames,
    after.totalVideoFrames - before.totalVideoFrames);
  state.results.dropped = pct;
  setResult('rDropped', 'dropped', pct, `${pct}% of frames dropped`);
  $('playStatus').textContent = 'Done.';
  $('playTest').disabled = false;
});

// ---------- seek test ----------
function seekTo(t) {
  return new Promise((res) => {
    const start = performance.now();
    video.addEventListener('seeked', () => res(performance.now() - start), { once: true });
    video.currentTime = t;
  });
}

$('seekTest').addEventListener('click', async () => {
  $('seekTest').disabled = true;
  video.pause();
  $('playStatus').textContent = 'Jumping to 5 spots…';
  const d = video.duration;
  const spots = [0.15, 0.8, 0.4, 0.95, 0.6].map((f) => f * d);
  const times = [];
  for (const t of spots) times.push(await seekTo(t));
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  state.results.seek = avg;
  setResult('rSeek', 'seek', avg, `${avg} ms on average`);
  $('playStatus').textContent = 'Done.';
  $('seekTest').disabled = false;
});

// ---------- export test ----------
$('exportTest').addEventListener('click', async () => {
  const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) { $('exportStatus').textContent = 'This browser cannot record video from a page.'; return; }
  $('exportTest').disabled = true;
  $('exportDownload').hidden = true;

  const out = document.createElement('canvas');
  out.width = OUT_W; out.height = OUT_H;
  const octx = out.getContext('2d');
  const stream = out.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const startAt = video.currentTime;
  const endAt = Math.min(startAt + 10, video.duration);
  const clipSeconds = endAt - startAt;
  let frames = 0;
  let running = true;
  const draw = () => {
    if (!running) return;
    drawZoom(octx);
    frames += 1;
    if (video.currentTime >= endAt) { running = false; video.pause(); rec.stop(); return; }
    video.requestVideoFrameCallback(draw);
  };

  const t0 = performance.now();
  const done = new Promise((res) => { rec.onstop = res; });
  drawZoom(octx);
  rec.start(500);
  $('exportStatus').textContent = 'Recording…';
  try { await video.play(); } catch { $('exportStatus').textContent = 'Playback was blocked. Press play once, then try again.'; $('exportTest').disabled = false; return; }
  video.requestVideoFrameCallback(draw);
  await done;

  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const expected = Math.max(1, Math.round(clipSeconds * 30));
  const framesPct = Math.min(100, Math.round((frames / expected) * 100));
  Object.assign(state.results, { exportFrames: framesPct, exportSeconds: seconds, exportSize: blob.size, exportType: mime.split(';')[0] });
  setResult('rExport', 'exportFrames', framesPct,
    `${framesPct}% of frames · took ${seconds} s for ${clipSeconds.toFixed(0)} s · ${formatBytes(blob.size)} (${mime.split(';')[0]})`);

  const link = $('exportDownload');
  if (link.href) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(blob);
  link.download = `pano-check-export.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
  link.hidden = false;
  $('exportStatus').textContent = 'Done. Save the test clip to see how it looks.';
  $('exportTest').disabled = false;
});

// ---------- results ----------
const PILL = { good: 'pill-good', work: 'pill-work', bad: 'pill-bad', unknown: 'pill-info' };
const WORD = { good: 'Smooth', work: 'Borderline', bad: 'Struggling', unknown: 'Not run yet' };

function setResult(cellId, metric, value, text) {
  const rating = rate(metric, value);
  state.ratings[metric] = rating;
  $(cellId).innerHTML = '';
  const pill = document.createElement('span');
  pill.className = `pill ${PILL[rating]}`;
  pill.textContent = WORD[rating];
  const words = document.createElement('span');
  words.textContent = ` ${text}`;
  $(cellId).append(pill, words);
  const verdict = overallVerdict(Object.values(state.ratings));
  $('verdict').className = `pill ${PILL[verdict]}`;
  $('verdict').textContent = verdict === 'unknown' ? 'Not run yet' : `Overall: ${WORD[verdict]}`;
}

$('copyResults').addEventListener('click', async () => {
  const text = resultsText(state.results);
  try { await navigator.clipboard.writeText(text); $('copyStatus').textContent = 'Copied.'; }
  catch { $('copyStatus').textContent = 'Could not copy. Select the table and copy it instead.'; }
});
