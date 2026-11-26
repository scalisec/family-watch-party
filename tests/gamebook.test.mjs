import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookKeyFor, normalizeGame } from '../js/games.js';
import { keyOf, scheduleFor, withSchedule, bookName, kidFor, GB } from '../js/game-book.js';
import { TEAMS } from '../js/config.js';
import { normalizeRecord } from '../js/library.js';

const lucas = TEAMS.find((t) => t.key === 'lucas');
const grace = TEAMS.find((t) => t.key === 'grace');

test('league games get the Game Book key: Alliance divisions by number, club feeds by name', () => {
  assert.equal(bookKeyFor({ id: 2408448, divisionId: 2712 }, lucas), 'alliance:2408448');
  assert.equal(bookKeyFor({ id: 59715, divisionId: 'bghc-2066' }, grace), 'club:bghc-2066:59715');
  assert.equal(bookKeyFor({ id: 59715 }, grace), 'club:bghc-2066:59715', 'falls back to the feed name');
  const g = normalizeGame({ id: 59715, divisionId: 'bghc-2066', start: '2026-09-12T12:30:00-04:00', away: 'Burlington Barracudas', home: 'Oakville Hornets', awayScore: 2, homeScore: 1, status: 'final', type: 'regular' }, grace);
  assert.equal(g.bookKey, 'club:bghc-2066:59715');
  assert.equal(keyOf({ id: 'grace-ts-abc123' }), 'teamsnap:abc123', 'older cached TeamSnap games');
});

test('the schedule goes into the book once; unchanged games leave the book as it was', () => {
  const g = normalizeGame({ id: 59715, divisionId: 'bghc-2066', start: '2026-09-12T12:30:00-04:00', away: 'Burlington Barracudas', home: 'Oakville Hornets', awayScore: 2, homeScore: 1, status: 'final', type: 'regular', venue: 'Glen Abbey' }, grace);
  const s = scheduleFor(g);
  assert.deepEqual([s.date, s.time, s.opponent, s.homeAway, s.type, s.score], ['2026-09-12', '12:30', 'Oakville Hornets', 'away', 'league', { for: 2, against: 1 }]);
  const b0 = GB.newBook({ team: 'Barracudas U13 B', season: '2026-27' });
  const b1 = withSchedule(b0, [g]);
  assert.notEqual(b1, b0);
  assert.equal(GB.effectiveGame(b1, g.bookKey).status, 'score');
  assert.equal(withSchedule(b1, [g]), b1, 'same schedule: same book, nothing to save');
  assert.notEqual(withSchedule(b1, [{ ...g, result: { us: 3, them: 1, outcome: 'W' } }]), b1, 'a new score is saved');
});

test('book names match what Bulldogs Watch Party creates', () => {
  assert.equal(bookName(lucas), 'Game Book – Bulldogs U10 Blue 2026-27.json');
  assert.equal(bookName(grace), 'Game Book – Barracudas U13 B 2026-27.json');
});

test('the kids’ numbers come from the Drive record, kept through normalizing', () => {
  const rec = normalizeRecord({ version: 1, games: {}, kids: { grace: { number: '12' } } });
  assert.deepEqual(kidFor(grace, rec), { number: '12', name: 'Grace' });
  assert.equal(kidFor(lucas, rec), null);
});
