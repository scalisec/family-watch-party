// Loads everything the pages show: league games, TeamSnap games (cached between visits),
// and the Drive record (cached between visits).
import { DATA_BASE, TEAMS } from './config.js';
import { normalizeGame } from './games.js';
import { mergeGames } from './teamsnap.js';
import { normalizeRecord, emptyRecord } from './library.js';
import { readJson, saveJson } from './ui.js';
import { isConnected, setAccountEmail } from './google.js';
import { about, loadLibrary } from './drive.js';
import { teamSnapGames } from './calendar.js';

async function getJson(rel) {
  const res = await fetch(DATA_BASE + rel, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${rel}: ${res.status}`);
  return res.json();
}

export async function loadLeague() {
  const results = await Promise.allSettled(TEAMS.map(async (team) => {
    const rows = await getJson(team.feed);
    return rows
      .filter((r) => r.home === team.feedName || r.away === team.feedName)
      .map((r) => ({ ...normalizeGame(r, team), divisionId: r.divisionId }));
  }));
  const failed = TEAMS.filter((_, i) => results[i].status === 'rejected').map((t) => t.kid);
  const games = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const logos = new Map();
  const [teams, clubs] = await Promise.all([getJson('data/teams.json').catch(() => []), getJson('data/clubs.json').catch(() => [])]);
  for (const t of [...teams, ...clubs]) if (t && t.name && t.logo) logos.set(`${t.divisionId}|${t.name}`, t.logo);

  let updatedAt = null;
  try { updatedAt = (await getJson('data/meta.json')).updatedAt; } catch { /* fine */ }
  return { games, logos, failed, updatedAt };
}

export function cachedTeamSnap() { return readJson('fwp.teamsnap', []); }
export function cachedRecord() { return normalizeRecord(readJson('fwp.record', emptyRecord())); }
export function cacheRecord(record) { saveJson('fwp.record', record); }

export function combine(league, teamsnap) { return mergeGames(league, teamsnap); }

// After connecting: account and storage, the record, and the TeamSnap games.
// Each part can fail on its own; the result says which did.
export async function loadGoogle() {
  if (!isConnected()) return null;
  const [acct, lib, cal] = await Promise.allSettled([about(), loadLibrary(), teamSnapGames(TEAMS)]);
  const out = { about: null, library: null, teamsnap: null, problems: [] };
  if (acct.status === 'fulfilled') { out.about = acct.value; setAccountEmail(acct.value.user && acct.value.user.emailAddress); } else out.problems.push(`Drive storage: ${acct.reason.message}`);
  if (lib.status === 'fulfilled') {
    out.library = lib.value;
    cacheRecord(out.library.record);
  } else out.problems.push(`Drive folders: ${lib.reason.message}`);
  if (cal.status === 'fulfilled') {
    out.teamsnap = cal.value.games;
    saveJson('fwp.teamsnap', cal.value.games);
    if (cal.value.missing.length) out.problems.push(`No TeamSnap calendar found for ${cal.value.missing.join(' and ')}. Check its name in Google Calendar.`);
  } else out.problems.push(`TeamSnap calendars: ${cal.reason.message}`);
  return out;
}
