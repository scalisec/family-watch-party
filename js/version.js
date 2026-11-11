// The app's version and release history (newest first). Keep VERSION, package.json,
// version.json and each page's byline in step: the tests check they match.
export const VERSION = '0.14.0';

export const RELEASES = [
  { version: '0.14.0', date: '2026-11-10', notes: ['Upload queue: Save gets the trimmed game ready on this PC in about a minute, then it goes to Drive in the background. Go back to your games or start the next one.', 'Uploads button at the top of every screen shows progress; uploads pick up where they stopped after closing the app or restarting.', 'PANO only by default: tick AUTO on a game to save that view too.'] },
  { version: '0.13.0', date: '2026-11-10', notes: ['Guided LiveBarn downloads: each game page lists the 30-minute windows to open in LiveBarn and what to take from each, with ticks.', 'To-download list: press ＋ on a game from your phone or PC; it waits on the home screen.', 'Pick files opens in your Downloads folder; parts are pre-marked from the schedule.', 'The LiveBarn helper extension is no longer needed: remove it from Chrome.'] },
  { version: '0.12.2', date: '2026-11-10', notes: ['LiveBarn helper 0.1.2: waits while a file sits on Chrome\'s Save As window instead of giving up, and says what to do.', 'A file Chrome starts late still gets the right name.', 'Helper test reminds you to switch off Chrome\'s "Ask where to save each file".'] },
  { version: '0.12.1', date: '2026-11-09', notes: ['LiveBarn helper 0.1.1: waits for each 30-minute window to load before reading it (fixes the dry run stopping at the second window).', 'The app tells you when the helper is missing or out of date, and how to fix it.'] },
  { version: '0.12.0', date: '2026-11-09', notes: ['Pick rink: choose the LiveBarn rink for games the schedule has no link for, and use it for the other games at that rink.', 'Open in LiveBarn on games and the game page jumps straight to the game\'s time.'] },
  { version: '0.11.0', date: '2026-11-09', notes: ['Highlight reels on the Clips page: tick clips for one kid, joined in game order with a title card per game.', 'Reels save to Drive, and to this PC or share right away.'] },
  { version: '0.10.0', date: '2026-11-09', notes: ['Clip editor on the game page: pick the moment, wide or tall, and drag to keep your kid in frame.', 'Slow motion, and freeze-and-draw with spotlight, arrows, circles and text.', 'Clips save to Drive, and to this PC or share right away.'] },
  { version: '0.9.0', date: '2026-11-09', notes: ['Install the app from Settings.', 'Version history, and a button to check for updates.', 'A note appears on any screen when a new version is ready.'] },
  { version: '0.8.0', date: '2026-11-09', notes: ['Watch full games on the game page, streamed from Drive.', 'Zoom and drag to follow the play in the PANO view; speeds, jumps and full screen.', 'Clips play by streaming too.'] },
  { version: '0.7.0', date: '2026-11-09', notes: ['Import files for one game from its page.', 'Mark puck drop and the final buzzer before uploading, so each game is one file per view.', 'Import files and Open on the home screen.'] },
  { version: '0.6.0', date: '2026-11-09', notes: ['Clips page: play, save, share and open in Drive.', 'Settings page.'] },
  { version: '0.5.1', date: '2026-11-09', notes: ['Stay connected to Google when moving between screens.'] },
  { version: '0.5.0', date: '2026-11-09', notes: ['Mark start & end: join a game\'s parts into one full-game file in Drive.'] },
  { version: '0.4.0', date: '2026-11-09', notes: ['Connect Google; Family Hockey folders in Drive.', 'Import games already downloaded.', 'Tournament games from the TeamSnap calendars.'] },
  { version: '0.3.0', date: '2026-11-08', notes: ['Home screen: both kids\' games, scores and video status.'] },
  { version: '0.2.0', date: '2026-11-08', notes: ['LiveBarn helper for Chrome, with a test page.'] },
  { version: '0.1.0', date: '2026-11-08', notes: ['First version: PANO playback check.'] },
];

// 1 when a is newer than b, -1 when older, 0 when the same
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Asks GitHub Pages for the latest version, skipping every cache.
export async function latestVersion() {
  const res = await fetch(new URL(`../version.json?t=${Date.now()}`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't check (${res.status}).`);
  const data = await res.json();
  return String(data.version || '');
}

export function releaseDate(iso) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
