// Reads games from the TeamSnap calendars synced into Google Calendar (read-only).
import { gjson } from './google.js';
import { parseTeamSnapEvent } from './teamsnap.js';
import { SEASON_START, SEASON_END } from './config.js';

const API = 'https://www.googleapis.com/calendar/v3';

export async function teamSnapGames(teams) {
  const list = await gjson(`${API}/users/me/calendarList?maxResults=250&fields=items(id,summary)`);
  const items = list.items || [];
  const games = [];
  const missing = [];
  for (const team of teams) {
    const cal = items.find((c) => c.summary === team.calendarName);
    if (!cal) { missing.push(team.kid); continue; }
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        timeMin: SEASON_START, timeMax: SEASON_END, singleEvents: 'true', orderBy: 'startTime',
        maxResults: '2500', fields: 'items(id,summary,description,start),nextPageToken',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await gjson(`${API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`);
      for (const ev of page.items || []) {
        const g = parseTeamSnapEvent(ev, team);
        if (g) games.push(g);
      }
      pageToken = page.nextPageToken || '';
    } while (pageToken);
  }
  return { games, missing };
}
