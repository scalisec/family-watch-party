// Family Watch Party helper: planning logic shared by the background worker and the
// LiveBarn page script. Plain functions, no browser APIs, so they can be tested in Node.
// Loaded as a classic script; exposes everything on self.FWPPlan.
(function (root) {
  'use strict';

  // "01:14 PM" -> minutes since midnight (854). Returns NaN when unreadable.
  function parseClock(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*$/i.exec(text || '');
    if (!m) return NaN;
    let h = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    return h * 60 + Number(m[2]);
  }

  // "13:15" -> 795
  function parseHHMM(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  // 795 -> "13:15"
  function toHHMM(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // One row of LiveBarn's download list, e.g.
  // "Clip 2  01:14 PM - 01:29 PM  15 minutes  DOWNLOAD"
  function parseClipRow(text) {
    const m = /Clip\s*(\d+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M)\s+(\d+)\s*minutes?/i.exec(text || '');
    if (!m) return null;
    const start = parseClock(m[2]);
    let end = parseClock(m[3]);
    if (end < start) end += 24 * 60;
    return { index: Number(m[1]), start, end, minutes: Number(m[4]), label: `${m[2].toUpperCase()} - ${m[3].toUpperCase()}` };
  }

  // "Download usage: 662/1800 minutes downloaded" -> { used: 662, limit: 1800 }
  function parseUsage(text) {
    const m = /Download usage:\s*(\d+)\s*\/\s*(\d+)\s*minutes/i.exec(text || '');
    return m ? { used: Number(m[1]), limit: Number(m[2]) } : null;
  }

  // The 30-minute window LiveBarn shows for a clock time (13:15 -> 13:00).
  function windowStartFor(mins) {
    return Math.floor(mins / 30) * 30;
  }

  // The span of video wanted for a game, in minutes since midnight.
  function gameSpan(game) {
    const start = parseHHMM(game.start);
    const duration = Number(game.durationMin) || 60;
    const before = Number(game.extraBeforeMin) || 0;
    const after = Number(game.extraAfterMin) || 0;
    return { from: start - before, to: start + duration + after };
  }

  // Files from one window's list that overlap the game and haven't been taken yet.
  // `taken` holds the start minutes of files already downloaded in this job.
  function clipsToDownload(clips, game, taken) {
    const span = gameSpan(game);
    const seen = new Set(taken || []);
    return clips
      .filter((c) => c && c.end > span.from && c.start < span.to)
      .filter((c) => !seen.has(c.start))
      .sort((a, b) => a.start - b.start);
  }

  // Whether another window is needed after the one starting at windowStart.
  function needsNextWindow(windowStart, game) {
    return windowStart + 30 < gameSpan(game).to;
  }

  // The first window to open for a game.
  function firstWindow(game) {
    return windowStartFor(gameSpan(game).from);
  }

  function videoUrl(surfaceId, date, windowStart) {
    return `https://watch.livebarn.com/en/video/${encodeURIComponent(surfaceId)}/${date}/${toHHMM(windowStart)}`;
  }

  // ---------- straight to Drive ----------
  function validateDrive(drive) {
    const problems = [];
    if (!drive || typeof drive !== 'object') return ['No Drive details were sent.'];
    if (!drive.gameId || typeof drive.gameId !== 'string') problems.push('The game is missing.');
    if (!Array.isArray(drive.folderPath) || !drive.folderPath.length || drive.folderPath[0] !== 'Family Hockey'
      || drive.folderPath.some((n) => typeof n !== 'string' || !n || n.length > 120)) problems.push('The Drive folder is not a Family Hockey folder.');
    if (!['PANO', 'AUTO'].includes(drive.view)) problems.push('The camera view should be PANO or AUTO.');
    return problems;
  }
  // "FamilyWatchParty/Lucas/2026-11-07 vs X/2026-11-07 vs X part 1 (1314).mp4" -> "2026-11-07 vs X part 1 (1314) PANO.mp4"
  function driveNameFor(fileName, view) {
    const base = String(fileName).split('/').pop().replace(/\.mp4$/i, '');
    return `${base}${view ? ` ${view}` : ''}.mp4`;
  }
  // LiveBarn's own file name from its download link, e.g. "Appleby_Ice_Centre_2026-11-07T131423.mp4"
  function liveBarnFileName(url) {
    try { const n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); return /\.mp4$/i.test(n) ? n : null; } catch { return null; }
  }
  function startSecFromName(name) {
    const m = /T(\d{2})(\d{2})(\d{2})\.mp4$/i.exec(String(name || ''));
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }

  // Chrome's errors when a page goes away while the helper is talking to it
  function isChannelClosed(err) {
    const m = String((err && err.message) || err || '');
    return /back\/forward cache|message channel (is )?closed|Receiving end does not exist|message port closed/i.test(m);
  }

  // AUTO downloads come from a "_720p" folder; PANO ones from a larger size.
  function isPanoHref(href) {
    try {
      const path = new URL(href).pathname;
      if (/_720p\//.test(path) || /_720p_/.test(path)) return false;
      return /_\d{3,5}x\d{3,5}p[/_]/.test(path);
    } catch { return false; }
  }

  function isLiveBarnMedia(url) {
    try { return new URL(url).hostname === 'livebarn-prod-vod-media.s3.amazonaws.com'; } catch { return false; }
  }

  function safeName(text) {
    return String(text || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/[\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+/, '')
      .trim()
      .slice(0, 80) || 'Game';
  }

  // Downloads/FamilyWatchParty/Lucas/2026-11-07 vs Woodstock Jr Navy Vets/... part 1 (1314).mp4
  function fileNameFor(game, clip, part) {
    const kid = safeName(game.kid || 'Family');
    const title = safeName(`${game.date} ${game.opponent || 'Game'}`);
    const hhmm = toHHMM(clip.start % (24 * 60)).replace(':', '');
    return `FamilyWatchParty/${kid}/${title}/${title} part ${part} (${hhmm}).mp4`;
  }

  // Checks a request from the app before anything is opened.
  function validateGame(game) {
    const problems = [];
    if (!game || typeof game !== 'object') return ['No game was sent.'];
    if (!/^\d{1,6}$/.test(String(game.surfaceId || ''))) problems.push('The LiveBarn rink number is missing or not a number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(game.date || ''))) problems.push('The game date should look like 2026-11-07.');
    if (Number.isNaN(parseHHMM(game.start))) problems.push('The start time should look like 13:15.');
    const d = Number(game.durationMin);
    if (!(d >= 15 && d <= 240)) problems.push('The game length should be between 15 and 240 minutes.');
    return problems;
  }

  root.FWPPlan = {
    parseClock, parseHHMM, toHHMM, parseClipRow, parseUsage, windowStartFor, gameSpan,
    clipsToDownload, needsNextWindow, firstWindow, videoUrl, isPanoHref, isLiveBarnMedia, isChannelClosed, validateDrive, driveNameFor, liveBarnFileName, startSecFromName,
    safeName, fileNameFor, validateGame,
  };
})(typeof self !== 'undefined' ? self : globalThis);
