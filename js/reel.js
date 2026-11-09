// Highlight reels: which clips, in what order, with which title cards (no screen code).
export const TITLE_SECONDS = 2.5;
export const OPENING_SECONDS = 3;

// Clips for one kid grouped by game, oldest game first (a season in order).
export function reelGroups(clips, kid) {
  const groups = new Map();
  for (const c of clips) {
    if (!c.game || c.game.kid !== kid) continue;
    if (!groups.has(c.gameId)) groups.set(c.gameId, { game: c.game, clips: [] });
    groups.get(c.gameId).clips.push(c);
  }
  return [...groups.values()]
    .sort((a, b) => (a.game.startMs || 0) - (b.game.startMs || 0))
    .map((g) => ({ ...g, clips: g.clips.sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || ''))) }));
}

export function gameTitleLines(game, dayLabel) {
  const r = game.result;
  return [
    dayLabel(game.date),
    game.opponentLabel,
    [r ? `${r.outcome} ${r.us}–${r.them}` : '', game.tournament || ''].filter(Boolean).join(' · '),
  ].filter(Boolean);
}

// The reel as a list of steps: an opening card, then for each game its title card and clips.
export function reelPlan({ groups, picked, titles, heading, subheading, dayLabel }) {
  const steps = [{ type: 'title', lines: [heading, subheading].filter(Boolean), hold: OPENING_SECONDS, big: true }];
  for (const g of groups) {
    const clips = g.clips.filter((c) => picked.has(c.driveId));
    if (!clips.length) continue;
    if (titles) steps.push({ type: 'title', lines: gameTitleLines(g.game, dayLabel), hold: TITLE_SECONDS });
    for (const c of clips) steps.push({ type: 'clip', clip: c, duration: c.duration || 0 });
  }
  return steps;
}

export function reelLength(steps) {
  return steps.reduce((s, st) => s + (st.type === 'title' ? st.hold : st.duration), 0);
}

export function reelName(kid, team, date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return `${kid} ${team ? `${team.season} ${team.label} ` : ''}highlights ${d}`;
}
