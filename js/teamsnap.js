// TeamSnap events (from the TeamSnap calendars synced into Google Calendar) -> games.
// Used for games the league feeds don't carry, mostly tournaments.
import { localParts } from './games.js';

const DAY = 24 * 60 * 60 * 1000;
const NOT_GAMES = /\b(practice|development|dryland|goalie|skills|meeting|picture day|media day|hold for|video review|training|drop-off|tryout|evaluation)\b/i;
const TOURNAMENT_WORDS = /\b(tournament|classic|fest|cup|showcase|invitational|jamboree)\b/i;

function cleanLine(line) {
  return line
    .replace(/\[sync[^\]]*\]/gi, '')
    .replace(/\(Arrival Time:.*$/i, '')
    .replace(/(\w)-\s/g, '$1 ')
    .replace(/[\s\-–]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTeamSnapEvent(ev, team) {
  const summary = String(ev && ev.summary || '').trim();
  if (!summary || NOT_GAMES.test(summary)) return null;
  const m = /^(.*?)\s(vs|at)\s(.+)$/.exec(summary);
  const startIso = ev.start && ev.start.dateTime;
  if (!m || !startIso) return null;

  const { date, time } = localParts(startIso);
  const lines = String(ev.description || '').split('\n');
  const loc = lines.map((l) => /^\s*Location:\s*(.+)$/i.exec(l)).find(Boolean);
  const venue = loc ? cleanLine(loc[1]) : '';
  const tournament = lines
    .filter((l) => !/^\s*(Location|Uniform):/i.test(l))
    .map(cleanLine)
    .find((l) => TOURNAMENT_WORDS.test(l)) || '';
  const opponent = m[3].trim();

  return {
    id: `${team.key}-ts-${ev.id}`,
    kid: team.kid,
    teamLabel: team.label,
    teamKey: team.key,
    date,
    time,
    startMs: Date.parse(startIso),
    isHome: m[2] === 'vs',
    opponent,
    opponentLabel: `${m[2]} ${opponent}`,
    venue,
    rink: venue,
    liveBarn: null,
    type: tournament ? 'tournament' : 'other',
    source: 'teamsnap',
    tournament,
    status: 'scheduled',
    result: null,
    gamesheet: null,
  };
}

// League games stay as they are (with tournament names filled in from TeamSnap where known);
// TeamSnap games with no league game within `windowMin` minutes for the same kid are added.
// A TeamSnap game with no tournament name takes one from a neighbouring game within 3 days.
export function mergeGames(league, teamsnap, windowMin = 75) {
  const near = (a, b) => a.kid === b.kid && Math.abs(a.startMs - b.startMs) <= windowMin * 60 * 1000;
  const merged = league.map((g) => {
    const twin = teamsnap.find((t) => near(g, t) && t.tournament);
    return twin && !g.tournament ? { ...g, tournament: twin.tournament } : g;
  });
  const added = teamsnap.filter((t) => !league.some((g) => near(g, t))).map((t) => ({ ...t }));
  for (const t of added) {
    if (t.tournament) continue;
    const sibling = added.find((o) => o !== t && o.kid === t.kid && o.tournament && Math.abs(o.startMs - t.startMs) <= 3 * DAY);
    if (sibling) { t.tournament = sibling.tournament; t.type = 'tournament'; }
  }
  return [...merged, ...added];
}
