// The download guide: which LiveBarn windows to open for a game, and what to take from each.
import { parseHHMMSafe } from './library.js';

export const GAME_MINUTES = 60;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// LiveBarn shows video in 30-minute windows on the clock. For a game from start to start+length,
// returns each window with the part of it the game covers: { start, end, from, to, url } (minutes after midnight).
export function guideWindows(game, { lengthMin = GAME_MINUTES, extraWindows = 0 } = {}) {
  const start = parseHHMMSafe(game && game.time);
  if (!Number.isFinite(start) || !game.liveBarn) return [];
  const end = start + lengthMin;
  const out = [];
  for (let w = Math.floor(start / 30) * 30; w < end; w += 30) out.push({ start: w, end: w + 30, from: Math.max(w, start), to: Math.min(w + 30, end), extra: false });
  for (let i = 0; i < extraWindows && out.length; i += 1) {
    const w = out[out.length - 1].end;
    out.push({ start: w, end: w + 30, from: w, to: w + 30, extra: true });
  }
  return out.map((x) => ({ ...x, url: `https://watch.livebarn.com/en/video/${encodeURIComponent(game.liveBarn.surfaceId)}/${game.date}/${hhmm(x.start)}` }));
}

// LiveBarn charges each file you download for its full length (usually the whole 30-minute window).
export const minutesUpTo = (windows) => windows.length * 30;

export function clockLabel(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
