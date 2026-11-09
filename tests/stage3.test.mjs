import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGame } from '../js/games.js';
import { TEAMS, GOOGLE_SCOPES, GOOGLE_CLIENT_ID } from '../js/config.js';
import { parseTeamSnapEvent, mergeGames } from '../js/teamsnap.js';
import { parseVideoFileName, matchFile, rinkScore, viewFromSize, kindFor } from '../js/import-match.js';
import {
  folderPath, gameFolderName, fullGameFileName, emptyRecord, normalizeRecord, addFile, downloadedIds,
  gameSummary, nextPart, alreadyImported, nextRange, totals, CHUNK, shortTournament, extensionOf,
} from '../js/library.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = path.join(root, 'tests');
const fixture = (f) => JSON.parse(readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const [LUCAS, GRACE] = TEAMS;
const league = [
  ...fixture('2712.json').map((r) => normalizeGame(r, LUCAS)),
  ...fixture('bghc-2066.json').map((r) => normalizeGame(r, GRACE)),
];
const ev = fixture('teamsnap-events.json');
const tsLucas = ev.lucas.map((e) => parseTeamSnapEvent(e, LUCAS)).filter(Boolean);
const tsGrace = ev.grace.map((e) => parseTeamSnapEvent(e, GRACE)).filter(Boolean);
const woodstock = league.find((g) => g.kid === 'Lucas' && g.date === '2026-11-07');

// ---------- config ----------
test('Google config: client id and only the two narrow scopes', () => {
  assert.match(GOOGLE_CLIENT_ID, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
  assert.deepEqual(GOOGLE_SCOPES, ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.readonly']);
  for (const t of TEAMS) assert.ok(t.calendarName, `${t.kid} needs a calendar name`);
});

// ---------- TeamSnap ----------
test('parseTeamSnapEvent keeps games, skips practices, holds, meetings and all-day events', () => {
  assert.deepEqual(tsLucas.map((g) => g.id), ['lucas-ts-lw1', 'lucas-ts-lt1', 'lucas-ts-lt2', 'lucas-ts-lt3']);
  assert.deepEqual(tsGrace.map((g) => g.id), ['grace-ts-gh1', 'grace-ts-gb1']);
});

test('parseTeamSnapEvent reads opponent, home/away, rink and tournament', () => {
  const oak = tsLucas.find((g) => g.id === 'lucas-ts-lt1');
  assert.equal(oak.opponentLabel, 'at Oakridge Aeros');
  assert.equal(oak.isHome, false);
  assert.equal(oak.date, '2026-11-20');
  assert.equal(oak.time, '10:00');
  assert.equal(oak.rink, 'London Sports Park - South');
  assert.equal(oak.tournament, '2026 Nazem Kadri North London Classic Tournament');
  assert.equal(oak.type, 'tournament');
  assert.equal(oak.source, 'teamsnap');
  const canton = tsLucas.find((g) => g.id === 'lucas-ts-lt2');
  assert.equal(canton.opponentLabel, 'vs Canton Wolves');
  assert.equal(canton.tournament, '2026 Nazem Kadri North London Classic Tournament');
  const champ = tsGrace.find((g) => g.id === 'grace-ts-gb1');
  assert.equal(champ.opponent, 'B Championship - TBD');
  assert.equal(champ.rink, 'Seymour-Hannah Sports & Entertainment Center (Sportsplex 4)');
});

test('mergeGames: league games win; TeamSnap-only tournament games are added', () => {
  const merged = mergeGames(league, [...tsLucas, ...tsGrace]);
  const added = merged.filter((g) => g.source === 'teamsnap').map((g) => g.id).sort();
  assert.deepEqual(added, ['lucas-ts-lt1', 'lucas-ts-lt2', 'lucas-ts-lt3']);
  assert.equal(merged.length, league.length + 3);
  assert.ok(merged.some((g) => g.id === woodstock.id), 'league Woodstock game kept');
});

test('mergeGames: a game with no tournament line takes its weekend neighbour\'s', () => {
  const merged = mergeGames(league, tsLucas);
  const brydges = merged.find((g) => g.id === 'lucas-ts-lt3');
  assert.equal(brydges.tournament, '2026 Nazem Kadri North London Classic Tournament');
  assert.equal(brydges.type, 'tournament');
  assert.equal(tsLucas.find((g) => g.id === 'lucas-ts-lt3').tournament, '', 'input not changed');
});

test('mergeGames: same kid only, so a Grace event never hides a Lucas game', () => {
  const fake = { ...tsGrace[0], startMs: woodstock.startMs, kid: 'Grace' };
  const merged = mergeGames(league, [fake]);
  assert.equal(merged.length, league.length + 1);
});

// ---------- file names ----------
test('parseVideoFileName: LiveBarn file names', () => {
  const p = parseVideoFileName('Appleby_Ice_Centre_Rink_3_(LEAGUE_PARTNER_GAMES_ONLY)_2026-11-07T131423.mp4');
  assert.deepEqual({ ...p }, { source: 'livebarn', rink: 'Appleby Ice Centre Rink 3', date: '2026-11-07', minutes: 13 * 60 + 14, seconds: 13 * 3600 + 14 * 60 + 23 });
  assert.equal(parseVideoFileName('Mainway_Arena_Rink_1_2026-10-25T175959.MP4').minutes, 17 * 60 + 59);
});

test('parseVideoFileName: helper file names, and anything else', () => {
  const p = parseVideoFileName('2026-11-07 vs Woodstock Jr Navy Vets part 2 (1344).mp4');
  assert.equal(p.source, 'helper');
  assert.equal(p.part, 2);
  assert.equal(p.minutes, 13 * 60 + 44);
  assert.equal(parseVideoFileName('2026-11-07 vs Woodstock part 1 (1314) PANO.mp4').source, 'helper');
  assert.equal(parseVideoFileName('Lucas breakaway.mp4').source, 'other');
  assert.equal(parseVideoFileName('').source, 'other');
});

test('rinkScore compares the meaningful words', () => {
  assert.equal(rinkScore('Appleby Ice Centre Rink 3', 'Appleby (3) Appleby Rink 3'), 2);
  assert.equal(rinkScore('Mainway Arena Rink 1', 'Appleby (3)'), 0);
});

// ---------- matching ----------
test('matchFile: both LiveBarn files from the test match the Woodstock game', () => {
  for (const name of ['Appleby_Ice_Centre_Rink_3_(LEAGUE_PARTNER_GAMES_ONLY)_2026-11-07T131423.mp4',
    'Appleby_Ice_Centre_Rink_3_(LEAGUE_PARTNER_GAMES_ONLY)_2026-11-07T125952.mp4']) {
    const m = matchFile(parseVideoFileName(name), league);
    assert.equal(m.game && m.game.id, woodstock.id, name);
    assert.equal(m.confidence, 'high');
  }
});

test('matchFile: rink decides between two kids\' games close together', () => {
  const games = [
    { id: 'L', kid: 'Lucas', date: '2026-11-07', time: '13:15', venue: 'Appleby (3)', rink: 'Appleby Rink 3' },
    { id: 'G', kid: 'Grace', date: '2026-11-07', time: '15:30', venue: 'Seymour-Hannah Sports & Entertainment Center (Sportsplex 4)', rink: '' },
  ];
  const m = matchFile(parseVideoFileName('Seymour-Hannah_Sports_&_Entertainment_Center_Sportsplex_4_2026-11-07T145000.mp4'), games);
  assert.equal(m.game.id, 'G');
  assert.equal(m.confidence, 'high');
  const a = matchFile(parseVideoFileName('Appleby_Ice_Centre_Rink_3_2026-11-07T145000.mp4'), games);
  assert.equal(a.game.id, 'L');
});

test('matchFile: low confidence when the rink name doesn\'t fit; none off-schedule', () => {
  const games = [{ id: 'L', kid: 'Lucas', date: '2026-11-07', time: '13:15', venue: 'Appleby (3)', rink: 'Appleby Rink 3' }];
  assert.equal(matchFile(parseVideoFileName('Mainway_Arena_Rink_1_2026-11-07T130000.mp4'), games).confidence, 'low');
  assert.equal(matchFile(parseVideoFileName('Appleby_Rink_3_2026-11-08T130000.mp4'), games).confidence, 'none');
  assert.equal(matchFile(parseVideoFileName('Appleby_Rink_3_2026-11-07T090000.mp4'), games).confidence, 'none');
  assert.equal(matchFile(parseVideoFileName('Lucas goal.mp4'), games).confidence, 'none');
});

test('viewFromSize and kindFor', () => {
  assert.equal(viewFromSize(3840, 1920), 'PANO');
  assert.equal(viewFromSize(1280, 720), 'AUTO');
  assert.equal(viewFromSize(0, 0), '');
  assert.equal(kindFor({ source: 'livebarn' }, 900), 'full');
  assert.equal(kindFor({ source: 'other' }, 25), 'clip');
  assert.equal(kindFor({ source: 'other' }, 1800), 'full');
});

// ---------- folders and names ----------
test('folderPath puts season and team label in the path', () => {
  assert.deepEqual(folderPath(woodstock, LUCAS, 'full'),
    ['Family Hockey', 'Lucas', '2026-27 U10BB Bulldogs Blue', '2026-11-07 vs Woodstock Jr Navy Vets', 'full game']);
  assert.equal(folderPath(woodstock, LUCAS, 'clip').at(-1), 'clips');
});

test('tournament games carry a short tournament name in the folder', () => {
  const merged = mergeGames(league, tsLucas);
  const oak = merged.find((g) => g.id === 'lucas-ts-lt1');
  assert.equal(shortTournament(oak.tournament), 'Nazem Kadri North London Classic');
  assert.equal(gameFolderName(oak), '2026-11-20 Nazem Kadri North London Classic – at Oakridge Aeros');
});

test('file names are tidy and safe', () => {
  assert.equal(fullGameFileName(woodstock, 1, 13 * 60 + 14, 'PANO'), '2026-11-07 vs Woodstock Jr Navy Vets part 1 (1314) PANO.mp4');
  assert.equal(fullGameFileName(woodstock, 2, NaN, ''), '2026-11-07 vs Woodstock Jr Navy Vets part 2.mp4');
  assert.ok(!/[\\/:*?"<>|]/.test(gameFolderName({ ...woodstock, opponentLabel: 'at A/B: "C"?' })));
  assert.equal(extensionOf('clip.MOV'), 'mov');
  assert.equal(extensionOf('noext'), 'mp4');
});

// ---------- record ----------
test('record: add files, summarize, part numbers, duplicates', () => {
  let r = emptyRecord();
  const orig = { name: 'Appleby_..._T131423.mp4', size: 415731712, lastModified: 1 };
  assert.equal(nextPart(r, woodstock.id, 'PANO'), 1);
  r = addFile(r, woodstock.id, { driveId: 'a', name: 'x', kind: 'full', view: 'PANO', start: 854, size: 415731712, original: orig }, 'T1');
  r = addFile(r, woodstock.id, { driveId: 'b', name: 'y', kind: 'full', view: 'AUTO', start: 854, size: 479744000, original: { name: 'auto.mp4', size: 479744000 } }, 'T2');
  r = addFile(r, woodstock.id, { driveId: 'c', name: 'z', kind: 'clip', view: '', size: 3000000, original: { name: 'goal.mp4', size: 3000000 } }, 'T3');
  assert.deepEqual([...downloadedIds(r)], [woodstock.id]);
  assert.deepEqual(gameSummary(r, woodstock.id), { full: 2, clips: 1, views: ['PANO', 'AUTO'], joined: false, toJoin: true });
  assert.equal(nextPart(r, woodstock.id, 'PANO'), 2);
  assert.equal(nextPart(r, woodstock.id, 'AUTO'), 2);
  assert.equal(alreadyImported(r, { name: orig.name, size: orig.size }), true);
  assert.equal(alreadyImported(r, { name: orig.name, size: 1 }), false);
  assert.deepEqual(totals(r), { games: 1, full: 2, clips: 1, bytes: 415731712 + 479744000 + 3000000 });
  assert.equal(r.updatedAt, 'T3');
});

test('record: a game with only clips is not "downloaded"; bad records reset safely', () => {
  const r = addFile(emptyRecord(), 'g1', { kind: 'clip', size: 1 });
  assert.equal(downloadedIds(r).size, 0);
  assert.deepEqual(normalizeRecord(null), emptyRecord());
  assert.deepEqual(normalizeRecord({ games: 'x' }), emptyRecord());
  assert.deepEqual(normalizeRecord(r).games, r.games);
});

test('nextRange makes Drive-sized pieces with the right header', () => {
  assert.equal(CHUNK % (256 * 1024), 0);
  assert.deepEqual(nextRange(0, 100, 40), { start: 0, end: 39, header: 'bytes 0-39/100' });
  assert.deepEqual(nextRange(80, 100, 40), { start: 80, end: 99, header: 'bytes 80-99/100' });
  const size = 415731712;
  let offset = 0; let pieces = 0;
  while (offset < size) { const r = nextRange(offset, size); offset = r.end + 1; pieces += 1; }
  assert.equal(pieces, Math.ceil(size / CHUNK));
});

// ---------- pages ----------
test('import.html: every id import-page.js uses exists; labels point at fields', () => {
  const html = read('import.html');
  const js = read('js/import-page.js');
  for (const id of new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))) assert.match(html, new RegExp(`id="${id}"`), `#${id} missing`);
  for (const m of html.matchAll(/<label[^>]* for="([^"]+)"/g)) assert.match(html, new RegExp(`id="${m[1]}"`));
});

test('no page script writes HTML strings', () => {
  for (const f of ['js/home.js', 'js/import-page.js', 'js/google.js', 'js/drive.js', 'js/calendar.js', 'js/ui.js']) {
    assert.doesNotMatch(read(f), /innerHTML|outerHTML|insertAdjacentHTML/, f);
  }
});

test('Google calls go only to Google\'s API hosts', () => {
  const hosts = new Set();
  for (const f of ['js/google.js', 'js/drive.js', 'js/calendar.js']) {
    for (const m of read(f).matchAll(/https:\/\/([a-z0-9.-]+)\//g)) hosts.add(m[1]);
  }
  assert.deepEqual([...hosts].sort(), ['accounts.google.com', 'www.googleapis.com']);
});

test('version matches across every page', () => {
  const v = JSON.parse(read('package.json')).version.replace(/\./g, '\\.');
  for (const page of ['index.html', 'pano-check.html', 'helper-test.html', 'import.html', 'join.html']) {
    assert.match(read(page), new RegExp(`V${v}<`), page);
  }
});

test('files named like clips are treated as clips even without a length', async () => {
  const { parseVideoFileName, kindFor } = await import('../js/import-match.js');
  assert.equal(kindFor(parseVideoFileName('Grace goal clip.mp4'), undefined), 'clip');
  assert.equal(kindFor(parseVideoFileName('Lucas highlights.mp4'), 3600), 'clip');
  assert.equal(kindFor(parseVideoFileName('game recording.mp4'), 3600), 'full');
});
