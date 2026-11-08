// Pure helpers for the PANO check page. No DOM access, so they can be tested in Node.

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return i === 0 ? `${value} bytes` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

// The source rectangle to draw for a zoom level centred on (cx, cy), both 0–1,
// matching the output's aspect ratio and kept inside the frame.
export function computeCrop(srcW, srcH, zoom, cx, cy, outAspect) {
  const z = Math.max(1, zoom);
  let sw = srcW / z;
  let sh = sw / outAspect;
  if (sh > srcH / z) { sh = srcH / z; sw = sh * outAspect; }
  if (sw > srcW) { sw = srcW; sh = sw / outAspect; }
  if (sh > srcH) { sh = srcH; sw = sh * outAspect; }
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const sx = clamp(cx * srcW - sw / 2, 0, srcW - sw);
  const sy = clamp(cy * srcH - sh / 2, 0, srcH - sh);
  return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(sw), sh: Math.round(sh) };
}

export function droppedPercent(dropped, total) {
  if (!total) return 0;
  return Math.round((dropped / total) * 1000) / 10;
}

// First container the browser can record a canvas into, MP4 preferred.
export function pickRecorderMime(isTypeSupported) {
  const options = [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return options.find((m) => { try { return isTypeSupported(m); } catch { return false; } }) || '';
}

// Rates each measurement: good, borderline (work) or poor (bad).
export function rate(metric, value) {
  const limits = {
    dropped: [2, 8],        // % of frames dropped during playback
    seek: [500, 1500],      // average ms to show a frame after a jump
    exportFrames: [95, 80], // % of expected frames drawn into the export (higher is better)
  };
  const lim = limits[metric];
  if (!lim || !Number.isFinite(value)) return 'unknown';
  if (metric === 'exportFrames') return value >= lim[0] ? 'good' : value >= lim[1] ? 'work' : 'bad';
  return value <= lim[0] ? 'good' : value <= lim[1] ? 'work' : 'bad';
}

export function overallVerdict(ratings) {
  const known = ratings.filter((r) => r !== 'unknown');
  if (known.length === 0) return 'unknown';
  if (known.includes('bad')) return 'bad';
  if (known.includes('work')) return 'work';
  return 'good';
}

export function resultsText(r) {
  return [
    'Family Watch Party — PANO check results',
    `File: ${r.fileName} (${formatBytes(r.fileSize)})`,
    `Picture: ${r.width}×${r.height}, ${r.duration ? r.duration.toFixed(0) : '—'} s`,
    `Playback: ${r.dropped ?? '—'}% frames dropped`,
    `Jumping: ${r.seek ?? '—'} ms average`,
    `Export: ${r.exportFrames ?? '—'}% of frames, ${r.exportSeconds ?? '—'} s for a 10 s clip, ${r.exportSize ? formatBytes(r.exportSize) : '—'} (${r.exportType || '—'})`,
    `Browser: ${r.userAgent}`,
  ].join('\n');
}
