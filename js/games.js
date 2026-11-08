// Game list logic: turns league feed rows into the games the home screen shows.
// Pure functions (no DOM, no network) so they can be tested in Node.

export const LIVEBARN_KEEP_DAYS = 30;   // LiveBarn removes recordings after 30 days
export const LEAVES_SOON_DAYS = 3;      // warn this many days before they go
const DAY = 24 * 60 * 60 * 1000;

// League rows give LiveBarn as a referral link whose rsLandingPage holds the video URL:
// https://join.livebarn.com/x?rsLandingPage=https://livebarn.com/en/video/4334/2026-10-03/13:15
export function parseLiveBarn(link) {
  if (!link) return null;
  let target = link;
  try {
    const u = new URL(link);
    const landing = u.searchParams.get('rsLandingPage');
    if (landing) target = landing;
  } catch { return null; }
  const m = /livebarn\.com\/(?:[a-z]{2}\/)?video\/(\d+)\/(\d{4}-\d{2}-\d{2})\/(\d{1,2}:\d{2})/.exec(target);
  return m ? { surfaceId: m[1], date: m[2], time: m[3] } : null;
}

// "2026-10-03T13:15:00-04:00" -> { date: '2026-10-03', time: '13:15' } in the feed's own local time.
export function localParts(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : { date: '', time: '' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// '2026-11-07' -> 'Sat Nov 7'
export function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS.at(wd)} ${MONTHS.at(m - 1)} ${d}`;
}

// '13:15' -> '1:15 PM'
export function timeLabel(time) {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// "Appleby (3)" -> "Appleby Rink 3"; other names pass through.
export function rinkLabel(venue) {
  if (!venue) return '';
  const same = /^(.+?)\s*\((.+)\)\s*$/.exec(venue);
  if (same && same[1].trim().toLowerCase() === same[2].trim().toLowerCase()) return same[1].trim();
  return venue.replace(/\s*\((\d+)\)\s*$/, ' Rink $1').replace(/\s*\(([A-Za-z][^)]*)\)\s*$/, ' $1').trim();
}

// One league row -> one game for a kid's team.
export function normalizeGame(row, team) {
  const isHome = row.home === team.feedName;
  const opponent = isHome ? row.away : row.home;
  const { date, time } = localParts(row.start);
  const final = row.status === 'final' && Number.isFinite(row.homeScore) && Number.isFinite(row.awayScore);
  let result = null;
  if (final) {
    const us = isHome ? row.homeScore : row.awayScore;
    const them = isHome ? row.awayScore : row.homeScore;
    result = { us, them, outcome: us > them ? 'W' : us < them ? 'L' : 'T' };
  }
  return {
    id: `${team.kid.toLowerCase()}-${row.id}`,
    kid: team.kid,
    teamLabel: team.label,
    teamKey: team.key,
    date, time,
    startMs: Date.parse(row.start),
    isHome,
    opponent,
    opponentLabel: `${isHome ? 'vs' : 'at'} ${opponent}`,
    venue: row.venue || '',
    rink: rinkLabel(row.venue),
    liveBarn: parseLiveBarn(row.liveBarn),
    type: row.type || 'regular',
    status: row.status || 'scheduled',
    result,
    gamesheet: row.gamesheet || null,
  };
}

// The video status a game shows. `downloaded` is a Set of game ids already saved.
// now = epoch ms. Returns { key, label, detail }.
export function videoStatus(game, now, downloaded = new Set()) {
  const ageMs = now - game.startMs;
  if (downloaded.has(game.id)) return { key: 'downloaded', label: 'Downloaded', detail: '' };
  if (ageMs < 0) return { key: 'upcoming', label: 'Upcoming', detail: '' };
  if (ageMs < 3 * 60 * 60 * 1000) return { key: 'today', label: 'After the game', detail: 'Ready about 30 minutes after the final buzzer' };

  const leavesMs = game.startMs + LIVEBARN_KEEP_DAYS * DAY;
  const leavesOn = new Date(leavesMs);
  const leavesText = `${MONTHS.at(leavesOn.getMonth())} ${leavesOn.getDate()}`;
  if (now >= leavesMs) return { key: 'expired', label: 'Expired', detail: `Left LiveBarn ${leavesText} without a download` };
  if (!game.liveBarn) return { key: 'no-link', label: 'No LiveBarn link', detail: game.type === 'tournament' ? 'Tournament game: pick the rink' : 'Not in the schedule: pick the rink' };
  const daysLeft = Math.ceil((leavesMs - now) / DAY);
  if (daysLeft <= LEAVES_SOON_DAYS) {
    return { key: 'leaves-soon', label: daysLeft <= 1 ? 'Ready · leaves tomorrow' : `Ready · leaves in ${daysLeft} days`, detail: `Leaves LiveBarn ${leavesText}` };
  }
  return { key: 'ready', label: 'Ready to download', detail: `Leaves LiveBarn ${leavesText}` };
}

// All games for the chosen kid ('all', 'Lucas', 'Grace'), split into recent (newest first) and upcoming (soonest first).
export function splitGames(games, kid, now) {
  const mine = kid === 'all' ? games : games.filter((g) => g.kid === kid);
  const recent = mine.filter((g) => g.startMs <= now).sort((a, b) => b.startMs - a.startMs);
  const upcoming = mine.filter((g) => g.startMs > now).sort((a, b) => a.startMs - b.startMs);
  return { recent, upcoming };
}

// Counts for the summary cards and the "Needs you" banner.
export function summarize(games, now, downloaded = new Set()) {
  const out = { ready: 0, leavesSoon: 0, noLink: 0, downloaded: 0, expired: 0, readyMinutes: 0 };
  for (const g of games) {
    const s = videoStatus(g, now, downloaded).key;
    if (s === 'ready' || s === 'leaves-soon') { out.ready += 1; out.readyMinutes += 60; }
    if (s === 'leaves-soon') out.leavesSoon += 1;
    if (s === 'no-link') out.noLink += 1;
    if (s === 'downloaded') out.downloaded += 1;
    if (s === 'expired') out.expired += 1;
  }
  return out;
}

// Season record from final games: { w, l, t, gf, ga }
export function record(games) {
  const r = { w: 0, l: 0, t: 0, gf: 0, ga: 0 };
  for (const g of games) {
    if (!g.result) continue;
    if (g.result.outcome === 'W') r.w += 1; else if (g.result.outcome === 'L') r.l += 1; else r.t += 1;
    r.gf += g.result.us; r.ga += g.result.them;
  }
  return r;
}
