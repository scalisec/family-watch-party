import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLiveBarn, normalizeGame } from '../js/games.js';
import { parseRinkInput, windowStart, watchUrl, buildDirectory, suggest, setRink, clearRink, withRinks, sameRinkGames, rinkKey } from '../js/rinks.js';
import { emptyRecord, normalizeRecord } from '../js/library.js';
import { TEAMS } from '../js/config.js';

const feed = (f) => { const d = JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url))); return Array.isArray(d) ? d : d.games; };

test('reads a LiveBarn rink from a number, a video link or a referral link', () => {
  assert.equal(parseRinkInput('4334'), '4334');
  assert.equal(parseRinkInput('https://watch.livebarn.com/en/video/4334/2026-11-07/13:00'), '4334');
  assert.equal(parseRinkInput('https://livebarn.com/en/video/4191'), '4191');
  assert.equal(parseRinkInput('https://join.livebarn.com/mzx?rsLandingPage=https://livebarn.com/en/video/4191/2026-10-03/13:00'), '4191');
  assert.equal(parseRinkInput('https://example.com/video/4334'), null, 'only LiveBarn links');
  assert.equal(parseRinkInput('Clearwater'), null);
});

test('LiveBarn windows start on the hour or half hour', () => {
  assert.equal(windowStart('13:15'), '13:00');
  assert.equal(windowStart('8:45'), '08:30');
  assert.equal(watchUrl({ date: '2026-11-07', time: '13:15', liveBarn: { surfaceId: '4334', time: '13:00' } }), 'https://watch.livebarn.com/en/video/4334/2026-11-07/13:00');
});

test('the rink list comes from the league schedules, one entry per arena and rink', () => {
  const rows = [...feed('2712.json'), ...feed('bghc-2066.json')];
  const dir = buildDirectory(rows, parseLiveBarn);
  assert.ok(dir.length > 3);
  assert.equal(new Set(dir.map((d) => d.key)).size, dir.length);
  const appleby = dir.find((d) => d.key === rinkKey('Appleby (3)'));
  assert.ok(appleby && /^\d+$/.test(appleby.surfaceId));
  assert.equal(appleby.name, 'Appleby Rink 3');
  const s = suggest(dir, 'Appleby (3)');
  assert.equal(s[0].key, appleby.key, 'the same rink comes first');
});

test('a picked rink gives the game a LiveBarn link; the schedule\'s own link always wins', () => {
  const team = TEAMS.find((t) => t.kid === 'Grace');
  const games = feed('bghc-2066.json').map((r) => normalizeGame(r, team));
  const bare = games.filter((g) => !g.liveBarn && g.venue);
  assert.ok(bare.length >= 2);
  const g = bare[0];
  const others = sameRinkGames(games, g);
  let rec = setRink(emptyRecord(), [g.id, ...others.map((o) => o.id)], { surfaceId: '9999', name: 'Test rink' }, 'T');
  rec = normalizeRecord(JSON.parse(JSON.stringify(rec)));
  const after = withRinks(games, rec);
  const picked = after.find((x) => x.id === g.id);
  assert.equal(picked.liveBarn.surfaceId, '9999');
  assert.equal(picked.liveBarn.picked, true);
  for (const o of others) assert.equal(after.find((x) => x.id === o.id).liveBarn.surfaceId, '9999');
  const linked = games.find((x) => x.liveBarn);
  if (linked) {
    const forced = withRinks([linked], setRink(emptyRecord(), [linked.id], { surfaceId: '1' }));
    assert.equal(forced[0].liveBarn.surfaceId, linked.liveBarn.surfaceId);
  }
  assert.equal(withRinks([g], clearRink(rec, g.id))[0].liveBarn, null);
});

test('home and game pages use picked rinks and offer Open in LiveBarn', () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(read('js/home.js'), /withRinks\(/);
  assert.match(read('js/home.js'), /Open in LiveBarn/);
  assert.match(read('js/join-page.js'), /watchUrl\(/);
  assert.doesNotMatch(read('js/rink-picker.js'), /innerHTML/);
});

test('rink suggestions need a shared arena name, not just a rink number', () => {
  const dir = [
    { key: rinkKey('Gretzky Center (#4)'), venue: 'Gretzky Center (#4)', name: 'Gretzky Center #4', surfaceId: '4548' },
    { key: rinkKey('Appleby (2)'), venue: 'Appleby (2)', name: 'Appleby Rink 2', surfaceId: '4333' },
    { key: rinkKey('Appleby (3)'), venue: 'Appleby (3)', name: 'Appleby Rink 3', surfaceId: '4334' },
  ];
  assert.deepEqual(suggest(dir, 'Seymour-Hannah Sports & Entertainment Center (Sportsplex 4)'), []);
  assert.deepEqual(suggest(dir, 'Appleby Ice Centre (3)').map((d) => d.surfaceId), ['4334', '4333'], 'same arena, matching rink number first');
});
