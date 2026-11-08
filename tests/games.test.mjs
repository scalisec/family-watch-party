import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseLiveBarn, localParts, dayLabel, timeLabel, rinkLabel, normalizeGame, videoStatus,
  splitGames, summarize, record,
} from '../js/games.js';
import { TEAMS } from '../js/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (f) => JSON.parse(readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const [LUCAS, GRACE] = TEAMS;
const lucasGames = fixture('2712.json').map((r) => normalizeGame(r, LUCAS));
const graceGames = fixture('bghc-2066.json').map((r) => normalizeGame(r, GRACE));
const all = [...lucasGames, ...graceGames];
const NOW = Date.parse('2026-11-08T17:00:00-05:00'); // Sunday Nov 8, 5 PM Toronto
const H = 60 * 60 * 1000;
const DAY = 24 * H;

test('parseLiveBarn reads the referral link the league feed uses', () => {
  assert.deepEqual(parseLiveBarn('https://join.livebarn.com/mzxCcjP?rsLandingPage=https://livebarn.com/en/video/4334/2026-10-03/13:15'),
    { surfaceId: '4334', date: '2026-10-03', time: '13:15' });
  assert.deepEqual(parseLiveBarn('https://watch.livebarn.com/en/video/3845/2026-09-14/19:00'),
    { surfaceId: '3845', date: '2026-09-14', time: '19:00' });
  assert.equal(parseLiveBarn(null), null);
  assert.equal(parseLiveBarn('not a link'), null);
  assert.equal(parseLiveBarn('https://example.com/'), null);
});

test('localParts keeps the feed\'s local time', () => {
  assert.deepEqual(localParts('2026-10-03T13:15:00-04:00'), { date: '2026-10-03', time: '13:15' });
  assert.deepEqual(localParts(''), { date: '', time: '' });
});

test('labels', () => {
  assert.equal(dayLabel('2026-11-07'), 'Sat Nov 7');
  assert.equal(timeLabel('13:15'), '1:15 PM');
  assert.equal(timeLabel('00:05'), '12:05 AM');
  assert.equal(timeLabel('12:00'), '12:00 PM');
  assert.equal(rinkLabel('Appleby (3)'), 'Appleby Rink 3');
  assert.equal(rinkLabel('AMC (West)'), 'AMC West');
  assert.equal(rinkLabel('Milton Sports Centre'), 'Milton Sports Centre');
  assert.equal(rinkLabel('Ken Houston (Ken Houston)'), 'Ken Houston');
  assert.equal(rinkLabel(null), '');
});

test('normalizeGame: Lucas\'s Woodstock game from the real feed', () => {
  const g = lucasGames.find((x) => x.date === '2026-11-07');
  assert.equal(g.kid, 'Lucas');
  assert.equal(g.opponentLabel, 'vs Woodstock Jr Navy Vets');
  assert.equal(g.time, '13:15');
  assert.equal(g.rink, 'Appleby Rink 3');
  assert.deepEqual(g.liveBarn, { surfaceId: '4334', date: '2026-11-07', time: '13:15' });
  assert.deepEqual(g.result, { us: 4, them: 0, outcome: 'W' });
});

test('normalizeGame: away game and loss read from our side', () => {
  const g = lucasGames.find((x) => x.date === '2026-10-10');
  assert.equal(g.isHome, false);
  assert.equal(g.opponentLabel, 'at Waterloo Wolves');
  assert.equal(g.result.outcome, 'W');
  const loss = all.find((x) => x.result && x.result.outcome === 'L');
  assert.ok(loss.result.us < loss.result.them);
});

test('normalizeGame: Grace\'s tournament games are tagged', () => {
  const t = graceGames.filter((g) => g.type === 'tournament');
  assert.ok(t.length >= 4);
  assert.ok(t.every((g) => g.kid === 'Grace'));
});

test('every game has an id, date and time; ids are unique', () => {
  for (const g of all) { assert.ok(g.id && g.date && g.time, JSON.stringify(g)); }
  assert.equal(new Set(all.map((g) => g.id)).size, all.length);
});

test('videoStatus covers every case', () => {
  const base = { id: 'x', startMs: NOW - 2 * DAY, liveBarn: { surfaceId: '1' }, type: 'regular' };
  assert.equal(videoStatus({ ...base, startMs: NOW + DAY }, NOW).key, 'upcoming');
  assert.equal(videoStatus({ ...base, startMs: NOW - H }, NOW).key, 'today');
  assert.equal(videoStatus(base, NOW).key, 'ready');
  assert.equal(videoStatus({ ...base, startMs: NOW - 28.5 * DAY }, NOW).key, 'leaves-soon');
  assert.equal(videoStatus({ ...base, startMs: NOW - 29.5 * DAY }, NOW).label, 'Ready · leaves tomorrow');
  assert.equal(videoStatus({ ...base, startMs: NOW - 31 * DAY }, NOW).key, 'expired');
  assert.equal(videoStatus({ ...base, liveBarn: null }, NOW).key, 'no-link');
  assert.match(videoStatus({ ...base, liveBarn: null, type: 'tournament' }, NOW).detail, /Tournament/);
  assert.equal(videoStatus(base, NOW, new Set(['x'])).key, 'downloaded');
  assert.equal(videoStatus({ ...base, startMs: NOW - 40 * DAY }, NOW, new Set(['x'])).key, 'downloaded');
});

test('splitGames filters by kid and orders recent and upcoming', () => {
  const { recent, upcoming } = splitGames(all, 'Lucas', NOW);
  assert.ok(recent.every((g) => g.kid === 'Lucas') && upcoming.every((g) => g.kid === 'Lucas'));
  for (let i = 1; i < recent.length; i += 1) assert.ok(recent[i - 1].startMs >= recent[i].startMs);
  for (let i = 1; i < upcoming.length; i += 1) assert.ok(upcoming[i - 1].startMs <= upcoming[i].startMs);
  const both = splitGames(all, 'all', NOW);
  assert.equal(both.recent.length + both.upcoming.length, all.length);
});

test('summarize counts statuses on real data', () => {
  const s = summarize(all, NOW);
  assert.ok(s.ready > 0, 'some games are ready');
  assert.ok(s.noLink > 0, 'some of Grace\'s games have no LiveBarn link');
  assert.equal(s.downloaded, 0);
  const marked = summarize(all, NOW, new Set([lucasGames.find((g) => g.date === '2026-11-07').id]));
  assert.equal(marked.downloaded, 1);
});

test('record adds up final games', () => {
  const r = record(lucasGames);
  const finals = lucasGames.filter((g) => g.result);
  assert.equal(r.w + r.l + r.t, finals.length);
  assert.equal(r.gf, finals.reduce((s, g) => s + g.result.us, 0));
});
