// Matching video files on the computer to games.
import { parseHHMMSafe } from './library.js';

// LiveBarn:  Appleby_Ice_Centre_Rink_3_(LEAGUE_PARTNER_GAMES_ONLY)_2026-11-07T131423.mp4  (local start time)
// Helper:    2026-11-07 vs Woodstock Jr Navy Vets part 1 (1314).mp4
export function parseVideoFileName(name) {
  let m = /^(.*)_(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})\.(mp4|m4v|mov)$/i.exec(name || '');
  if (m) {
    return {
      source: 'livebarn',
      rink: m[1].replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(),
      date: m[2],
      minutes: Number(m[3]) * 60 + Number(m[4]),
    };
  }
  m = /^(\d{4}-\d{2}-\d{2}) .+ part (\d+) \((\d{2})(\d{2})\)(?: (?:PANO|AUTO))?\.(mp4|m4v|mov)$/i.exec(name || '');
  if (m) return { source: 'helper', rink: '', date: m[1], part: Number(m[2]), minutes: Number(m[3]) * 60 + Number(m[4]) };
  return { source: 'other', name: String(name || '') };
}

const STOP = new Set(['ice', 'centre', 'center', 'arena', 'arenas', 'rink', 'community', 'sports', 'sport', 'the', 'complex',
  'recreation', 'and', 'of', 'pad', 'league', 'partner', 'games', 'only', 'cc', 'entertainment', 'facility', 'twin', 'pads']);

export function rinkTokens(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
}

export function rinkScore(a, b) {
  const A = rinkTokens(a);
  let n = 0;
  for (const t of rinkTokens(b)) if (A.has(t)) n += 1;
  return n;
}

// The game a LiveBarn or helper file belongs to.
// A file counts when it starts between 45 minutes before and 100 minutes after puck drop on the same day.
// Returns { game, confidence: 'high' | 'low' | 'none', reason }.
export function matchFile(parsed, games) {
  if (!parsed || parsed.source === 'other') return { game: null, confidence: 'none', reason: 'Not a LiveBarn file name: pick the game.' };
  const candidates = games
    .filter((g) => g.date === parsed.date)
    .map((g) => ({ g, offset: parsed.minutes - parseHHMMSafe(g.time) }))
    .filter((c) => c.offset >= -45 && c.offset <= 100)
    .map((c) => ({ ...c, score: rinkScore(parsed.rink, `${c.g.venue} ${c.g.rink}`) }));
  if (candidates.length === 0) return { game: null, confidence: 'none', reason: 'No game at that time: pick the game.' };
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.offset) - Math.abs(b.offset));
  const [best, second] = candidates;
  if (candidates.length === 1) {
    return { game: best.g, confidence: best.score > 0 || !parsed.rink ? 'high' : 'low', reason: best.score > 0 || !parsed.rink ? 'Matched by date and time.' : 'Matched by time, but the rink name differs: check it.' };
  }
  if (best.score > second.score) return { game: best.g, confidence: 'high', reason: 'Matched by time and rink.' };
  return { game: best.g, confidence: 'low', reason: 'Two games fit this time: check it.' };
}

// PANO files are 3840×1920 (wider than tall by 2:1); AUTO files are 1280×720.
export function viewFromSize(width, height) {
  if (!width || !height) return '';
  return width >= 2000 || width / height >= 1.9 ? 'PANO' : 'AUTO';
}

// Full game file or clip: LiveBarn and helper names are full-game files; anything else
// shorter than 10 minutes is treated as a clip.
export function kindFor(parsed, durationSec) {
  if (parsed.source !== 'other') return 'full';
  if (/\b(clip|highlight|goal|save)s?\b/i.test(parsed.name || '')) return 'clip';
  return durationSec && durationSec < 600 ? 'clip' : 'full';
}
